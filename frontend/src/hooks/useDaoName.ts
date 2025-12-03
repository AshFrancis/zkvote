import { useState, useEffect, useCallback } from "react";
import { initializeContractClients } from "../lib/contracts";
import { getReadOnlyDaoRegistry } from "../lib/readOnlyContracts";

interface UseDaoNameOptions {
  publicKey: string | null;
  daoId: number | null;
  isInitializing?: boolean;
}

interface UseDaoNameResult {
  daoName: string;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Hook to fetch and cache DAO name from the registry.
 * Uses localStorage cache with stale-while-revalidate pattern.
 */
export function useDaoName({
  publicKey,
  daoId,
  isInitializing = false,
}: UseDaoNameOptions): UseDaoNameResult {
  const cacheKey = daoId ? `dao_info_${daoId}` : null;

  // Initialize with cached DAO name if available
  const [daoName, setDaoName] = useState<string>(() => {
    if (cacheKey) {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const cachedDao = JSON.parse(cached);
          return cachedDao.name || "";
        } catch {
          return "";
        }
      }
    }
    return "";
  });

  // Only show loading if no cache exists
  const [loading, setLoading] = useState(() => {
    if (cacheKey) {
      const cached = localStorage.getItem(cacheKey);
      return !cached;
    }
    return true;
  });

  const [error, setError] = useState<string | null>(null);

  const loadDaoName = useCallback(async () => {
    if (!daoId || !cacheKey) return;

    try {
      setError(null);

      // Load from cache first (stale-while-revalidate)
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const cachedDao = JSON.parse(cached);
          setDaoName(cachedDao.name || "");
          setLoading(false);
        } catch {
          // Invalid cache, continue to fetch
        }
      }

      // Fetch fresh data
      let result;
      // Try with wallet client first, fall back to read-only if unfunded
      if (publicKey) {
        try {
          const clients = initializeContractClients(publicKey);
          result = await clients.daoRegistry.get_dao({
            dao_id: BigInt(daoId),
          });
        } catch (err) {
          // If account not found, use read-only client
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (
            errorMessage.includes("Account not found") ||
            errorMessage.includes("does not exist")
          ) {
            const registry = getReadOnlyDaoRegistry();
            result = await registry.get_dao({
              dao_id: BigInt(daoId),
            });
          } else {
            throw err;
          }
        }
      } else {
        // No wallet connected, use read-only
        const registry = getReadOnlyDaoRegistry();
        result = await registry.get_dao({
          dao_id: BigInt(daoId),
        });
      }

      const newDaoName = result.result.name;
      setDaoName(newDaoName);

      // Update cache - merge with existing cached data if it exists
      if (cached) {
        try {
          const cachedDao = JSON.parse(cached);
          cachedDao.name = newDaoName;
          localStorage.setItem(cacheKey, JSON.stringify(cachedDao));
        } catch {
          localStorage.setItem(cacheKey, JSON.stringify({ name: newDaoName }));
        }
      } else {
        // Create minimal cache entry with just the name
        localStorage.setItem(cacheKey, JSON.stringify({ name: newDaoName }));
      }
    } catch (err) {
      console.error("Failed to load DAO name:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [daoId, cacheKey, publicKey]);

  useEffect(() => {
    // Wait for wallet initialization before loading
    if (isInitializing) {
      return;
    }
    if (daoId) {
      loadDaoName();
    }
  }, [publicKey, daoId, isInitializing, loadDaoName]);

  return {
    daoName,
    loading,
    error,
    refresh: loadDaoName,
  };
}
