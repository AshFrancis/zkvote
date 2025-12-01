import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { initializeContractClients } from "../lib/contracts";
import { getReadOnlyDaoRegistry, getReadOnlyMembershipSbt, getReadOnlyMembershipTree, getReadOnlyVoting } from "../lib/readOnlyContracts";
import { useWallet } from "../hooks/useWallet";
import ProposalList from "./ProposalList";
import ManageMembers from "./ManageMembers";
import DAOInfoPanel from "./DAOInfoPanel";
import { getZKCredentials, storeZKCredentials, generateDeterministicZKCredentials } from "../lib/zk";
import { isUserRejection } from "../lib/utils";
import { Alert, LoadingSpinner, CreateProposalForm } from "./ui";
import { Button } from "./ui/Button";
import { FileText, Users, PlusCircle, Home } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/Card";

interface PublicVotesProps {
  publicKey: string | null;
  isConnected: boolean;
  isInitializing?: boolean;
  tab?: 'info' | 'proposals' | 'members' | 'create-proposal';
}

interface DAOInfo {
  id: number;
  name: string;
  creator: string;
  hasMembership: boolean;
  isRegistered: boolean;
  memberCount: number;
  vkVersion: number | null;
}

const PUBLIC_DAO_ID = 1;
const PUBLIC_DAO_CACHE_KEY = `public_dao_info_${PUBLIC_DAO_ID}`;

export default function PublicVotes({ publicKey, isConnected, isInitializing = false, tab = 'proposals' }: PublicVotesProps) {
  const { kit } = useWallet();
  const navigate = useNavigate();
  const [dao, setDao] = useState<DAOInfo | null>(() => {
    // Initialize from cache for instant display
    const cached = localStorage.getItem(PUBLIC_DAO_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  });
  const [loading, setLoading] = useState(() => {
    // Only show loading spinner if no cache exists
    const cached = localStorage.getItem(PUBLIC_DAO_CACHE_KEY);
    return !cached;
  });
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [proposalKey, setProposalKey] = useState(0);
  const [creatingProposal, setCreatingProposal] = useState(false);
  // Use tab prop from URL route - activeTab is now derived from the route
  const activeTab = tab;

  useEffect(() => {
    if (isInitializing) {
      return;
    }
    loadPublicDAO();
  }, [publicKey, isInitializing]);

  const loadPublicDAO = async () => {
    try {
      // Load from cache first for instant display
      const cached = localStorage.getItem(PUBLIC_DAO_CACHE_KEY);
      if (cached) {
        setDao(JSON.parse(cached));
        setLoading(false);
      } else {
        setLoading(true);
      }
      setError(null);

      const publicDaoId = PUBLIC_DAO_ID;

      let result;
      let vkResult;
      if (publicKey) {
        try {
          const clients = initializeContractClients(publicKey);
          result = await clients.daoRegistry.get_dao({
            dao_id: BigInt(publicDaoId),
          });
          vkResult = await (clients.voting as any).vk_version({ dao_id: BigInt(publicDaoId) });
        } catch (err: any) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (errorMessage.includes('Account not found') || errorMessage.includes('does not exist')) {
            const registry = getReadOnlyDaoRegistry();
            result = await registry.get_dao({
              dao_id: BigInt(publicDaoId),
            });
            const voting = getReadOnlyVoting() as any;
            vkResult = await voting.vk_version({ dao_id: BigInt(publicDaoId) });
          } else {
            throw err;
          }
        }
      } else {
        const registry = getReadOnlyDaoRegistry();
        result = await registry.get_dao({
          dao_id: BigInt(publicDaoId),
        });
        const voting = getReadOnlyVoting() as any;
        vkResult = await voting.vk_version({ dao_id: BigInt(publicDaoId) });
      }

      if (!result.result.membership_open) {
        setError("Public DAO not configured correctly. Please redeploy.");
        return;
      }

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

          const cached = publicKey ? getZKCredentials(publicDaoId, publicKey) : null;
          if (cached && publicKey) {
            try {
              try {
                const clients = initializeContractClients(publicKey);
                const leafIndexResult = await clients.membershipTree.get_leaf_index({
                  dao_id: BigInt(publicDaoId),
                  commitment: BigInt(cached.commitment),
                });
                const onChainLeafIndex = Number(leafIndexResult.result);
                isRegistered = onChainLeafIndex === cached.leafIndex;
              } catch (err: any) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                if (errorMessage.includes('Account not found') || errorMessage.includes('does not exist')) {
                  const tree = getReadOnlyMembershipTree();
                  const leafIndexResult = await tree.get_leaf_index({
                    dao_id: BigInt(publicDaoId),
                    commitment: BigInt(cached.commitment),
                  });
                  const onChainLeafIndex = Number(leafIndexResult.result);
                  isRegistered = onChainLeafIndex === cached.leafIndex;
                } else {
                  throw err;
                }
              }
            } catch (err) {
              console.log("Cached registration invalid, clearing...");
              isRegistered = false;
            }
          }
        } catch (err) {
          console.error("Failed to check membership:", err);
        }
      }

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

      const daoInfo = {
        id: publicDaoId,
        name: result.result.name,
        creator: result.result.admin,
        hasMembership,
        isRegistered,
        memberCount,
        vkVersion: vkResult?.result !== undefined ? Number(vkResult.result) : null,
      };
      setDao(daoInfo);
      // Cache the DAO info for instant loading next time
      localStorage.setItem(PUBLIC_DAO_CACHE_KEY, JSON.stringify(daoInfo));
    } catch (err) {
      console.error("Failed to load public DAO:", err);
      // Only show error if we don't have cached data to display
      if (!localStorage.getItem(PUBLIC_DAO_CACHE_KEY)) {
        setError("Failed to load public DAO. Make sure DAO #1 exists and is public.");
      }
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
      await loadPublicDAO();
    } catch (err: any) {
      if (isUserRejection(err)) {
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

      console.log("[Registration] Step 1: Generating deterministic credentials from wallet signature...");
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
      await new Promise(resolve => setTimeout(resolve, 500));

      console.log("[Registration] Step 2: Registering commitment in Merkle tree...");
      const clients = initializeContractClients(publicKey);

      const registerTx = await clients.membershipTree.self_register({
        dao_id: BigInt(dao.id),
        commitment: BigInt(commitment),
        member: publicKey,
      });

      // Helper to check if error is CommitmentExists (error #5 from tree contract)
      const isCommitmentExistsError = (err: any): boolean => {
        const errStr = err?.message || err?.toString() || '';
        return errStr.includes('#5') || errStr.includes('Error(Contract, #5)');
      };

      let alreadyRegistered = false;
      try {
        console.log("[Registration] Calling signAndSend...");
        const result = await registerTx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });
        console.log("[Registration] Step 2 complete - Transaction signed and sent:", result);
      } catch (err: any) {
        // Check if this is a CommitmentExists error - means we're already registered
        if (isCommitmentExistsError(err)) {
          console.log("[Registration] Commitment already exists on-chain - recovering credentials");
          alreadyRegistered = true;
        } else {
          console.error("[Registration] Step 2 (signAndSend) failed:", err);
          const enhancedError = new Error(`Transaction signing failed: ${err?.message || 'Unknown error'}`);
          (enhancedError as any).originalError = err;
          throw enhancedError;
        }
      }

      const leafIndexResult = await clients.membershipTree.get_leaf_index({
        dao_id: BigInt(dao.id),
        commitment: BigInt(commitment),
      });

      const leafIndex = Number(leafIndexResult.result);
      storeZKCredentials(dao.id, publicKey, { secret, salt, commitment }, leafIndex);

      console.log(alreadyRegistered ? "[Registration] Credentials recovered! Leaf index:" : "[Registration] Registration successful! Leaf index:", leafIndex);
      await loadPublicDAO();
    } catch (err: any) {
      if (isUserRejection(err)) {
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

  const handleCreateProposal = async (data: {
    title: string;
    contentCid: string;
    voteMode: "fixed" | "trailing";
    deadlineSeconds: number;
  }) => {
    if (!publicKey || !kit || !dao) {
      setError("Wallet not connected");
      return;
    }

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

      const createProposalTx = await clients.voting.create_proposal({
        dao_id: BigInt(dao.id),
        title: data.title,
        content_cid: data.contentCid,
        end_time: endTime,
        creator: publicKey,
        vote_mode: { tag: data.voteMode === "fixed" ? "Fixed" : "Trailing", values: undefined },
      });

      await createProposalTx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });

      navigate('/public-votes/');
      setProposalKey(prev => prev + 1);
    } catch (err: any) {
      if (isUserRejection(err)) {
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
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error && !dao) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-xl font-semibold mb-4">
          Public Votes
        </h2>
        <Alert variant="error">{error}</Alert>
      </div>
    );
  }

  return (
    <>
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="space-y-1">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              {dao?.name || "Public DAO"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Open DAO • {dao?.memberCount || 0} member{dao?.memberCount !== 1 ? 's' : ''} • VK v{dao?.vkVersion ?? "?"} • Anyone can join and vote
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={activeTab === 'proposals' ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => navigate('/public-votes/')}
            className="gap-2"
          >
            <Home className="w-4 h-4" />
            Overview
          </Button>
          <Button
            variant={activeTab === 'info' ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => navigate('/public-votes/info')}
            className="gap-2"
          >
            <FileText className="w-4 h-4" /> Info
          </Button>
          <Button
            variant={activeTab === 'members' ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => navigate('/public-votes/members')}
            className="gap-2"
          >
            <Users className="w-4 h-4" />
            Members
          </Button>
          {isConnected && dao && dao.isRegistered && (
            <Button
              variant={activeTab === 'create-proposal' ? 'secondary' : 'outline'}
              onClick={() => navigate('/public-votes/create-proposal')}
              size="sm"
              className="gap-2"
            >
              <PlusCircle className="w-4 h-4" />
              Add Proposal
            </Button>
          )}

          {isConnected && dao && !dao.hasMembership && (
            <Button
              variant="outline"
              onClick={handleJoinDAO}
              disabled={joining}
              size="sm"
              className="gap-2"
            >
              {joining && <LoadingSpinner size="sm" color="white" />}
              {joining ? "Joining..." : "Join DAO"}
            </Button>
          )}
          {isConnected && dao && dao.hasMembership && !dao.isRegistered && (
            <Button
              variant="outline"
              onClick={handleRegisterToVote}
              disabled={registering}
              size="sm"
              className="gap-2"
            >
              {registering && <LoadingSpinner size="sm" color="white" />}
              {registering ? "Registering..." : "Register to Vote"}
            </Button>
          )}
        </div>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {activeTab === 'info' && dao && (
        <DAOInfoPanel daoId={dao.id} publicKey={publicKey} kit={kit} />
      )}

      {activeTab === 'proposals' && (
        <>
          {!isConnected && (
            <div className="rounded-xl border bg-card p-6">
              <p className="text-muted-foreground">
                Connect your wallet to join this public DAO and vote on proposals.
              </p>
            </div>
          )}

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
        </>
      )}

      {activeTab === 'members' && dao && (
        <ManageMembers
          daoId={dao.id}
          publicKey={publicKey}
          isAdmin={false}
        />
      )}

      {activeTab === 'create-proposal' && dao && (
        <Card>
          <CardHeader>
            <CardTitle>New Proposal</CardTitle>
            <CardDescription>Create a new proposal for the community to vote on.</CardDescription>
          </CardHeader>
          <CardContent>
            <CreateProposalForm
              onSubmit={handleCreateProposal}
              onCancel={() => {
                navigate('/public-votes/');
                setError(null);
              }}
              isSubmitting={creatingProposal}
            />
          </CardContent>
        </Card>
      )}
    </div>
    </>
  );
}
