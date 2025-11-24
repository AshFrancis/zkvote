import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { initializeContractClients } from "../lib/contracts";
import { getReadOnlyDaoRegistry, getReadOnlyMembershipSbt, getReadOnlyMembershipTree } from "../lib/readOnlyContracts";
import { useWallet } from "../hooks/useWallet";
import { generateSecret, calculateCommitment } from "../lib/zkproof";
import ProposalList from "./ProposalList";

interface DAODashboardProps {
  publicKey: string | null;
  daoId: number;
  isInitializing?: boolean;
}

interface DAOInfo {
  id: number;
  name: string;
  creator: string;
  hasMembership: boolean;
  isAdmin: boolean;
  treeInitialized: boolean;
  vkSet: boolean;
  membershipOpen: boolean;
}

export default function DAODashboard({ publicKey, daoId, isInitializing = false }: DAODashboardProps) {
  const { kit } = useWallet();
  const navigate = useNavigate();
  const [dao, setDao] = useState<DAOInfo | null>(() => {
    // Initialize with cached data if available
    const cacheKey = `dao_info_${daoId}`;
    const cached = localStorage.getItem(cacheKey);
    return cached ? JSON.parse(cached) : null;
  });
  const [loading, setLoading] = useState(() => {
    // Only show loading indicator if no cache exists
    const cacheKey = `dao_info_${daoId}`;
    const cached = localStorage.getItem(cacheKey);
    return !cached;
  });
  const [error, setError] = useState<string | null>(null);
  const [mintAddress, setMintAddress] = useState("");
  const [minting, setMinting] = useState(false);
  const [showMintForm, setShowMintForm] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registrationStatus, setRegistrationStatus] = useState<string | null>(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [hasUnregisteredCredentials, setHasUnregisteredCredentials] = useState(false);
  const [joining, setJoining] = useState(false);
  const [showCreateProposal, setShowCreateProposal] = useState(false);
  const [proposalDescription, setProposalDescription] = useState("");
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [proposalKey, setProposalKey] = useState(0);
  const [voteMode, setVoteMode] = useState<"fixed" | "trailing">("fixed");

  // Optimistically check registration from cache when publicKey changes
  useEffect(() => {
    if (publicKey) {
      const key = `voting_registration_${daoId}_${publicKey}`;
      setIsRegistered(!!localStorage.getItem(key));
    }
  }, [publicKey, daoId]);

  useEffect(() => {
    // Wait for wallet initialization before loading
    if (isInitializing) {
      return;
    }
    loadDAOInfo();
    checkRegistrationStatus();
  }, [daoId, publicKey, isInitializing]);

  // Note: Auto-registration removed - users must manually click "Register for Voting"
  // This gives users explicit control over when they set up voting credentials

  const checkRegistrationStatus = async () => {
    const key = `voting_registration_${daoId}_${publicKey}`;
    const stored = localStorage.getItem(key);

    if (!stored) {
      setIsRegistered(false);
      setHasUnregisteredCredentials(false);
      return;
    }

    // Validate that the cached registration actually exists on-chain
    // This handles contract redeployments where localStorage has stale data
    try {
      const registrationData = JSON.parse(stored);
      const clients = initializeContractClients(publicKey || "");

      const leafIndexResult = await clients.membershipTree.get_leaf_index({
        dao_id: BigInt(daoId),
        commitment: BigInt(registrationData.commitment),
      });

      const onChainLeafIndex = Number(leafIndexResult.result);

      if (onChainLeafIndex === registrationData.leafIndex) {
        setIsRegistered(true);
        setHasUnregisteredCredentials(false);
      } else {
        localStorage.removeItem(key);
        setIsRegistered(false);
        setHasUnregisteredCredentials(false);
      }
    } catch (err) {
      // If the commitment doesn't exist on-chain, keep the credentials
      // and show "Complete Registration" button
      setIsRegistered(false);
      setHasUnregisteredCredentials(true);
    }
  };

  const loadDAOInfo = async () => {
    const cacheKey = `dao_info_${daoId}`;

    try {
      // Load from cache first
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const cachedDao = JSON.parse(cached);
        setDao(cachedDao);
        setLoading(false);
      }

      setError(null);

      // Determine if we should use read-only mode
      let useReadOnly = !publicKey;
      let daoResult;

      // Try to load DAO info with wallet client first, fall back to read-only if unfunded
      if (publicKey && !useReadOnly) {
        try {
          const clients = initializeContractClients(publicKey);
          daoResult = await clients.daoRegistry.get_dao({
            dao_id: BigInt(daoId),
          });
        } catch (err) {
          // If account not found, fall back to read-only mode
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (errorMessage.includes('Account not found') || errorMessage.includes('does not exist')) {
            console.warn('Connected wallet account not found on network, using read-only mode');
            useReadOnly = true;
          } else {
            throw err;
          }
        }
      }

      // If we need read-only mode, get DAO info with read-only client
      if (useReadOnly || !daoResult) {
        const registry = getReadOnlyDaoRegistry();
        daoResult = await registry.get_dao({
          dao_id: BigInt(daoId),
        });
      }

      // Check if user has SBT (only if wallet connected and funded)
      const hasSBT = !useReadOnly && publicKey ? await checkMembership() : false;

      // Check initialization status (always use read-only)
      const treeInitialized = await checkTreeInitialized();
      const vkSet = await checkVKSet();

      const isAdmin = !useReadOnly && publicKey ? (daoResult.result.admin === publicKey) : false;

      const daoInfo = {
        id: daoId,
        name: daoResult.result.name,
        creator: daoResult.result.admin,
        hasMembership: hasSBT,
        isAdmin,
        treeInitialized,
        vkSet,
        membershipOpen: daoResult.result.membership_open,
      };

      setDao(daoInfo);

      // Cache the DAO info
      localStorage.setItem(cacheKey, JSON.stringify(daoInfo));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load DAO");
      console.error("Failed to load DAO:", err);
    } finally {
      setLoading(false);
    }
  };

  const checkMembership = async (): Promise<boolean> => {
    if (!publicKey) return false;
    try {
      // Try with wallet client first, fall back to read-only if unfunded
      try {
        const clients = initializeContractClients(publicKey);
        const result = await clients.membershipSbt.has({
          dao_id: BigInt(daoId),
          of: publicKey,
        });
        return result.result;
      } catch (err) {
        // If account not found, use read-only client
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes('Account not found') || errorMessage.includes('does not exist')) {
          const sbtClient = getReadOnlyMembershipSbt();
          const result = await sbtClient.has({
            dao_id: BigInt(daoId),
            of: publicKey,
          });
          return result.result;
        }
        throw err;
      }
    } catch (err) {
      console.error("Failed to check membership:", err);
      return false;
    }
  };

  const checkTreeInitialized = async (): Promise<boolean> => {
    try {
      // Always use read-only client for this check
      const treeClient = getReadOnlyMembershipTree();

      const result = await treeClient.get_tree_info({
        dao_id: BigInt(daoId),
      });

      // get_tree_info returns [depth, leaf_count, root] as a tuple
      // Check if depth > 0 to confirm tree is initialized
      const depth = Number(result.result[0]);
      return depth > 0;
    } catch (err) {
      console.error("Failed to check tree initialization:", err);
      return false;
    }
  };

  const checkVKSet = async (): Promise<boolean> => {
    // Note: There's no get_vk function in the contract, so we can't reliably check
    // if VK is set without creating a proposal first. We'll assume it's set for now.
    // If it's not set, proposal creation will fail with an error.
    // TODO: Add get_vk function to voting contract for proper validation
    return true;
  };

  const handleMintSBT = async () => {
    if (!mintAddress.trim()) {
      setError("Address is required");
      return;
    }

    try {
      setMinting(true);
      setError(null);

      const clients = initializeContractClients(publicKey);

      // Check if address already has an SBT
      const alreadyHas = await clients.membershipSbt.has({
        dao_id: BigInt(daoId),
        of: mintAddress,
      });

      if (alreadyHas.result) {
        setError(`Address ${mintAddress.substring(0, 8)}... already has a membership SBT for this DAO`);
        setMinting(false);
        return;
      }

      const tx = await clients.membershipSbt.mint({
        dao_id: BigInt(daoId),
        to: mintAddress,
        admin: publicKey,
      });

      if (!kit) {
        throw new Error("Wallet kit not available");
      }

      await tx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });

      setMintAddress("");
      setShowMintForm(false);

      // Reload DAO info to update membership status
      await loadDAOInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mint SBT");
      console.error("Failed to mint SBT:", err);
    } finally {
      setMinting(false);
    }
  };

  const handleRegisterForVoting = async () => {
    // Prevent duplicate calls
    if (registering) {
      console.log("[Registration] Already in progress, ignoring duplicate call");
      return;
    }

    try {
      setRegistering(true);
      setError(null);
      setRegistrationStatus(null);

      if (!kit) {
        throw new Error("Wallet kit not available");
      }

      let secret: string, salt: string, commitment: string;

      // Check if we already have unregistered credentials
      const key = `voting_registration_${daoId}_${publicKey}`;
      const stored = localStorage.getItem(key);

      if (hasUnregisteredCredentials && stored) {
        // Skip Step 1 - we already have credentials!
        console.log("[Registration] Using existing credentials, skipping signature step");
        const existingData = JSON.parse(stored);
        secret = existingData.secret;
        salt = existingData.salt;
        commitment = existingData.commitment;
        setRegistrationStatus("Using existing credentials...");
      } else {
        // Step 1: Generate deterministic credentials from wallet signature
        setRegistrationStatus("Step 1/2: Generating secret (sign message)...");
        console.log("[Registration] Step 1: Generating deterministic credentials from wallet signature...");
        const { generateDeterministicZKCredentials } = await import("../lib/zk");

        let credentials;
        try {
          credentials = await generateDeterministicZKCredentials(kit, daoId);
        } catch (err) {
          console.error("[Registration] Step 1 failed:", err);
          throw err;
        }

        secret = credentials.secret;
        salt = credentials.salt;
        commitment = credentials.commitment;

        console.log("[Registration] Step 1 complete - Generated voting credentials:");
        console.log("Secret:", secret);
        console.log("Salt:", salt);
        console.log("Commitment:", commitment);

        // Small delay to ensure Step 1 UI updates before Step 2 popup
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Step 2: Register commitment in Merkle tree
      setRegistrationStatus("Step 2/2: Registering commitment (sign transaction)...");
      console.log("[Registration] Step 2: Registering commitment in Merkle tree...");
      const clients = initializeContractClients(publicKey);

      const tx = await clients.membershipTree.register_with_caller({
        dao_id: BigInt(daoId),
        commitment: BigInt(commitment),
        caller: publicKey,
      });

      try {
        console.log("[Registration] Calling signAndSend...");
        const result = await tx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });
        console.log("[Registration] Step 2 complete - Transaction signed and sent:", result);
      } catch (err: any) {
        console.error("[Registration] Step 2 (signAndSend) failed:", err);
        // Re-throw with more context
        const enhancedError = new Error(`Transaction signing failed: ${err?.message || 'Unknown error'}`);
        (enhancedError as any).originalError = err;
        throw enhancedError;
      }

      // Step 3: Get the leaf index
      const leafIndexResult = await clients.membershipTree.get_leaf_index({
        dao_id: BigInt(daoId),
        commitment: BigInt(commitment),
      });

      const leafIndex = Number(leafIndexResult.result);

      // Step 4: Store credentials in localStorage (cache for convenience)
      const registrationData = {
        secret,
        salt,
        commitment,
        leafIndex,
        registeredAt: Date.now(),
      };

      // Reuse the key variable from above
      localStorage.setItem(key, JSON.stringify(registrationData));

      setIsRegistered(true);
      setHasUnregisteredCredentials(false);
      setRegistrationStatus("Registration complete!");
      console.log("Registration successful! Leaf index:", leafIndex);
    } catch (err: any) {
      // Check if user rejected the request (don't show error for intentional cancellation)
      const isUserRejection =
        err?.code === -4 ||
        err?.message?.includes("User rejected") ||
        err?.message?.includes("user rejected") ||
        err?.message?.includes("declined");

      if (isUserRejection) {
        console.log("User cancelled registration");
        setRegistrationStatus(null);
      } else {
        setError(err instanceof Error ? err.message : "Failed to register for voting");
        console.error("Registration failed:", err);
        setRegistrationStatus(null);
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleJoinDao = async () => {
    try {
      setJoining(true);
      setError(null);

      const clients = initializeContractClients(publicKey);

      if (!kit) {
        throw new Error("Wallet kit not available");
      }

      // Call self_join on the membership-sbt contract
      const tx = await clients.membershipSbt.self_join({
        dao_id: BigInt(daoId),
        member: publicKey,
        encrypted_alias: undefined,
      });

      await tx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });

      // Reload DAO info to update membership status
      await loadDAOInfo();

      console.log("Successfully joined DAO! Click 'Register for Voting' to set up voting credentials.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join DAO");
      console.error("Join DAO failed:", err);
    } finally {
      setJoining(false);
    }
  };

  const handleCreateProposal = async () => {
    if (!proposalDescription.trim()) {
      setError("Proposal description is required");
      return;
    }

    try {
      setCreatingProposal(true);
      setError(null);

      const clients = initializeContractClients(publicKey);

      // Default end time: 1 week from now
      const endTime = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);

      const tx = await clients.voting.create_proposal({
        dao_id: BigInt(daoId),
        description: proposalDescription,
        end_time: endTime,
        creator: publicKey,
        vote_mode: { tag: voteMode === "fixed" ? "Fixed" : "Trailing", values: void 0 },
      });

      if (!kit) {
        throw new Error("Wallet kit not available");
      }

      await tx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });

      setProposalDescription("");
      setShowCreateProposal(false);
      // Trigger proposal list reload by incrementing key
      setProposalKey(prev => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create proposal");
      console.error("Failed to create proposal:", err);
    } finally {
      setCreatingProposal(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-red-900 dark:text-red-100 mb-2">
          Error
        </h3>
        <p className="text-red-800 dark:text-red-200">{error}</p>
      </div>
    );
  }

  if (!dao) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <p className="text-gray-600 dark:text-gray-400">DAO not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* DAO Header */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {dao.name}
            </h2>
            {dao.isAdmin ? (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200">
                Admin
              </span>
            ) : dao.hasMembership ? (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">
                Member
              </span>
            ) : (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200">
                Non-member
              </span>
            )}
            {dao.membershipOpen ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="w-3.5 h-3.5">
                  <rect width="12" height="8.571" x="6" y="12.071" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" rx="2"/>
                  <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16.286 8.643a4.286 4.286 0 0 0-8.572 0v3.428"/>
                </svg>
                Open DAO
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="w-3.5 h-3.5">
                  <rect width="12.526" height="8.947" x="5.737" y="12.053" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" rx="2"/>
                  <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7.526 12.053v-3.58a4.474 4.474 0 0 1 8.948 0v3.58"/>
                </svg>
                Private DAO
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              View Log
            </button>
            <button
              onClick={() => navigate(`/daos/${daoId}/members`)}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {dao.isAdmin ? 'Manage Members' : 'Members'}
            </button>
            {!dao.hasMembership && dao.membershipOpen && publicKey && (
              <button
                onClick={handleJoinDao}
                disabled={joining}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-green-600 rounded-md hover:bg-green-700 disabled:bg-green-400 transition-colors flex items-center gap-2"
              >
                {joining && (
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                )}
                {joining ? "Joining..." : "Join DAO"}
              </button>
            )}
            {(() => {
              const shouldShowRegisterButton = dao.hasMembership && !isRegistered && publicKey;

              const buttonText = hasUnregisteredCredentials
                ? "Complete Registration"
                : "Register to Vote";

              return shouldShowRegisterButton && (
                <button
                  onClick={handleRegisterForVoting}
                  disabled={registering}
                  className="px-4 py-2 text-sm font-medium text-white bg-purple-600 border border-purple-600 rounded-md hover:bg-purple-700 disabled:bg-purple-400 transition-colors flex items-center gap-2"
                >
                  {registering && (
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  )}
                  {registering ? (registrationStatus || "Registering...") : buttonText}
                </button>
              );
            })()}
            {dao.isAdmin && dao.vkSet && (
              <button
                onClick={() => setShowCreateProposal(true)}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-blue-600 rounded-md hover:bg-blue-700 transition-colors"
              >
                Create Proposal
              </button>
            )}
          </div>
        </div>

      </div>

      {/* Create Proposal Form */}
      {showCreateProposal && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            New Proposal
          </h3>
          <textarea
            value={proposalDescription}
            onChange={(e) => setProposalDescription(e.target.value)}
            placeholder="Enter proposal description..."
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
            rows={4}
          />

          {/* Vote Mode Selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Voting Set
            </label>
            <div className="space-y-2">
              <label className="flex items-start cursor-pointer">
                <input
                  type="radio"
                  name="voteMode"
                  value="fixed"
                  checked={voteMode === "fixed"}
                  onChange={(e) => setVoteMode(e.target.value as "fixed" | "trailing")}
                  className="mt-1 mr-3"
                />
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    Fixed - Only current members
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Only members at the time of proposal creation can vote
                  </div>
                </div>
              </label>
              <label className="flex items-start cursor-pointer">
                <input
                  type="radio"
                  name="voteMode"
                  value="open"
                  checked={voteMode === "open"}
                  onChange={(e) => setVoteMode(e.target.value as "fixed" | "trailing")}
                  className="mt-1 mr-3"
                />
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    Trailing - Allow future members
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Members added after proposal creation can also vote
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCreateProposal}
              disabled={creatingProposal}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium px-4 py-2 rounded-md transition-colors flex items-center gap-2"
            >
              {creatingProposal && (
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {creatingProposal ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => {
                setShowCreateProposal(false);
                setProposalDescription("");
                setError(null);
              }}
              className="bg-gray-600 hover:bg-gray-700 text-white font-medium px-4 py-2 rounded-md transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Proposals Section */}
      <div>
        <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          Proposals
        </h3>
        <ProposalList
          key={proposalKey}
          publicKey={publicKey}
          daoId={daoId}
          kit={kit}
          hasMembership={dao.hasMembership}
          vkSet={dao.vkSet}
          isInitializing={isInitializing}
        />
      </div>
    </div>
  );
}
