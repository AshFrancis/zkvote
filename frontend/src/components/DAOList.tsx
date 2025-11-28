import { useEffect, useState } from 'react';
import { getAllDaos } from '../lib/readOnlyContracts';
import { CONTRACTS } from '../config/contracts';
import { Alert, LoadingSpinner, Badge } from './ui';
import { Card, CardContent } from './ui/Card';
import { Lock, Unlock, Users } from 'lucide-react';

interface DAO {
  id: number;
  name: string;
  creator: string;
  membership_open: boolean;
}

interface DAOListProps {
  onSelectDao: (daoId: number, daoName?: string) => void;
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
      <Card>
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold mb-4">
            {title}
          </h2>
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner size="md" />
            <span className="ml-3 text-muted-foreground">Loading DAOs...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold mb-4">
            {title}
          </h2>
          <Alert variant="error">{error}</Alert>
          <button
            onClick={loadDaos}
            className="mt-4 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 transition-colors"
          >
            Retry
          </button>
        </CardContent>
      </Card>
    );
  }

  if (filteredDaos.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold mb-4">
            {title}
          </h2>
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">
              {isConnected ? 'No other DAOs found.' : 'No DAOs found. Connect your wallet to create the first DAO!'}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-lg font-semibold mb-4">
          {title} ({filteredDaos.length})
        </h2>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {filteredDaos.map((dao) => (
            <button
              key={dao.id}
              onClick={() => onSelectDao(dao.id, dao.name)}
              className={`text-left p-4 rounded-lg border transition-all hover:shadow-sm ${selectedDaoId === dao.id
                  ? 'bg-primary/5 border-primary ring-1 ring-primary'
                  : 'bg-card border-border hover:bg-accent hover:text-accent-foreground'
                }`}
            >
              <div className="flex flex-col h-full justify-between gap-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <h3 className="text-sm font-semibold truncate">
                      {dao.name}
                    </h3>
                  </div>
                  {selectedDaoId === dao.id && (
                    <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    #{dao.id}
                  </p>
                  {dao.membership_open ? (
                    <Badge variant="success" className="h-5 px-1 text-[10px] gap-0.5">
                      <Unlock className="w-2.5 h-2.5" /> Open
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="h-5 px-1 text-[10px] gap-0.5">
                      <Lock className="w-2.5 h-2.5" /> Private
                    </Badge>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
