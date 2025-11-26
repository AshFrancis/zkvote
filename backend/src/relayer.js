import express from 'express';
import * as StellarSdk from '@stellar/stellar-sdk';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

dotenv.config();

const app = express();

// Security: HTTP headers
app.use(helmet());

// Security: CORS configuration
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : '*';
const corsOptions = {
  origin: corsOrigins,  // In production, set to specific origin
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  maxAge: 86400  // 24 hours
};
app.use(cors(corsOptions));

// Security: Request body size limit
app.use(express.json({ limit: '100kb' }));  // Reduced from 1mb

// Security: Rate limiting (per-IP hashed to avoid storing raw IP)
const hashIp = (ip) => crypto.createHash('sha256').update(ip || '').digest('hex');
const limiterKeyGen = (req) => hashIp(req.ip || '');

const voteLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 10,  // 10 votes per minute per IP
  message: { error: 'Too many vote requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: limiterKeyGen,
});

const queryLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 60,  // 60 queries per minute per IP
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: limiterKeyGen,
});

// Minimal structured logger with proof redaction
const log = (level, event, meta = {}) => {
  const safe = { ...meta };
  if (safe.proof) safe.proof = '[redacted]';
  if (safe.nullifier) safe.nullifier = '[redacted]';
  if (safe.commitment) safe.commitment = '[redacted]';
  console.log(JSON.stringify({ level, event, ...safe }));
};

// Configuration
const RPC_URL = process.env.SOROBAN_RPC_URL || 'http://localhost:8000/soroban/rpc';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || 'Standalone Network ; February 2017';
const PORT = process.env.PORT || 3001;
const RELAYER_AUTH_TOKEN = process.env.RELAYER_AUTH_TOKEN; // optional shared secret to gate vote API
const LOG_CLIENT_IP = process.env.LOG_CLIENT_IP; // 'plain' | 'hash' | undefined
const HEALTH_EXPOSE_DETAILS = process.env.HEALTH_EXPOSE_DETAILS !== 'false'; // hide relayer/contract ids when false
const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS || 10_000);
const LOG_REQUEST_BODY = process.env.LOG_REQUEST_BODY !== 'false'; // disable to avoid logging body meta
const STRIP_REQUEST_BODIES = process.env.STRIP_REQUEST_BODIES === 'true'; // drop bodies entirely from logs/handlers
const STATIC_VK_VERSION = process.env.VOTING_VK_VERSION
  ? Number(process.env.VOTING_VK_VERSION)
  : undefined;

// Contract IDs - MUST be set or server won't start
const VOTING_CONTRACT_ID = process.env.VOTING_CONTRACT_ID;
const TREE_CONTRACT_ID = process.env.TREE_CONTRACT_ID;

function validateEnv() {
  const missing = [];
  if (!VOTING_CONTRACT_ID) missing.push('VOTING_CONTRACT_ID');
  if (!TREE_CONTRACT_ID) missing.push('TREE_CONTRACT_ID');
  if (!process.env.RELAYER_SECRET_KEY) missing.push('RELAYER_SECRET_KEY');
  if (!RPC_URL) missing.push('SOROBAN_RPC_URL');
  if (!NETWORK_PASSPHRASE) missing.push('NETWORK_PASSPHRASE');

  if (missing.length > 0) {
    log('error', 'missing_env', { missing });
    console.error('\nRun ./scripts/init-local.sh to generate backend/.env'); // keep human-readable tip
    process.exit(1);
  }

  if (!isValidContractId(VOTING_CONTRACT_ID)) {
    log('error', 'invalid_contract_id', { var: 'VOTING_CONTRACT_ID', value: VOTING_CONTRACT_ID });
    process.exit(1);
  }
  if (!isValidContractId(TREE_CONTRACT_ID)) {
    log('error', 'invalid_contract_id', { var: 'TREE_CONTRACT_ID', value: TREE_CONTRACT_ID });
    process.exit(1);
  }
}

validateEnv();

// Minimal request-scoped logging with optional IP hashing
app.use((req, res, next) => {
  const ctx = crypto.randomBytes(6).toString('hex');
  const ipMeta =
    LOG_CLIENT_IP === 'plain'
      ? { ip: req.ip }
      : LOG_CLIENT_IP === 'hash'
        ? { ipHash: crypto.createHash('sha256').update(req.ip || '').digest('hex').slice(0, 12) }
        : {};

  const bodyMeta = LOG_REQUEST_BODY ? { bodyKeys: Object.keys(req.body || {}) } : {};
  log('info', 'request_start', { ctx, path: req.path, method: req.method, ...ipMeta, ...bodyMeta });

  res.on('finish', () => {
    log('info', 'request_end', { ctx, path: req.path, status: res.statusCode });
  });

  next();
});

// Relayer account
let relayerKeypair;
try {
  if (process.env.RELAYER_TEST_MODE === 'true') {
    relayerKeypair = {
      publicKey: () => 'GTESTRELAYERADDRESS000000000000000000000000000000000000',
    };
    log('info', 'relayer_loaded', { relayer: relayerKeypair.publicKey(), testMode: true });
  } else {
    if (!process.env.RELAYER_SECRET_KEY) {
      throw new Error('RELAYER_SECRET_KEY is not set');
    }
    relayerKeypair = StellarSdk.Keypair.fromSecret(process.env.RELAYER_SECRET_KEY);
    log('info', 'relayer_loaded', { relayer: relayerKeypair.publicKey() });
  }
} catch (err) {
  log('error', 'invalid_relayer_key', { message: err.message });
  console.error('Run ./scripts/init-local.sh to generate a secure key'); // keep human-readable tip
  process.exit(1);
}

// Soroban RPC client (test mode uses stubbed client)
const server =
  process.env.RELAYER_TEST_MODE === 'true'
    ? {
        getHealth: async () => ({ status: 'online' }),
        simulateTransaction: async () => {
          throw new Error('simulate disabled in RELAYER_TEST_MODE');
        },
        sendTransaction: async () => ({ status: 'ERROR', errorResult: 'disabled' }),
        getTransaction: async () => ({ status: 'NOT_FOUND' }),
        getAccount: async () => ({ accountId: 'GTEST', sequence: '0' }),
      }
    : new StellarSdk.rpc.Server(RPC_URL, { allowHttp: true });

async function rpcHealth() {
  try {
    const info = await server.getHealth();
    return { ok: info?.status === 'online', info };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function callWithTimeout(fn, label) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout: ${label} (${RPC_TIMEOUT_MS}ms)`)), RPC_TIMEOUT_MS)
  );
  return Promise.race([fn(), timeout]);
}

// Optional shared-secret guard to reduce spam/abuse on write endpoints
function authGuard(req, res, next) {
  if (!RELAYER_AUTH_TOKEN) return next();
  const token = extractAuthToken(req);

  if (token !== RELAYER_AUTH_TOKEN) {
    log('warn', 'auth_failed', { path: req.path });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

function extractAuthToken(req) {
  const header = req.headers['x-relayer-auth'] || req.headers['authorization'];
  return typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : header;
}

// Health check (no rate limit)
app.get('/health', async (_req, res) => {
  const rpc = process.env.HEALTHCHECK_PING === 'true' ? await rpcHealth() : { ok: true };
  const base = {
    status: 'ok',
    rpc,
  };

  if (HEALTH_EXPOSE_DETAILS) {
    if (RELAYER_AUTH_TOKEN) {
      const token = extractAuthToken(_req);
      if (token !== RELAYER_AUTH_TOKEN) {
        return res.status(200).json({ status: 'ok', rpc });
      }
    }
    base.relayer = relayerKeypair.publicKey();
    base.votingContract = VOTING_CONTRACT_ID;
    base.treeContract = TREE_CONTRACT_ID;
    base.vkVersion = STATIC_VK_VERSION;
  }

  res.json(base);
});

// Readiness check (auth optional, but details only with token)
app.get('/ready', async (_req, res) => {
  try {
    const rpcStatus = await rpcHealth();
    if (!rpcStatus.ok) {
      return res.status(503).json({ status: 'degraded', rpc: rpcStatus });
    }

    const base = { status: 'ready' };
    if (HEALTH_EXPOSE_DETAILS) {
      if (RELAYER_AUTH_TOKEN) {
        const token = extractAuthToken(_req);
        if (token === RELAYER_AUTH_TOKEN) {
          base.relayer = relayerKeypair.publicKey();
          base.votingContract = VOTING_CONTRACT_ID;
          base.treeContract = TREE_CONTRACT_ID;
          base.vkVersion = STATIC_VK_VERSION;
        }
      } else {
        base.relayer = relayerKeypair.publicKey();
        base.votingContract = VOTING_CONTRACT_ID;
        base.treeContract = TREE_CONTRACT_ID;
        base.vkVersion = STATIC_VK_VERSION;
      }
    }
    return res.json(base);
  } catch (err) {
    log('error', 'ready_exception', { message: err.message });
    return res.status(503).json({ status: 'error', error: 'Ready check failed' });
  }
});

// Lightweight config surface (no secrets)
app.get('/config', (req, res) => {
  if (RELAYER_AUTH_TOKEN) {
    const token = extractAuthToken(req);
    if (token !== RELAYER_AUTH_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const base = {
    votingContract: VOTING_CONTRACT_ID,
    treeContract: TREE_CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpc: RPC_URL,
    vkVersion: STATIC_VK_VERSION,
  };
  return res.json(base);
});

// Submit anonymous vote (with rate limiting)
app.post('/vote', authGuard, voteLimiter, async (req, res) => {
  const { daoId, proposalId, choice, nullifier, root, commitment, proof } = STRIP_REQUEST_BODIES
    ? {}
    : req.body;

  if (process.env.RELAYER_TEST_MODE === 'true') {
    // In test mode, avoid hitting real RPC/contract constructors
    return res.status(400).json({ error: 'Simulation failed (test mode)' });
  }

  // Validate required fields
  if (daoId === undefined || proposalId === undefined || choice === undefined ||
      !nullifier || !root || !commitment || !proof) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate types
  if (!Number.isInteger(daoId) || daoId < 0) {
    return res.status(400).json({ error: 'daoId must be a non-negative integer' });
  }
  if (!Number.isInteger(proposalId) || proposalId < 0) {
    return res.status(400).json({ error: 'proposalId must be a non-negative integer' });
  }
  if (typeof choice !== 'boolean') {
    return res.status(400).json({ error: 'choice must be a boolean' });
  }

  // Validate U256 hex strings
  if (!isValidU256Hex(nullifier)) {
    return res.status(400).json({ error: 'nullifier must be a valid hex string (up to 64 chars)' });
  }
  if (!isValidU256Hex(root)) {
    return res.status(400).json({ error: 'root must be a valid hex string (up to 64 chars)' });
  }
  if (!isValidU256Hex(commitment)) {
    return res.status(400).json({ error: 'commitment must be a valid hex string (up to 64 chars)' });
  }

  // Validate proof structure
  if (!proof.a || !proof.b || !proof.c) {
    return res.status(400).json({ error: 'proof must contain a, b, and c fields' });
  }
  if (!isValidHex(proof.a, 128)) {
    return res.status(400).json({ error: 'proof.a must be a valid hex string (64 bytes)' });
  }
  if (!isValidHex(proof.b, 256)) {
    return res.status(400).json({ error: 'proof.b must be a valid hex string (128 bytes)' });
  }
  if (!isValidHex(proof.c, 128)) {
    return res.status(400).json({ error: 'proof.c must be a valid hex string (64 bytes)' });
  }

  try {
    log('info', 'vote_request', { daoId, proposalId });

    // Build the contract call
    const contract = new StellarSdk.Contract(VOTING_CONTRACT_ID);

    // Convert inputs to Soroban types
    const args = [
      StellarSdk.nativeToScVal(daoId, { type: 'u64' }),                    // dao_id
      StellarSdk.nativeToScVal(proposalId, { type: 'u64' }),               // proposal_id
      StellarSdk.nativeToScVal(choice, { type: 'bool' }),                  // choice
      u256ToScVal(nullifier),                                              // nullifier
      u256ToScVal(root),                                                   // root
      u256ToScVal(commitment),                                             // commitment (NEW)
      proofToScVal(proof)                                                  // proof
    ];

    const operation = contract.call('vote', ...args);

    // Get relayer account
    const account = await server.getAccount(relayerKeypair.publicKey());

    // Build transaction
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100000', // 0.01 XLM
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    // Simulate transaction
    log('info', 'simulate_vote', { daoId, proposalId });
    const simResult = await callWithTimeout(
      () => simulateWithBackoff(() => server.simulateTransaction(tx)),
      'simulate_vote'
    );

    if (!StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
      log('warn', 'simulation_failed', { daoId, proposalId, error: simResult.error });

      // Extract user-friendly error message from contract panic
      let errorMessage = 'Transaction simulation failed';

      // Check for contract error in simulation result
      if (simResult.error) {
        const errorStr = JSON.stringify(simResult.error);

        // Common contract errors
        if (errorStr.includes('already voted')) {
          errorMessage = 'You have already voted on this proposal';
        } else if (errorStr.includes('voting period closed')) {
          errorMessage = 'Voting period has ended';
        } else if (errorStr.includes('invalid proof')) {
          errorMessage = 'Invalid vote proof';
        } else if (errorStr.includes('root must match')) {
          errorMessage = 'You are not eligible to vote on this proposal';
        } else if (errorStr.includes('proposal not found')) {
          errorMessage = 'Proposal not found';
        } else if (errorStr.includes('UnreachableCodeReached')) {
          errorMessage = 'Invalid proof or contract error (proof verification failed)';
        } else {
          // Try to extract any panic message
          const panicMatch = errorStr.match(/Error\(Contract, #\d+\)/);
          if (panicMatch) {
            errorMessage = 'Contract error: ' + panicMatch[0];
          }
        }
      }

      return res.status(400).json({ error: errorMessage });
    }

    // Prepare and sign
    const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simResult).build();
    preparedTx.sign(relayerKeypair);

    // Submit
    log('info', 'submit_vote', { daoId, proposalId });
    const sendResult = await callWithTimeout(
      () => server.sendTransaction(preparedTx),
      'send_vote'
    );

    if (sendResult.status === 'ERROR') {
      log('error', 'submit_failed', { daoId, proposalId, error: sendResult.errorResult });
      return res.status(500).json({ error: 'Transaction submission failed' });
    }

    // Wait for confirmation
    log('info', 'submitted', { txHash: sendResult.hash, daoId, proposalId });
    const result = await callWithTimeout(
      () => waitForTransaction(sendResult.hash),
      'wait_for_vote'
    );

    if (result.status === 'SUCCESS') {
      log('info', 'vote_success', { txHash: sendResult.hash, daoId, proposalId });
      res.json({
        success: true,
        txHash: sendResult.hash,
        status: result.status
      });
    } else {
      log('error', 'vote_failed', { txHash: sendResult.hash, status: result.status });
      res.status(500).json({
        error: 'Transaction failed',
        txHash: sendResult.hash,
        status: result.status
      });
    }
  } catch (err) {
    log('error', 'vote_exception', { message: err.message, stack: err.stack });
    res.status(500).json({
      error: 'Internal server error',
      message: err.message
    });
  }
});

// Get proposal info (convenience endpoint, with rate limiting)
app.get('/proposal/:daoId/:proposalId', queryLimiter, async (req, res) => {
  const { daoId, proposalId } = req.params;

  try {
    const contract = new StellarSdk.Contract(VOTING_CONTRACT_ID);
    const args = [
      StellarSdk.nativeToScVal(parseInt(daoId), { type: 'u64' }),
      StellarSdk.nativeToScVal(parseInt(proposalId), { type: 'u64' })
    ];

    const operation = contract.call('get_results', ...args);

    const account = await server.getAccount(relayerKeypair.publicKey());
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simResult = await callWithTimeout(
      () => simulateWithBackoff(() => server.simulateTransaction(tx)),
      'simulate_get_results'
    );

    if (StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
      const result = simResult.result?.retval;
      if (result) {
        const [yesVotes, noVotes] = StellarSdk.scValToNative(result);
        res.json({ daoId, proposalId, yesVotes, noVotes });
      } else {
        res.status(404).json({ error: 'Proposal not found' });
      }
    } else {
      res.status(400).json({ error: 'Failed to get proposal info' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get current Merkle root for a DAO (with rate limiting)
app.get('/root/:daoId', queryLimiter, async (req, res) => {
  const { daoId } = req.params;

  try {
    const contract = new StellarSdk.Contract(TREE_CONTRACT_ID);
    const args = [StellarSdk.nativeToScVal(parseInt(daoId), { type: 'u64' })];

    const operation = contract.call('current_root', ...args);

    const account = await server.getAccount(relayerKeypair.publicKey());
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simResult = await callWithTimeout(
      () => simulateWithBackoff(() => server.simulateTransaction(tx)),
      'simulate_current_root'
    );

    if (StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
      const result = simResult.result?.retval;
      if (result) {
        const rootHex = scValToU256Hex(result);
        res.json({ daoId, root: rootHex });
      } else {
        res.status(404).json({ error: 'DAO tree not found' });
      }
    } else {
      res.status(400).json({ error: 'Failed to get root' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Global error handler (last middleware)
app.use((err, req, res, _next) => {
  log('error', 'unhandled_error', { path: req.path, message: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

// Helper: Convert U256 hex string to ScVal
function u256ToScVal(hexString) {
  // Remove 0x prefix if present
  const hex = hexString.startsWith('0x') ? hexString.slice(2) : hexString;

  // Validate hex string format (even length, valid chars)
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('Invalid U256 hex string: contains non-hexadecimal characters');
  }
  if (hex.length % 2 !== 0 && hex.length > 0) {
    throw new Error(`Invalid U256 hex string: odd length (${hex.length})`);
  }
  if (hex.length > 64) {
    throw new Error(`Invalid U256 hex string: too long (${hex.length} chars, max 64)`);
  }

  // Pad to 64 characters (32 bytes)
  const padded = hex.padStart(64, '0');

  // Validate that value is in BN254 scalar field
  // BN254 scalar field modulus: 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47
  const value = BigInt('0x' + padded);
  const BN254_SCALAR_FIELD = BigInt('0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47');

  if (value >= BN254_SCALAR_FIELD) {
    throw new Error('Value exceeds BN254 scalar field modulus');
  }

  // Split into 4 u64 parts (hi_hi, hi_lo, lo_hi, lo_lo)
  const hiHi = BigInt('0x' + padded.slice(0, 16));
  const hiLo = BigInt('0x' + padded.slice(16, 32));
  const loHi = BigInt('0x' + padded.slice(32, 48));
  const loLo = BigInt('0x' + padded.slice(48, 64));

  return StellarSdk.xdr.ScVal.scvU256(
    new StellarSdk.xdr.UInt256Parts({
      hiHi: new StellarSdk.xdr.Uint64(hiHi),
      hiLo: new StellarSdk.xdr.Uint64(hiLo),
      loHi: new StellarSdk.xdr.Uint64(loHi),
      loLo: new StellarSdk.xdr.Uint64(loLo)
    })
  );
}

// Helper: Convert ScVal U256 to hex string
function scValToU256Hex(scVal) {
  if (scVal.switch().name !== 'scvU256') {
    throw new Error('Expected U256 ScVal');
  }
  const parts = scVal.u256();
  const hiHi = parts.hiHi().toBigInt().toString(16).padStart(16, '0');
  const hiLo = parts.hiLo().toBigInt().toString(16).padStart(16, '0');
  const loHi = parts.loHi().toBigInt().toString(16).padStart(16, '0');
  const loLo = parts.loLo().toBigInt().toString(16).padStart(16, '0');
  return '0x' + hiHi + hiLo + loHi + loLo;
}

// Helper: Convert proof object to ScVal
function proofToScVal(proof) {
  // proof = { a: "0x...", b: "0x...", c: "0x..." }
  //
  // BN254 Groth16 proof structure (from snarkjs):
  //   a: G1 point (64 bytes) - [x (32 bytes), y (32 bytes)]
  //   b: G2 point (128 bytes) - [x1, x2, y1, y2] (32 bytes each)
  //   c: G1 point (64 bytes) - [x (32 bytes), y (32 bytes)]
  //
  // Byte order: BIG-ENDIAN (from circuits/utils/proof_to_soroban.js)
  //   - snarkjs outputs big-endian by default
  //   - BN254 field elements are big-endian
  //   - Soroban expects big-endian BytesN
  //
  // Validation:
  //   - Proof must come from circuits/utils/proof_to_soroban.js
  //   - Do NOT reverse byte order
  //   - Do NOT modify hex strings from circuit output

  // Validate proof has expected structure
  if (!proof || typeof proof !== 'object') {
    throw new Error('Invalid proof: must be an object');
  }
  if (!proof.a || !proof.b || !proof.c) {
    throw new Error('Invalid proof: missing a, b, or c fields');
  }

  // Convert to bytes with validation
  const aBytes = hexToBytes(proof.a, 64);
  const bBytes = hexToBytes(proof.b, 128);
  const cBytes = hexToBytes(proof.c, 64);

  // Additional validation: Check for all-zero proofs (likely invalid)
  if (isAllZeros(aBytes) || isAllZeros(bBytes) || isAllZeros(cBytes)) {
    throw new Error('Invalid proof: proof components cannot be all zeros');
  }

  return StellarSdk.xdr.ScVal.scvMap([
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol('a'),
      val: StellarSdk.xdr.ScVal.scvBytes(aBytes)
    }),
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol('b'),
      val: StellarSdk.xdr.ScVal.scvBytes(bBytes)
    }),
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol('c'),
      val: StellarSdk.xdr.ScVal.scvBytes(cBytes)
    })
  ]);
}

// Helper: Convert hex string to byte array
function hexToBytes(hex, expectedLength) {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;

  // Validate hex string format
  if (!/^[0-9a-fA-F]*$/.test(cleanHex)) {
    throw new Error('Invalid hex string: contains non-hexadecimal characters');
  }

  // Validate even length (hex strings must have even length)
  if (cleanHex.length % 2 !== 0 && cleanHex.length > 0) {
    throw new Error(`Invalid hex string: odd length (${cleanHex.length})`);
  }

  // Validate length constraint
  if (cleanHex.length > expectedLength * 2) {
    throw new Error(`Hex string too long: ${cleanHex.length} chars, max ${expectedLength * 2}`);
  }

  const padded = cleanHex.padStart(expectedLength * 2, '0');
  const bytes = Buffer.from(padded, 'hex');

  if (bytes.length !== expectedLength) {
    throw new Error(`Expected ${expectedLength} bytes, got ${bytes.length}`);
  }

  return bytes;
}

// Helper: Wait for transaction confirmation
async function waitForTransaction(hash) {
  let attempts = 0;
  const maxAttempts = 30;

  while (attempts < maxAttempts) {
    const result = await server.getTransaction(hash);

    if (result.status !== 'NOT_FOUND') {
      return result;
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
  }

  throw new Error('Transaction not found after timeout');
}

// Helper: Validate U256 hex string (32 bytes max)
function isValidU256Hex(str) {
  if (typeof str !== 'string') return false;
  const hex = str.startsWith('0x') ? str.slice(2) : str;
  // Max 64 hex chars (32 bytes)
  if (hex.length === 0 || hex.length > 64) return false;
  // Must be valid hex
  return /^[0-9a-fA-F]*$/.test(hex);
}

// Helper: Validate hex string with expected length
function isValidHex(str, maxHexChars) {
  if (typeof str !== 'string') return false;
  const hex = str.startsWith('0x') ? str.slice(2) : str;
  if (hex.length > maxHexChars) return false;
  return /^[0-9a-fA-F]*$/.test(hex);
}

// Helper: Check if byte array is all zeros
function isAllZeros(bytes) {
  return bytes.every(byte => byte === 0);
}

// Helper: Validate Stellar contract ID format
function isValidContractId(contractId) {
  if (typeof contractId !== 'string') return false;
  // Stellar contract IDs are 56-character C-addresses
  if (contractId.length !== 56) return false;
  if (!contractId.startsWith('C')) return false;
  // Base32 alphabet (uppercase)
  return /^C[A-Z2-7]{55}$/.test(contractId);
}

// Start server unless running under test mode (imports should not bind ports)
if (process.env.RELAYER_TEST_MODE !== 'true') {
  app.listen(PORT, () => {
    log('info', 'relayer_start', {
      port: PORT,
      rpc: RPC_URL,
      votingContract: VOTING_CONTRACT_ID,
      treeContract: TREE_CONTRACT_ID
    });
    console.log('\nEndpoints:');
    console.log('  GET  /health              - Health check');
    console.log('  POST /vote                - Submit anonymous vote');
    console.log('  GET  /proposal/:dao/:prop - Get vote results');
    console.log('  GET  /root/:dao           - Get current Merkle root');
  });
}

export { app };
// Basic circuit-breaker helpers for RPC instability
async function simulateWithBackoff(simulateFn, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await simulateFn();
    } catch (err) {
      lastErr = err;
      await new Promise(r => setTimeout(r, 200 * i));
    }
  }
  throw lastErr;
}
