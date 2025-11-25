import { useEffect, useState } from 'react';
import { getAllDaos } from '../lib/readOnlyContracts';
import { CONTRACTS } from '../config/contracts';

interface DAO {
  id: number;
  name: string;
  creator: string;
  membership_open: boolean;
}

interface DAOListProps {
  onSelectDao: (daoId: number) => void;
  selectedDaoId?: number | null;
  isConnected?: boolean;
  userDaoIds?: number[];
  isInitializing?: boolean;
}

// Generate cache key based on contract addresses so cache invalidates on redeployment
const getCacheKey = () => `all_daos_${CONTRACTS.REGISTRY_ID.slice(0, 8)}`;

export default function DAOList({ onSelectDao, selectedDaoId, isConnected, userDaoIds = [], isInitializing = false }: DAOListProps) {
  const [daos, setDaos] = useState<DAO[]>(() => {
    // Initialize with cached data if available
    const cached = localStorage.getItem(getCacheKey());
    return cached ? JSON.parse(cached) : [];
  });
  const [loading, setLoading] = useState(() => {
    // Only show loading indicator if no cache exists
    const cached = localStorage.getItem(getCacheKey());
    return !cached;
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Wait for wallet to finish initializing before loading
    if (isInitializing) {
      console.log('[DAOList] Waiting for wallet initialization...');
      return;
    }
    console.log('[DAOList] Loading all DAOs');
    loadDaos();
  }, [isInitializing]);

  const loadDaos = async () => {
    const cacheKey = getCacheKey();

    try {
      // Load from cache first
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const cachedData = JSON.parse(cached);
        setDaos(cachedData);
        setLoading(false);
      }

      // Fetch fresh data
      setError(null);
      const fetchedDaos = await getAllDaos();
      setDaos(fetchedDaos);

      // Update cache
      localStorage.setItem(cacheKey, JSON.stringify(fetchedDaos));
    } catch (err) {
      console.error('Failed to load DAOs:', err);
      setError('Failed to load DAOs. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Filter out user's DAOs when connected and always exclude DAO #1 (Public Votes)
  const filteredDaos = daos
    .filter(dao => dao.id !== 1) // Exclude Public Votes DAO
    .filter(dao => !isConnected || !userDaoIds.includes(dao.id)); // Exclude user's DAOs when connected

  const title = isConnected ? 'Other DAOs' : 'All DAOs';

  if (loading && daos.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          {title}
        </h2>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-400">Loading DAOs...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          {title}
        </h2>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-100 px-4 py-3 rounded-lg">
          {error}
        </div>
        <button
          onClick={loadDaos}
          className="mt-4 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (filteredDaos.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          {title}
        </h2>
        <div className="text-center py-8">
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {isConnected ? 'No other DAOs found.' : 'No DAOs found. Connect your wallet to create the first DAO!'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        {title} ({filteredDaos.length})
      </h2>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {filteredDaos.map((dao) => (
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
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                    {dao.name}
                  </h3>
                  {dao.membership_open ? (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="w-3 h-3 flex-shrink-0">
                      <rect width="12" height="8.571" x="6" y="12.071" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" rx="2"/>
                      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16.286 8.643a4.286 4.286 0 0 0-8.572 0v3.428"/>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="w-3 h-3 flex-shrink-0">
                      <rect width="12.526" height="8.947" x="5.737" y="12.053" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" rx="2"/>
                      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7.526 12.053v-3.58a4.474 4.474 0 0 1 8.948 0v3.58"/>
                    </svg>
                  )}
                </div>
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
              <p className="text-xs text-gray-500 dark:text-gray-400">
                DAO #{dao.id}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
