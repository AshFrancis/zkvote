// Comment types and utilities for the commenting system

const RELAYER_URL = import.meta.env.VITE_RELAYER_URL || "http://localhost:3001";

export interface CommentMetadata {
  version: 1;
  body: string;
  createdAt: string;
}

export interface CommentInfo {
  id: number;
  author: string | null; // null = anonymous
  contentCid: string;
  parentId: number | null;
  createdAt: number;
  updatedAt: number;
  revisionCids: string[];
  deleted: boolean;
  deletedBy: "user" | "admin" | null;
  nullifier: string | null;
}

export interface CommentWithContent extends CommentInfo {
  content: CommentMetadata | null;
  replies: CommentWithContent[];
  isCollapsed: boolean;
}

// Anonymous comment tracking (stored in localStorage)
export interface AnonymousCommentRecord {
  commentId: number;
  proposalId: number;
  daoId: number;
  nullifier: string;
}

const ANON_COMMENTS_KEY = "daovote_anonymous_comments";

export function saveAnonymousComment(record: AnonymousCommentRecord): void {
  const existing = getAnonymousCommentsAll();
  existing.push(record);
  localStorage.setItem(ANON_COMMENTS_KEY, JSON.stringify(existing));
}

export function getAnonymousCommentsAll(): AnonymousCommentRecord[] {
  try {
    const stored = localStorage.getItem(ANON_COMMENTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function getAnonymousComments(
  daoId: number,
  proposalId: number
): AnonymousCommentRecord[] {
  return getAnonymousCommentsAll().filter(
    (r) => r.daoId === daoId && r.proposalId === proposalId
  );
}

export function getAnonymousCommentByNullifier(
  nullifier: string
): AnonymousCommentRecord | undefined {
  return getAnonymousCommentsAll().find((r) => r.nullifier === nullifier);
}

export function canEditAnonymousComment(
  daoId: number,
  proposalId: number,
  nullifier: string
): boolean {
  const record = getAnonymousCommentsAll().find(
    (r) =>
      r.daoId === daoId &&
      r.proposalId === proposalId &&
      r.nullifier === nullifier
  );
  return !!record;
}

// Upload comment content to IPFS
export async function uploadCommentContent(
  body: string
): Promise<{ cid: string }> {
  const metadata: CommentMetadata = {
    version: 1,
    body,
    createdAt: new Date().toISOString(),
  };

  const response = await fetch(`${RELAYER_URL}/ipfs/metadata`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });

  if (!response.ok) {
    throw new Error("Failed to upload comment content to IPFS");
  }

  return response.json();
}

// Fetch comment content from IPFS
export async function fetchCommentContent(
  cid: string
): Promise<CommentMetadata | null> {
  try {
    const response = await fetch(`${RELAYER_URL}/ipfs/${cid}`);
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

// Fetch all comments for a proposal
export async function fetchComments(
  daoId: number,
  proposalId: number
): Promise<CommentInfo[]> {
  const response = await fetch(
    `${RELAYER_URL}/comments/${daoId}/${proposalId}`
  );
  if (!response.ok) {
    // If endpoint doesn't exist yet, return empty array
    if (response.status === 404) return [];
    throw new Error("Failed to fetch comments");
  }
  const data = await response.json();
  return data.comments || [];
}

/**
 * @deprecated Public comments should be submitted via direct wallet signing (see CommentForm.tsx).
 * The contract requires author.require_auth() which cannot be satisfied by the relayer.
 * This function is kept for reference but should not be used.
 */
export async function submitPublicComment(_params: {
  daoId: number;
  proposalId: number;
  contentCid: string;
  parentId: number | null;
  author: string;
}): Promise<{ success: boolean; commentId?: number; error?: string }> {
  return {
    success: false,
    error:
      "Public comments must be submitted via direct wallet signing. Use the voting contract client directly.",
  };
}

// Submit an anonymous comment (with ZK proof via relayer)
export async function submitAnonymousComment(params: {
  daoId: number;
  proposalId: number;
  contentCid: string;
  parentId: number | null;
  proof: { a: string; b: string; c: string };
  publicSignals: [string, string]; // [root, nullifier]
}): Promise<{ success: boolean; commentId?: number; error?: string }> {
  const response = await fetch(`${RELAYER_URL}/comment/anonymous`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  const data = await response.json();
  if (!response.ok) {
    return { success: false, error: data.error || "Failed to submit comment" };
  }
  return { success: true, commentId: data.commentId };
}

// Edit a public comment
export async function editComment(params: {
  daoId: number;
  proposalId: number;
  commentId: number;
  newContentCid: string;
  author: string;
}): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${RELAYER_URL}/comment/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  const data = await response.json();
  if (!response.ok) {
    return { success: false, error: data.error || "Failed to edit comment" };
  }
  return { success: true };
}

// Delete a public comment
export async function deleteComment(params: {
  daoId: number;
  proposalId: number;
  commentId: number;
  author: string;
}): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${RELAYER_URL}/comment/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  const data = await response.json();
  if (!response.ok) {
    return { success: false, error: data.error || "Failed to delete comment" };
  }
  return { success: true };
}

// Build comment tree from flat list
export function buildCommentTree(
  comments: CommentInfo[],
  contentMap: Map<string, CommentMetadata | null>
): CommentWithContent[] {
  // Create map for quick lookup
  const commentMap = new Map<number, CommentWithContent>();

  // Initialize all comments with content
  comments.forEach((c) => {
    commentMap.set(c.id, {
      ...c,
      content: contentMap.get(c.contentCid) || null,
      replies: [],
      isCollapsed: false,
    });
  });

  // Build tree structure
  const rootComments: CommentWithContent[] = [];

  comments.forEach((c) => {
    const comment = commentMap.get(c.id)!;
    // parentId is null or 0 for root comments (contract uses 0, API may return either)
    if (c.parentId === null || c.parentId === 0) {
      rootComments.push(comment);
    } else {
      const parent = commentMap.get(c.parentId);
      if (parent) {
        parent.replies.push(comment);
      }
    }
  });

  // Sort: top-level by newest first, replies by oldest first
  rootComments.sort((a, b) => b.createdAt - a.createdAt);
  rootComments.forEach((c) => {
    c.replies.sort((a, b) => a.createdAt - b.createdAt);
  });

  return rootComments;
}

// Format relative time
export function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return "just now";
  if (diff < 3600) {
    const mins = Math.floor(diff / 60);
    return `${mins} minute${mins !== 1 ? "s" : ""} ago`;
  }
  if (diff < 86400) {
    const hours = Math.floor(diff / 3600);
    return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  }
  if (diff < 604800) {
    const days = Math.floor(diff / 86400);
    return `${days} day${days !== 1 ? "s" : ""} ago`;
  }

  // Fallback to date
  return new Date(timestamp * 1000).toLocaleDateString();
}

// Truncate address for display
export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
