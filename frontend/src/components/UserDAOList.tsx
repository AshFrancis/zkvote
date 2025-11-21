import { useEffect, useState } from 'react';
import { getUserDaos } from '../lib/readOnlyContracts';

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

export default function UserDAOList({ userAddress, onSelectDao, selectedDaoId, onDaosLoaded, isInitializing = false }: UserDAOListProps) {
  const [daos, setDaos] = useState<UserDAO[]>(() => {
    // Initialize with cached data if available
    const cacheKey = `user_daos_${userAddress}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const cachedData = JSON.parse(cached);
      return cachedData;
    }
    return [];
  });
  const [loading, setLoading] = useState(() => {
    // Only show loading indicator if no cache exists
    const cacheKey = `user_daos_${userAddress}`;
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
    const cacheKey = `user_daos_${userAddress}`;

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
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Your DAOs
        </h2>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-400">Loading your DAOs...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Your DAOs
        </h2>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-100 px-4 py-3 rounded-lg">
          {error}
        </div>
        <button
          onClick={loadUserDaos}
          className="mt-4 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (daos.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Your DAOs
        </h2>
        <div className="text-center py-8">
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            You are not a member or admin of any DAOs yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Your DAOs ({daos.length})
      </h2>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {daos.map((dao) => (
          <button
            key={dao.id}
            onClick={() => onSelectDao(dao.id)}
            className={`text-left p-4 rounded-lg border transition-colors ${
              selectedDaoId === dao.id
                ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700'
                : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
            }`}
          >
            <div className="flex flex-col">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate flex-1">
                  {dao.name}
                </h3>
                {selectedDaoId === dao.id && (
                  <svg
                    className="w-4 h-4 text-purple-600 dark:text-purple-400 flex-shrink-0 ml-1"
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
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  DAO #{dao.id}
                </p>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    dao.role === 'admin'
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                  }`}
                >
                  {dao.role}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
