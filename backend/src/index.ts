/**
 * ZKVote Backend - Main Entry Point
 *
 * TypeScript backend relayer for anonymous voting on Stellar/Soroban.
 * Provides vote submission, IPFS integration, event indexing, and DAO caching.
 */

import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';

// Configuration and types
import { config, validateEnv, isValidContractId } from './config.js';

// Services
import { log, logger } from './services/logger.js';
import * as ipfsService from './services/ipfs.js';
import { server, relayerKeypair } from './services/stellar.js';
import {
  startDaoSync,
  stopDaoSync,
  startMembershipSync,
  stopMembershipSync,
  triggerDaoMembershipSync,
} from './services/sync.js';
import { startIndexer, stopIndexer } from './services/indexer.js';

// Middleware
import { csrfGuard, requestLogger, errorHandler } from './middleware/index.js';

// Routes
import healthRoutes, { initHealthRoutes } from './routes/health.js';
import votingRoutes from './routes/voting.js';
import daoRoutes from './routes/daos.js';
import ipfsRoutes from './routes/ipfs.js';
import commentsRoutes from './routes/comments.js';
import indexerRoutes, { initIndexerRoutes } from './routes/indexer.js';

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
// ROUTE INITIALIZATION
// ============================================

// Initialize routes that need dependencies
initHealthRoutes(server, relayerKeypair.publicKey());
initIndexerRoutes(triggerDaoMembershipSync);

// Mount route handlers
app.use(healthRoutes);
app.use(votingRoutes);
app.use(daoRoutes);
app.use(ipfsRoutes);
app.use(commentsRoutes);
app.use(indexerRoutes);

// Global error handler (must be last)
app.use(errorHandler);

// ============================================
// SERVER STARTUP
// ============================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const PORT = config.port;

  app.listen(PORT, async () => {
    logger.info('server_started', { port: PORT });
    console.log(`\n🚀 ZKVote Relayer running on http://localhost:${PORT}`);
    console.log(`   Network: ${config.networkPassphrase}`);
    console.log(`   RPC URL: ${config.rpcUrl}`);
    console.log(`   Relayer: ${relayerKeypair.publicKey()}`);

    console.log('\nCore Endpoints:');
    console.log('  GET  /health              - Health check');
    console.log('  GET  /ready               - Readiness check');
    console.log('  GET  /config              - Public configuration');
    console.log('  POST /vote                - Submit anonymous vote (ZK)');
    console.log('  GET  /proposal/:dao/:prop - Get proposal results');
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
