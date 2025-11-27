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
import { Button } from "./ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/Card";
import ProposalList from "./ProposalList";
import ManageMembers from "./ManageMembers";
import DAOInfoPanel from "./DAOInfoPanel";
import { Shield, Users, Lock, Unlock, FileText, CheckCircle, AlertCircle, PlusCircle, X, Home } from "lucide-react";

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
  const [activeTab, setActiveTab] = useState<'info' | 'proposals' | 'members'>('proposals');

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
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">DAO not found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-3xl font-bold tracking-tight text-foreground">
                {dao.name}
              </h2>
              {dao.isAdmin ? (
                <Badge variant="blue" className="gap-1"><Shield className="w-3 h-3" /> Admin</Badge>
              ) : dao.hasMembership ? (
                <Badge variant="success" className="gap-1"><Users className="w-3 h-3" /> Member</Badge>
              ) : (
                <Badge variant="gray" className="gap-1"><Users className="w-3 h-3" /> Non-member</Badge>
              )}
              {dao.membershipOpen ? (
                <Badge variant="success" className="gap-1"><Unlock className="w-3 h-3" /> Open</Badge>
              ) : (
                <Badge variant="secondary" className="gap-1"><Lock className="w-3 h-3" /> Private</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <span className="font-mono text-xs bg-muted/50 px-1.5 py-0.5 rounded">ID: {dao.id}</span>
              <span>•</span>
              <span>Created by {dao.creator.slice(0, 4)}...{dao.creator.slice(-4)}</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={activeTab === 'proposals' ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setActiveTab('proposals')}
            className="gap-2"
          >
            <Home className="w-4 h-4" />
            Overview
          </Button>
          <Button
            variant={activeTab === 'info' ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setActiveTab('info')}
            className="gap-2"
          >
            <FileText className="w-4 h-4" /> Info
          </Button>
          <Button
            variant={activeTab === 'members' ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setActiveTab('members')}
            className="gap-2"
          >
            <Users className="w-4 h-4" />
            Members
          </Button>
          {dao.isAdmin && dao.vkSet && (
            <Button
              variant="outline"
              onClick={() => setShowCreateProposal(true)}
              size="sm"
              className="gap-2"
            >
              <PlusCircle className="w-4 h-4" />
              Add Proposal
            </Button>
          )}

          {!dao.hasMembership && dao.membershipOpen && publicKey && (
            <Button
              variant="outline"
              onClick={handleJoinDao}
              disabled={joining}
              size="sm"
              className="gap-2"
            >
              {joining && <LoadingSpinner size="sm" color="white" />}
              {joining ? "Joining..." : "Join DAO"}
            </Button>
          )}

          {(() => {
            const shouldShowRegisterButton = dao.hasMembership && !isRegistered && publicKey;
            const buttonText = hasUnregisteredCredentials ? "Complete Registration" : "Register to Vote";

            return shouldShowRegisterButton && (
              <Button
                variant="outline"
                onClick={handleRegisterForVoting}
                disabled={registering}
                size="sm"
                className="gap-2"
              >
                {registering ? (
                  <>
                    <LoadingSpinner size="sm" color="white" />
                    {registrationStatus || "Registering..."}
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    {buttonText}
                  </>
                )}
              </Button>
            );
          })()}
        </div>
      </div>

      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      {activeTab === 'info' && (
        <DAOInfoPanel daoId={daoId} publicKey={publicKey} />
      )}

      {activeTab === 'proposals' && (
        <ProposalList
          key={proposalKey}
          publicKey={publicKey}
          daoId={daoId}
          kit={kit}
          hasMembership={dao.hasMembership}
          vkSet={dao.vkSet}
          isInitializing={isInitializing}
        />
      )}

      {activeTab === 'members' && (
        <ManageMembers
          daoId={daoId}
          publicKey={publicKey}
          isAdmin={dao.isAdmin}
        />
      )}
    </div>

    {/* Create Proposal Modal */}
    {showCreateProposal && (
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[100] animate-fade-in"
        onClick={() => setShowCreateProposal(false)}
      >
        <div className="relative w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowCreateProposal(false)}
            className="absolute -top-10 right-0 h-8 w-8 rounded-full text-white hover:bg-white/20"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Button>
          <Card className="w-full shadow-xl border-none">
            <CardHeader>
              <CardTitle>New Proposal</CardTitle>
              <CardDescription>Create a new proposal for the community to vote on.</CardDescription>
            </CardHeader>
            <CardContent>
              <CreateProposalForm
                onSubmit={handleCreateProposal}
                onCancel={() => {
                  setShowCreateProposal(false);
                  setError(null);
                }}
                isSubmitting={creatingProposal}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    )}
    </>
  );
}
