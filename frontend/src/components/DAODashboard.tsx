import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { initializeContractClients } from "../lib/contracts";
import { getReadOnlyDaoRegistry, getReadOnlyMembershipSbt, getReadOnlyMembershipTree } from "../lib/readOnlyContracts";
import { useWallet } from "../hooks/useWallet";
import {
  generateDeterministicZKCredentials,
  getZKCredentials,
  storeZKCredentials,
} from "../lib/zk";
import { isUserRejection, extractTxHash } from "../lib/utils";
import { notifyEvent } from "../lib/api";
import {
  type DAOMetadata,
  fetchDAOMetadata,
  getImageUrl,
  getTwitterUrl,
} from "../lib/daoMetadata";
import { Badge, Alert, LoadingSpinner, CreateProposalForm } from "./ui";
import { Button } from "./ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/Card";
import ProposalList from "./ProposalList";
import ManageMembers from "./ManageMembers";
import DAOInfoPanel from "./DAOInfoPanel";
import DAOSettings from "./DAOSettings";
import { Shield, Users, Lock, Unlock, FileText, CheckCircle, PlusCircle, Home, Settings, Globe, ChevronDown, ChevronUp } from "lucide-react";

// Custom social icons
const TwitterIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const LinkedInIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
  </svg>
);

const GitHubIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
);

type DAOTab = 'info' | 'proposals' | 'members' | 'create-proposal' | 'settings';

interface DAODashboardProps {
  publicKey: string | null;
  daoId: number;
  isInitializing?: boolean;
  initialTab?: DAOTab;
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
  membersCanPropose: boolean;
  metadataCid: string | null;
}

export default function DAODashboard({ publicKey, daoId, isInitializing = false, initialTab = 'proposals' }: DAODashboardProps) {
  const { kit } = useWallet();
  const navigate = useNavigate();

  // Helper to get URL path for a tab
  const getTabPath = (tab: DAOTab) => {
    const daoSlug = dao?.name ? `${daoId}-${dao.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}` : String(daoId);
    if (tab === 'proposals') return `/daos/${daoSlug}`;
    return `/daos/${daoSlug}/${tab}`;
  };

  // Navigation function that uses URL routing
  const navigateToTab = (tab: DAOTab) => {
    navigate(getTabPath(tab));
  };
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
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [proposalKey, setProposalKey] = useState(0);
  // Use initialTab from URL route - no local state needed as navigation handles tab changes
  const activeTab = initialTab;
  const [metadata, setMetadata] = useState<DAOMetadata | null>(null);
  const [showDescription, setShowDescription] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
    // Run both loads in parallel
    Promise.all([loadDAOInfo(), checkRegistrationStatus()]);
  }, [daoId, publicKey, isInitializing]);

  // Update page title and meta description based on active tab
  useEffect(() => {
    const daoName = dao?.name || 'DAO';
    const tabMeta: Record<DAOTab, { title: string; description: string }> = {
      proposals: {
        title: `${daoName} - Proposals | ZKVote`,
        description: `View and vote on proposals for ${daoName}. Participate in decentralized governance with zero-knowledge privacy.`,
      },
      info: {
        title: `${daoName} - Info | ZKVote`,
        description: `Learn about ${daoName} DAO - membership status, voting setup, and governance details.`,
      },
      members: {
        title: `${daoName} - Members | ZKVote`,
        description: `View members of ${daoName} DAO. See who's participating in this decentralized community.`,
      },
      settings: {
        title: `${daoName} - Settings | ZKVote`,
        description: `Manage settings for ${daoName} DAO. Configure membership and proposal permissions.`,
      },
      'create-proposal': {
        title: `${daoName} - New Proposal | ZKVote`,
        description: `Create a new proposal for ${daoName} DAO. Start a vote for the community.`,
      },
    };

    const { title, description } = tabMeta[activeTab];
    document.title = title;

    // Update meta description
    let metaDescription = document.querySelector('meta[name="description"]');
    if (!metaDescription) {
      metaDescription = document.createElement('meta');
      metaDescription.setAttribute('name', 'description');
      document.head.appendChild(metaDescription);
    }
    metaDescription.setAttribute('content', description);
  }, [activeTab, dao?.name]);

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
    } catch {
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

        // Load cached metadata immediately for instant image display
        if (cachedDao.metadataCid) {
          const metadataCacheKey = `dao_metadata_${cachedDao.metadataCid}`;
          const cachedMetadata = localStorage.getItem(metadataCacheKey);
          if (cachedMetadata) {
            setMetadata(JSON.parse(cachedMetadata));
          }
        }
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

      // Run membership and tree checks in parallel to reduce RPC calls latency
      const [hasSBT, treeInitialized] = await Promise.all([
        !useReadOnly && publicKey ? checkMembership() : Promise.resolve(false),
        checkTreeInitialized(),
      ]);
      const vkSet = await checkVKSet();
      const isAdmin = !useReadOnly && publicKey ? (daoResult.result.admin === publicKey) : false;

      const metadataCid = daoResult.result.metadata_cid || null;

      const daoInfo = {
        id: daoId,
        name: daoResult.result.name,
        creator: daoResult.result.admin,
        hasMembership: hasSBT,
        isAdmin,
        treeInitialized,
        vkSet,
        membershipOpen: daoResult.result.membership_open,
        membersCanPropose: daoResult.result.members_can_propose ?? true,
        metadataCid,
      };

      setDao(daoInfo);
      localStorage.setItem(cacheKey, JSON.stringify(daoInfo));

      // Load metadata from IPFS if available (and cache it)
      if (metadataCid) {
        fetchDAOMetadata(metadataCid).then((meta) => {
          if (meta) {
            setMetadata(meta);
            // Cache metadata for instant loading on next visit
            const metadataCacheKey = `dao_metadata_${metadataCid}`;
            localStorage.setItem(metadataCacheKey, JSON.stringify(meta));
          }
        });
      } else {
        setMetadata(null);
      }
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
        setRegistrationStatus("Step 1/2: Generating Secret");
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

      setRegistrationStatus("Step 2/2: Registering Commitment");
      console.log("[Registration] Step 2: Registering commitment in Merkle tree...");
      const clients = initializeContractClients(publicKey || "");

      const tx = await clients.membershipTree.register_with_caller({
        dao_id: BigInt(daoId),
        commitment: BigInt(commitment),
        caller: publicKey || "",
      });

      // Helper to check if error is CommitmentExists (error #5 from tree contract)
      const isCommitmentExistsError = (err: unknown): boolean => {
        const errStr = (err as { message?: string })?.message || String(err);
        return errStr.includes('#5') || errStr.includes('Error(Contract, #5)');
      };

      let alreadyRegistered = false;
      let txHash: string | null = null;
      try {
        console.log("[Registration] Calling signAndSend...");
        const result = await tx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });
        console.log("[Registration] Step 2 complete - Transaction signed and sent:", result);
        txHash = extractTxHash(result);
      } catch (err) {
        // Check if this is a CommitmentExists error - means we're already registered
        if (isCommitmentExistsError(err)) {
          console.log("[Registration] Commitment already exists on-chain - recovering credentials");
          alreadyRegistered = true;
        } else {
          console.error("[Registration] Step 2 (signAndSend) failed:", err);
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          const enhancedError = new Error(`Transaction signing failed: ${errorMessage}`);
          (enhancedError as Error & { originalError: unknown }).originalError = err;
          throw enhancedError;
        }
      }

      if (alreadyRegistered) {
        setRegistrationStatus("Found existing registration - recovering...");
      }

      const leafIndexResult = await clients.membershipTree.get_leaf_index({
        dao_id: BigInt(daoId),
        commitment: BigInt(commitment),
      });

      const leafIndex = Number(leafIndexResult.result);
      storeZKCredentials(daoId, publicKey || "", { secret, salt, commitment }, leafIndex);

      // Notify relayer of registration event (only if we actually registered, not recovered)
      if (txHash && !alreadyRegistered) {
        notifyEvent(daoId, "voter_registered", txHash, { commitment, leafIndex });
      }

      setIsRegistered(true);
      setHasUnregisteredCredentials(false);
      setRegistrationStatus(alreadyRegistered ? "Credentials recovered!" : "Registration complete!");
      console.log(alreadyRegistered ? "Credentials recovered! Leaf index:" : "Registration successful! Leaf index:", leafIndex);
    } catch (err) {
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

      const clients = initializeContractClients(publicKey || "");

      if (!kit) {
        throw new Error("Wallet kit not available");
      }

      const tx = await clients.membershipSbt.self_join({
        dao_id: BigInt(daoId),
        member: publicKey || "",
        encrypted_alias: undefined,
      });

      const result = await tx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });

      // Notify relayer of member joined event
      const txHash = extractTxHash(result);
      if (txHash) {
        notifyEvent(daoId, "member_added", txHash, { member: publicKey });
      }

      // Immediately update local state to reflect membership
      setDao(prev => prev ? { ...prev, hasMembership: true } : prev);

      // Also update cache
      const cacheKey = `dao_info_${daoId}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const cachedDao = JSON.parse(cached);
        cachedDao.hasMembership = true;
        localStorage.setItem(cacheKey, JSON.stringify(cachedDao));
      }

      // Reload to get any other updates
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
    title: string;
    contentCid: string;
    voteMode: "fixed" | "trailing";
    deadlineSeconds: number;
  }) => {
    try {
      setCreatingProposal(true);
      setError(null);

      const clients = initializeContractClients(publicKey || "");

      let endTime: bigint;
      if (data.deadlineSeconds === 0) {
        endTime = BigInt(0);
      } else {
        endTime = BigInt(Math.floor(Date.now() / 1000) + data.deadlineSeconds);
      }

      const tx = await clients.voting.create_proposal({
        dao_id: BigInt(daoId),
        title: data.title,
        content_cid: data.contentCid,
        end_time: endTime,
        creator: publicKey || "",
        vote_mode: { tag: data.voteMode === "fixed" ? "Fixed" : "Trailing", values: void 0 },
      });

      if (!kit) {
        throw new Error("Wallet kit not available");
      }

      const result = await tx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });

      // Notify relayer of proposal created event
      const txHash = extractTxHash(result);
      if (txHash) {
        notifyEvent(daoId, "proposal_created", txHash, { title: data.title, contentCid: data.contentCid });
      }

      navigateToTab('proposals');
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
    <div className="space-y-6 animate-fade-in">
      {/* DAO Header Card with Profile, Title, Nav, and Description */}
      <Card>
        <CardContent className="pt-6">
          {/* Cover Image with Profile Photo and Social Links overlay */}
          {metadata?.coverImageCid && (
            <div className="relative -mx-6 -mt-6 mb-4">
              {/* Cover container with overflow hidden */}
              <div className="relative h-[200px] rounded-t-lg overflow-hidden bg-muted">
                <img
                  src={getImageUrl(metadata.coverImageCid)}
                  alt="DAO Cover"
                  className="w-full h-full object-cover"
                />
              </div>
              {/* Profile Image - positioned outside the overflow-hidden container */}
              {metadata?.profileImageCid && (
                <div className="absolute -bottom-12 left-4">
                  <div className="w-24 h-24 md:w-28 md:h-28 rounded-xl border-4 border-background overflow-hidden bg-muted shadow-lg">
                    <img
                      src={getImageUrl(metadata.profileImageCid)}
                      alt="DAO Profile"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}
              {/* Social Links - top right of cover */}
              {metadata?.links && Object.values(metadata.links).some(Boolean) && (
                <div className="absolute top-3 right-3 flex items-center gap-1">
                  {metadata.links.website && (
                    <a
                      href={metadata.links.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-lg bg-background/80 hover:bg-background transition-colors text-muted-foreground hover:text-foreground"
                      title="Website"
                    >
                      <Globe className="w-4 h-4" />
                    </a>
                  )}
                  {metadata.links.twitter && (
                    <a
                      href={getTwitterUrl(metadata.links.twitter)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-lg bg-background/80 hover:bg-background transition-colors text-muted-foreground hover:text-foreground"
                      title="X (Twitter)"
                    >
                      <TwitterIcon className="w-4 h-4" />
                    </a>
                  )}
                  {metadata.links.linkedin && (
                    <a
                      href={metadata.links.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-lg bg-background/80 hover:bg-background transition-colors text-muted-foreground hover:text-foreground"
                      title="LinkedIn"
                    >
                      <LinkedInIcon className="w-4 h-4" />
                    </a>
                  )}
                  {metadata.links.github && (
                    <a
                      href={metadata.links.github}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-lg bg-background/80 hover:bg-background transition-colors text-muted-foreground hover:text-foreground"
                      title="GitHub"
                    >
                      <GitHubIcon className="w-4 h-4" />
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Profile Image - shown standalone when no cover image */}
          {metadata?.profileImageCid && !metadata?.coverImageCid && (
            <div className="mb-4">
              <div className="w-24 h-24 md:w-28 md:h-28 rounded-xl border-4 border-background overflow-hidden bg-muted shadow-lg">
                <img
                  src={getImageUrl(metadata.profileImageCid)}
                  alt="DAO Profile"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          )}

          {/* Header Info with Navigation - flex row layout on 2xl+ */}
          <div className={`flex flex-col 2xl:flex-row 2xl:items-start 2xl:justify-between gap-4 mb-4 ${metadata?.coverImageCid && metadata?.profileImageCid ? 'mt-14' : ''}`}>
            {/* Left: DAO name, badges, and ID */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <h2 className="text-2xl font-bold tracking-tight text-foreground">
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
                  <Badge variant="secondary" className="gap-1"><Lock className="w-3 h-3" /> Closed</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="font-mono text-xs bg-muted/50 px-1.5 py-0.5 rounded">ID: {dao.id}</span>
                <span>•</span>
                <span>Created by {dao.creator?.slice(0, 4) ?? '...'}...{dao.creator?.slice(-4) ?? '...'}</span>
              </p>
            </div>

            {/* Right: Navigation Menu (2xl+ only - floated right of header) */}
            <div className="shrink-0 hidden 2xl:block">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={activeTab === 'proposals' ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => navigateToTab('proposals')}
                  className="gap-2"
                >
                  <Home className="w-4 h-4" />
                  Overview
                </Button>
                <Button
                  variant={activeTab === 'info' ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => navigateToTab('info')}
                  className="gap-2"
                >
                  <FileText className="w-4 h-4" /> Info
                </Button>
                <Button
                  variant={activeTab === 'members' ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => navigateToTab('members')}
                  className="gap-2"
                >
                  <Users className="w-4 h-4" />
                  Members
                </Button>
                {dao.isAdmin && publicKey && kit && (
                  <Button
                    variant={activeTab === 'settings' ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => navigateToTab('settings')}
                    className="gap-2"
                  >
                    <Settings className="w-4 h-4" />
                    Settings
                  </Button>
                )}
                {(dao.isAdmin || (dao.hasMembership && dao.membersCanPropose)) && dao.vkSet && (
                  <Button
                    variant={activeTab === 'create-proposal' ? 'secondary' : 'outline'}
                    onClick={() => navigateToTab('create-proposal')}
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
          </div>

          {/* Social Links - shown below header when no cover image */}
          {!metadata?.coverImageCid && metadata?.links && Object.values(metadata.links).some(Boolean) && (
            <div className="flex items-center gap-2 mb-4">
              {metadata.links.website && (
                <a
                  href={metadata.links.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg bg-muted/30 dark:bg-muted/50 hover:bg-muted transition-colors text-foreground/70 hover:text-foreground"
                  title="Website"
                >
                  <Globe className="w-5 h-5" />
                </a>
              )}
              {metadata.links.twitter && (
                <a
                  href={getTwitterUrl(metadata.links.twitter)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg bg-muted/30 dark:bg-muted/50 hover:bg-muted transition-colors text-foreground/70 hover:text-foreground"
                  title="X (Twitter)"
                >
                  <TwitterIcon className="w-5 h-5" />
                </a>
              )}
              {metadata.links.linkedin && (
                <a
                  href={metadata.links.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg bg-muted/30 dark:bg-muted/50 hover:bg-muted transition-colors text-foreground/70 hover:text-foreground"
                  title="LinkedIn"
                >
                  <LinkedInIcon className="w-5 h-5" />
                </a>
              )}
              {metadata.links.github && (
                <a
                  href={metadata.links.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg bg-muted/30 dark:bg-muted/50 hover:bg-muted transition-colors text-foreground/70 hover:text-foreground"
                  title="GitHub"
                >
                  <GitHubIcon className="w-5 h-5" />
                </a>
              )}
            </div>
          )}

          {/* Mobile Navigation Menu - dropdown for < 1024px */}
          <div className="lg:hidden mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2">
                {activeTab === 'proposals' && <><Home className="w-4 h-4" /> Overview</>}
                {activeTab === 'info' && <><FileText className="w-4 h-4" /> Info</>}
                {activeTab === 'members' && <><Users className="w-4 h-4" /> Members</>}
                {activeTab === 'settings' && <><Settings className="w-4 h-4" /> Settings</>}
                {activeTab === 'create-proposal' && <><PlusCircle className="w-4 h-4" /> Add Proposal</>}
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${mobileMenuOpen ? 'rotate-180' : ''}`} />
            </Button>
            {mobileMenuOpen && (
              <div className="mt-2 w-full rounded-lg border bg-background shadow-lg">
                <div className="p-2 space-y-1">
                  <button
                    onClick={() => { navigateToTab('proposals'); setMobileMenuOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${activeTab === 'proposals' ? 'bg-secondary text-secondary-foreground' : 'hover:bg-muted'}`}
                  >
                    <Home className="w-4 h-4" /> Overview
                  </button>
                  <button
                    onClick={() => { navigateToTab('info'); setMobileMenuOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${activeTab === 'info' ? 'bg-secondary text-secondary-foreground' : 'hover:bg-muted'}`}
                  >
                    <FileText className="w-4 h-4" /> Info
                  </button>
                  <button
                    onClick={() => { navigateToTab('members'); setMobileMenuOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${activeTab === 'members' ? 'bg-secondary text-secondary-foreground' : 'hover:bg-muted'}`}
                  >
                    <Users className="w-4 h-4" /> Members
                  </button>
                  {dao.isAdmin && publicKey && kit && (
                    <button
                      onClick={() => { navigateToTab('settings'); setMobileMenuOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${activeTab === 'settings' ? 'bg-secondary text-secondary-foreground' : 'hover:bg-muted'}`}
                    >
                      <Settings className="w-4 h-4" /> Settings
                    </button>
                  )}
                  {(dao.isAdmin || (dao.hasMembership && dao.membersCanPropose)) && dao.vkSet && (
                    <button
                      onClick={() => { navigateToTab('create-proposal'); setMobileMenuOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${activeTab === 'create-proposal' ? 'bg-secondary text-secondary-foreground' : 'hover:bg-muted'}`}
                    >
                      <PlusCircle className="w-4 h-4" /> Add Proposal
                    </button>
                  )}
                  {!dao.hasMembership && dao.membershipOpen && publicKey && (
                    <>
                      <div className="border-t my-2" />
                      <button
                        onClick={() => { handleJoinDao(); setMobileMenuOpen(false); }}
                        disabled={joining}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
                      >
                        {joining ? <LoadingSpinner size="sm" color="white" /> : <Users className="w-4 h-4" />}
                        {joining ? "Joining..." : "Join DAO"}
                      </button>
                    </>
                  )}
                  {dao.hasMembership && !isRegistered && publicKey && (
                    <>
                      <div className="border-t my-2" />
                      <button
                        onClick={() => { handleRegisterForVoting(); setMobileMenuOpen(false); }}
                        disabled={registering}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
                      >
                        {registering ? (
                          <>
                            <LoadingSpinner size="sm" color="white" />
                            {registrationStatus || "Registering..."}
                          </>
                        ) : (
                          <>
                            <CheckCircle className="w-4 h-4" />
                            {hasUnregisteredCredentials ? "Complete Registration" : "Register to Vote"}
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Inline Navigation Menu - shown for lg to 2xl (1024px - 1536px), above description */}
          <div className="hidden lg:block 2xl:hidden mb-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={activeTab === 'proposals' ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => navigateToTab('proposals')}
                className="gap-2"
              >
                <Home className="w-4 h-4" />
                Overview
              </Button>
              <Button
                variant={activeTab === 'info' ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => navigateToTab('info')}
                className="gap-2"
              >
                <FileText className="w-4 h-4" /> Info
              </Button>
              <Button
                variant={activeTab === 'members' ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => navigateToTab('members')}
                className="gap-2"
              >
                <Users className="w-4 h-4" />
                Members
              </Button>
              {dao.isAdmin && publicKey && kit && (
                <Button
                  variant={activeTab === 'settings' ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => navigateToTab('settings')}
                  className="gap-2"
                >
                  <Settings className="w-4 h-4" />
                  Settings
                </Button>
              )}
              {(dao.isAdmin || (dao.hasMembership && dao.membersCanPropose)) && dao.vkSet && (
                <Button
                  variant={activeTab === 'create-proposal' ? 'secondary' : 'outline'}
                  onClick={() => navigateToTab('create-proposal')}
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
              {dao.hasMembership && !isRegistered && publicKey && (
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
                      {hasUnregisteredCredentials ? "Complete Registration" : "Register to Vote"}
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* Description (collapsible) */}
          {metadata?.description && (
            <div>
              <button
                onClick={() => setShowDescription(!showDescription)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {showDescription ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
                {showDescription ? "Hide description" : "Show description"}
              </button>
              {showDescription && (
                <div className="mt-3 p-4 rounded-lg bg-muted/30">
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {metadata.description}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          )}

        </CardContent>
      </Card>

      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      {activeTab === 'info' && (
        <DAOInfoPanel key={`info-${dao.hasMembership}`} daoId={daoId} publicKey={publicKey} kit={kit} />
      )}

      {activeTab === 'proposals' && (
        <ProposalList
          key={`proposals-${proposalKey}-${dao.hasMembership}`}
          publicKey={publicKey}
          daoId={daoId}
          daoName={dao.name}
          kit={kit}
          hasMembership={dao.hasMembership}
          vkSet={dao.vkSet}
          isInitializing={isInitializing}
        />
      )}

      {activeTab === 'members' && (
        <ManageMembers
          key={`members-${dao.hasMembership}-${dao.isAdmin}`}
          daoId={daoId}
          publicKey={publicKey}
          isAdmin={dao.isAdmin}
        />
      )}

      {activeTab === 'create-proposal' && (
        <Card>
          <CardHeader>
            <CardTitle>New Proposal</CardTitle>
            <CardDescription>Create a new proposal for the community to vote on.</CardDescription>
          </CardHeader>
          <CardContent>
            <CreateProposalForm
              onSubmit={handleCreateProposal}
              onCancel={() => {
                navigateToTab('proposals');
                setError(null);
              }}
              isSubmitting={creatingProposal}
            />
          </CardContent>
        </Card>
      )}

      {activeTab === 'settings' && dao.isAdmin && publicKey && kit && (
        <DAOSettings
          daoId={daoId}
          daoName={dao.name}
          publicKey={publicKey}
          kit={kit}
          membershipOpen={dao.membershipOpen}
          membersCanPropose={dao.membersCanPropose}
          metadataCid={dao.metadataCid}
          onSettingsChanged={loadDAOInfo}
        />
      )}
    </div>
  );
}
