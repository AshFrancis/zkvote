/**
 * Deployment-aware caching utility
 *
 * All cache keys include the deployment version to ensure
 * caches are automatically invalidated after redeployment.
 */

import { DEPLOY_VERSION, CONTRACTS, NETWORK_CONFIG } from '../config/contracts';

// Storage key for tracking the current deployment version
const VERSION_KEY = 'zkvote_deploy_version';

// Prefix for all zkvote cache keys
const CACHE_PREFIX = `zkvote_${NETWORK_CONFIG.networkName}_${CONTRACTS.REGISTRY_ID.slice(0, 6)}`;

/**
 * Check if deployment version has changed and clear old caches
 * Call this on app startup
 */
export function checkAndClearStaleCache(): boolean {
  const storedVersion = localStorage.getItem(VERSION_KEY);

  if (storedVersion !== DEPLOY_VERSION) {
    console.log(`[Cache] Deployment version changed: ${storedVersion} -> ${DEPLOY_VERSION}`);
    clearAllZKVoteCaches();
    localStorage.setItem(VERSION_KEY, DEPLOY_VERSION);
    return true;
  }

  return false;
}

/**
 * Clear all zkvote-related caches from localStorage
 */
export function clearAllZKVoteCaches(): void {
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (
      key.startsWith('zkvote_') ||
      key.startsWith('dao_') ||
      key.startsWith('tree_') ||
      key.startsWith('proposal_') ||
      key.startsWith('member_')
    )) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }

  console.log(`[Cache] Cleared ${keysToRemove.length} stale cache entries`);
}

/**
 * Generate a deployment-aware cache key
 */
export function cacheKey(namespace: string, ...parts: (string | number)[]): string {
  return `${CACHE_PREFIX}_${namespace}_${parts.join('_')}`;
}

/**
 * Get item from cache with type safety
 */
export function getCached<T>(key: string): T | null {
  try {
    const item = localStorage.getItem(key);
    if (!item) return null;
    return JSON.parse(item) as T;
  } catch {
    return null;
  }
}

/**
 * Set item in cache
 */
export function setCached<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

/**
 * Remove item from cache
 */
export function removeCached(key: string): void {
  localStorage.removeItem(key);
}
