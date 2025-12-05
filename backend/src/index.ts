/**
 * ZKVote Backend - Main Entry Point
 *
 * TypeScript backend relayer for anonymous voting on Stellar/Soroban.
 * Provides vote submission, IPFS integration, event indexing, and DAO caching.
 */

import express, { type Express, type Request, type Response } from 'express';
import * as StellarSdk from '@stellar/stellar-sdk';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';

// Configuration and types
import { config, validateEnv, isValidContractId, LIMITS, ALLOWED_IMAGE_MIMES, BN254_SCALAR_FIELD } from './config.js';
import type { Groth16Proof, Dao, DaoWithRole, AsyncHandler } from './types/index.js';

// Services
import { log, logger } from './services/logger.js';
import * as dbService from './services/db.js';
import * as ipfsService from './services/ipfs.js';

// Middleware
import {
  authGuard,
  csrfGuard,
  requestLogger,
  errorHandler,
  voteLimiter,
  queryLimiter,
  ipfsUploadLimiter,
  ipfsReadLimiter,
  commentLimiter,
  validateBody,
} from './middleware/index.js';

// Validation schemas
import { voteSchema, anonymousCommentSchema } from './validation/schemas.js';

// Routes
import { default as healthRoutes, initHealthRoutes } from './routes/health.js';

// Indexer
import {
  startIndexer,
  stopIndexer,
  getEventsForDao,
  getIndexedDaos,
  getIndexerStatus,
  addManualEvent,
  notifyEvent,
  ensureDaoCreateEvent,
} from './services/indexer.js';

// ============================================
// ENVIRONMENT VALIDATION
// ============================================

validateEnv();

// ============================================
// EXPRESS APP SETUP
// ============================================

const app: Express = express();

// Security: HTTP headers
app.use(helmet());

// Security: CORS configuration
const corsOrigins = config.corsOrigins === '*' ? '*' : config.corsOrigins;
const corsOptions: cors.CorsOptions = {
  origin: corsOrigins,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Relayer-Auth'],
  maxAge: 86400, // 24 hours
};
app.use(cors(corsOptions));

// Security: Request body size limit
app.use(express.json({ limit: '100kb' }));

// Logging middleware
app.use(requestLogger);

// CSRF protection (applied globally)
app.use(csrfGuard);

// ============================================
// STELLAR/SOROBAN SETUP
// ============================================

// Relayer keypair
let relayerKeypair: StellarSdk.Keypair | { publicKey: () => string };
try {
  if (config.testMode) {
    relayerKeypair = {
      publicKey: () => 'GTESTRELAYERADDRESS000000000000000000000000000000000000',
    };
    logger.info('relayer_loaded', { relayer: relayerKeypair.publicKey(), testMode: true });
  } else {
    if (!config.relayerSecretKey) {
      throw new Error('RELAYER_SECRET_KEY is not set');
    }
    relayerKeypair = StellarSdk.Keypair.fromSecret(config.relayerSecretKey);
    logger.info('relayer_loaded', { relayer: relayerKeypair.publicKey() });
  }
} catch (err) {
  log('error', 'invalid_relayer_key', { message: (err as Error).message });
  console.error('Run ./scripts/init-local.sh to generate a secure key');
  process.exit(1);
}

// Soroban RPC client
interface TestServer {
  getHealth: () => Promise<{ status: string }>;
  simulateTransaction: () => Promise<never>;
  sendTransaction: () => Promise<{ status: string; errorResult: string }>;
  getTransaction: () => Promise<{ status: string }>;
  getAccount: () => Promise<{ accountId: string; sequence: string }>;
  getLatestLedger?: () => Promise<{ sequence: number }>;
}

const server: StellarSdk.rpc.Server | TestServer = config.testMode
  ? {
      getHealth: async () => ({ status: 'online' }),
      simulateTransaction: async () => {
        throw new Error('simulate disabled in RELAYER_TEST_MODE');
      },
      sendTransaction: async () => ({ status: 'ERROR', errorResult: 'disabled' }),
      getTransaction: async () => ({ status: 'NOT_FOUND' }),
      getAccount: async () => ({ accountId: 'GTEST', sequence: '0' }),
    }
  : new StellarSdk.rpc.Server(config.rpcUrl, { allowHttp: true });

// ============================================
// MULTER CONFIGURATION (FILE UPLOADS)
// ============================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: LIMITS.MAX_IMAGE_SIZE,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    log('info', 'upload_file_filter', { mimetype: file.mimetype, originalname: file.originalname });

    if (ALLOWED_IMAGE_MIMES.includes(file.mimetype as any) || file.mimetype?.startsWith('image/')) {
      cb(null, true);
    } else {
      const err = new Error(
        `Unsupported file type: ${file.mimetype || 'unknown'}. Allowed: JPEG, PNG, GIF, WebP, AVIF, HEIC.`
      ) as any;
      err.code = 'INVALID_FILE_TYPE';
      cb(err);
    }
  },
});

// ============================================
// IPFS CACHE (IN-MEMORY)
// ============================================

interface CachedContent {
  data: unknown;
  timestamp: number;
}

const ipfsCache = new Map<string, CachedContent>();

function getCachedContent(cid: string): unknown | null {
  const cached = ipfsCache.get(cid);
  if (cached && Date.now() - cached.timestamp < LIMITS.IPFS_CACHE_TTL) {
    return cached.data;
  }
  ipfsCache.delete(cid);
  return null;
}

function setCachedContent(cid: string, data: unknown): void {
  ipfsCache.set(cid, { data, timestamp: Date.now() });
  // Clean up old entries periodically
  if (ipfsCache.size > 1000) {
    const now = Date.now();
    for (const [key, value] of ipfsCache) {
      if (now - value.timestamp > LIMITS.IPFS_CACHE_TTL) {
        ipfsCache.delete(key);
      }
    }
  }
}

// ============================================
// MEMBERSHIP CACHE (GLOBAL)
// ============================================

const daoMembersCache = new Map<number, Set<string>>(); // daoId -> Set<memberAddress>
const daoAdminsCache = new Map<number, string>(); // daoId -> adminAddress

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Call RPC with timeout
 */
async function callWithTimeout<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout: ${label} (${config.rpcTimeoutMs}ms)`)), config.rpcTimeoutMs)
  );
  return Promise.race([fn(), timeout]);
}

/**
 * Wait for transaction confirmation
 */
async function waitForTransaction(hash: string): Promise<StellarSdk.rpc.Api.GetTransactionResponse> {
  let attempts = 0;
  const maxAttempts = 30;

  while (attempts < maxAttempts) {
    const result = await (server as StellarSdk.rpc.Server).getTransaction(hash);

    if (result.status !== 'NOT_FOUND') {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    attempts++;
  }

  throw new Error('Transaction not found after timeout');
}

/**
 * Simulate with backoff/retry
 */
async function simulateWithBackoff<T>(simulateFn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: Error | null = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await simulateFn();
    } catch (err) {
      lastErr = err as Error;
      await new Promise((r) => setTimeout(r, 200 * i));
    }
  }
  throw lastErr;
}

// Note: Hand-rolled validation functions (isValidU256Hex, isValidHex, isWithinField)
// have been replaced with Zod schemas in validation/schemas.ts

/**
 * Check if byte array is all zeros
 */
function isAllZeros(bytes: Buffer): boolean {
  return bytes.every((byte) => byte === 0);
}

/**
 * Convert U256 hex string to ScVal
 */
function u256ToScVal(hexString: string): StellarSdk.xdr.ScVal {
  const hex = hexString.startsWith('0x') ? hexString.slice(2) : hexString;

  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('Invalid U256 hex string: contains non-hexadecimal characters');
  }
  if (hex.length % 2 !== 0 && hex.length > 0) {
    throw new Error(`Invalid U256 hex string: odd length (${hex.length})`);
  }
  if (hex.length > 64) {
    throw new Error(`Invalid U256 hex string: too long (${hex.length} chars, max 64)`);
  }

  const padded = hex.padStart(64, '0');
  const value = BigInt('0x' + padded);

  if (value >= BN254_SCALAR_FIELD) {
    throw new Error('Value exceeds BN254 scalar field modulus');
  }

  const hiHi = BigInt('0x' + padded.slice(0, 16));
  const hiLo = BigInt('0x' + padded.slice(16, 32));
  const loHi = BigInt('0x' + padded.slice(32, 48));
  const loLo = BigInt('0x' + padded.slice(48, 64));

  return StellarSdk.xdr.ScVal.scvU256(
    new StellarSdk.xdr.UInt256Parts({
      hiHi: new StellarSdk.xdr.Uint64(hiHi),
      hiLo: new StellarSdk.xdr.Uint64(hiLo),
      loHi: new StellarSdk.xdr.Uint64(loHi),
      loLo: new StellarSdk.xdr.Uint64(loLo),
    })
  );
}

/**
 * Convert ScVal U256 to hex string
 */
function scValToU256Hex(scVal: StellarSdk.xdr.ScVal): string {
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

/**
 * Convert hex string to byte array
 */
function hexToBytes(hex: string, expectedLength: number): Buffer {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;

  if (!/^[0-9a-fA-F]*$/.test(cleanHex)) {
    throw new Error('Invalid hex string: contains non-hexadecimal characters');
  }

  if (cleanHex.length % 2 !== 0 && cleanHex.length > 0) {
    throw new Error(`Invalid hex string: odd length (${cleanHex.length})`);
  }

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

/**
 * Convert Groth16 proof to ScVal
 */
function proofToScVal(proof: Groth16Proof): StellarSdk.xdr.ScVal {
  if (!proof || typeof proof !== 'object') {
    throw new Error('Invalid proof: must be an object');
  }
  if (!proof.a || !proof.b || !proof.c) {
    throw new Error('Invalid proof: missing a, b, or c fields');
  }

  const aBytes = hexToBytes(proof.a, 64);
  const bBytes = hexToBytes(proof.b, 128);
  const cBytes = hexToBytes(proof.c, 64);

  if (isAllZeros(aBytes) || isAllZeros(bBytes) || isAllZeros(cBytes)) {
    throw new Error('Invalid proof: proof components cannot be all zeros');
  }

  return StellarSdk.xdr.ScVal.scvMap([
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol('a'),
      val: StellarSdk.xdr.ScVal.scvBytes(aBytes),
    }),
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol('b'),
      val: StellarSdk.xdr.ScVal.scvBytes(bBytes),
    }),
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol('c'),
      val: StellarSdk.xdr.ScVal.scvBytes(cBytes),
    }),
  ]);
}

// ============================================
// HEALTH ROUTES
// ============================================

initHealthRoutes(server, relayerKeypair.publicKey());
app.use(healthRoutes);

// ============================================
// VOTING ROUTES
// ============================================

/**
 * POST /vote - Submit anonymous vote with ZK proof
 */
app.post('/vote', authGuard, voteLimiter, validateBody(voteSchema), (async (req: Request, res: Response) => {
  // Validated by voteSchema middleware
  const { daoId, proposalId, choice, nullifier, root, proof } = config.stripRequestBodies ? {} : req.body;

  try {
    log('info', 'vote_request', { daoId, proposalId });

    // Convert inputs to Soroban types
    let scNullifier: StellarSdk.xdr.ScVal;
    let scRoot: StellarSdk.xdr.ScVal;
    let scProof: StellarSdk.xdr.ScVal;
    try {
      scNullifier = u256ToScVal(nullifier);
      scRoot = u256ToScVal(root);
      scProof = proofToScVal(proof);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }

    if (config.testMode) {
      return res.status(400).json({ error: 'Simulation failed (test mode)' });
    }

    // Build contract call
    const contract = new StellarSdk.Contract(config.votingContractId!);

    const args = [
      StellarSdk.nativeToScVal(daoId, { type: 'u64' }),
      StellarSdk.nativeToScVal(proposalId, { type: 'u64' }),
      StellarSdk.nativeToScVal(choice, { type: 'bool' }),
      scNullifier,
      scRoot,
      scProof,
    ];

    const operation = contract.call('vote', ...args);

    // Get relayer account
    const account = await (server as StellarSdk.rpc.Server).getAccount(relayerKeypair.publicKey());

    // Build transaction
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    // Simulate
    log('info', 'simulate_vote', { daoId, proposalId });
    const simResult = await callWithTimeout(
      () => simulateWithBackoff(() => (server as StellarSdk.rpc.Server).simulateTransaction(tx)),
      'simulate_vote'
    );

    if (!StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
      log('warn', 'simulation_failed', { daoId, proposalId, error: simResult.error });

      let errorMessage = 'Transaction simulation failed';
      if (simResult.error) {
        const errorStr = JSON.stringify(simResult.error);
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
        }
      }

      return res.status(400).json({ error: errorMessage });
    }

    // Prepare and sign
    const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simResult).build();
    preparedTx.sign(relayerKeypair as StellarSdk.Keypair);

    // Submit
    log('info', 'submit_vote', { daoId, proposalId });
    const sendResult = await callWithTimeout(
      () => (server as StellarSdk.rpc.Server).sendTransaction(preparedTx),
      'send_vote'
    );

    if (sendResult.status === 'ERROR') {
      log('error', 'submit_failed', { daoId, proposalId, error: sendResult.errorResult });
      return res.status(500).json({ error: 'Transaction submission failed' });
    }

    // Wait for confirmation
    log('info', 'submitted', { txHash: sendResult.hash, daoId, proposalId });
    const result = await callWithTimeout(() => waitForTransaction(sendResult.hash), 'wait_for_vote');

    if (result.status === 'SUCCESS') {
      log('info', 'vote_success', { txHash: sendResult.hash, daoId, proposalId });
      res.json({
        success: true,
        txHash: sendResult.hash,
        status: result.status,
      });
    } else {
      log('error', 'vote_failed', { txHash: sendResult.hash, status: result.status });
      res.status(500).json({
        error: 'Transaction failed',
        txHash: sendResult.hash,
        status: result.status,
      });
    }
  } catch (err) {
    log('error', 'vote_exception', { message: (err as Error).message, stack: (err as Error).stack });

    const errMsg = (err as Error).message || '';
    let statusCode = 500;
    let userMessage = 'Internal server error';

    if (errMsg.includes('Timeout:')) {
      statusCode = 504;
      userMessage = 'Request timeout - please try again';
    } else if (errMsg.includes('Transaction not found after timeout')) {
      statusCode = 504;
      userMessage = 'Transaction confirmation timeout - vote may have succeeded, please check proposal results';
    } else if (errMsg.includes('getAccount')) {
      statusCode = 503;
      userMessage = 'Blockchain RPC temporarily unavailable - please retry';
    } else if (errMsg.includes('ECONNREFUSED') || errMsg.includes('ETIMEDOUT')) {
      statusCode = 503;
      userMessage = 'Network error - please retry';
    } else if (errMsg.includes('sequence')) {
      statusCode = 503;
      userMessage = 'Transaction sequence error - please retry';
    }

    res.status(statusCode).json(
      config.genericErrors ? { error: userMessage } : { error: userMessage, details: errMsg }
    );
  }
}) as AsyncHandler);

/**
 * GET /proposal/:daoId/:proposalId - Get proposal results
 */
app.get('/proposal/:daoId/:proposalId', queryLimiter, (async (req: Request, res: Response) => {
  const { daoId, proposalId } = req.params;

  try {
    const contract = new StellarSdk.Contract(config.votingContractId!);
    const args = [
      StellarSdk.nativeToScVal(parseInt(daoId), { type: 'u64' }),
      StellarSdk.nativeToScVal(parseInt(proposalId), { type: 'u64' }),
    ];

    const operation = contract.call('get_results', ...args);

    const account = await (server as StellarSdk.rpc.Server).getAccount(relayerKeypair.publicKey());
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simResult = await callWithTimeout(
      () => simulateWithBackoff(() => (server as StellarSdk.rpc.Server).simulateTransaction(tx)),
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
    res.status(500).json({ error: (err as Error).message });
  }
}) as AsyncHandler);

/**
 * GET /root/:daoId - Get current Merkle root for DAO
 */
app.get('/root/:daoId', queryLimiter, (async (req: Request, res: Response) => {
  const { daoId } = req.params;

  try {
    const contract = new StellarSdk.Contract(config.treeContractId!);
    const args = [StellarSdk.nativeToScVal(parseInt(daoId), { type: 'u64' })];

    const operation = contract.call('current_root', ...args);

    const account = await (server as StellarSdk.rpc.Server).getAccount(relayerKeypair.publicKey());
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simResult = await callWithTimeout(
      () => simulateWithBackoff(() => (server as StellarSdk.rpc.Server).simulateTransaction(tx)),
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
    res.status(500).json({ error: (err as Error).message });
  }
}) as AsyncHandler);

// ============================================
// EVENT INDEXER ROUTES
// ============================================

/**
 * GET /events/:daoId - Get events for a DAO
 */
app.get('/events/:daoId', queryLimiter, (req: Request, res: Response) => {
  const { daoId } = req.params;
  const { limit = '50', offset = '0', types } = req.query;

  try {
    const options = {
      limit: Math.min(parseInt(limit as string) || 50, 100),
      offset: parseInt(offset as string) || 0,
      types: types ? (types as string).split(',') : null,
    };

    const result = getEventsForDao(parseInt(daoId), options);
    res.json(result);
  } catch (err) {
    log('error', 'get_events_failed', { daoId, error: (err as Error).message });
    res.status(500).json({ error: 'Failed to get events' });
  }
});

/**
 * GET /indexer/status - Get indexer status
 */
app.get('/indexer/status', queryLimiter, (req: Request, res: Response) => {
  try {
    const status = getIndexerStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get indexer status' });
  }
});

/**
 * GET /indexer/daos - List all indexed DAOs
 */
app.get('/indexer/daos', queryLimiter, (req: Request, res: Response) => {
  try {
    const daos = getIndexedDaos();
    res.json({ daos });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get indexed DAOs' });
  }
});

/**
 * POST /events - Manual event submission (admin only)
 */
app.post('/events', authGuard, (req: Request, res: Response) => {
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

/**
 * POST /events/notify - Frontend event notification
 */
app.post('/events/notify', queryLimiter, (async (req: Request, res: Response) => {
  const { daoId, type, data, txHash } = req.body;

  if (!daoId || !type || !txHash) {
    return res.status(400).json({ error: 'daoId, type, and txHash are required' });
  }

  if (!/^[0-9a-fA-F]{64}$/.test(txHash)) {
    return res.status(400).json({ error: 'Invalid txHash format' });
  }

  try {
    notifyEvent(Number(daoId), type, data || {}, txHash);

    // Trigger membership cache refresh for membership events
    const membershipEvents = ['sbt_mint', 'sbt_revoke', 'member_join', 'member_leave', 'self_join'];
    if (membershipEvents.includes(type)) {
      triggerDaoMembershipSync(Number(daoId)).catch((err) => {
        log('warn', 'triggered_membership_sync_failed', { daoId, error: (err as Error).message });
      });
    }

    res.json({ success: true, message: 'Event queued for verification' });
  } catch (err) {
    log('error', 'notify_event_failed', { daoId, type, error: (err as Error).message });
    res.status(500).json({ error: 'Failed to notify event' });
  }
}) as AsyncHandler);

// ============================================
// DAO CACHE ROUTES
// ============================================

/**
 * GET /daos - Get all DAOs (with optional user membership info)
 */
app.get('/daos', queryLimiter, (async (req: Request, res: Response) => {
  try {
    const daos = dbService.getAllCachedDaos();
    const lastSync = dbService.getDaosSyncTime();
    const userAddress = req.query.user as string | undefined;

    if (!userAddress) {
      return res.json({
        daos,
        total: daos.length,
        lastSync,
        cached: true,
      });
    }

    // Validate address
    if (!/^[GC][A-Z2-7]{55}$/.test(userAddress)) {
      return res.status(400).json({ error: 'Invalid Stellar address format' });
    }

    // Use global membership cache
    const daosWithRoles: DaoWithRole[] = daos.map((dao) => {
      const adminAddr = daoAdminsCache.get(dao.id) || dao.creator;
      if (adminAddr === userAddress) {
        return { ...dao, role: 'admin' as const };
      }

      const members = daoMembersCache.get(dao.id);
      if (members && members.has(userAddress)) {
        return { ...dao, role: 'member' as const };
      }

      return { ...dao, role: null };
    });

    log('info', 'get_daos_with_membership', {
      user: userAddress.slice(0, 8) + '...',
      count: daos.length,
      cachedDaos: daoMembersCache.size,
    });

    res.json({
      daos: daosWithRoles,
      total: daosWithRoles.length,
      lastSync,
      cached: true,
    });
  } catch (err) {
    log('error', 'get_daos_failed', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to get DAOs' });
  }
}) as AsyncHandler);

/**
 * GET /dao/:daoId - Get specific DAO from cache
 */
app.get('/dao/:daoId', queryLimiter, (req: Request, res: Response) => {
  const { daoId } = req.params;
  try {
    const dao = dbService.getCachedDao(parseInt(daoId));
    if (!dao) {
      return res.status(404).json({ error: 'DAO not found in cache' });
    }
    res.json({ dao, cached: true });
  } catch (err) {
    log('error', 'get_dao_failed', { daoId, error: (err as Error).message });
    res.status(500).json({ error: 'Failed to get DAO' });
  }
});

/**
 * POST /daos/sync - Trigger manual DAO sync (admin only)
 */
app.post('/daos/sync', authGuard, (async (req: Request, res: Response) => {
  try {
    const synced = await syncDaosFromContract();
    res.json({ success: true, synced });
  } catch (err) {
    log('error', 'dao_sync_failed', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to sync DAOs' });
  }
}) as AsyncHandler);

// ============================================
// IPFS/PINATA ROUTES
// ============================================

/**
 * GET /ipfs/health - IPFS health check
 */
app.get('/ipfs/health', queryLimiter, (async (req: Request, res: Response) => {
  if (!config.ipfsEnabled) {
    return res.json({ enabled: false, status: 'not_configured' });
  }

  try {
    const healthy = await ipfsService.isHealthy();
    res.json({
      enabled: true,
      status: healthy ? 'healthy' : 'degraded',
    });
  } catch (err) {
    res.json({
      enabled: true,
      status: 'error',
      error: (err as Error).message,
    });
  }
}) as AsyncHandler);

/**
 * POST /ipfs/image - Upload image to IPFS
 */
app.post(
  '/ipfs/image',
  ipfsUploadLimiter,
  (req, res, next) => {
    upload.single('image')(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
        }
        if (err.code === 'INVALID_FILE_TYPE' || err.message?.includes('file type')) {
          return res.status(400).json({ error: err.message });
        }
        log('error', 'multer_error', { code: err.code, message: err.message });
        return res.status(400).json({ error: err.message || 'File upload failed' });
      }
      next();
    });
  },
  (async (req: Request, res: Response) => {
    if (!config.ipfsEnabled) {
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

      const result = await ipfsService.pinFile(req.file.buffer, req.file.originalname, req.file.mimetype);

      log('info', 'ipfs_upload_success', { cid: result.cid, type: 'image' });

      res.json({
        cid: result.cid,
        size: result.size,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
      });
    } catch (err) {
      log('error', 'ipfs_upload_failed', { error: (err as Error).message, type: 'image' });
      res.status(500).json({ error: 'Failed to upload image to IPFS' });
    }
  }) as AsyncHandler
);

/**
 * POST /ipfs/metadata - Upload JSON metadata to IPFS
 */
app.post('/ipfs/metadata', ipfsUploadLimiter, (async (req: Request, res: Response) => {
  if (!config.ipfsEnabled) {
    return res.status(503).json({ error: 'IPFS service not configured' });
  }

  const metadata = req.body;

  const metadataSize = JSON.stringify(metadata).length;
  if (metadataSize > LIMITS.MAX_METADATA_SIZE) {
    return res.status(400).json({
      error: `Metadata too large: ${metadataSize} bytes (max ${LIMITS.MAX_METADATA_SIZE})`,
    });
  }

  if (!metadata.version || typeof metadata.version !== 'number') {
    return res.status(400).json({ error: 'metadata.version is required and must be a number' });
  }

  if (metadata.videoUrl) {
    const videoPattern = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\/.+$/i;
    if (!videoPattern.test(metadata.videoUrl)) {
      return res.status(400).json({
        error: 'Invalid video URL. Only YouTube and Vimeo URLs are allowed.',
      });
    }
  }

  try {
    // Sanitize metadata to prevent XSS attacks
    const sanitizedMetadata = ipfsService.sanitizeMetadata(metadata);

    log('info', 'ipfs_upload_metadata', { size: metadataSize });

    const result = await ipfsService.pinJSON(sanitizedMetadata, 'zkvote-proposal-metadata');

    log('info', 'ipfs_upload_success', { cid: result.cid, type: 'metadata' });

    res.json({
      cid: result.cid,
      size: result.size,
    });
  } catch (err) {
    log('error', 'ipfs_upload_failed', { error: (err as Error).message, type: 'metadata' });
    res.status(500).json({ error: 'Failed to upload metadata to IPFS' });
  }
}) as AsyncHandler);

/**
 * GET /ipfs/:cid - Fetch content from IPFS (JSON)
 */
app.get('/ipfs/:cid', ipfsReadLimiter, (async (req: Request, res: Response) => {
  if (!config.ipfsEnabled) {
    return res.status(503).json({ error: 'IPFS service not configured' });
  }

  const { cid } = req.params;

  if (!ipfsService.isValidCid(cid)) {
    return res.status(400).json({ error: 'Invalid CID format' });
  }

  const cached = getCachedContent(cid);
  if (cached) {
    log('info', 'ipfs_cache_hit', { cid });
    return res.json(cached);
  }

  try {
    log('info', 'ipfs_fetch', { cid });

    const result = await ipfsService.fetchContent(cid);

    setCachedContent(cid, result.data);

    log('info', 'ipfs_fetch_success', { cid });

    if (typeof result.data === 'object') {
      res.json(result.data);
    } else {
      res.json({ content: result.data, contentType: result.contentType });
    }
  } catch (err) {
    log('error', 'ipfs_fetch_failed', { cid, error: (err as Error).message });
    res.status(500).json({ error: 'Failed to fetch content from IPFS' });
  }
}) as AsyncHandler);

/**
 * GET /ipfs/image/:cid - Fetch raw image from IPFS
 */
app.get('/ipfs/image/:cid', ipfsReadLimiter, (async (req: Request, res: Response) => {
  if (!config.ipfsEnabled) {
    return res.status(503).json({ error: 'IPFS service not configured' });
  }

  const { cid } = req.params;

  if (!ipfsService.isValidCid(cid)) {
    return res.status(400).json({ error: 'Invalid CID format' });
  }

  try {
    log('info', 'ipfs_fetch_image', { cid });

    const result = await ipfsService.fetchRawContent(cid);

    log('info', 'ipfs_fetch_image_success', { cid, contentType: result.contentType });

    res.set('Content-Type', result.contentType);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(result.buffer);
  } catch (err) {
    log('error', 'ipfs_fetch_image_failed', { cid, error: (err as Error).message });
    res.status(500).json({ error: 'Failed to fetch image from IPFS' });
  }
}) as AsyncHandler);

// ============================================
// COMMENT ROUTES
// ============================================

/**
 * POST /comment/anonymous - Submit anonymous comment with ZK proof
 */
app.post('/comment/anonymous', authGuard, commentLimiter, validateBody(anonymousCommentSchema), (async (req: Request, res: Response) => {
  // Validated by anonymousCommentSchema middleware
  const { daoId, proposalId, contentCid, parentId, voteChoice, nullifier, root, commitment, proof } = req.body;

  try {
    log('info', 'comment_anonymous_request', { daoId, proposalId });

    const scNullifier = u256ToScVal(nullifier);
    const scRoot = u256ToScVal(root);
    const scCommitment = u256ToScVal(commitment);
    const scProof = proofToScVal(proof);

    const contract = new StellarSdk.Contract(config.commentsContractId!);

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

    const account = await (server as StellarSdk.rpc.Server).getAccount(relayerKeypair.publicKey());
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simResult = await callWithTimeout(
      () => simulateWithBackoff(() => (server as StellarSdk.rpc.Server).simulateTransaction(tx)),
      'simulate_add_anonymous_comment'
    );

    if (!StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
      const errorStr = typeof simResult.error === 'string'
        ? simResult.error
        : JSON.stringify(simResult.error);
      log('warn', 'comment_anon_simulation_failed', { daoId, proposalId, error: errorStr, fullResult: JSON.stringify(simResult).slice(0, 500) });
      return res
        .status(400)
        .json({ error: 'Failed to add anonymous comment (proof verification failed or invalid membership)', details: errorStr });
    }

    const commentId = simResult.result?.retval ? Number(StellarSdk.scValToNative(simResult.result.retval)) : null;

    const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simResult).build();
    preparedTx.sign(relayerKeypair as StellarSdk.Keypair);

    const sendResult = await callWithTimeout(
      () => (server as StellarSdk.rpc.Server).sendTransaction(preparedTx),
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
    log('error', 'comment_anonymous_exception', { message: (err as Error).message });

    const errMsg = (err as Error).message || '';
    let statusCode = 500;
    let userMessage = 'Internal server error';

    if (errMsg.includes('Timeout:')) {
      statusCode = 504;
      userMessage = 'Request timeout - please try again';
    } else if (errMsg.includes('Transaction not found after timeout')) {
      statusCode = 504;
      userMessage = 'Transaction confirmation timeout';
    } else if (errMsg.includes('getAccount') || errMsg.includes('ECONNREFUSED')) {
      statusCode = 503;
      userMessage = 'Blockchain RPC temporarily unavailable - please retry';
    }

    res.status(statusCode).json(
      config.genericErrors ? { error: userMessage } : { error: userMessage, details: errMsg }
    );
  }
}) as AsyncHandler);

/**
 * GET /comments/:daoId/:proposalId/nonce - Get next comment nonce
 */
app.get('/comments/:daoId/:proposalId/nonce', queryLimiter, (async (req: Request, res: Response) => {
  const { daoId, proposalId } = req.params;
  const { commitment } = req.query;

  if (!commitment) {
    return res.status(400).json({ error: 'commitment query parameter is required' });
  }

  try {
    const contract = new StellarSdk.Contract(config.commentsContractId!);
    const scCommitment = u256ToScVal(commitment as string);

    const args = [
      StellarSdk.nativeToScVal(parseInt(daoId), { type: 'u64' }),
      StellarSdk.nativeToScVal(parseInt(proposalId), { type: 'u64' }),
      scCommitment,
    ];

    const operation = contract.call('get_comment_nonce', ...args);

    const account = await (server as StellarSdk.rpc.Server).getAccount(relayerKeypair.publicKey());
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simResult = await callWithTimeout(
      () => simulateWithBackoff(() => (server as StellarSdk.rpc.Server).simulateTransaction(tx)),
      'simulate_get_comment_nonce'
    );

    if (StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
      const result = simResult.result?.retval;
      const nonce = result ? Number(StellarSdk.scValToNative(result)) : 0;
      res.json({ nonce });
    } else {
      log('warn', 'get_comment_nonce_failed', { daoId, proposalId, error: simResult.error });
      res.json({ nonce: 0 });
    }
  } catch (err) {
    log('error', 'get_comment_nonce_exception', { daoId, proposalId, error: (err as Error).message });
    res.json({ nonce: 0 });
  }
}) as AsyncHandler);

/**
 * GET /comments/:daoId/:proposalId - Get comments for a proposal
 */
app.get('/comments/:daoId/:proposalId', queryLimiter, (async (req: Request, res: Response) => {
  const { daoId, proposalId } = req.params;
  const { limit = '50', offset = '0' } = req.query;

  try {
    const contract = new StellarSdk.Contract(config.commentsContractId!);

    const args = [
      StellarSdk.nativeToScVal(parseInt(daoId), { type: 'u64' }),
      StellarSdk.nativeToScVal(parseInt(proposalId), { type: 'u64' }),
      StellarSdk.nativeToScVal(parseInt(offset as string), { type: 'u64' }),
      StellarSdk.nativeToScVal(Math.min(parseInt(limit as string), 100), { type: 'u64' }),
    ];

    const operation = contract.call('get_comments', ...args);

    const account = await (server as StellarSdk.rpc.Server).getAccount(relayerKeypair.publicKey());
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simResult = await callWithTimeout(
      () => simulateWithBackoff(() => (server as StellarSdk.rpc.Server).simulateTransaction(tx)),
      'simulate_get_comments'
    );

    if (StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
      const result = simResult.result?.retval;
      if (result) {
        const comments = StellarSdk.scValToNative(result);
        const transformed = comments.map((c: any) => ({
          id: Number(c.id),
          daoId: Number(c.dao_id),
          proposalId: Number(c.proposal_id),
          author: c.author || null,
          nullifier: c.nullifier ? c.nullifier.toString() : null,
          contentCid: c.content_cid,
          parentId: c.parent_id !== undefined ? Number(c.parent_id) : null,
          createdAt: Number(c.created_at),
          updatedAt: Number(c.updated_at),
          revisionCids: c.revision_cids || [],
          deleted: c.deleted,
          deletedBy: c.deleted_by,
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
    log('error', 'get_comments_failed', { daoId, proposalId, error: (err as Error).message });
    res.status(500).json({ error: (err as Error).message });
  }
}) as AsyncHandler);

/**
 * GET /comment/:daoId/:proposalId/:commentId - Get single comment
 */
app.get('/comment/:daoId/:proposalId/:commentId', queryLimiter, (async (req: Request, res: Response) => {
  const { daoId, proposalId, commentId } = req.params;

  try {
    const contract = new StellarSdk.Contract(config.commentsContractId!);

    const args = [
      StellarSdk.nativeToScVal(parseInt(daoId), { type: 'u64' }),
      StellarSdk.nativeToScVal(parseInt(proposalId), { type: 'u64' }),
      StellarSdk.nativeToScVal(parseInt(commentId), { type: 'u64' }),
    ];

    const operation = contract.call('get_comment', ...args);

    const account = await (server as StellarSdk.rpc.Server).getAccount(relayerKeypair.publicKey());
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simResult = await callWithTimeout(
      () => simulateWithBackoff(() => (server as StellarSdk.rpc.Server).simulateTransaction(tx)),
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
    res.status(500).json({ error: (err as Error).message });
  }
}) as AsyncHandler);

/**
 * POST /comment/edit - Edit public comment
 */
app.post('/comment/edit', authGuard, commentLimiter, (async (req: Request, res: Response) => {
  const { daoId, proposalId, commentId, newContentCid, author } = req.body;

  if (daoId === undefined || proposalId === undefined || commentId === undefined || !newContentCid || !author) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    log('info', 'comment_edit_request', { daoId, proposalId, commentId });

    const contract = new StellarSdk.Contract(config.commentsContractId!);
    const authorAddress = StellarSdk.Address.fromString(author);

    const args = [
      StellarSdk.nativeToScVal(daoId, { type: 'u64' }),
      StellarSdk.nativeToScVal(proposalId, { type: 'u64' }),
      StellarSdk.nativeToScVal(commentId, { type: 'u64' }),
      StellarSdk.xdr.ScVal.scvAddress(authorAddress.toScAddress()),
      StellarSdk.nativeToScVal(newContentCid, { type: 'string' }),
    ];

    const operation = contract.call('edit_comment', ...args);

    const account = await (server as StellarSdk.rpc.Server).getAccount(relayerKeypair.publicKey());
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simResult = await callWithTimeout(
      () => simulateWithBackoff(() => (server as StellarSdk.rpc.Server).simulateTransaction(tx)),
      'simulate_edit_comment'
    );

    if (!StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
      return res.status(400).json({ error: 'Failed to edit comment' });
    }

    const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simResult).build();
    preparedTx.sign(relayerKeypair as StellarSdk.Keypair);

    const sendResult = await callWithTimeout(
      () => (server as StellarSdk.rpc.Server).sendTransaction(preparedTx),
      'send_edit_comment'
    );

    if (sendResult.status === 'ERROR') {
      return res.status(500).json({ error: 'Transaction submission failed' });
    }

    const result = await callWithTimeout(() => waitForTransaction(sendResult.hash), 'wait_for_edit_comment');

    if (result.status === 'SUCCESS') {
      log('info', 'comment_edit_success', { daoId, proposalId, commentId });
      res.json({ success: true, txHash: sendResult.hash });
    } else {
      res.status(500).json({ error: 'Transaction failed' });
    }
  } catch (err) {
    log('error', 'comment_edit_exception', { message: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
}) as AsyncHandler);

/**
 * POST /comment/delete - Delete public comment
 */
app.post('/comment/delete', authGuard, commentLimiter, (async (req: Request, res: Response) => {
  const { daoId, proposalId, commentId, author } = req.body;

  if (daoId === undefined || proposalId === undefined || commentId === undefined || !author) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    log('info', 'comment_delete_request', { daoId, proposalId, commentId });

    const contract = new StellarSdk.Contract(config.commentsContractId!);
    const authorAddress = StellarSdk.Address.fromString(author);

    const args = [
      StellarSdk.nativeToScVal(daoId, { type: 'u64' }),
      StellarSdk.nativeToScVal(proposalId, { type: 'u64' }),
      StellarSdk.nativeToScVal(commentId, { type: 'u64' }),
      StellarSdk.xdr.ScVal.scvAddress(authorAddress.toScAddress()),
    ];

    const operation = contract.call('delete_comment', ...args);

    const account = await (server as StellarSdk.rpc.Server).getAccount(relayerKeypair.publicKey());
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simResult = await callWithTimeout(
      () => simulateWithBackoff(() => (server as StellarSdk.rpc.Server).simulateTransaction(tx)),
      'simulate_delete_comment'
    );

    if (!StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
      return res.status(400).json({ error: 'Failed to delete comment' });
    }

    const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simResult).build();
    preparedTx.sign(relayerKeypair as StellarSdk.Keypair);

    const sendResult = await callWithTimeout(
      () => (server as StellarSdk.rpc.Server).sendTransaction(preparedTx),
      'send_delete_comment'
    );

    if (sendResult.status === 'ERROR') {
      return res.status(500).json({ error: 'Transaction submission failed' });
    }

    const result = await callWithTimeout(() => waitForTransaction(sendResult.hash), 'wait_for_delete_comment');

    if (result.status === 'SUCCESS') {
      log('info', 'comment_delete_success', { daoId, proposalId, commentId });
      res.json({ success: true, txHash: sendResult.hash });
    } else {
      res.status(500).json({ error: 'Transaction failed' });
    }
  } catch (err) {
    log('error', 'comment_delete_exception', { message: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
}) as AsyncHandler);

// ============================================
// GLOBAL ERROR HANDLER
// ============================================

app.use(errorHandler);

// ============================================
// DAO SYNC FROM CONTRACT
// ============================================

/**
 * Sync all DAOs from the DAO Registry contract to local cache
 */
async function syncDaosFromContract(): Promise<number> {
  if (!config.daoRegistryContractId || !isValidContractId(config.daoRegistryContractId)) {
    log('warn', 'dao_sync_skipped', { reason: 'DAO_REGISTRY_CONTRACT_ID not configured' });
    return 0;
  }

  try {
    log('info', 'dao_sync_start');

    const contract = new StellarSdk.Contract(config.daoRegistryContractId);
    const account = await (server as StellarSdk.rpc.Server).getAccount(relayerKeypair.publicKey());

    // Get DAO count
    const countOp = contract.call('dao_count');
    const countTx = new StellarSdk.TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(countOp)
      .setTimeout(30)
      .build();

    const countSimResult = await callWithTimeout(
      () => simulateWithBackoff(() => (server as StellarSdk.rpc.Server).simulateTransaction(countTx)),
      'simulate_dao_count'
    );

    if (!StellarSdk.rpc.Api.isSimulationSuccess(countSimResult)) {
      log('warn', 'dao_count_failed', { error: countSimResult.error });
      return 0;
    }

    const daoCount = Number(StellarSdk.scValToNative(countSimResult.result!.retval!));
    log('info', 'dao_count_fetched', { count: daoCount });

    if (daoCount === 0) {
      dbService.setDaosSyncTime(new Date().toISOString());
      return 0;
    }

    // Fetch each DAO
    const daos: Dao[] = [];
    for (let i = 1; i <= daoCount; i++) {
      try {
        const daoAccount = await (server as StellarSdk.rpc.Server).getAccount(relayerKeypair.publicKey());
        const getOp = contract.call('get_dao', StellarSdk.nativeToScVal(i, { type: 'u64' }));
        const getTx = new StellarSdk.TransactionBuilder(daoAccount, {
          fee: '100',
          networkPassphrase: config.networkPassphrase,
        })
          .addOperation(getOp)
          .setTimeout(30)
          .build();

        const getSimResult = await callWithTimeout(
          () => simulateWithBackoff(() => (server as StellarSdk.rpc.Server).simulateTransaction(getTx)),
          `simulate_get_dao_${i}`
        );

        if (StellarSdk.rpc.Api.isSimulationSuccess(getSimResult) && getSimResult.result?.retval) {
          const daoData = StellarSdk.scValToNative(getSimResult.result.retval);
          daos.push({
            id: i,
            name: daoData.name || `DAO ${i}`,
            creator: daoData.creator || '',
            membership_open: daoData.membership_open !== false,
            members_can_propose: daoData.members_can_propose === true,
            metadata_cid: daoData.metadata_cid || null,
            member_count: Number(daoData.member_count || 0),
          });
        }
      } catch (err) {
        log('warn', 'dao_fetch_failed', { daoId: i, error: (err as Error).message });
      }
    }

    // Save to database
    if (daos.length > 0) {
      dbService.upsertDaos(daos);

      // Ensure dao_create events exist
      for (const dao of daos) {
        ensureDaoCreateEvent(dao.id, dao);
      }
    }

    dbService.setDaosSyncTime(new Date().toISOString());
    log('info', 'dao_sync_complete', { synced: daos.length, total: daoCount });

    return daos.length;
  } catch (err) {
    log('error', 'dao_sync_error', { error: (err as Error).message });
    return 0;
  }
}

let daoSyncInterval: NodeJS.Timeout | null = null;

/**
 * Start background DAO sync
 */
function startDaoSync(): void {
  if (daoSyncInterval) {
    clearInterval(daoSyncInterval);
  }

  syncDaosFromContract()
    .then((count) => {
      log('info', 'initial_dao_sync', { count });
    })
    .catch((err) => {
      log('error', 'initial_dao_sync_failed', { error: (err as Error).message });
    });

  daoSyncInterval = setInterval(() => {
    syncDaosFromContract().catch((err) => {
      log('error', 'periodic_dao_sync_failed', { error: (err as Error).message });
    });
  }, config.daoSyncIntervalMs);

  log('info', 'dao_sync_started', { intervalMs: config.daoSyncIntervalMs });
}

/**
 * Stop background DAO sync
 */
function stopDaoSync(): void {
  if (daoSyncInterval) {
    clearInterval(daoSyncInterval);
    daoSyncInterval = null;
    log('info', 'dao_sync_stopped');
  }
}

// ============================================
// MEMBERSHIP SYNC
// ============================================

/**
 * Sync members for a single DAO
 */
async function syncDaoMembership(daoId: number): Promise<void> {
  if (!config.membershipSbtContractId || !isValidContractId(config.membershipSbtContractId)) {
    return;
  }

  try {
    const sbtContract = new StellarSdk.Contract(config.membershipSbtContractId);
    const members = new Set<string>();
    const BATCH_SIZE = 50;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const account = await (server as StellarSdk.rpc.Server).getAccount(relayerKeypair.publicKey());
      const getMembersOp = sbtContract.call(
        'get_members',
        StellarSdk.nativeToScVal(daoId, { type: 'u64' }),
        StellarSdk.nativeToScVal(offset, { type: 'u64' }),
        StellarSdk.nativeToScVal(BATCH_SIZE, { type: 'u64' })
      );
      const getMembersTx = new StellarSdk.TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: config.networkPassphrase,
      })
        .addOperation(getMembersOp)
        .setTimeout(30)
        .build();

      const simResult = await callWithTimeout(
        () => simulateWithBackoff(() => (server as StellarSdk.rpc.Server).simulateTransaction(getMembersTx)),
        `simulate_get_members_${daoId}_${offset}`
      );

      if (StellarSdk.rpc.Api.isSimulationSuccess(simResult) && simResult.result?.retval) {
        const memberAddresses = StellarSdk.scValToNative(simResult.result.retval);
        if (Array.isArray(memberAddresses) && memberAddresses.length > 0) {
          for (const addr of memberAddresses) {
            members.add(addr);
          }
          offset += memberAddresses.length;
          hasMore = memberAddresses.length === BATCH_SIZE;
        } else {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }

    daoMembersCache.set(daoId, members);
    log('info', 'dao_membership_synced', { daoId, memberCount: members.size });
  } catch (err) {
    log('warn', 'dao_membership_sync_failed', { daoId, error: (err as Error).message });
  }
}

/**
 * Sync all memberships
 */
async function syncAllMemberships(): Promise<void> {
  if (!config.membershipSbtContractId || !isValidContractId(config.membershipSbtContractId)) {
    log('warn', 'membership_sync_skipped', { reason: 'MEMBERSHIP_SBT_CONTRACT_ID not configured' });
    return;
  }

  const daos = dbService.getAllCachedDaos();
  if (daos.length === 0) {
    log('info', 'membership_sync_skipped', { reason: 'no DAOs in cache' });
    return;
  }

  log('info', 'membership_sync_start', { daoCount: daos.length });

  // Cache admin addresses
  for (const dao of daos) {
    if (dao.creator) {
      daoAdminsCache.set(dao.id, dao.creator);
    }
  }

  // Sync each DAO sequentially
  for (const dao of daos) {
    await syncDaoMembership(dao.id);
  }

  log('info', 'membership_sync_complete', { daoCount: daos.length });
}

let membershipSyncInterval: NodeJS.Timeout | null = null;

/**
 * Start background membership sync
 */
function startMembershipSync(): void {
  if (membershipSyncInterval) {
    clearInterval(membershipSyncInterval);
  }

  // Initial sync after DAO sync
  setTimeout(() => {
    syncAllMemberships().catch((err) => {
      log('error', 'initial_membership_sync_failed', { error: (err as Error).message });
    });
  }, 5000);

  membershipSyncInterval = setInterval(() => {
    syncAllMemberships().catch((err) => {
      log('error', 'periodic_membership_sync_failed', { error: (err as Error).message });
    });
  }, config.membershipSyncIntervalMs);

  log('info', 'membership_sync_started', { intervalMs: config.membershipSyncIntervalMs });
}

/**
 * Stop background membership sync
 */
function stopMembershipSync(): void {
  if (membershipSyncInterval) {
    clearInterval(membershipSyncInterval);
    membershipSyncInterval = null;
    log('info', 'membership_sync_stopped');
  }
}

/**
 * Trigger membership sync for specific DAO
 */
async function triggerDaoMembershipSync(daoId: number): Promise<void> {
  log('info', 'triggered_membership_sync', { daoId });
  await syncDaoMembership(daoId);
}

// ============================================
// SERVER STARTUP
// ============================================

if (!config.testMode) {
  app.listen(config.port, async () => {
    log('info', 'relayer_start', {
      port: config.port,
      rpc: config.rpcUrl,
      votingContract: config.votingContractId,
      treeContract: config.treeContractId,
      ipfsEnabled: config.ipfsEnabled,
    });
    console.log('\nEndpoints:');
    console.log('  GET  /health              - Health check');
    console.log('  POST /vote                - Submit anonymous vote');
    console.log('  GET  /proposal/:dao/:prop - Get vote results');
    console.log('  GET  /root/:dao           - Get current Merkle root');
    console.log('  GET  /events/:daoId       - Get events for a DAO');
    console.log('  POST /events/notify       - Notify relayer of event (with txHash)');
    console.log('  GET  /indexer/status      - Get indexer status');
    console.log('\nComment Endpoints:');
    console.log('  POST /comment/anonymous   - Submit anonymous comment (ZK)');
    console.log('  GET  /comments/:dao/:prop - Get comments for proposal');
    console.log('  GET  /comments/:dao/:prop/nonce - Get next comment nonce');
    console.log('  GET  /comment/:dao/:prop/:id - Get single comment');
    console.log('  POST /comment/edit        - Edit public comment');
    console.log('  POST /comment/delete      - Delete public comment');
    if (config.ipfsEnabled) {
      console.log('\nIPFS Endpoints:');
      console.log('  POST /ipfs/image          - Upload image to IPFS');
      console.log('  POST /ipfs/metadata       - Upload metadata to IPFS');
      console.log('  GET  /ipfs/:cid           - Fetch content from IPFS (JSON)');
      console.log('  GET  /ipfs/image/:cid     - Fetch raw image from IPFS');
      console.log('  GET  /ipfs/health         - IPFS health check');
    }

    // Initialize Pinata
    if (config.ipfsEnabled && config.pinataJwt) {
      try {
        ipfsService.initPinata(config.pinataJwt, config.pinataGateway);
        log('info', 'pinata_initialized');
      } catch (err) {
        log('error', 'pinata_init_failed', { error: (err as Error).message });
      }
    }

    // Start event indexer
    if (config.indexerEnabled) {
      const contractIds = [config.votingContractId!, config.treeContractId!];
      if (config.daoRegistryContractId && isValidContractId(config.daoRegistryContractId)) {
        contractIds.push(config.daoRegistryContractId);
      }
      if (config.membershipSbtContractId && isValidContractId(config.membershipSbtContractId)) {
        contractIds.push(config.membershipSbtContractId);
      }

      try {
        await startIndexer(server as any, contractIds, config.indexerPollIntervalMs);
        log('info', 'indexer_enabled', { contracts: contractIds.length });
      } catch (err) {
        log('warn', 'indexer_start_failed', { error: (err as Error).message });
      }
    }

    // Start DAO sync
    if (config.daoRegistryContractId && isValidContractId(config.daoRegistryContractId)) {
      console.log('\nDAO Cache Endpoints:');
      console.log('  GET  /daos                - Get all DAOs (cached)');
      console.log('  GET  /daos?user=ADDRESS   - Get DAOs with membership info');
      console.log('  GET  /dao/:daoId          - Get single DAO (cached)');
      console.log('  POST /daos/sync           - Trigger DAO sync (admin)');
      startDaoSync();

      // Start membership sync
      if (config.membershipSbtContractId && isValidContractId(config.membershipSbtContractId)) {
        startMembershipSync();
      }
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    log('info', 'shutdown_signal');
    stopIndexer();
    stopDaoSync();
    stopMembershipSync();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log('info', 'shutdown_signal');
    stopIndexer();
    stopDaoSync();
    stopMembershipSync();
    process.exit(0);
  });
}

export { app };
