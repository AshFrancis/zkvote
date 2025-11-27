import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { initializeContractClients } from "../lib/contracts";
import { getReadOnlyDaoRegistry, getReadOnlyMembershipSbt, getReadOnlyMembershipTree } from "../lib/readOnlyContracts";
import { useWallet } from "../hooks/useWallet";
import {
  generateDeterministicZKCredentials,
  getZKCredentials,
  storeZKCredentials,
} from "../lib/zk";
import { isUserRejection } from "../lib/utils";
import { Badge, Alert, LoadingSpinner, CreateProposalForm } from "./ui";
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
    const cacheKey = `dao_info_${daoId}`;
    const cached = localStorage.getItem(cacheKey);
    return cached ? JSON.parse(cached) : null;
  });
  const [loading, setLoading] = useState(() => {
    const cacheKey = `dao_info_${daoId}`;
    const cached = localStorage.getItem(cacheKey);
    return !cached;
  });
  const [error, setError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registrationStatus, setRegistrationStatus] = useState<string | null>(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [hasUnregisteredCredentials, setHasUnregisteredCredentials] = useState(false);
  const [joining, setJoining] = useState(false);
  const [showCreateProposal, setShowCreateProposal] = useState(false);
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [proposalKey, setProposalKey] = useState(0);

  useEffect(() => {
    if (publicKey) {
      const cached = getZKCredentials(daoId, publicKey);
      setIsRegistered(!!cached);
    }
  }, [publicKey, daoId]);

  useEffect(() => {
    if (isInitializing) {
      return;
    }
    loadDAOInfo();
    checkRegistrationStatus();
  }, [daoId, publicKey, isInitializing]);

  const checkRegistrationStatus = async () => {
    const cached = publicKey ? getZKCredentials(daoId, publicKey) : null;

    if (!cached) {
      setIsRegistered(false);
      setHasUnregisteredCredentials(false);
      return;
    }

    try {
      const clients = initializeContractClients(publicKey || "");

      const leafIndexResult = await clients.membershipTree.get_leaf_index({
        dao_id: BigInt(daoId),
        commitment: BigInt(cached.commitment),
      });

      const onChainLeafIndex = Number(leafIndexResult.result);

      if (onChainLeafIndex === cached.leafIndex) {
        setIsRegistered(true);
        setHasUnregisteredCredentials(false);
      } else {
        if (publicKey) {
          const legacyKey = `voting_registration_${daoId}_${publicKey}`;
          localStorage.removeItem(legacyKey);
        }
        setIsRegistered(false);
        setHasUnregisteredCredentials(false);
      }
    } catch (err) {
      setIsRegistered(false);
      setHasUnregisteredCredentials(true);
    }
  };

  const loadDAOInfo = async () => {
    const cacheKey = `dao_info_${daoId}`;

    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const cachedDao = JSON.parse(cached);
        setDao(cachedDao);
        setLoading(false);
      }

      setError(null);

      let useReadOnly = !publicKey;
      let daoResult;

      if (publicKey && !useReadOnly) {
        try {
          const clients = initializeContractClients(publicKey);
          daoResult = await clients.daoRegistry.get_dao({
            dao_id: BigInt(daoId),
          });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (errorMessage.includes('Account not found') || errorMessage.includes('does not exist')) {
            console.warn('Connected wallet account not found on network, using read-only mode');
            useReadOnly = true;
          } else {
            throw err;
          }
        }
      }

      if (useReadOnly || !daoResult) {
        const registry = getReadOnlyDaoRegistry();
        daoResult = await registry.get_dao({
          dao_id: BigInt(daoId),
        });
      }

      const hasSBT = !useReadOnly && publicKey ? await checkMembership() : false;
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
      try {
        const clients = initializeContractClients(publicKey);
        const result = await clients.membershipSbt.has({
          dao_id: BigInt(daoId),
          of: publicKey,
        });
        return result.result;
      } catch (err) {
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
      const treeClient = getReadOnlyMembershipTree();
      const result = await treeClient.get_tree_info({
        dao_id: BigInt(daoId),
      });
      const depth = Number(result.result[0]);
      return depth > 0;
    } catch (err) {
      console.error("Failed to check tree initialization:", err);
      return false;
    }
  };

  const checkVKSet = async (): Promise<boolean> => {
    return true;
  };

  const handleRegisterForVoting = async () => {
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

      const cached = publicKey ? getZKCredentials(daoId, publicKey) : null;

      if (hasUnregisteredCredentials && cached) {
        console.log("[Registration] Using existing credentials, skipping signature step");
        secret = cached.secret;
        salt = cached.salt;
        commitment = cached.commitment;
        setRegistrationStatus("Using existing credentials...");
      } else {
        setRegistrationStatus("Step 1/2: Generating secret (sign message)...");
        console.log("[Registration] Step 1: Generating deterministic credentials from wallet signature...");
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

        console.log("[Registration] Step 1 complete - Generated voting credentials");
        await new Promise(resolve => setTimeout(resolve, 500));
      }

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
        const enhancedError = new Error(`Transaction signing failed: ${err?.message || 'Unknown error'}`);
        (enhancedError as any).originalError = err;
        throw enhancedError;
      }

      const leafIndexResult = await clients.membershipTree.get_leaf_index({
        dao_id: BigInt(daoId),
        commitment: BigInt(commitment),
      });

      const leafIndex = Number(leafIndexResult.result);
      storeZKCredentials(daoId, publicKey || "", { secret, salt, commitment }, leafIndex);

      setIsRegistered(true);
      setHasUnregisteredCredentials(false);
      setRegistrationStatus("Registration complete!");
      console.log("Registration successful! Leaf index:", leafIndex);
    } catch (err: any) {
      if (isUserRejection(err)) {
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

      const tx = await clients.membershipSbt.self_join({
        dao_id: BigInt(daoId),
        member: publicKey,
        encrypted_alias: undefined,
      });

      await tx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });
      await loadDAOInfo();

      console.log("Successfully joined DAO! Click 'Register for Voting' to set up voting credentials.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join DAO");
      console.error("Join DAO failed:", err);
    } finally {
      setJoining(false);
    }
  };

  const handleCreateProposal = async (data: {
    description: string;
    voteMode: "fixed" | "trailing";
    deadlineSeconds: number;
  }) => {
    try {
      setCreatingProposal(true);
      setError(null);

      const clients = initializeContractClients(publicKey);

      let endTime: bigint;
      if (data.deadlineSeconds === 0) {
        endTime = BigInt(0);
      } else {
        endTime = BigInt(Math.floor(Date.now() / 1000) + data.deadlineSeconds);
      }

      const tx = await clients.voting.create_proposal({
        dao_id: BigInt(daoId),
        description: data.description,
        end_time: endTime,
        creator: publicKey,
        vote_mode: { tag: data.voteMode === "fixed" ? "Fixed" : "Trailing", values: void 0 },
      });

      if (!kit) {
        throw new Error("Wallet kit not available");
      }

      await tx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });

      setShowCreateProposal(false);
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
        <LoadingSpinner size="lg" color="blue" />
      </div>
    );
  }

  if (error && !dao) {
    return <Alert variant="error">{error}</Alert>;
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
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {dao.name}
            </h2>
            {dao.isAdmin ? (
              <Badge variant="blue">Admin</Badge>
            ) : dao.hasMembership ? (
              <Badge variant="green">Member</Badge>
            ) : (
              <Badge variant="gray">Non-member</Badge>
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
                {joining && <LoadingSpinner size="sm" color="white" />}
                {joining ? "Joining..." : "Join DAO"}
              </button>
            )}
            {(() => {
              const shouldShowRegisterButton = dao.hasMembership && !isRegistered && publicKey;
              const buttonText = hasUnregisteredCredentials ? "Complete Registration" : "Register to Vote";

              return shouldShowRegisterButton && (
                <button
                  onClick={handleRegisterForVoting}
                  disabled={registering}
                  className="px-4 py-2 text-sm font-medium text-white bg-purple-600 border border-purple-600 rounded-md hover:bg-purple-700 disabled:bg-purple-400 transition-colors flex items-center gap-2"
                >
                  {registering && <LoadingSpinner size="sm" color="white" />}
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

      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      {showCreateProposal && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            New Proposal
          </h3>
          <CreateProposalForm
            onSubmit={handleCreateProposal}
            onCancel={() => {
              setShowCreateProposal(false);
              setError(null);
            }}
            isSubmitting={creatingProposal}
          />
        </div>
      )}

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
