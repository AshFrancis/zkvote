/**
 * Shared Type Definitions for ZKVote Backend
 */

import type { Request, Response, NextFunction } from 'express';

// ============================================
// EXPRESS EXTENSIONS
// ============================================

declare global {
  namespace Express {
    interface Request {
      ctx?: string; // Request context ID for logging
    }
  }
}

// ============================================
// LOGGING
// ============================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogMeta {
  [key: string]: unknown;
}

// ============================================
// PROOF TYPES
// ============================================

export interface Groth16Proof {
  a: string; // 64 bytes hex
  b: string; // 128 bytes hex
  c: string; // 64 bytes hex
}

// ============================================
// VOTE TYPES
// ============================================

export interface VoteRequest {
  daoId: number;
  proposalId: number;
  choice: boolean;
  nullifier: string;
  root: string;
  proof: Groth16Proof;
}

// ============================================
// COMMENT TYPES
// ============================================

export interface AnonymousCommentRequest {
  daoId: number;
  proposalId: number;
  contentCid: string;
  parentId?: number | null;
  voteChoice: boolean;
  nullifier: string;
  root: string;
  commitment: string;
  proof: Groth16Proof;
}

export interface Comment {
  id: number;
  daoId: number;
  proposalId: number;
  author: string | null;
  nullifier: string | null;
  contentCid: string;
  parentId: number | null;
  createdAt: number;
  updatedAt: number;
  revisionCids: string[];
  deleted: boolean;
  deletedBy: number; // 0=none, 1=user, 2=admin
  isAnonymous: boolean;
}

// ============================================
// DAO TYPES
// ============================================

export interface Dao {
  id: number;
  name: string;
  creator: string;
  membership_open: boolean;
  members_can_propose: boolean;
  metadata_cid: string | null;
  member_count: number;
  updated_at?: string;
}

export interface DaoWithRole extends Dao {
  role: 'admin' | 'member' | null;
}

// ============================================
// IPFS TYPES
// ============================================

export interface IpfsUploadResult {
  cid: string;
  size: number;
  filename?: string;
  mimeType?: string;
}

export interface ProposalMetadata {
  version: number;
  body: string;
  videoUrl?: string;
}

export interface CommentMetadata {
  version: number;
  body: string;
  createdAt: string;
}

// ============================================
// REQUEST HANDLER TYPES
// ============================================

export type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void | Response>;

// ============================================
// SOROBAN TYPES
// ============================================

export interface RpcHealthResult {
  ok: boolean;
  info?: { status: string };
  error?: string;
}

export interface TransactionResult {
  status: 'SUCCESS' | 'FAILED' | 'NOT_FOUND' | 'ERROR';
  ledger?: number;
  errorResult?: unknown;
  hash?: string;
}

// ============================================
// CACHE TYPES
// ============================================

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}
