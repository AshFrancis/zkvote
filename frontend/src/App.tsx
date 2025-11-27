import { useState, useEffect } from "react";
import { Routes, Route, useNavigate, useLocation, useParams } from "react-router-dom";
import { Buffer } from "buffer";
import Navbar from "./components/Navbar";
import DAODashboard from "./components/DAODashboard";
import DAOList from "./components/DAOList";
import Homepage from "./components/Homepage";
import Docs from "./components/Docs";
import UserDAOList from "./components/UserDAOList";
import ManageMembers from "./components/ManageMembers";
import PublicVotes from "./components/PublicVotes";
import { useWallet } from "./hooks/useWallet";
import { useTheme } from "./hooks/useTheme";
import { initializeContractClients } from "./lib/contracts";
import { getReadOnlyDaoRegistry } from "./lib/readOnlyContracts";
import { truncateText } from "./lib/utils";
import verificationKey from "./lib/verification_key_soroban.json";
import { CONTRACTS } from "./config/contracts";
import { validateStaticConfig } from "./config/guardrails";
import { useRelayerStatus } from "./hooks/useRelayerStatus";
import { RelayerStatus as RelayerStatusComponent } from "./components/RelayerStatus";
import { Alert, LoadingSpinner } from "./components/ui";
import { Button } from "./components/ui/Button";
// ZK credentials will be generated deterministically after DAO creation

// Component for DAO detail page
function DAODetailPage({ publicKey, isInitializing }: { publicKey: string | null; isInitializing: boolean }) {
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
      return;
    }
    if (daoId) {
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
          {loading ? 'Loading...' : truncateText(daoName, 30)}
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
function ManageMembersPage({ publicKey, isInitializing }: { publicKey: string | null; isInitializing: boolean }) {
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
      return;
    }
    if (daoId) {
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
        <LoadingSpinner size="lg" />
      </div>
    );
  }

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
          {truncateText(daoName, 30)}
        </button>
        <span className="text-gray-400 dark:text-gray-600">/</span>
        <span className="text-gray-900 dark:text-gray-100 font-medium">Members</span>
      </nav>

      {/* Manage/View Members */}
      {selectedDaoId !== null && (
        <ManageMembers publicKey={publicKey} daoId={selectedDaoId} isAdmin={isAdmin} isInitializing={isInitializing} />
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
  const [userDaosLoaded, setUserDaosLoaded] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newDaoName, setNewDaoName] = useState("");
  const [membershipOpen, setMembershipOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [configErrors, setConfigErrors] = useState<string[]>([]);
  const { status: relayerStatusState, relayerConfig } = useRelayerStatus();

  // Determine current view from URL path
  const getCurrentView = (): 'home' | 'browse' | 'votes' | 'docs' => {
    if (location.pathname.startsWith('/daos/')) return 'browse';
    if (location.pathname === '/public-votes/') return 'votes';
    if (location.pathname === '/docs/') return 'docs';
    return 'home';
  };

  const currentView = getCurrentView();

  // Update document title and meta description based on current view
  useEffect(() => {
    const pageMeta: Record<string, { title: string; description: string }> = {
      home: {
        title: 'ZKVote - Anonymous Governance',
        description: 'Zero-knowledge governance for decentralized organizations on Stellar. Vote anonymously with cryptographic proofs.',
      },
      browse: {
        title: 'ZKVote - Browse DAOs',
        description: 'Explore and join decentralized autonomous organizations. Create your own DAO with anonymous voting powered by ZK proofs.',
      },
      votes: {
        title: 'ZKVote - Public Votes',
        description: 'Participate in public votes without revealing your identity. Anonymous governance powered by Groth16 zero-knowledge proofs.',
      },
      docs: {
        title: 'ZKVote - Documentation',
        description: 'Learn how ZKVote enables anonymous DAO governance using zero-knowledge proofs, Poseidon Merkle trees, and Stellar smart contracts.',
      },
    };
    const meta = pageMeta[currentView] || pageMeta.home;
    document.title = meta.title;

    // Update meta description
    const descriptionMeta = document.querySelector('meta[name="description"]');
    if (descriptionMeta) {
      descriptionMeta.setAttribute('content', meta.description);
    }
  }, [currentView]);

  // Clear success and error messages when navigating to a different route
  useEffect(() => {
    setSuccess(null);
    setError(null);
  }, [location.pathname]);

  // Reset userDaosLoaded when disconnecting
  useEffect(() => {
    if (!isConnected) {
      setUserDaosLoaded(false);
      setUserDaoIds([]);
    }
  }, [isConnected]);

  // Basic config guardrails (network + contract IDs)
  useEffect(() => {
    const { errors, warnings } = validateStaticConfig();
    setConfigErrors(errors);
    if (warnings.length) {
      console.warn("[config] warnings", warnings);
    }
  }, []);

  // Relayer readiness/mismatch handled via useRelayerStatus
  const relayerStatus =
    relayerStatusState?.state === "ready"
      ? "ready"
      : relayerStatusState?.message || null;

  const handleNavigate = (view: 'home' | 'browse' | 'votes' | 'docs') => {
    if (view === 'home') navigate('/');
    else if (view === 'browse') navigate('/daos/');
    else if (view === 'votes') navigate('/public-votes/');
    else if (view === 'docs') navigate('/docs/');
  };

  const handleSelectDao = (daoId: number) => {
    navigate(`/daos/${daoId}`);
  };

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

      if (!kit) {
        throw new Error("Wallet kit not available. Please reconnect your wallet.");
      }

      const clients = initializeContractClients(publicKey);

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

      // Convert hex strings to Buffers for VK
      const vk = {
        alpha: Buffer.from(verificationKey.alpha, 'hex'),
        beta: Buffer.from(verificationKey.beta, 'hex'),
        gamma: Buffer.from(verificationKey.gamma, 'hex'),
        delta: Buffer.from(verificationKey.delta, 'hex'),
        ic: verificationKey.ic.map((ic: string) => Buffer.from(ic, 'hex')),
      };

      // Single transaction: Create and initialize DAO (without creator registration)
      // Creator will register with deterministic credentials after creation
      console.log("Creating and initializing DAO...");

      const createAndInitTx = await clients.daoRegistry.create_and_init_dao_no_reg(
        {
          name: newDaoName,
          creator: publicKey,
          membership_open: membershipOpen,
          sbt_contract: CONTRACTS.SBT_ID,
          tree_contract: CONTRACTS.TREE_ID,
          voting_contract: CONTRACTS.VOTING_ID,
          tree_depth: 18,
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

      setSuccess(
        `DAO "${newDaoName}" created successfully! Redirecting...`
      );

      console.log(`DAO "${newDaoName}" (ID: ${newDaoId}) fully initialized!`);
      setNewDaoName("");
      setShowCreateForm(false);

      // Navigate to DAO page
      navigate(`/daos/${newDaoId}`);
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
    <div className="min-h-screen bg-background font-sans antialiased">

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
        relayerStatus={relayerStatus}
        relayerErrors={configErrors}
      />

      {/* Main Content */}
      <main className="container mx-auto py-8 md:py-24 px-4 sm:px-6 lg:px-8">
        <Routes>
          {/* Homepage Route */}
          <Route path="/" element={<Homepage />} />

          {/* Docs Route */}
          <Route path="/docs/" element={<Docs />} />

          {/* Browse DAOs Route */}
          <Route path="/daos/" element={
            <div className="space-y-8 animate-fade-in">
              {/* Page Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight">
                    Decentralized Organizations
                  </h1>
                  <p className="text-muted-foreground mt-2">
                    Explore and join DAOs on the network.
                  </p>
                </div>
                {isConnected && !showCreateForm && (
                  <Button onClick={() => setShowCreateForm(true)}>
                    Create DAO
                  </Button>
                )}
              </div>

              {/* Success/Error Messages */}
              {success && <Alert variant="success">{success}</Alert>}
              {error && <Alert variant="error">{error}</Alert>}

              {/* Create DAO Form */}
              {isConnected && showCreateForm && (
                <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6 animate-slide-in-from-top">
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-semibold leading-none tracking-tight mb-4">
                        Create New DAO
                      </h3>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label htmlFor="dao-name-input" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            DAO Name
                          </label>
                          <input
                            id="dao-name-input"
                            type="text"
                            value={newDaoName}
                            onChange={(e) => setNewDaoName(e.target.value)}
                            placeholder="Enter DAO name..."
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          />
                        </div>
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id="membership-open"
                            checked={membershipOpen}
                            onChange={(e) => setMembershipOpen(e.target.checked)}
                            className="h-4 w-4 rounded border-primary text-primary ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
                          />
                          <label htmlFor="membership-open" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            Open Membership
                            <span className="ml-2 text-xs text-muted-foreground font-normal">(Allow users to join without admin approval)</span>
                          </label>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Button
                        onClick={handleCreateDao}
                        disabled={creating || isInitializing || !kit}
                        className="flex-1"
                      >
                        {creating && <LoadingSpinner size="sm" color="white" className="mr-2" />}
                        {creating ? "Creating..." : "Create DAO"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowCreateForm(false);
                          setNewDaoName("");
                          setMembershipOpen(false);
                          setError(null);
                        }}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* User's DAOs - only visible when connected */}
              {isConnected && publicKey && (
                <UserDAOList
                  userAddress={publicKey}
                  onSelectDao={handleSelectDao}
                  onDaosLoaded={(ids) => {
                    setUserDaoIds(ids);
                    setUserDaosLoaded(true);
                  }}
                  isInitializing={isInitializing}
                />
              )}

              {/* DAO List - visible to everyone, but wait for user DAOs to load when connected */}
              {(!isConnected || userDaosLoaded) && (
                <DAOList
                  onSelectDao={handleSelectDao}
                  isConnected={isConnected}
                  userDaoIds={userDaoIds}
                  isInitializing={isInitializing}
                />
              )}

            </div>
          } />

          {/* Public Votes Route */}
          <Route path="/public-votes/" element={
            <PublicVotes publicKey={publicKey} isConnected={isConnected} isInitializing={isInitializing} />
          } />

          {/* DAO Detail Route */}
          <Route path="/daos/:daoId" element={
            <DAODetailPage publicKey={publicKey} isInitializing={isInitializing} />
          } />

          {/* Manage/View Members Route */}
          <Route path="/daos/:daoId/members" element={
            <ManageMembersPage publicKey={publicKey} isInitializing={isInitializing} />
          } />
        </Routes>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 bg-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="flex flex-col lg:flex-row lg:justify-between gap-8 mb-12 text-center lg:text-left">
            {/* Brand */}
            <div className="space-y-4 flex flex-col items-center lg:items-start">
              <svg className="h-6 w-auto" viewBox="0 0 203.97 50.91" fill="currentColor">
                <path d="M30.96,18.29c-5.69,9.07-12.96,21.17-17.64,28.59h5.62c7.06,0,8.42-2.16,10.51-9.29h2.59l-.72,12.46H.79l-.79-1.37c6.05-9.22,12.96-20.74,17.64-28.59h-5.47c-6.26,0-6.77,2.74-8.21,8.28H1.22v-11.52h29.09l.65,1.44Z"/>
                <path d="M38.39,8.28c0-2.74-.58-3.38-1.51-3.6l-2.38-.43V1.8l14.19-1.8.43.36v43.85c0,2.74.58,3.02,4.32,3.24v2.59h-19.37v-2.59c3.74-.22,4.32-.5,4.32-3.24V8.28ZM58.55,18.65c1.22-1.51,1.73-1.8,3.17-1.8h10.37v2.23c-8.06,1.58-10.51,2.59-12.1,4.46-.65.72-2.09,2.38-2.66,3.1-.07.14-.14.29,0,.5,3.24,5.98,6.91,11.45,11.38,16.92,1.94,2.38,3.31,3.24,4.61,3.74v2.16l-6.41.07c-5.33,0-7.85-1.01-10.15-4.25-3.1-4.18-5.04-8.5-7.2-12.89v-.58c1.66-2.3,6.55-10.58,9-13.68Z"/>
                <path d="M88.55,50.04c-3.31-9.22-6.98-18.87-10.3-27.58-.79-2.09-1.73-2.81-4.25-2.95v-2.66h18.29v2.66l-2.45.29c-1.22.22-1.3.72-.94,2.02,1.58,4.97,5.18,15.05,6.77,19.66h.29c2.3-6.91,4.46-13.25,6.05-19.37.36-1.3.14-2.02-1.08-2.16l-3.38-.43v-2.66h14.19v2.66c-2.74.22-3.89.43-4.97,2.88-3.82,8.64-7.2,18.94-10.44,27.65h-7.78Z"/>
                <path d="M146.69,33.48c0,10.8-5.18,17.43-17.64,17.43s-17.71-6.62-17.71-17.43,5.18-17.5,17.79-17.5,17.57,6.7,17.57,17.5ZM129.04,47.74c4.54,0,6.34-5.26,6.34-14.26s-1.8-14.26-6.34-14.26-6.41,5.18-6.41,14.33,1.8,14.19,6.41,14.19Z"/>
                <path d="M162.98,20.31v19.23c0,4.46,1.8,6.19,4.18,6.19.65,0,2.02-.29,2.88-.65l.72,2.16c-3.96,2.52-7.34,3.67-10.01,3.67-3.96,0-8.5-2.81-8.5-8.86v-21.75h-3.82v-3.46h4.18l6.19-8.5h4.18v8.5h6.84v3.46h-6.84Z"/>
                <path d="M183.16,33.12c0,7.06,2.38,12.38,8.86,12.38,3.96,0,6.91-2.02,8.93-5.9l2.52,1.44c-2.38,5.98-6.84,9.87-14.91,9.87-12.82.07-16.71-8.42-16.71-17.5s4.46-17.43,16.85-17.43c13.18,0,15.27,8.42,15.27,14.19,0,2.16-1.15,2.95-3.74,2.95h-17.07ZM191.08,29.74c1.51,0,2.09-.36,2.09-2.23,0-3.24-.86-8.28-4.61-8.28-4.03,0-5.47,5.33-5.47,10.51h7.99Z"/>
              </svg>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Zero-knowledge governance for decentralized organizations on Stellar.
              </p>
            </div>

            {/* Right columns */}
            <div className="flex justify-center lg:justify-end gap-24">
              {/* Product */}
              <div className="space-y-4 lg:text-right">
                <h4 className="text-sm font-semibold">Product</h4>
                <ul className="space-y-3 text-sm text-muted-foreground">
                  <li>
                    <button onClick={() => navigate('/daos/')} className="hover:text-foreground transition-colors">
                      Browse DAOs
                    </button>
                  </li>
                  <li>
                    <button onClick={() => navigate('/public-votes/')} className="hover:text-foreground transition-colors">
                      Public Votes
                    </button>
                  </li>
                  <li>
                    <button onClick={() => navigate('/docs/')} className="hover:text-foreground transition-colors">
                      Documentation
                    </button>
                  </li>
                </ul>
              </div>

              {/* Resources */}
              <div className="space-y-4 lg:text-right">
                <h4 className="text-sm font-semibold">Resources</h4>
                <ul className="space-y-3 text-sm text-muted-foreground">
                  <li>
                    <a href="https://github.com/ashtron/daovote" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                      GitHub
                    </a>
                  </li>
                  <li>
                    <a href="https://stellar.org" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                      Stellar Network
                    </a>
                  </li>
                  <li>
                    <a href="https://stellar.org/blog/developers/announcing-stellar-x-ray-protocol-25" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                      Stellar Protocol 25
                    </a>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="pt-8 border-t border-border/40 flex flex-col lg:flex-row items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              Built with Stellar Soroban Protocol 25 • Groth16 on BN254 • Poseidon Merkle Trees
            </p>
            <div className="flex items-center gap-6">
              <a href="https://github.com/ashtron/daovote" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
                </svg>
              </a>
              <a href="https://stellar.org" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 236.36 200">
                  <path d="M203,26.16l-28.46,14.5-137.43,70a82.49,82.49,0,0,1-.7-10.69A81.87,81.87,0,0,1,158.2,28.6l16.29-8.3,2.43-1.24A100,100,0,0,0,18.18,100q0,3.82.29,7.61a18.19,18.19,0,0,1-9.88,17.58L0,129.57V150l25.29-12.89,0,0,8.19-4.18,8.07-4.11v0L186.43,55l16.28-8.29,33.65-17.15V9.14Z"/>
                  <path d="M236.36,50,49.78,145,33.5,153.31,0,170.38v20.41l33.27-16.95,28.46-14.5L199.3,89.24A83.45,83.45,0,0,1,200,100,81.87,81.87,0,0,1,78.09,171.36l-1,.53-17.66,9A100,100,0,0,0,218.18,100c0-2.57-.1-5.14-.29-7.68a18.2,18.2,0,0,1,9.87-17.58l8.6-4.38Z"/>
                </svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
