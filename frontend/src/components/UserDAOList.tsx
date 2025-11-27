import { useEffect, useState } from 'react';
import { getUserDaos } from '../lib/readOnlyContracts';
import { CONTRACTS } from '../config/contracts';
import { Alert, LoadingSpinner, Badge } from './ui';

interface UserDAO {
  id: number;
  name: string;
  creator: string;
  role: 'admin' | 'member';
}

interface UserDAOListProps {
  userAddress: string;
  onSelectDao: (daoId: number) => void;
  selectedDaoId?: number | null;
  onDaosLoaded?: (daoIds: number[]) => void;
  isInitializing?: boolean;
}

// Generate cache key based on user address and contract deployment so cache invalidates on redeployment
const getCacheKey = (userAddress: string) => `user_daos_${userAddress}_${CONTRACTS.REGISTRY_ID.slice(0, 8)}`;

export default function UserDAOList({ userAddress, onSelectDao, selectedDaoId, onDaosLoaded, isInitializing = false }: UserDAOListProps) {
  const [daos, setDaos] = useState<UserDAO[]>(() => {
    // Initialize with cached data if available
    const cacheKey = getCacheKey(userAddress);
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const cachedData = JSON.parse(cached);
      return cachedData;
    }
    return [];
  });
  const [loading, setLoading] = useState(() => {
    // Only show loading indicator if no cache exists
    const cacheKey = getCacheKey(userAddress);
    const cached = localStorage.getItem(cacheKey);
    return !cached;
  });
  const [error, setError] = useState<string | null>(null);

  // Notify parent of cached DAOs on mount
  useEffect(() => {
    if (daos.length > 0 && onDaosLoaded) {
      onDaosLoaded(daos.map(dao => dao.id));
    }
  }, []); // Run only once on mount

  useEffect(() => {
    // Wait for wallet to finish initializing before loading
    if (isInitializing) {
      console.log('[UserDAOList] Waiting for wallet initialization...');
      return;
    }
    console.log('[UserDAOList] Loading user DAOs for:', userAddress);
    loadUserDaos();
  }, [userAddress, isInitializing]);

  const loadUserDaos = async () => {
    const cacheKey = getCacheKey(userAddress);

    try {
      // Load from cache first
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const cachedData = JSON.parse(cached);
        setDaos(cachedData);
        setLoading(false);
        if (onDaosLoaded) {
          onDaosLoaded(cachedData.map((dao: UserDAO) => dao.id));
        }
      }

      // Fetch fresh data
      setError(null);
      const fetchedDaos = await getUserDaos(userAddress);
      setDaos(fetchedDaos);

      // Update cache
      localStorage.setItem(cacheKey, JSON.stringify(fetchedDaos));

      // Notify parent component of loaded DAO IDs
      if (onDaosLoaded) {
        onDaosLoaded(fetchedDaos.map(dao => dao.id));
      }
    } catch (err) {
      console.error('Failed to load user DAOs:', err);
      setError('Failed to load your DAOs. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (loading && daos.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Your DAOs
        </h2>
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner size="md" />
          <span className="ml-3 text-muted-foreground">Loading your DAOs...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Your DAOs
        </h2>
        <Alert variant="error">{error}</Alert>
        <button
          onClick={loadUserDaos}
          className="mt-4 px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // Filter out Public DAO (DAO #1) from user's DAOs
  const filteredDaos = daos.filter(dao => dao.id !== 1);

  if (filteredDaos.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Your DAOs
        </h2>
        <div className="text-center py-8">
          <p className="text-muted-foreground mb-4">
            You are not a member or admin of any DAOs yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-6">
      <h2 className="text-lg font-semibold text-foreground mb-4">
        Your DAOs ({filteredDaos.length})
      </h2>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {filteredDaos.map((dao) => (
          <button
            key={dao.id}
            onClick={() => onSelectDao(dao.id)}
            className={`text-left p-4 rounded-lg border transition-colors ${
              selectedDaoId === dao.id
                ? 'bg-primary/10 border-primary/50'
                : 'bg-muted/50 border-border hover:bg-muted'
            }`}
          >
            <div className="flex flex-col">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-semibold text-foreground truncate flex-1">
                  {dao.name}
                </h3>
                {selectedDaoId === dao.id && (
                  <svg
                    className="w-4 h-4 text-primary flex-shrink-0 ml-1"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">
                  DAO #{dao.id}
                </p>
                <Badge variant={dao.role === 'admin' ? 'blue' : 'success'} size="sm">
                  {dao.role}
                </Badge>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
/* eslint-disable react-hooks/exhaustive-deps */
