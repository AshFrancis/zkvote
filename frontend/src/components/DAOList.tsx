import { useEffect, useState } from 'react';
import { getAllDaos } from '../lib/readOnlyContracts';
import { CONTRACTS } from '../config/contracts';
import { Alert, LoadingSpinner } from './ui';
import { Card, CardContent } from './ui/Card';
import DAOCard from './ui/DAOCard';
import { fetchDAOMetadata, getImageUrl } from '../lib/daoMetadata';
import type { DAOMetadata } from '../lib/daoMetadata';

interface DAO {
  id: number;
  name: string;
  creator: string;
  membership_open: boolean;
  metadata_cid?: string;
}

interface DAOWithMetadata extends DAO {
  metadata?: DAOMetadata | null;
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
const getMetadataCacheKey = () => `dao_metadata_${CONTRACTS.REGISTRY_ID.slice(0, 8)}`;

export default function DAOList({ onSelectDao, selectedDaoId, isConnected, userDaoIds = [], isInitializing = false }: DAOListProps) {
  const [daos, setDaos] = useState<DAOWithMetadata[]>(() => {
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
  const [metadataCache, setMetadataCache] = useState<Record<string, DAOMetadata | null>>(() => {
    const cached = localStorage.getItem(getMetadataCacheKey());
    return cached ? JSON.parse(cached) : {};
  });

  useEffect(() => {
    // Wait for wallet to finish initializing before loading
    if (isInitializing) {
      console.log('[DAOList] Waiting for wallet initialization...');
      return;
    }
    console.log('[DAOList] Loading all DAOs');
    loadDaos();
  }, [isInitializing]);

  // Load metadata for DAOs that have metadata_cid
  useEffect(() => {
    const loadMetadata = async () => {
      const daosWithCid = daos.filter(dao => dao.metadata_cid && !metadataCache[dao.metadata_cid]);
      if (daosWithCid.length === 0) return;

      const newCache = { ...metadataCache };

      await Promise.all(daosWithCid.map(async (dao) => {
        if (!dao.metadata_cid) return;
        try {
          const metadata = await fetchDAOMetadata(dao.metadata_cid);
          newCache[dao.metadata_cid] = metadata;
        } catch (err) {
          console.warn(`Failed to fetch metadata for DAO ${dao.id}:`, err);
          newCache[dao.metadata_cid!] = null;
        }
      }));

      setMetadataCache(newCache);
      localStorage.setItem(getMetadataCacheKey(), JSON.stringify(newCache));
    };

    loadMetadata();
  }, [daos]);

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

  // Get metadata for a DAO
  const getDAOMetadata = (dao: DAOWithMetadata): DAOMetadata | null => {
    if (!dao.metadata_cid) return null;
    return metadataCache[dao.metadata_cid] || null;
  };

  // Get cover image URL - returns null if using default background
  const getCoverImageUrl = (dao: DAOWithMetadata): string | null => {
    const metadata = getDAOMetadata(dao);
    if (metadata?.coverImageCid) {
      return getImageUrl(metadata.coverImageCid);
    }
    return null; // Will use CSS background for default
  };

  // Check if DAO has a custom cover image
  const hasCustomCover = (dao: DAOWithMetadata): boolean => {
    const metadata = getDAOMetadata(dao);
    return !!metadata?.coverImageCid;
  };

  // Get profile image URL
  const getProfileImageUrl = (dao: DAOWithMetadata): string | null => {
    const metadata = getDAOMetadata(dao);
    if (metadata?.profileImageCid) {
      return getImageUrl(metadata.profileImageCid);
    }
    return null;
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

        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredDaos.map((dao) => (
            <DAOCard
              key={dao.id}
              id={dao.id}
              name={dao.name}
              membershipOpen={dao.membership_open}
              isSelected={selectedDaoId === dao.id}
              coverUrl={getCoverImageUrl(dao)}
              profileUrl={getProfileImageUrl(dao)}
              hasCover={hasCustomCover(dao)}
              onClick={() => onSelectDao(dao.id, dao.name)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
