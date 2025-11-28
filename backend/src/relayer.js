import express from 'express';
import * as StellarSdk from '@stellar/stellar-sdk';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import multer from 'multer';
import {
  startIndexer,
  stopIndexer,
  getEventsForDao,
  getIndexedDaos,
  getIndexerStatus,
  addManualEvent,
} from './indexer.js';
import {
  initPinata,
  pinJSON,
  pinFile,
  fetchContent,
  fetchRawContent,
  isValidCid,
  isHealthy as isPinataHealthy,
} from './ipfs.js';

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

const ipfsUploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 uploads per minute per IP
  message: { error: 'Too many upload requests, please try again later' },
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
const GENERIC_ERRORS = process.env.RELAYER_GENERIC_ERRORS === 'true'; // when true, avoid detailed errors in /vote responses

// Contract IDs - MUST be set or server won't start
const VOTING_CONTRACT_ID = process.env.VOTING_CONTRACT_ID;
const TREE_CONTRACT_ID = process.env.TREE_CONTRACT_ID;
const COMMENTS_CONTRACT_ID = process.env.COMMENTS_CONTRACT_ID;
const DAO_REGISTRY_CONTRACT_ID = process.env.DAO_REGISTRY_CONTRACT_ID;
const MEMBERSHIP_SBT_CONTRACT_ID = process.env.MEMBERSHIP_SBT_CONTRACT_ID;

// Event Indexer Configuration
const INDEXER_ENABLED = process.env.INDEXER_ENABLED !== 'false';
const INDEXER_POLL_INTERVAL_MS = Number(process.env.INDEXER_POLL_INTERVAL_MS || 5000);

// IPFS/Pinata Configuration
const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY;
const IPFS_ENABLED = !!PINATA_JWT;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_METADATA_SIZE = 100 * 1024; // 100KB

// Multer configuration for file uploads
// Supported image types (allow all common image formats)
const ALLOWED_IMAGE_MIMES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/svg+xml', 'image/heic', 'image/heif', 'image/avif',
  'image/bmp', 'image/tiff'
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_SIZE,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    // Log the received MIME type for debugging
    log('info', 'upload_file_filter', { mimetype: file.mimetype, originalname: file.originalname });

    // Allow known image MIME types or any image/* type
    if (ALLOWED_IMAGE_MIMES.includes(file.mimetype) || file.mimetype?.startsWith('image/')) {
      cb(null, true);
    } else {
      // Create error with specific message that will be caught by error handler
      const err = new Error(`Unsupported file type: ${file.mimetype || 'unknown'}. Allowed: JPEG, PNG, GIF, WebP, AVIF, HEIC.`);
      err.code = 'INVALID_FILE_TYPE';
      cb(err);
    }
  },
});

function validateEnv() {
  const missing = [];
  if (!VOTING_CONTRACT_ID) missing.push('VOTING_CONTRACT_ID');
  if (!TREE_CONTRACT_ID) missing.push('TREE_CONTRACT_ID');
  if (!COMMENTS_CONTRACT_ID) missing.push('COMMENTS_CONTRACT_ID');
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
  if (!isValidContractId(COMMENTS_CONTRACT_ID)) {
    log('error', 'invalid_contract_id', { var: 'COMMENTS_CONTRACT_ID', value: COMMENTS_CONTRACT_ID });
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
  if (!isValidU256Hex(nullifier) || !isWithinField(nullifier)) {
    return res.status(400).json({ error: 'nullifier must be a valid hex string < BN254 modulus' });
  }
  if (!isValidU256Hex(root) || !isWithinField(root)) {
    return res.status(400).json({ error: 'root must be a valid hex string < BN254 modulus' });
  }
  if (!isValidU256Hex(commitment) || !isWithinField(commitment)) {
    return res.status(400).json({ error: 'commitment must be a valid hex string < BN254 modulus' });
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

    // Convert inputs to Soroban types with validation
    let scNullifier, scRoot, scCommitment, scProof;
    try {
      scNullifier = u256ToScVal(nullifier);
      scRoot = u256ToScVal(root);
      scCommitment = u256ToScVal(commitment);
      scProof = proofToScVal(proof);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    if (process.env.RELAYER_TEST_MODE === 'true') {
      // In test mode, stop after validation/conversion
      return res.status(400).json({ error: 'Simulation failed (test mode)' });
    }

    // Build the contract call
    const contract = new StellarSdk.Contract(VOTING_CONTRACT_ID);

    const args = [
      StellarSdk.nativeToScVal(daoId, { type: 'u64' }),                    // dao_id
      StellarSdk.nativeToScVal(proposalId, { type: 'u64' }),               // proposal_id
      StellarSdk.nativeToScVal(choice, { type: 'bool' }),                  // choice
      scNullifier,                                                         // nullifier
      scRoot,                                                              // root
      scCommitment,                                                        // commitment (NEW)
      scProof                                                              // proof
    ];

    if (process.env.RELAYER_TEST_MODE === 'true') {
      // In test mode, stop after validation/conversion
      return res.status(400).json({ error: 'Simulation failed (test mode)' });
    }

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
    res.status(500).json(
      GENERIC_ERRORS
        ? { error: 'Internal server error' }
        : { error: 'Internal server error', message: err.message }
    );
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

// ============================================
// EVENT INDEXER ENDPOINTS
// ============================================

// Get events for a specific DAO
app.get('/events/:daoId', queryLimiter, (req, res) => {
  const { daoId } = req.params;
  const { limit = 50, offset = 0, types } = req.query;

  try {
    const options = {
      limit: Math.min(parseInt(limit) || 50, 100),
      offset: parseInt(offset) || 0,
      types: types ? types.split(',') : null,
    };

    const result = getEventsForDao(parseInt(daoId), options);
    res.json(result);
  } catch (err) {
    log('error', 'get_events_failed', { daoId, error: err.message });
    res.status(500).json({ error: 'Failed to get events' });
  }
});

// Get indexer status
app.get('/indexer/status', queryLimiter, (req, res) => {
  try {
    const status = getIndexerStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get indexer status' });
  }
});

// List all indexed DAOs
app.get('/indexer/daos', queryLimiter, (req, res) => {
  try {
    const daos = getIndexedDaos();
    res.json({ daos });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get indexed DAOs' });
  }
});

// Manual event submission (admin only - requires auth token)
app.post('/events', authGuard, (req, res) => {
  const { daoId, type, data } = req.body;

  if (!daoId || !type) {
    return res.status(400).json({ error: 'daoId and type are required' });
  }

  try {
    addManualEvent(daoId, type, data || {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add event' });
  }
});

// ============================================
// IPFS/PINATA ENDPOINTS
// ============================================

// In-memory cache for IPFS content (15 min TTL)
const ipfsCache = new Map();
const IPFS_CACHE_TTL = 15 * 60 * 1000;

function getCachedContent(cid) {
  const cached = ipfsCache.get(cid);
  if (cached && Date.now() - cached.timestamp < IPFS_CACHE_TTL) {
    return cached.data;
  }
  ipfsCache.delete(cid);
  return null;
}

function setCachedContent(cid, data) {
  ipfsCache.set(cid, { data, timestamp: Date.now() });
  // Clean up old entries periodically
  if (ipfsCache.size > 1000) {
    const now = Date.now();
    for (const [key, value] of ipfsCache) {
      if (now - value.timestamp > IPFS_CACHE_TTL) {
        ipfsCache.delete(key);
      }
    }
  }
}

// Upload image to IPFS
// Wrap multer to handle file filter errors with proper 400 status
app.post('/ipfs/image', ipfsUploadLimiter, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      // Handle multer errors (file type, size, etc.)
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
      }
      if (err.code === 'INVALID_FILE_TYPE' || err.message?.includes('file type')) {
        return res.status(400).json({ error: err.message });
      }
      // Other multer errors
      log('error', 'multer_error', { code: err.code, message: err.message });
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }
    next();
  });
}, async (req, res) => {
  if (!IPFS_ENABLED) {
    return res.status(503).json({ error: 'IPFS service not configured' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No image file provided' });
  }

  try {
    log('info', 'ipfs_upload_image', {
      filename: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });

    const result = await pinFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    log('info', 'ipfs_upload_success', { cid: result.cid, type: 'image' });

    res.json({
      cid: result.cid,
      size: result.size,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
    });
  } catch (err) {
    log('error', 'ipfs_upload_failed', { error: err.message, type: 'image' });
    res.status(500).json({ error: 'Failed to upload image to IPFS' });
  }
});

// Upload JSON metadata to IPFS
app.post('/ipfs/metadata', ipfsUploadLimiter, async (req, res) => {
  if (!IPFS_ENABLED) {
    return res.status(503).json({ error: 'IPFS service not configured' });
  }

  const metadata = req.body;

  // Validate metadata size
  const metadataSize = JSON.stringify(metadata).length;
  if (metadataSize > MAX_METADATA_SIZE) {
    return res.status(400).json({
      error: `Metadata too large: ${metadataSize} bytes (max ${MAX_METADATA_SIZE})`,
    });
  }

  // Validate required fields
  if (!metadata.version || typeof metadata.version !== 'number') {
    return res.status(400).json({ error: 'metadata.version is required and must be a number' });
  }

  // Validate video URL if present
  if (metadata.videoUrl) {
    const videoPattern = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\/.+$/i;
    if (!videoPattern.test(metadata.videoUrl)) {
      return res.status(400).json({
        error: 'Invalid video URL. Only YouTube and Vimeo URLs are allowed.',
      });
    }
  }

  try {
    log('info', 'ipfs_upload_metadata', { size: metadataSize });

    const result = await pinJSON(metadata, 'daovote-proposal-metadata');

    log('info', 'ipfs_upload_success', { cid: result.cid, type: 'metadata' });

    res.json({
      cid: result.cid,
      size: result.size,
    });
  } catch (err) {
    log('error', 'ipfs_upload_failed', { error: err.message, type: 'metadata' });
    res.status(500).json({ error: 'Failed to upload metadata to IPFS' });
  }
});

// IPFS health check (must be before :cid route to avoid matching "health" as CID)
app.get('/ipfs/health', queryLimiter, async (_req, res) => {
  if (!IPFS_ENABLED) {
    return res.json({ enabled: false, status: 'not_configured' });
  }

  try {
    const healthy = await isPinataHealthy();
    res.json({
      enabled: true,
      status: healthy ? 'healthy' : 'degraded',
    });
  } catch (err) {
    res.json({
      enabled: true,
      status: 'error',
      error: err.message,
    });
  }
});

// Fetch content from IPFS (with caching)
app.get('/ipfs/:cid', queryLimiter, async (req, res) => {
  if (!IPFS_ENABLED) {
    return res.status(503).json({ error: 'IPFS service not configured' });
  }

  const { cid } = req.params;

  if (!isValidCid(cid)) {
    return res.status(400).json({ error: 'Invalid CID format' });
  }

  // Check cache first
  const cached = getCachedContent(cid);
  if (cached) {
    log('info', 'ipfs_cache_hit', { cid });
    return res.json(cached);
  }

  try {
    log('info', 'ipfs_fetch', { cid });

    const result = await fetchContent(cid);

    // Cache the result
    setCachedContent(cid, result.data);

    log('info', 'ipfs_fetch_success', { cid });

    // Return JSON data directly or as a wrapper
    if (typeof result.data === 'object') {
      res.json(result.data);
    } else {
      res.json({ content: result.data, contentType: result.contentType });
    }
  } catch (err) {
    log('error', 'ipfs_fetch_failed', { cid, error: err.message });
    res.status(500).json({ error: 'Failed to fetch content from IPFS' });
  }
});

// GET /ipfs/image/:cid - Fetch raw image from IPFS (for img src tags)
app.get('/ipfs/image/:cid', queryLimiter, async (req, res) => {
  if (!IPFS_ENABLED) {
    return res.status(503).json({ error: 'IPFS service not configured' });
  }

  const { cid } = req.params;

  if (!isValidCid(cid)) {
    return res.status(400).json({ error: 'Invalid CID format' });
  }

  try {
    log('info', 'ipfs_fetch_image', { cid });

    const result = await fetchRawContent(cid);

    log('info', 'ipfs_fetch_image_success', { cid, contentType: result.contentType });

    // Set content type, cache headers, and CORS headers for cross-origin image loading
    res.set('Content-Type', result.contentType);
    res.set('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year cache (content-addressed)
    res.set('Cross-Origin-Resource-Policy', 'cross-origin'); // Allow cross-origin image loading
    res.send(result.buffer);
  } catch (err) {
    log('error', 'ipfs_fetch_image_failed', { cid, error: err.message });
    res.status(500).json({ error: 'Failed to fetch image from IPFS' });
  }
});

// ============================================
// COMMENT ENDPOINTS
// ============================================

// Rate limiter for comment operations
const commentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 comment operations per minute per IP
  message: { error: 'Too many comment requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: limiterKeyGen,
});

// POST /comment/public - Submit public comment (author identified)
app.post('/comment/public', authGuard, commentLimiter, async (req, res) => {
  const { daoId, proposalId, contentCid, parentId, author } = req.body;

  // Validate required fields
  if (daoId === undefined || proposalId === undefined || !contentCid || !author) {
    return res.status(400).json({ error: 'Missing required fields: daoId, proposalId, contentCid, author' });
  }

  if (!Number.isInteger(daoId) || daoId < 0) {
    return res.status(400).json({ error: 'daoId must be a non-negative integer' });
  }
  if (!Number.isInteger(proposalId) || proposalId < 0) {
    return res.status(400).json({ error: 'proposalId must be a non-negative integer' });
  }
  if (typeof contentCid !== 'string' || contentCid.length > 100) {
    return res.status(400).json({ error: 'Invalid contentCid' });
  }
  if (parentId !== undefined && parentId !== null && (!Number.isInteger(parentId) || parentId < 0)) {
    return res.status(400).json({ error: 'parentId must be a non-negative integer or null' });
  }

  try {
    log('info', 'comment_public_request', { daoId, proposalId });

    const contract = new StellarSdk.Contract(COMMENTS_CONTRACT_ID);

    // Build args for add_comment
    // Contract signature: add_comment(dao_id, proposal_id, content_cid, parent_id, author)
    const authorAddress = StellarSdk.Address.fromString(author);
    const args = [
      StellarSdk.nativeToScVal(daoId, { type: 'u64' }),
      StellarSdk.nativeToScVal(proposalId, { type: 'u64' }),
      StellarSdk.nativeToScVal(contentCid, { type: 'string' }),
      StellarSdk.nativeToScVal(parentId !== undefined && parentId !== null ? BigInt(parentId) : null),
      StellarSdk.xdr.ScVal.scvAddress(authorAddress.toScAddress()),
    ];

    const operation = contract.call('add_comment', ...args);

    const account = await server.getAccount(relayerKeypair.publicKey());
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    // Simulate
    const simResult = await callWithTimeout(
      () => simulateWithBackoff(() => server.simulateTransaction(tx)),
      'simulate_add_comment'
    );

    if (!StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
      log('warn', 'comment_simulation_failed', { daoId, proposalId, error: simResult.error });
      return res.status(400).json({ error: 'Failed to add comment' });
    }

    // Get comment ID from simulation result
    const commentId = simResult.result?.retval
      ? Number(StellarSdk.scValToNative(simResult.result.retval))
      : null;

    // Prepare and sign
    const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simResult).build();
    preparedTx.sign(relayerKeypair);

    // Submit
    const sendResult = await callWithTimeout(
      () => server.sendTransaction(preparedTx),
      'send_add_comment'
    );

    if (sendResult.status === 'ERROR') {
      log('error', 'comment_submit_failed', { daoId, proposalId });
      return res.status(500).json({ error: 'Transaction submission failed' });
    }

    // Wait for confirmation
    const result = await callWithTimeout(
      () => waitForTransaction(sendResult.hash),
      'wait_for_comment'
    );

    if (result.status === 'SUCCESS') {
      log('info', 'comment_public_success', { daoId, proposalId, commentId });
      res.json({ success: true, commentId, txHash: sendResult.hash });
    } else {
      res.status(500).json({ error: 'Transaction failed', txHash: sendResult.hash });
    }
  } catch (err) {
    log('error', 'comment_public_exception', { message: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /comment/anonymous - Submit anonymous comment with ZK proof
// Uses the same vote circuit as voting - just verifies membership, doesn't track nullifiers
app.post('/comment/anonymous', authGuard, commentLimiter, async (req, res) => {
  const { daoId, proposalId, contentCid, parentId, voteChoice, nullifier, root, commitment, proof } = req.body;

  // Validate required fields
  if (daoId === undefined || proposalId === undefined || !contentCid ||
      voteChoice === undefined || !nullifier || !root || !commitment || !proof) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!Number.isInteger(daoId) || daoId < 0) {
    return res.status(400).json({ error: 'daoId must be a non-negative integer' });
  }
  if (!Number.isInteger(proposalId) || proposalId < 0) {
    return res.status(400).json({ error: 'proposalId must be a non-negative integer' });
  }
  if (typeof voteChoice !== 'boolean') {
    return res.status(400).json({ error: 'voteChoice must be a boolean' });
  }
  if (!isValidU256Hex(nullifier) || !isWithinField(nullifier)) {
    return res.status(400).json({ error: 'nullifier must be a valid hex string < BN254 modulus' });
  }
  if (!isValidU256Hex(root) || !isWithinField(root)) {
    return res.status(400).json({ error: 'root must be a valid hex string < BN254 modulus' });
  }
  if (!isValidU256Hex(commitment) || !isWithinField(commitment)) {
    return res.status(400).json({ error: 'commitment must be a valid hex string < BN254 modulus' });
  }

  // Validate proof structure
  if (!proof.a || !proof.b || !proof.c) {
    return res.status(400).json({ error: 'proof must contain a, b, and c fields' });
  }

  try {
    log('info', 'comment_anonymous_request', { daoId, proposalId });

    // Convert to Soroban types
    const scNullifier = u256ToScVal(nullifier);
    const scRoot = u256ToScVal(root);
    const scCommitment = u256ToScVal(commitment);
    const scProof = proofToScVal(proof);

    // Use comments contract for anonymous comments (same vote circuit, no nullifier tracking)
    const contract = new StellarSdk.Contract(COMMENTS_CONTRACT_ID);

    // Vote circuit public signals: [root, nullifier, daoId, proposalId, voteChoice, commitment]
    // Contract args: dao_id, proposal_id, content_cid, parent_id, nullifier, root, commitment, vote_choice, proof
    const args = [
      StellarSdk.nativeToScVal(daoId, { type: 'u64' }),
      StellarSdk.nativeToScVal(proposalId, { type: 'u64' }),
      StellarSdk.nativeToScVal(contentCid, { type: 'string' }),
      StellarSdk.nativeToScVal(parentId !== undefined && parentId !== null ? BigInt(parentId) : null),
      scNullifier,
      scRoot,
      scCommitment,
      StellarSdk.nativeToScVal(voteChoice, { type: 'bool' }),
      scProof,
    ];

    const operation = contract.call('add_anonymous_comment', ...args);

    const account = await server.getAccount(relayerKeypair.publicKey());
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simResult = await callWithTimeout(
      () => simulateWithBackoff(() => server.simulateTransaction(tx)),
      'simulate_add_anonymous_comment'
    );

    if (!StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
      log('warn', 'comment_anon_simulation_failed', { daoId, proposalId, error: simResult.error });
      return res.status(400).json({ error: 'Failed to add anonymous comment (proof verification failed or invalid membership)' });
    }

    const commentId = simResult.result?.retval
      ? Number(StellarSdk.scValToNative(simResult.result.retval))
      : null;

    const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simResult).build();
    preparedTx.sign(relayerKeypair);

    const sendResult = await callWithTimeout(
      () => server.sendTransaction(preparedTx),
      'send_add_anonymous_comment'
    );

    if (sendResult.status === 'ERROR') {
      return res.status(500).json({ error: 'Transaction submission failed' });
    }

    const result = await callWithTimeout(
      () => waitForTransaction(sendResult.hash),
      'wait_for_anonymous_comment'
    );

    if (result.status === 'SUCCESS') {
      log('info', 'comment_anonymous_success', { daoId, proposalId, commentId });
      res.json({ success: true, commentId, txHash: sendResult.hash });
    } else {
      res.status(500).json({ error: 'Transaction failed', txHash: sendResult.hash });
    }
  } catch (err) {
    log('error', 'comment_anonymous_exception', { message: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /comments/:daoId/:proposalId/nonce - Get next available comment nonce for a commitment
// This is used to generate unique nullifiers for multiple anonymous comments
app.get('/comments/:daoId/:proposalId/nonce', queryLimiter, async (req, res) => {
  const { daoId, proposalId } = req.params;
  const { commitment } = req.query;

  if (!commitment) {
    return res.status(400).json({ error: 'commitment query parameter is required' });
  }

  try {
    // Query the comments contract to get the nonce for this commitment
    // The nonce is the count of anonymous comments by this commitment on this proposal
    const contract = new StellarSdk.Contract(COMMENTS_CONTRACT_ID);

    // Convert commitment hex to U256
    const scCommitment = u256ToScVal(commitment);

    const args = [
      StellarSdk.nativeToScVal(parseInt(daoId), { type: 'u64' }),
      StellarSdk.nativeToScVal(parseInt(proposalId), { type: 'u64' }),
      scCommitment,
    ];

    const operation = contract.call('get_comment_nonce', ...args);

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
      'simulate_get_comment_nonce'
    );

    if (StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
      const result = simResult.result?.retval;
      const nonce = result ? Number(StellarSdk.scValToNative(result)) : 0;
      res.json({ nonce });
    } else {
      // If contract doesn't have this function yet, return 0
      log('warn', 'get_comment_nonce_failed', { daoId, proposalId, error: simResult.error });
      res.json({ nonce: 0 });
    }
  } catch (err) {
    log('error', 'get_comment_nonce_exception', { daoId, proposalId, error: err.message });
    // Return 0 as fallback (first comment)
    res.json({ nonce: 0 });
  }
});

// GET /comments/:daoId/:proposalId - Fetch comments for a proposal
app.get('/comments/:daoId/:proposalId', queryLimiter, async (req, res) => {
  const { daoId, proposalId } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  try {
    const contract = new StellarSdk.Contract(COMMENTS_CONTRACT_ID);

    const args = [
      StellarSdk.nativeToScVal(parseInt(daoId), { type: 'u64' }),
      StellarSdk.nativeToScVal(parseInt(proposalId), { type: 'u64' }),
      StellarSdk.nativeToScVal(parseInt(offset), { type: 'u64' }),
      StellarSdk.nativeToScVal(Math.min(parseInt(limit), 100), { type: 'u64' }),
    ];

    const operation = contract.call('get_comments', ...args);

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
      'simulate_get_comments'
    );

    if (StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
      const result = simResult.result?.retval;
      if (result) {
        const comments = StellarSdk.scValToNative(result);
        // Transform comments to frontend-friendly format
        const transformed = comments.map(c => ({
          id: Number(c.id),
          daoId: Number(c.dao_id),
          proposalId: Number(c.proposal_id),
          author: c.author || null,
          contentCid: c.content_cid,
          parentId: c.parent_id !== undefined ? Number(c.parent_id) : null,
          createdAt: Number(c.created_at),
          updatedAt: Number(c.updated_at),
          revisionCids: c.revision_cids || [],
          deleted: c.deleted,
          deletedBy: c.deleted_by, // 0=none, 1=user, 2=admin
          isAnonymous: !c.author,
        }));
        res.json({ comments: transformed, total: transformed.length });
      } else {
        res.json({ comments: [], total: 0 });
      }
    } else {
      res.status(400).json({ error: 'Failed to get comments' });
    }
  } catch (err) {
    log('error', 'get_comments_failed', { daoId, proposalId, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /comment/:daoId/:proposalId/:commentId - Fetch single comment
app.get('/comment/:daoId/:proposalId/:commentId', queryLimiter, async (req, res) => {
  const { daoId, proposalId, commentId } = req.params;

  try {
    const contract = new StellarSdk.Contract(COMMENTS_CONTRACT_ID);

    const args = [
      StellarSdk.nativeToScVal(parseInt(daoId), { type: 'u64' }),
      StellarSdk.nativeToScVal(parseInt(proposalId), { type: 'u64' }),
      StellarSdk.nativeToScVal(parseInt(commentId), { type: 'u64' }),
    ];

    const operation = contract.call('get_comment', ...args);

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
      'simulate_get_comment'
    );

    if (StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
      const result = simResult.result?.retval;
      if (result) {
        const c = StellarSdk.scValToNative(result);
        res.json({
          id: Number(c.id),
          daoId: Number(c.dao_id),
          proposalId: Number(c.proposal_id),
          author: c.author || null,
          contentCid: c.content_cid,
          parentId: c.parent_id !== undefined ? Number(c.parent_id) : null,
          createdAt: Number(c.created_at),
          updatedAt: Number(c.updated_at),
          revisionCids: c.revision_cids || [],
          deleted: c.deleted,
          deletedBy: c.deleted_by,
          isAnonymous: !c.author,
        });
      } else {
        res.status(404).json({ error: 'Comment not found' });
      }
    } else {
      res.status(404).json({ error: 'Comment not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /comment/edit - Edit public comment
app.post('/comment/edit', authGuard, commentLimiter, async (req, res) => {
  const { daoId, proposalId, commentId, newContentCid, author } = req.body;

  if (daoId === undefined || proposalId === undefined || commentId === undefined ||
      !newContentCid || !author) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    log('info', 'comment_edit_request', { daoId, proposalId, commentId });

    const contract = new StellarSdk.Contract(COMMENTS_CONTRACT_ID);
    const authorAddress = StellarSdk.Address.fromString(author);

    const args = [
      StellarSdk.nativeToScVal(daoId, { type: 'u64' }),
      StellarSdk.nativeToScVal(proposalId, { type: 'u64' }),
      StellarSdk.nativeToScVal(commentId, { type: 'u64' }),
      StellarSdk.xdr.ScVal.scvAddress(authorAddress.toScAddress()),
      StellarSdk.nativeToScVal(newContentCid, { type: 'string' }),
    ];

    const operation = contract.call('edit_comment', ...args);

    const account = await server.getAccount(relayerKeypair.publicKey());
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simResult = await callWithTimeout(
      () => simulateWithBackoff(() => server.simulateTransaction(tx)),
      'simulate_edit_comment'
    );

    if (!StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
      return res.status(400).json({ error: 'Failed to edit comment' });
    }

    const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simResult).build();
    preparedTx.sign(relayerKeypair);

    const sendResult = await callWithTimeout(
      () => server.sendTransaction(preparedTx),
      'send_edit_comment'
    );

    if (sendResult.status === 'ERROR') {
      return res.status(500).json({ error: 'Transaction submission failed' });
    }

    const result = await callWithTimeout(
      () => waitForTransaction(sendResult.hash),
      'wait_for_edit_comment'
    );

    if (result.status === 'SUCCESS') {
      log('info', 'comment_edit_success', { daoId, proposalId, commentId });
      res.json({ success: true, txHash: sendResult.hash });
    } else {
      res.status(500).json({ error: 'Transaction failed' });
    }
  } catch (err) {
    log('error', 'comment_edit_exception', { message: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /comment/delete - Delete public comment
app.post('/comment/delete', authGuard, commentLimiter, async (req, res) => {
  const { daoId, proposalId, commentId, author } = req.body;

  if (daoId === undefined || proposalId === undefined || commentId === undefined || !author) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    log('info', 'comment_delete_request', { daoId, proposalId, commentId });

    const contract = new StellarSdk.Contract(COMMENTS_CONTRACT_ID);
    const authorAddress = StellarSdk.Address.fromString(author);

    const args = [
      StellarSdk.nativeToScVal(daoId, { type: 'u64' }),
      StellarSdk.nativeToScVal(proposalId, { type: 'u64' }),
      StellarSdk.nativeToScVal(commentId, { type: 'u64' }),
      StellarSdk.xdr.ScVal.scvAddress(authorAddress.toScAddress()),
    ];

    const operation = contract.call('delete_comment', ...args);

    const account = await server.getAccount(relayerKeypair.publicKey());
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simResult = await callWithTimeout(
      () => simulateWithBackoff(() => server.simulateTransaction(tx)),
      'simulate_delete_comment'
    );

    if (!StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
      return res.status(400).json({ error: 'Failed to delete comment' });
    }

    const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simResult).build();
    preparedTx.sign(relayerKeypair);

    const sendResult = await callWithTimeout(
      () => server.sendTransaction(preparedTx),
      'send_delete_comment'
    );

    if (sendResult.status === 'ERROR') {
      return res.status(500).json({ error: 'Transaction submission failed' });
    }

    const result = await callWithTimeout(
      () => waitForTransaction(sendResult.hash),
      'wait_for_delete_comment'
    );

    if (result.status === 'SUCCESS') {
      log('info', 'comment_delete_success', { daoId, proposalId, commentId });
      res.json({ success: true, txHash: sendResult.hash });
    } else {
      res.status(500).json({ error: 'Transaction failed' });
    }
  } catch (err) {
    log('error', 'comment_delete_exception', { message: err.message });
    res.status(500).json({ error: 'Internal server error' });
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

// Helper: Check BN254 field bound (p)
// p = 21888242871839275222246405745257275088548364400416034343698204186575808495617
const BN254_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
function isWithinField(str) {
  if (!isValidU256Hex(str)) return false;
  const hex = str.startsWith('0x') ? str.slice(2) : str;
  const val = BigInt('0x' + hex);
  return val < BN254_MODULUS;
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
  app.listen(PORT, async () => {
    log('info', 'relayer_start', {
      port: PORT,
      rpc: RPC_URL,
      votingContract: VOTING_CONTRACT_ID,
      treeContract: TREE_CONTRACT_ID,
      ipfsEnabled: IPFS_ENABLED
    });
    console.log('\nEndpoints:');
    console.log('  GET  /health              - Health check');
    console.log('  POST /vote                - Submit anonymous vote');
    console.log('  GET  /proposal/:dao/:prop - Get vote results');
    console.log('  GET  /root/:dao           - Get current Merkle root');
    console.log('  GET  /events/:daoId       - Get events for a DAO');
    console.log('  GET  /indexer/status      - Get indexer status');
    console.log('\nComment Endpoints:');
    console.log('  POST /comment/public      - Submit public comment');
    console.log('  POST /comment/anonymous   - Submit anonymous comment (ZK)');
    console.log('  GET  /comments/:dao/:prop - Get comments for proposal');
    console.log('  GET  /comments/:dao/:prop/nonce - Get next comment nonce');
    console.log('  GET  /comment/:dao/:prop/:id - Get single comment');
    console.log('  POST /comment/edit        - Edit public comment');
    console.log('  POST /comment/delete      - Delete public comment');
    if (IPFS_ENABLED) {
      console.log('\nIPFS Endpoints:');
      console.log('  POST /ipfs/image          - Upload image to IPFS');
      console.log('  POST /ipfs/metadata       - Upload metadata to IPFS');
      console.log('  GET  /ipfs/:cid           - Fetch content from IPFS (JSON)');
      console.log('  GET  /ipfs/image/:cid     - Fetch raw image from IPFS');
      console.log('  GET  /ipfs/health         - IPFS health check');
    }

    // Initialize Pinata if configured
    if (IPFS_ENABLED) {
      try {
        initPinata(PINATA_JWT, PINATA_GATEWAY);
        log('info', 'pinata_initialized');
      } catch (err) {
        log('error', 'pinata_init_failed', { error: err.message });
      }
    }

    // Start event indexer if enabled
    if (INDEXER_ENABLED) {
      const contractIds = [VOTING_CONTRACT_ID, TREE_CONTRACT_ID];
      if (DAO_REGISTRY_CONTRACT_ID && isValidContractId(DAO_REGISTRY_CONTRACT_ID)) {
        contractIds.push(DAO_REGISTRY_CONTRACT_ID);
      }
      if (MEMBERSHIP_SBT_CONTRACT_ID && isValidContractId(MEMBERSHIP_SBT_CONTRACT_ID)) {
        contractIds.push(MEMBERSHIP_SBT_CONTRACT_ID);
      }

      try {
        await startIndexer(server, contractIds, INDEXER_POLL_INTERVAL_MS);
        log('info', 'indexer_enabled', { contracts: contractIds.length });
      } catch (err) {
        log('warn', 'indexer_start_failed', { error: err.message });
      }
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    log('info', 'shutdown_signal');
    stopIndexer();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    log('info', 'shutdown_signal');
    stopIndexer();
    process.exit(0);
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
