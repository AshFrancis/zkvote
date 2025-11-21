import { useState, useEffect } from "react";
import { Routes, Route, useNavigate, useLocation, useParams } from "react-router-dom";
import { Buffer } from "buffer";
import Navbar from "./components/Navbar";
import DAODashboard from "./components/DAODashboard";
import DAOList from "./components/DAOList";
import UserDAOList from "./components/UserDAOList";
import ManageMembers from "./components/ManageMembers";
import { useWallet } from "./hooks/useWallet";
import { useTheme } from "./hooks/useTheme";
import { initializeContractClients } from "./lib/contracts";
import { getReadOnlyDaoRegistry } from "./lib/readOnlyContracts";
import verificationKey from "./lib/verification_key_soroban_le.json";
import { CONTRACTS } from "./config/contracts";
import { generateZKCredentials, storeZKCredentials } from "./lib/zk";

// Component for DAO detail page
function DAODetailPage({ publicKey, isConnected, isInitializing }: { publicKey: string | null; isConnected: boolean; isInitializing: boolean }) {
  const { daoId } = useParams<{ daoId: string }>();
  const navigate = useNavigate();
  const [daoName, setDaoName] = useState<string>(() => {
    // Initialize with cached DAO name if available
    if (daoId) {
      const cacheKey = `dao_info_${daoId}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const cachedDao = JSON.parse(cached);
        return cachedDao.name || "";
      }
    }
    return "";
  });
  const [loading, setLoading] = useState(() => {
    // Only show loading if no cache exists
    if (daoId) {
      const cacheKey = `dao_info_${daoId}`;
      const cached = localStorage.getItem(cacheKey);
      return !cached;
    }
    return true;
  });
  const selectedDaoId = daoId ? parseInt(daoId, 10) : null;

  useEffect(() => {
    // Wait for wallet initialization before loading
    if (isInitializing) {
      console.log('[DAODetailPage] Waiting for wallet initialization...');
      return;
    }
    if (daoId) {
      console.log('[DAODetailPage] Loading DAO name for DAO:', daoId, 'publicKey:', publicKey);
      loadDAOName();
    }
  }, [publicKey, daoId, isInitializing]);

  const loadDAOName = async () => {
    const cacheKey = `dao_info_${daoId}`;

    try {
      // Load from cache first
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const cachedDao = JSON.parse(cached);
        setDaoName(cachedDao.name || "");
        setLoading(false);
      }

      // Fetch fresh data
      let result;
      // Try with wallet client first, fall back to read-only if unfunded
      if (publicKey) {
        try {
          const clients = initializeContractClients(publicKey);
          result = await clients.daoRegistry.get_dao({
            dao_id: BigInt(daoId!),
          });
        } catch (err) {
          // If account not found, use read-only client
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (errorMessage.includes('Account not found') || errorMessage.includes('does not exist')) {
            const registry = getReadOnlyDaoRegistry();
            result = await registry.get_dao({
              dao_id: BigInt(daoId!),
            });
          } else {
            throw err;
          }
        }
      } else {
        // No wallet connected, use read-only
        const registry = getReadOnlyDaoRegistry();
        result = await registry.get_dao({
          dao_id: BigInt(daoId!),
        });
      }

      const newDaoName = result.result.name;
      setDaoName(newDaoName);

      // Update cache - merge with existing cached data if it exists
      if (cached) {
        const cachedDao = JSON.parse(cached);
        cachedDao.name = newDaoName;
        localStorage.setItem(cacheKey, JSON.stringify(cachedDao));
      } else {
        // Create minimal cache entry with just the name
        localStorage.setItem(cacheKey, JSON.stringify({ name: newDaoName }));
      }
    } catch (err) {
      console.error('Failed to load DAO name:', err);
    } finally {
      setLoading(false);
    }
  };

  const truncateDaoName = (name: string) => {
    return name.length > 30 ? `${name.substring(0, 30)}...` : name;
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-sm">
        <button
          onClick={() => navigate('/daos/')}
          className="text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
        >
          DAOs
        </button>
        <span className="text-gray-400 dark:text-gray-600">/</span>
        <span className="text-gray-900 dark:text-gray-100 font-medium">
          {loading ? 'Loading...' : truncateDaoName(daoName)}
        </span>
      </nav>

      {/* DAO Dashboard */}
      {selectedDaoId !== null && (
        <DAODashboard publicKey={publicKey} daoId={selectedDaoId} isInitializing={isInitializing} />
      )}
    </div>
  );
}

// Component for Manage/View Members page
function ManageMembersPage({ publicKey, isConnected, isInitializing }: { publicKey: string | null; isConnected: boolean; isInitializing: boolean }) {
  const { daoId } = useParams<{ daoId: string }>();
  const navigate = useNavigate();
  const [daoName, setDaoName] = useState<string>(() => {
    // Initialize with cached DAO name if available
    if (daoId) {
      const cacheKey = `dao_info_${daoId}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const cachedDao = JSON.parse(cached);
        return cachedDao.name || "";
      }
    }
    return "";
  });
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    // Initialize with cached admin status if available
    if (daoId && publicKey) {
      const cacheKey = `dao_info_${daoId}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const cachedDao = JSON.parse(cached);
        return cachedDao.creator === publicKey;
      }
    }
    return false;
  });
  const [loading, setLoading] = useState(() => {
    // Only show loading if no cache exists
    if (daoId) {
      const cacheKey = `dao_info_${daoId}`;
      const cached = localStorage.getItem(cacheKey);
      return !cached;
    }
    return true;
  });

  useEffect(() => {
    // Wait for wallet initialization before loading
    if (isInitializing) {
      console.log('[ManageMembersPage] Waiting for wallet initialization...');
      return;
    }
    if (daoId) {
      console.log('[ManageMembersPage] Loading DAO info for DAO:', daoId, 'publicKey:', publicKey);
      loadDAOInfo();
    }
  }, [publicKey, daoId, isInitializing]);

  const loadDAOInfo = async () => {
    const cacheKey = `dao_info_${daoId}`;

    try {
      // Load from cache first
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const cachedDao = JSON.parse(cached);
        setDaoName(cachedDao.name || "");
        setIsAdmin(cachedDao.creator === publicKey);
        setLoading(false);
      }

      // Fetch fresh data
      let result;
      // Try with wallet client first, fall back to read-only if unfunded
      if (publicKey) {
        try {
          const clients = initializeContractClients(publicKey);
          result = await clients.daoRegistry.get_dao({
            dao_id: BigInt(daoId!),
          });
        } catch (err) {
          // If account not found, use read-only client
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (errorMessage.includes('Account not found') || errorMessage.includes('does not exist')) {
            const registry = getReadOnlyDaoRegistry();
            result = await registry.get_dao({
              dao_id: BigInt(daoId!),
            });
          } else {
            throw err;
          }
        }
      } else {
        // No wallet connected, use read-only
        const registry = getReadOnlyDaoRegistry();
        result = await registry.get_dao({
          dao_id: BigInt(daoId!),
        });
      }

      const newDaoName = result.result.name;
      const newIsAdmin = result.result.admin === publicKey;
      setDaoName(newDaoName);
      setIsAdmin(newIsAdmin);

      // Update cache - merge with existing cached data if it exists
      if (cached) {
        const cachedDao = JSON.parse(cached);
        cachedDao.name = newDaoName;
        cachedDao.creator = result.result.admin;
        localStorage.setItem(cacheKey, JSON.stringify(cachedDao));
      } else {
        // Create minimal cache entry
        localStorage.setItem(cacheKey, JSON.stringify({
          name: newDaoName,
          creator: result.result.admin
        }));
      }
    } catch (err) {
      console.error('Failed to load DAO info:', err);
    } finally {
      setLoading(false);
    }
  };

  const selectedDaoId = daoId ? parseInt(daoId, 10) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  const truncateDaoName = (name: string) => {
    return name.length > 30 ? `${name.substring(0, 30)}...` : name;
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-sm">
        <button
          onClick={() => navigate('/daos/')}
          className="text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
        >
          DAOs
        </button>
        <span className="text-gray-400 dark:text-gray-600">/</span>
        <button
          onClick={() => navigate(`/daos/${daoId}`)}
          className="text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
        >
          {truncateDaoName(daoName)}
        </button>
        <span className="text-gray-400 dark:text-gray-600">/</span>
        <span className="text-gray-900 dark:text-gray-100 font-medium">Members</span>
      </nav>

      {/* Manage/View Members */}
      {selectedDaoId !== null && (
        <ManageMembers publicKey={publicKey} daoId={selectedDaoId} daoName={daoName} isAdmin={isAdmin} isInitializing={isInitializing} />
      )}
    </div>
  );
}

function App() {
  const { publicKey, isConnected, isInitializing, connect, disconnect, kit } = useWallet();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [userDaoIds, setUserDaoIds] = useState<number[]>([]);

  // Determine current view from URL path
  const getCurrentView = (): 'home' | 'browse' | 'votes' | 'dao' => {
    if (location.pathname.startsWith('/daos/')) return 'dao';
    if (location.pathname === '/daos/') return 'browse';
    if (location.pathname === '/public-votes/') return 'votes';
    return 'home';
  };

  const currentView = getCurrentView();

  const handleNavigate = (view: 'home' | 'browse' | 'votes') => {
    if (view === 'home') navigate('/');
    else if (view === 'browse') navigate('/daos/');
    else if (view === 'votes') navigate('/public-votes/');
  };

  const handleSelectDao = (daoId: number) => {
    navigate(`/daos/${daoId}`);
  };
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newDaoName, setNewDaoName] = useState("");
  const [membershipOpen, setMembershipOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleCreateDao = async () => {
    if (!newDaoName.trim()) {
      setError("DAO name is required");
      return;
    }

    if (!publicKey) {
      setError("Wallet not connected");
      return;
    }

    try {
      setCreating(true);
      setError(null);
      setSuccess(null);

      const clients = initializeContractClients(publicKey);

      if (!kit) {
        throw new Error("Wallet kit not available");
      }

      // Helper function to retry transactions on TRY_AGAIN_LATER errors
      const sendWithRetry = async (tx: any, maxRetries = 3) => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            return await tx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });
          } catch (err: any) {
            const isTryAgainLater = err?.message?.includes("TRY_AGAIN_LATER") ||
                                    err?.toString()?.includes("TRY_AGAIN_LATER");

            if (isTryAgainLater && attempt < maxRetries) {
              console.log(`Transaction failed with TRY_AGAIN_LATER, retrying (attempt ${attempt}/${maxRetries})...`);
              await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
              continue;
            }
            throw err; // Re-throw if not TRY_AGAIN_LATER or out of retries
          }
        }
      };

      // Generate ZK credentials for anonymous voting
      console.log("Generating ZK credentials...");
      const zkCredentials = await generateZKCredentials();
      console.log("Generated commitment:", zkCredentials.commitment);

      // Convert hex strings to Buffers for VK
      const vk = {
        alpha: Buffer.from(verificationKey.alpha, 'hex'),
        beta: Buffer.from(verificationKey.beta, 'hex'),
        gamma: Buffer.from(verificationKey.gamma, 'hex'),
        delta: Buffer.from(verificationKey.delta, 'hex'),
        ic: verificationKey.ic.map((ic: string) => Buffer.from(ic, 'hex')),
      };

      // Single transaction: Create and fully initialize DAO
      console.log("Creating and initializing DAO in a single transaction...");

      const createAndInitTx = await clients.daoRegistry.create_and_init_dao(
        {
          name: newDaoName,
          creator: publicKey,
          membership_open: membershipOpen,
          sbt_contract: CONTRACTS.SBT_ID,
          tree_contract: CONTRACTS.TREE_ID,
          voting_contract: CONTRACTS.VOTING_ID,
          tree_depth: 20,
          creator_commitment: BigInt(zkCredentials.commitment),
          vk,
        },
        {
          // Increase budget for this complex transaction (5 steps including Merkle tree ops)
          fee: "10000000", // 10 XLM max fee
        }
      );

      const result = await sendWithRetry(createAndInitTx);

      // Show creating message only after transaction is signed and sent
      setSuccess("Creating DAO (minting SBT, initializing tree, and setting verification key)...");

      const newDaoId = Number(result.result);
      console.log(`DAO created and fully initialized with ID: ${newDaoId}`);

      // Store ZK credentials for this DAO (leafIndex is 0 since creator is first registered member)
      storeZKCredentials(newDaoId, publicKey, zkCredentials, 0);
      console.log(`Stored ZK credentials for DAO ${newDaoId}`);

      setSuccess(`DAO "${newDaoName}" created and fully initialized! DAO ID: ${newDaoId}. You can now vote anonymously!`);
      console.log(`DAO "${newDaoName}" (ID: ${newDaoId}) fully initialized!`);
      setNewDaoName("");
      setShowCreateForm(false);

      // Navigate to the newly created DAO's page
      setTimeout(() => {
        navigate(`/daos/${newDaoId}`);
      }, 1500); // Give user time to see success message
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to create DAO";
      setError(errorMessage);
      console.error("Failed to create DAO:", err);
      console.error("Error details:", errorMessage);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Navigation */}
      <Navbar
        onConnect={connect}
        onDisconnect={disconnect}
        publicKey={publicKey}
        isConnected={isConnected}
        connecting={false}
        theme={theme}
        onToggleTheme={toggleTheme}
        currentView={currentView}
        onNavigate={handleNavigate}
      />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          {/* Homepage Route */}
          <Route path="/" element={
            <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)]">
              <div className="text-center max-w-3xl">
                <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-8">
                  Anonymous Stellar Voting Through ZK Snarks
                </h1>
                <button
                  onClick={() => navigate('/daos/')}
                  className="px-8 py-4 text-lg font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors shadow-lg hover:shadow-xl"
                >
                  Browse DAOs
                </button>
              </div>
            </div>
          } />

          {/* Browse DAOs Route */}
          <Route path="/daos/" element={
          <div className="space-y-6">
          {/* Page Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Decentralized Autonomous Organizations
            </h1>
            {isConnected && !showCreateForm && (
              <button
                onClick={() => setShowCreateForm(true)}
                className="px-6 py-2 text-sm font-medium text-white bg-purple-600 border border-transparent rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 transition-colors"
              >
                Create DAO
              </button>
            )}
          </div>

          {/* Success/Error Messages */}
          {success && (
            <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-100 px-4 py-3 rounded-lg">
              {success}
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-100 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {/* Create DAO Form */}
          {isConnected && showCreateForm && (
            <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
              <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                    Create New DAO
                  </h3>
                  <div className="mb-4">
                    <label htmlFor="dao-name-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      DAO Name
                    </label>
                    <input
                      id="dao-name-input"
                      type="text"
                      value={newDaoName}
                      onChange={(e) => setNewDaoName(e.target.value)}
                      placeholder="Enter DAO name..."
                      className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                    />
                  </div>
                  <div className="mb-4">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={membershipOpen}
                        onChange={(e) => setMembershipOpen(e.target.checked)}
                        className="w-4 h-4 text-purple-600 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-purple-500 focus:ring-2"
                      />
                      <span className="ml-2 text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
                        Open DAO
                        <span className="text-xs text-gray-500 dark:text-gray-400">(Allow users to join without admin approval)</span>
                      </span>
                    </label>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={handleCreateDao}
                      disabled={creating}
                      className="flex-1 px-4 py-2 text-sm font-medium text-white bg-purple-600 border border-transparent rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                    >
                      {creating && (
                        <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      )}
                      {creating ? "Creating..." : "Create"}
                    </button>
                    <button
                      onClick={() => {
                        setShowCreateForm(false);
                        setNewDaoName("");
                        setMembershipOpen(false);
                        setError(null);
                      }}
                      className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
            </div>
          )}

          {/* User's DAOs - only visible when connected */}
          {isConnected && publicKey && (
            <UserDAOList
              userAddress={publicKey}
              onSelectDao={handleSelectDao}
              onDaosLoaded={setUserDaoIds}
              isInitializing={isInitializing}
            />
          )}

          {/* DAO List - visible to everyone */}
          <DAOList
            onSelectDao={handleSelectDao}
            isConnected={isConnected}
            userDaoIds={userDaoIds}
            isInitializing={isInitializing}
          />

          {/* Info Banner when not connected */}
          {!isConnected && !isInitializing && (
            <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                Welcome to DaoVote
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                An anonymous voting system for DAOs built on Stellar using zero-knowledge proofs.
              </p>
              <ul className="space-y-3">
                <li className="flex items-start">
                  <span className="text-green-500 dark:text-green-400 mr-3 mt-0.5">✓</span>
                  <span className="text-gray-700 dark:text-gray-300">
                    <strong className="font-semibold">Anonymous voting</strong> - Vote without revealing your identity
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 dark:text-green-400 mr-3 mt-0.5">✓</span>
                  <span className="text-gray-700 dark:text-gray-300">
                    <strong className="font-semibold">ZK proofs</strong> - Prove membership without revealing which member
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 dark:text-green-400 mr-3 mt-0.5">✓</span>
                  <span className="text-gray-700 dark:text-gray-300">
                    <strong className="font-semibold">Soulbound tokens</strong> - Non-transferable membership NFTs
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 dark:text-green-400 mr-3 mt-0.5">✓</span>
                  <span className="text-gray-700 dark:text-gray-300">
                    <strong className="font-semibold">Protocol 25</strong> - Native BN254 curve operations on Stellar
                  </span>
                </li>
              </ul>
            </div>
          )}
          </div>
          } />

          {/* Public Votes Route */}
          <Route path="/public-votes/" element={
            <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                Public Votes
              </h2>
              <p className="text-gray-600 dark:text-gray-400">
                Public vote history coming soon...
              </p>
            </div>
          } />

          {/* DAO Detail Route */}
          <Route path="/daos/:daoId" element={
            <DAODetailPage publicKey={publicKey} isConnected={isConnected} isInitializing={isInitializing} />
          } />

          {/* Manage/View Members Route */}
          <Route path="/daos/:daoId/members" element={
            <ManageMembersPage publicKey={publicKey} isConnected={isConnected} isInitializing={isInitializing} />
          } />
        </Routes>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 mt-12">
        <div className="border-t border-gray-200 dark:border-gray-700 pt-8 text-center text-sm text-gray-600 dark:text-gray-400">
          <p>
            Built with Stellar Soroban Protocol 25 • Using Groth16 ZK-SNARKs on BN254
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
