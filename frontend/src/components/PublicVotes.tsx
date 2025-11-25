import { useState, useEffect } from "react";
import { initializeContractClients } from "../lib/contracts";
import { getReadOnlyDaoRegistry, getReadOnlyMembershipSbt, getReadOnlyMembershipTree } from "../lib/readOnlyContracts";
import { useWallet } from "../hooks/useWallet";
import ProposalList from "./ProposalList";

interface PublicVotesProps {
  publicKey: string | null;
  isConnected: boolean;
  isInitializing?: boolean;
}

interface DAOInfo {
  id: number;
  name: string;
  creator: string;
  hasMembership: boolean;
  isRegistered: boolean;
  memberCount: number;
}

export default function PublicVotes({ publicKey, isConnected, isInitializing = false }: PublicVotesProps) {
  const { kit } = useWallet();
  const [dao, setDao] = useState<DAOInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [proposalKey, setProposalKey] = useState(0);
  const [showCreateProposal, setShowCreateProposal] = useState(false);
  const [proposalDescription, setProposalDescription] = useState("");
  const [creatingProposal, setCreatingProposal] = useState(false);

  useEffect(() => {
    if (isInitializing) {
      return;
    }
    loadPublicDAO();
  }, [publicKey, isInitializing]);

  const loadPublicDAO = async () => {
    try {
      setLoading(true);
      setError(null);

      // Public DAO is always DAO #1 (created at deployment)
      const publicDaoId = 1;

      let result;
      if (publicKey) {
        try {
          const clients = initializeContractClients(publicKey);
          result = await clients.daoRegistry.get_dao({
            dao_id: BigInt(publicDaoId),
          });
        } catch (err: any) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (errorMessage.includes('Account not found') || errorMessage.includes('does not exist')) {
            const registry = getReadOnlyDaoRegistry();
            result = await registry.get_dao({
              dao_id: BigInt(publicDaoId),
            });
          } else {
            throw err;
          }
        }
      } else {
        const registry = getReadOnlyDaoRegistry();
        result = await registry.get_dao({
          dao_id: BigInt(publicDaoId),
        });
      }

      if (!result.result.membership_open) {
        setError("Public DAO not configured correctly. Please redeploy.");
        return;
      }

      // Check if user has membership
      let hasMembership = false;
      let isRegistered = false;

      if (publicKey) {
        try {
          if (publicKey) {
            try {
              const clients = initializeContractClients(publicKey);
              const membershipResult = await clients.membershipSbt.has({
                dao_id: BigInt(publicDaoId),
                of: publicKey,
              });
              hasMembership = membershipResult.result;
            } catch (err: any) {
              const errorMessage = err instanceof Error ? err.message : String(err);
              if (errorMessage.includes('Account not found') || errorMessage.includes('does not exist')) {
                const sbt = getReadOnlyMembershipSbt();
                const membershipResult = await sbt.has({
                  dao_id: BigInt(publicDaoId),
                  of: publicKey,
                });
                hasMembership = membershipResult.result;
              } else {
                throw err;
              }
            }
          } else {
            const sbt = getReadOnlyMembershipSbt();
            const membershipResult = await sbt.has({
              dao_id: BigInt(publicDaoId),
              of: publicKey,
            });
            hasMembership = membershipResult.result;
          }

          // Check registration status
          const key = `voting_registration_${publicDaoId}_${publicKey}`;
          const stored = localStorage.getItem(key);
          if (stored) {
            // Validate that the cached registration actually exists on-chain
            try {
              const registrationData = JSON.parse(stored);
              if (publicKey) {
                try {
                  const clients = initializeContractClients(publicKey);
                  const leafIndexResult = await clients.membershipTree.get_leaf_index({
                    dao_id: BigInt(publicDaoId),
                    commitment: BigInt(registrationData.commitment),
                  });
                  const onChainLeafIndex = Number(leafIndexResult.result);
                  isRegistered = onChainLeafIndex === registrationData.leafIndex;
                } catch (err: any) {
                  const errorMessage = err instanceof Error ? err.message : String(err);
                  if (errorMessage.includes('Account not found') || errorMessage.includes('does not exist')) {
                    const tree = getReadOnlyMembershipTree();
                    const leafIndexResult = await tree.get_leaf_index({
                      dao_id: BigInt(publicDaoId),
                      commitment: BigInt(registrationData.commitment),
                    });
                    const onChainLeafIndex = Number(leafIndexResult.result);
                    isRegistered = onChainLeafIndex === registrationData.leafIndex;
                  } else {
                    throw err;
                  }
                }
              }
            } catch (err) {
              console.log("Cached registration invalid, clearing...");
              localStorage.removeItem(key);
              isRegistered = false;
            }
          }
        } catch (err) {
          console.error("Failed to check membership:", err);
        }
      }

      // Get member count
      let memberCount = 0;
      try {
        if (publicKey) {
          try {
            const clients = initializeContractClients(publicKey);
            const countResult = await clients.membershipSbt.get_member_count({
              dao_id: BigInt(publicDaoId),
            });
            memberCount = Number(countResult.result);
          } catch (err: any) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            if (errorMessage.includes('Account not found') || errorMessage.includes('does not exist')) {
              const sbt = getReadOnlyMembershipSbt();
              const countResult = await sbt.get_member_count({
                dao_id: BigInt(publicDaoId),
              });
              memberCount = Number(countResult.result);
            } else {
              throw err;
            }
          }
        } else {
          const sbt = getReadOnlyMembershipSbt();
          const countResult = await sbt.get_member_count({
            dao_id: BigInt(publicDaoId),
          });
          memberCount = Number(countResult.result);
        }
      } catch (err) {
        console.error("Failed to get member count:", err);
      }

      setDao({
        id: publicDaoId,
        name: result.result.name,
        creator: result.result.admin,
        hasMembership,
        isRegistered,
        memberCount,
      });
    } catch (err) {
      console.error("Failed to load public DAO:", err);
      setError("Failed to load public DAO. Make sure DAO #1 exists and is public.");
    } finally {
      setLoading(false);
    }
  };

  const handleJoinDAO = async () => {
    if (!publicKey || !kit || !dao) {
      setError("Wallet not connected");
      return;
    }

    try {
      setJoining(true);
      setError(null);

      const clients = initializeContractClients(publicKey);

      const joinTx = await clients.membershipSbt.self_join({
        dao_id: BigInt(dao.id),
        member: publicKey,
        encrypted_alias: undefined,
      });

      await joinTx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });

      // Reload DAO info
      await loadPublicDAO();
    } catch (err: any) {
      // Check if user rejected the request (don't show error for intentional cancellation)
      const isUserRejection =
        err?.code === -4 ||
        err?.message?.includes("User rejected") ||
        err?.message?.includes("user rejected") ||
        err?.message?.includes("declined");

      if (isUserRejection) {
        console.log("User cancelled joining DAO");
      } else {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        console.error("Failed to join DAO:", err);
      }
    } finally {
      setJoining(false);
    }
  };

  const handleRegisterToVote = async () => {
    if (!publicKey || !kit || !dao) {
      setError("Wallet not connected");
      return;
    }

    try {
      setRegistering(true);
      setError(null);

      let secret, salt, commitment;

      // Step 1: Generate deterministic ZK credentials from wallet signature
      console.log("[Registration] Step 1: Generating deterministic credentials from wallet signature...");
      const { generateDeterministicZKCredentials } = await import("../lib/zk");

      try {
        const credentials = await generateDeterministicZKCredentials(kit, dao.id);
        secret = credentials.secret;
        salt = credentials.salt;
        commitment = credentials.commitment;
      } catch (err) {
        console.error("[Registration] Step 1 failed:", err);
        throw err;
      }

      console.log("[Registration] Step 1 complete - Generated voting credentials");

      // Small delay to ensure Step 1 UI updates before Step 2 popup
      await new Promise(resolve => setTimeout(resolve, 500));

      // Step 2: Register commitment in Merkle tree
      console.log("[Registration] Step 2: Registering commitment in Merkle tree...");
      const clients = initializeContractClients(publicKey);

      const registerTx = await clients.membershipTree.self_register({
        dao_id: BigInt(dao.id),
        commitment: BigInt(commitment),
        member: publicKey,
      });

      try {
        console.log("[Registration] Calling signAndSend...");
        const result = await registerTx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });
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
        dao_id: BigInt(dao.id),
        commitment: BigInt(commitment),
      });

      const leafIndex = Number(leafIndexResult.result);

      // Step 4: Store credentials in localStorage
      const registrationData = {
        secret,
        salt,
        commitment,
        leafIndex,
        registeredAt: Date.now(),
      };

      const key = `voting_registration_${dao.id}_${publicKey}`;
      localStorage.setItem(key, JSON.stringify(registrationData));

      console.log("[Registration] Registration successful! Leaf index:", leafIndex);

      // Reload DAO info
      await loadPublicDAO();
    } catch (err: any) {
      // Check if user rejected the request (don't show error for intentional cancellation)
      const isUserRejection =
        err?.code === -4 ||
        err?.message?.includes("User rejected") ||
        err?.message?.includes("user rejected") ||
        err?.message?.includes("declined");

      if (isUserRejection) {
        console.log("User cancelled registration");
      } else {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        console.error("Failed to register to vote:", err);
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleCreateProposal = async () => {
    if (!proposalDescription.trim()) {
      setError("Proposal description is required");
      return;
    }

    if (!publicKey || !kit || !dao) {
      setError("Wallet not connected");
      return;
    }

    try {
      setCreatingProposal(true);
      setError(null);

      const clients = initializeContractClients(publicKey);

      const endTime = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60); // 7 days from now

      const createProposalTx = await clients.voting.create_proposal({
        dao_id: BigInt(dao.id),
        description: proposalDescription,
        end_time: endTime,
        creator: publicKey,
        vote_mode: { tag: "Trailing", values: undefined },
      });

      await createProposalTx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });

      setProposalDescription("");
      setShowCreateProposal(false);
      setProposalKey(prev => prev + 1); // Force proposal list to reload
    } catch (err: any) {
      // Check if user rejected the request (don't show error for intentional cancellation)
      const isUserRejection =
        err?.code === -4 ||
        err?.message?.includes("User rejected") ||
        err?.message?.includes("user rejected") ||
        err?.message?.includes("declined");

      if (isUserRejection) {
        console.log("User cancelled proposal creation");
      } else {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        console.error("Failed to create proposal:", err);
      }
    } finally {
      setCreatingProposal(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  if (error && !dao) {
    return (
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          Public Votes
        </h2>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-100 px-4 py-3 rounded-lg">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              {dao?.name || "Public Votes"}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Open DAO • {dao?.memberCount || 0} members • Anyone can join and vote
            </p>
          </div>
          {isConnected && dao && dao.isRegistered && (
            <button
              onClick={() => setShowCreateProposal(!showCreateProposal)}
              className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 transition-colors"
            >
              Create Proposal
            </button>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-100 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        {/* Join DAO Button */}
        {isConnected && dao && !dao.hasMembership && (
          <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-purple-900 dark:text-purple-100 mb-2">
              Join Public DAO
            </h3>
            <p className="text-sm text-purple-800 dark:text-purple-200 mb-3">
              Join this public DAO to create proposals and vote anonymously.
            </p>
            <button
              onClick={handleJoinDAO}
              disabled={joining}
              className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              {joining ? "Joining..." : "Join DAO"}
            </button>
          </div>
        )}

        {/* Register to Vote Button */}
        {isConnected && dao && dao.hasMembership && !dao.isRegistered && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-2">
              Register to Vote
            </h3>
            <p className="text-sm text-blue-800 dark:text-blue-200 mb-3">
              Generate your anonymous voting credentials to participate in proposals.
            </p>
            <button
              onClick={handleRegisterToVote}
              disabled={registering}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {registering ? "Registering..." : "Register to Vote"}
            </button>
          </div>
        )}

        {/* Not Connected */}
        {!isConnected && (
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
            <p className="text-gray-600 dark:text-gray-400">
              Connect your wallet to join this public DAO and vote on proposals.
            </p>
          </div>
        )}
      </div>

      {/* Create Proposal Form */}
      {showCreateProposal && dao && (
        <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Create New Proposal
          </h3>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Proposal Description
            </label>
            <textarea
              value={proposalDescription}
              onChange={(e) => setProposalDescription(e.target.value)}
              placeholder="Describe your proposal..."
              rows={4}
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-purple-500 focus:border-purple-500"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleCreateProposal}
              disabled={creatingProposal}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              {creatingProposal ? "Creating..." : "Create Proposal"}
            </button>
            <button
              onClick={() => {
                setShowCreateProposal(false);
                setProposalDescription("");
                setError(null);
              }}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Proposals */}
      {dao && (
        <ProposalList
          key={proposalKey}
          publicKey={publicKey}
          daoId={dao.id}
          kit={kit}
          hasMembership={dao.hasMembership}
          vkSet={true}
          isInitializing={isInitializing}
        />
      )}
    </div>
  );
}
