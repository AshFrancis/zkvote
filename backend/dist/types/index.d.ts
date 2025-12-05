/**
 * Shared Type Definitions for ZKVote Backend
 */
import type { Request, Response, NextFunction } from 'express';
declare global {
    namespace Express {
        interface Request {
            ctx?: string;
        }
    }
}
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogMeta {
    [key: string]: unknown;
}
export interface Groth16Proof {
    a: string;
    b: string;
    c: string;
}
export interface VoteRequest {
    daoId: number;
    proposalId: number;
    choice: boolean;
    nullifier: string;
    root: string;
    proof: Groth16Proof;
}
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
    deletedBy: number;
    isAnonymous: boolean;
}
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
export type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void | Response>;
export interface RpcHealthResult {
    ok: boolean;
    info?: {
        status: string;
    };
    error?: string;
}
export interface TransactionResult {
    status: 'SUCCESS' | 'FAILED' | 'NOT_FOUND' | 'ERROR';
    ledger?: number;
    errorResult?: unknown;
    hash?: string;
}
export interface CacheEntry<T> {
    data: T;
    timestamp: number;
}
//# sourceMappingURL=index.d.ts.map