import express from 'express';
import * as StellarSdk from '@stellar/stellar-sdk';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

dotenv.config();

const app = express();

// Security: HTTP headers
app.use(helmet());

// Security: CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN || '*',  // In production, set to specific origin
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  maxAge: 86400  // 24 hours
};
app.use(cors(corsOptions));

// Security: Request body size limit
app.use(express.json({ limit: '100kb' }));  // Reduced from 1mb

// Security: Rate limiting
const voteLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 10,  // 10 votes per minute per IP
  message: { error: 'Too many vote requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

const queryLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 60,  // 60 queries per minute per IP
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

// Configuration
const RPC_URL = process.env.SOROBAN_RPC_URL || 'http://localhost:8000/soroban/rpc';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || 'Standalone Network ; February 2017';
const PORT = process.env.PORT || 3001;

// Contract IDs - MUST be set or server won't start
const VOTING_CONTRACT_ID = process.env.VOTING_CONTRACT_ID;
const TREE_CONTRACT_ID = process.env.TREE_CONTRACT_ID;

// Validate configuration on startup
if (!VOTING_CONTRACT_ID || !TREE_CONTRACT_ID) {
  console.error('ERROR: Missing required environment variables:');
  if (!VOTING_CONTRACT_ID) console.error('  - VOTING_CONTRACT_ID is not set');
  if (!TREE_CONTRACT_ID) console.error('  - TREE_CONTRACT_ID is not set');
  console.error('\nRun ./scripts/init-local.sh to generate backend/.env');
  process.exit(1);
}

// Validate contract ID format
if (!isValidContractId(VOTING_CONTRACT_ID)) {
  console.error(`ERROR: Invalid VOTING_CONTRACT_ID format: ${VOTING_CONTRACT_ID}`);
  process.exit(1);
}
if (!isValidContractId(TREE_CONTRACT_ID)) {
  console.error(`ERROR: Invalid TREE_CONTRACT_ID format: ${TREE_CONTRACT_ID}`);
  process.exit(1);
}

// Relayer account
let relayerKeypair;
try {
  if (!process.env.RELAYER_SECRET_KEY) {
    throw new Error('RELAYER_SECRET_KEY is not set');
  }
  relayerKeypair = StellarSdk.Keypair.fromSecret(process.env.RELAYER_SECRET_KEY);
  console.log(`Relayer account: ${relayerKeypair.publicKey()}`);
} catch (err) {
  console.error(`ERROR: Invalid RELAYER_SECRET_KEY: ${err.message}`);
  console.error('Run ./scripts/init-local.sh to generate a secure key');
  process.exit(1);
}

// Soroban RPC client
const server = new StellarSdk.rpc.Server(RPC_URL, { allowHttp: true });

// Health check (no rate limit)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    relayer: relayerKeypair.publicKey(),
    votingContract: VOTING_CONTRACT_ID,
    treeContract: TREE_CONTRACT_ID
  });
});

// Submit anonymous vote (with rate limiting)
app.post('/vote', voteLimiter, async (req, res) => {
  const { daoId, proposalId, choice, nullifier, root, commitment, proof } = req.body;

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
    console.log(`Processing vote for DAO ${daoId}, Proposal ${proposalId}`);

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
    console.log('Simulating transaction...');
    const simResult = await server.simulateTransaction(tx);

    if (!StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
      console.error('Simulation failed:', simResult);

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

      return res.status(400).json({
        error: errorMessage,
        details: simResult.error || simResult
      });
    }

    // Prepare and sign
    const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simResult).build();
    preparedTx.sign(relayerKeypair);

    // Submit
    console.log('Submitting transaction...');
    const sendResult = await server.sendTransaction(preparedTx);

    if (sendResult.status === 'ERROR') {
      console.error('Submit failed:', sendResult.errorResult);
      return res.status(500).json({
        error: 'Transaction submission failed',
        details: sendResult.errorResult
      });
    }

    // Wait for confirmation
    console.log(`Transaction submitted: ${sendResult.hash}`);
    const result = await waitForTransaction(sendResult.hash);

    if (result.status === 'SUCCESS') {
      console.log('Vote recorded successfully');
      res.json({
        success: true,
        txHash: sendResult.hash,
        status: result.status
      });
    } else {
      console.error('Transaction failed:', result);
      res.status(500).json({
        error: 'Transaction failed',
        txHash: sendResult.hash,
        status: result.status
      });
    }
  } catch (err) {
    console.error('Error processing vote:', err);
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

    const simResult = await server.simulateTransaction(tx);

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

    const simResult = await server.simulateTransaction(tx);

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
  if (hex.length > 64) return false;
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

// Start server
app.listen(PORT, () => {
  console.log(`DaoVote Relayer running on port ${PORT}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Voting Contract: ${VOTING_CONTRACT_ID}`);
  console.log(`Tree Contract: ${TREE_CONTRACT_ID}`);
  console.log('\nEndpoints:');
  console.log('  GET  /health              - Health check');
  console.log('  POST /vote                - Submit anonymous vote');
  console.log('  GET  /proposal/:dao/:prop - Get vote results');
  console.log('  GET  /root/:dao           - Get current Merkle root');
});
