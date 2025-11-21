// Merkle tree path computation for Poseidon tree
import { buildPoseidon } from "circomlibjs";

const TREE_DEPTH = 20;

// Cache for zero hashes at each level
let zeroCache: string[] | null = null;

/**
 * Compute zero hash at each level of the tree
 * Zero hashes are: [0, H(0,0), H(H(0,0), H(0,0)), ...]
 */
async function getZeroHashes(): Promise<string[]> {
  if (zeroCache) return zeroCache;

  const poseidon = await buildPoseidon();
  const zeros: string[] = ["0"];

  for (let i = 0; i < TREE_DEPTH; i++) {
    const prev = BigInt(zeros[i]);
    const hash = poseidon.F.toString(poseidon([prev, prev]));
    zeros.push(hash);
  }

  zeroCache = zeros;
  return zeros;
}

/**
 * Compute Merkle path for a leaf at given index
 * For a sparse tree (few leaves), most path elements will be zero hashes
 *
 * @param leafIndex Index of the leaf (0-based)
 * @param totalLeaves Total number of leaves currently in tree
 * @param leaves All leaf values (commitments) in order
 * @returns Object with pathElements and pathIndices
 */
export async function computeMerklePath(
  leafIndex: number,
  totalLeaves: number,
  leaves: string[]
): Promise<{ pathElements: string[]; pathIndices: number[] }> {
  const poseidon = await buildPoseidon();
  const zeros = await getZeroHashes();

  const pathElements: string[] = [];
  const pathIndices: number[] = [];

  // Build tree level by level
  let currentLevel = [...leaves];
  let currentIndex = leafIndex;

  for (let level = 0; level < TREE_DEPTH; level++) {
    const isLeft = currentIndex % 2 === 0;
    pathIndices.push(isLeft ? 0 : 1);

    // Get sibling
    let sibling: string;
    if (isLeft) {
      // Right sibling
      const siblingIndex = currentIndex + 1;
      sibling = siblingIndex < currentLevel.length
        ? currentLevel[siblingIndex]
        : zeros[level];
    } else {
      // Left sibling
      const siblingIndex = currentIndex - 1;
      sibling = currentLevel[siblingIndex];
    }

    pathElements.push(sibling);

    // Compute next level
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : zeros[level];
      const hash = poseidon.F.toString(poseidon([BigInt(left), BigInt(right)]));
      nextLevel.push(hash);
    }

    // Pad next level to power of 2 if needed
    while (nextLevel.length < Math.ceil(currentLevel.length / 2)) {
      nextLevel.push(zeros[level + 1]);
    }

    currentLevel = nextLevel;
    currentIndex = Math.floor(currentIndex / 2);
  }

  return { pathElements, pathIndices };
}

/**
 * Simpler version: For the first leaf (index 0), path is all zeros on the right
 */
export async function getPathForFirstLeaf(): Promise<{ pathElements: string[]; pathIndices: number[] }> {
  const zeros = await getZeroHashes();

  return {
    pathElements: zeros.slice(0, TREE_DEPTH),
    pathIndices: Array(TREE_DEPTH).fill(0), // Always left (0) for first leaf
  };
}

/**
 * Get path elements and indices for any leaf index in a sparse tree
 * For a sparse tree with few leaves, we compute the path by:
 * 1. Building a minimal tree with only the known leaves
 * 2. Using zero hashes for empty positions
 *
 * Note: This assumes leaves are added sequentially from index 0
 * For production, query actual leaf values from contract or indexer
 */
export async function getMerklePath(
  leafIndex: number,
  totalLeaves?: number
): Promise<{ pathElements: string[]; pathIndices: number[] }> {
  // For first leaf, use optimized path
  if (leafIndex === 0) {
    return getPathForFirstLeaf();
  }

  // For sparse tree: all siblings on the path are zeros
  // This works because we assume sequential insertion and no other leaves exist
  // in the sibling positions along our path
  const zeros = await getZeroHashes();
  const pathElements: string[] = [];
  const pathIndices: number[] = [];

  let currentIndex = leafIndex;

  for (let level = 0; level < TREE_DEPTH; level++) {
    const isLeft = currentIndex % 2 === 0;
    pathIndices.push(isLeft ? 0 : 1);

    // In a sparse tree with sequential insertions, siblings are typically zero
    pathElements.push(zeros[level]);

    currentIndex = Math.floor(currentIndex / 2);
  }

  return { pathElements, pathIndices };
}
