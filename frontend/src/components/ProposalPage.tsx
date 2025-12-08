import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { initializeContractClients } from "../lib/contracts";
import { getReadOnlyVoting, getReadOnlyDaoRegistry, getReadOnlyMembershipSbt } from "../lib/readOnlyContracts";
import { calculateNullifier } from "../lib/zkproof";
import {
  generateDeterministicZKCredentials,
  getZKCredentials,
  storeZKCredentials,
} from "../lib/zk";
import { parseIdFromSlug, toIdSlug, isUserRejection } from "../lib/utils";
import { relayerFetch, RELAYER_URL } from "../lib/api";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card, CardContent } from "./ui/Card";
import { LoadingSpinner, MediaSlider } from "./ui";
import VoteModal from "./VoteModal";
import CommentSection from "./CommentSection";
import { Clock, CheckCircle, XCircle, AlertCircle, ExternalLink, ArrowLeft, Shield, Users, Lock, Unlock, Home, FileText, Vote, UserPlus, KeyRound } from "lucide-react";

interface ProposalMetadata {
  version: number;
  body: string;
  videoUrl?: string;
  image?: {
    cid: string;
    filename: string;
    mimeType: string;
  };
}

interface Proposal {
  id: number;
  title: string;
  contentCid: string;
  yesVotes: number;
  noVotes: number;
  hasVoted: boolean;
  eligibleRoot: bigint;
  voteMode: "Fixed" | "Trailing";
  endTime: number;
  vkVersion?: number | null;
}

interface DAOInfo {
  id: number;
  name: string;
  creator: string;
  hasMembership: boolean;
  isAdmin: boolean;
  membershipOpen: boolean;
}

interface ProposalPageProps {
  publicKey: string | null;
  kit: StellarWalletsKit | null;
  isInitializing: boolean;
}

// Helper to get cached DAO info synchronously
function getCachedDaoInfo(daoId: number): DAOInfo | null {
  const cached = localStorage.getItem(`dao_info_${daoId}`);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      return null;
    }
  }
  return null;
}

export default function ProposalPage({ publicKey, kit, isInitializing: _isInitializing }: ProposalPageProps) {
  const { daoSlug, proposalSlug } = useParams<{ daoSlug: string; proposalSlug: string }>();
  const navigate = useNavigate();

  // Parse IDs from slugs
  const numericDaoId = daoSlug ? parseIdFromSlug(daoSlug) : null;
  const numericProposalId = proposalSlug ? parseIdFromSlug(proposalSlug) : null;

  // Initialize DAO from cache immediately for instant render
  const [dao, setDao] = useState<DAOInfo | null>(() => numericDaoId ? getCachedDaoInfo(numericDaoId) : null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [metadata, setMetadata] = useState<ProposalMetadata | null>(null);
  const [metadataFailed, setMetadataFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showVoteModal, setShowVoteModal] = useState(false);
  // Start with false - membership is set by fresh on-chain check (not cached)
  const [hasMembership, setHasMembership] = useState(false);
  const [joining, setJoining] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registrationStatus, setRegistrationStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isProposalNotFound, setIsProposalNotFound] = useState(false);

  const [isRegistered, setIsRegistered] = useState(() => {
    return publicKey && numericDaoId !== null ? !!getZKCredentials(numericDaoId, publicKey) : false;
  });

  // Update isRegistered when publicKey or daoId changes
  useEffect(() => {
    if (publicKey && numericDaoId !== null) {
      setIsRegistered(!!getZKCredentials(numericDaoId, publicKey));
    } else {
      setIsRegistered(false);
    }
  }, [publicKey, numericDaoId]);


  // Generate slug for navigation - use DAO name if available, otherwise fallback to original slug
  const daoSlugForNav = numericDaoId && dao?.name ? toIdSlug(numericDaoId, dao.name) : daoSlug || '';

  const now = Math.floor(Date.now() / 1000);
  const hasDeadline = proposal ? proposal.endTime > 0 : false;
  const isPastDeadline = hasDeadline && proposal ? now > proposal.endTime : false;

  const totalVotes = proposal ? proposal.yesVotes + proposal.noVotes : 0;
  const yesPercentage = totalVotes > 0 && proposal ? (proposal.yesVotes / totalVotes) * 100 : 0;
  const noPercentage = totalVotes > 0 && proposal ? (proposal.noVotes / totalVotes) * 100 : 0;

  // Check if contentCid looks like a valid CID
  const hasRichContent = proposal?.contentCid &&
    (proposal.contentCid.startsWith("Qm") ||
     proposal.contentCid.startsWith("bafy") ||
     proposal.contentCid.startsWith("bafk"));

  useEffect(() => {
    if (numericDaoId !== null && numericProposalId !== null) {
      loadProposal();
      loadDaoInfo();
    }
  }, [numericDaoId, numericProposalId, publicKey]);

  // Load metadata when proposal is loaded (only once - don't retry on failure)
  useEffect(() => {
    if (proposal && hasRichContent && !metadata && !loadingMetadata && !metadataFailed) {
      loadMetadata();
    }
  }, [proposal, hasRichContent, metadata, loadingMetadata, metadataFailed]);

  const loadDaoInfo = async () => {
    if (!numericDaoId) return;

    const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
    const cacheKey = `dao_info_${numericDaoId}`;
    const cacheTimeKey = `dao_info_${numericDaoId}_time`;
    const cached = localStorage.getItem(cacheKey);
    const cacheTime = localStorage.getItem(cacheTimeKey);
    const now = Date.now();
    const isCacheValid = cached && cacheTime && (now - parseInt(cacheTime, 10)) < CACHE_TTL_MS;

    // Show cached data immediately for fast UX (but always refresh membership)
    if (cached) {
      const cachedDao = JSON.parse(cached);
      setDao(cachedDao);
      // Don't trust cached membership - always refresh it from chain
      // setHasMembership(cachedDao.hasMembership || false);

      // For non-membership data, return early if cache is valid
      // But we still need to check membership freshly (done below)
      if (isCacheValid && !publicKey) {
        return;
      }
    }

    // Lazy background fetch - don't block UI
    const fetchFromChain = async () => {
      try {
        const registry = publicKey
          ? initializeContractClients(publicKey).daoRegistry
          : getReadOnlyDaoRegistry();

        const daoResult = await registry.get_dao({
          dao_id: BigInt(numericDaoId),
        });

        const daoData = daoResult.result;

        // Check membership
        let userHasMembership = false;
        let isAdmin = false;

        if (publicKey) {
          isAdmin = daoData.admin === publicKey;

          try {
            const sbt = publicKey
              ? initializeContractClients(publicKey).membershipSbt
              : getReadOnlyMembershipSbt();
            const hasSbtResult = await sbt.has({
              dao_id: BigInt(numericDaoId),
              of: publicKey,
            });
            userHasMembership = hasSbtResult.result;
          } catch {
            // Ignore membership check errors
          }
        }

        const daoInfo: DAOInfo = {
          id: numericDaoId,
          name: daoData.name,
          creator: daoData.admin,
          hasMembership: userHasMembership,
          isAdmin,
          membershipOpen: daoData.membership_open,
        };

        // Always update membership from fresh on-chain check
        setHasMembership(userHasMembership);

        // Only update DAO state if data changed (avoid unnecessary re-renders)
        const cachedStr = localStorage.getItem(cacheKey);
        const newStr = JSON.stringify(daoInfo);
        if (cachedStr !== newStr) {
          setDao(daoInfo);
        }

        // Update cache with timestamp
        localStorage.setItem(cacheKey, newStr);
        localStorage.setItem(cacheTimeKey, Date.now().toString());
      } catch (err) {
        console.error("Failed to load DAO info:", err);
      }
    };

    // If we have stale cache, do background refresh without blocking
    if (cached) {
      fetchFromChain(); // Fire and forget
    } else {
      // No cache - must wait for data
      await fetchFromChain();
    }
  };

  const loadProposal = async () => {
    if (numericDaoId === null || numericProposalId === null) return;

    setLoading(true);
    setError(null);
    setIsProposalNotFound(false);

    try {
      // Use contract client like ProposalList does
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Contract client types not fully exported
      const votingClient: any = publicKey
        ? initializeContractClients(publicKey).voting
        : getReadOnlyVoting();

      // Get proposal info
      const proposalResult = await votingClient.get_proposal({
        dao_id: BigInt(numericDaoId),
        proposal_id: BigInt(numericProposalId),
      });

      const proposalData = proposalResult.result;

      // Check if user has already voted
      let hasVoted = false;
      if (publicKey) {
        try {
          const cached = getZKCredentials(numericDaoId, publicKey);

          if (cached) {
            const { secret } = cached;
            const nullifier = await calculateNullifier(
              secret,
              numericDaoId.toString(),
              numericProposalId.toString()
            );

            // Check if this nullifier has been used
            const nullifierUsedResult = await votingClient.is_nullifier_used({
              dao_id: BigInt(numericDaoId),
              proposal_id: BigInt(numericProposalId),
              nullifier: BigInt(nullifier),
            });
            hasVoted = nullifierUsedResult.result;
          }
        } catch (err) {
          console.error("Failed to check if voted:", err);
        }
      }

      // Success - reset retry count
      setRetryCount(0);
      setProposal({
        id: numericProposalId,
        title: proposalData.title,
        contentCid: proposalData.content_cid,
        yesVotes: Number(proposalData.yes_votes),
        noVotes: Number(proposalData.no_votes),
        hasVoted,
        eligibleRoot: proposalData.eligible_root,
        voteMode: proposalData.vote_mode.tag as "Fixed" | "Trailing",
        endTime: Number(proposalData.end_time),
        vkVersion: 'vk_version' in proposalData && proposalData.vk_version !== undefined
          ? Number(proposalData.vk_version)
          : null,
      });

      // Note: hasMembership is set by the fresh on-chain check in useEffect,
      // not from local ZK credentials (which persist after SBT revocation)
    } catch (err) {
      console.error("Failed to load proposal:", err);
      const errorMsg = err instanceof Error ? err.message : "Failed to load proposal";

      // Detect "proposal not found" type errors (contract trap, simulation failure)
      const isNotFound = errorMsg.includes("UnreachableCodeReached") ||
                        errorMsg.includes("simulation failed") ||
                        errorMsg.includes("InvalidAction");

      if (isNotFound) {
        setIsProposalNotFound(true);
        // Auto-retry up to 3 times with increasing delay (proposal may be confirming)
        if (retryCount < 3) {
          setRetryCount(prev => prev + 1);
          const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
          setTimeout(() => loadProposal(), delay);
          return; // Don't set loading to false yet
        }
      }

      setError(isNotFound ? "Proposal not found - it may still be confirming on the network" : errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const loadMetadata = async () => {
    if (!proposal?.contentCid) return;

    setLoadingMetadata(true);
    try {
      const res = await relayerFetch(`/ipfs/${proposal.contentCid}`);
      if (!res.ok) throw new Error("Failed to fetch metadata");
      const data = await res.json();
      setMetadata(data);
    } catch (err) {
      console.error("Failed to load metadata:", err);
      setMetadataFailed(true); // Mark as failed to prevent retry loop
    } finally {
      setLoadingMetadata(false);
    }
  };

  const formatDeadline = (timestamp: number): string => {
    if (timestamp === 0) return "No deadline";

    const timeLeft = timestamp - now;

    if (timeLeft < 0) {
      return "Closed";
    } else if (timeLeft < 3600) {
      const minutes = Math.floor(timeLeft / 60);
      return `${minutes} minute${minutes !== 1 ? "s" : ""} left`;
    } else if (timeLeft < 86400) {
      const hours = Math.floor(timeLeft / 3600);
      return `${hours} hour${hours !== 1 ? "s" : ""} left`;
    } else {
      const days = Math.floor(timeLeft / 86400);
      return `${days} day${days !== 1 ? "s" : ""} left`;
    }
  };

  const getDeadlineColor = (): string => {
    if (!hasDeadline) return "text-muted-foreground";
    if (isPastDeadline) return "text-destructive";

    const timeLeft = proposal!.endTime - now;
    if (timeLeft < 86400) return "text-orange-500";
    return "text-muted-foreground";
  };

  const handleVoteComplete = () => {
    setShowVoteModal(false);
    loadProposal(); // Reload to get updated vote counts
  };

  const handleJoinDao = async () => {
    if (!publicKey || !kit || numericDaoId === null) return;

    try {
      setJoining(true);
      setActionError(null);

      const clients = initializeContractClients(publicKey);

      const tx = await clients.membershipSbt.self_join({
        dao_id: BigInt(numericDaoId),
        member: publicKey,
        encrypted_alias: undefined,
      });

      await tx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });

      // Refresh DAO info to update membership status
      setHasMembership(true);
      if (dao) {
        const updatedDao = { ...dao, hasMembership: true };
        setDao(updatedDao);
        localStorage.setItem(`dao_info_${numericDaoId}`, JSON.stringify(updatedDao));
      }
    } catch (err) {
      if (!isUserRejection(err)) {
        setActionError(err instanceof Error ? err.message : "Failed to join DAO");
        console.error("Join DAO failed:", err);
      }
    } finally {
      setJoining(false);
    }
  };

  const handleRegisterForVoting = async () => {
    if (!publicKey || !kit || numericDaoId === null || registering) return;

    try {
      setRegistering(true);
      setActionError(null);
      setRegistrationStatus("Step 1/2: Generating secret (sign message)...");

      // Generate deterministic credentials
      const credentials = await generateDeterministicZKCredentials(kit, numericDaoId);

      setRegistrationStatus("Step 2/2: Registering commitment (sign transaction)...");
      const clients = initializeContractClients(publicKey);

      const tx = await clients.membershipTree.register_with_caller({
        dao_id: BigInt(numericDaoId),
        commitment: BigInt(credentials.commitment),
        caller: publicKey,
      });

      // Helper to check if error is CommitmentExists (error #5 from tree contract)
      const isCommitmentExistsError = (err: unknown): boolean => {
        const errStr = (err as { message?: string })?.message || String(err);
        return errStr.includes('#5') || errStr.includes('Error(Contract, #5)');
      };

      let alreadyRegistered = false;
      try {
        await tx.signAndSend({ signTransaction: kit.signTransaction.bind(kit) });
      } catch (err) {
        // Check if this is a CommitmentExists error - means we're already registered
        if (isCommitmentExistsError(err)) {
          console.log("[Registration] Commitment already exists on-chain - recovering credentials");
          alreadyRegistered = true;
        } else {
          throw err;
        }
      }

      if (alreadyRegistered) {
        setRegistrationStatus("Found existing registration - recovering...");
      }

      // Get leaf index and store credentials
      const leafIndexResult = await clients.membershipTree.get_leaf_index({
        dao_id: BigInt(numericDaoId),
        commitment: BigInt(credentials.commitment),
      });

      const leafIndex = Number(leafIndexResult.result);
      storeZKCredentials(numericDaoId, publicKey, credentials, leafIndex);

      setIsRegistered(true);
      setRegistrationStatus(null);
    } catch (err) {
      if (!isUserRejection(err)) {
        setActionError(err instanceof Error ? err.message : "Failed to register for voting");
        console.error("Registration failed:", err);
      }
      setRegistrationStatus(null);
    } finally {
      setRegistering(false);
    }
  };

  // Show full page loading only if we have no cached DAO info
  if (loading && !dao) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8">
        <LoadingSpinner size="lg" />
        {retryCount > 0 && (
          <p className="text-sm text-muted-foreground">
            Waiting for proposal to confirm... (attempt {retryCount}/3)
          </p>
        )}
      </div>
    );
  }

  // Error state - but still show DAO header if we have it
  if (error || (!loading && !proposal)) {
    return (
      <div className="space-y-6 animate-fade-in">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-2 text-sm">
          <button
            onClick={() => navigate('/daos/')}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            DAOs
          </button>
          <span className="text-muted-foreground">/</span>
          <button
            onClick={() => navigate(`/daos/${daoSlugForNav}`)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {dao?.name || `DAO #${numericDaoId}`}
          </button>
        </nav>

        {/* DAO Header */}
        {dao && (
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
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/daos/${daoSlugForNav}`)}
              className="gap-2"
            >
              <Home className="w-4 h-4" />
              Back to Overview
            </Button>
          </div>
        )}

        <Card>
          <CardContent className="p-6">
            {isProposalNotFound ? (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30">
                  <Clock className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="text-center">
                  <h3 className="font-medium text-foreground mb-1">Proposal not found</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    This proposal may still be confirming on the network. Please wait a moment and try again.
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/daos/${daoSlugForNav}`)}
                    className="gap-2"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back to DAO
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setRetryCount(0);
                      loadProposal();
                    }}
                    className="gap-2"
                  >
                    <Clock className="w-4 h-4" />
                    Try Again
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-destructive">{error || "Proposal not found"}</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-2 text-sm">
          <button
            onClick={() => navigate('/daos/')}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            DAOs
          </button>
          <span className="text-muted-foreground">/</span>
          <button
            onClick={() => navigate(`/daos/${daoSlugForNav}`)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {dao?.name || `DAO #${numericDaoId}`}
          </button>
          {proposal && (
            <>
              <span className="text-muted-foreground">/</span>
              <span className="text-foreground font-medium">{proposal.title}</span>
            </>
          )}
        </nav>

        {/* DAO Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="space-y-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-3xl font-bold tracking-tight text-foreground">
                  {dao?.name || `DAO #${numericDaoId}`}
                </h2>
                {dao?.isAdmin ? (
                  <Badge variant="blue" className="gap-1"><Shield className="w-3 h-3" /> Admin</Badge>
                ) : dao?.hasMembership ? (
                  <Badge variant="success" className="gap-1"><Users className="w-3 h-3" /> Member</Badge>
                ) : (
                  <Badge variant="gray" className="gap-1"><Users className="w-3 h-3" /> Non-member</Badge>
                )}
                {dao?.membershipOpen ? (
                  <Badge variant="success" className="gap-1"><Unlock className="w-3 h-3" /> Open</Badge>
                ) : (
                  <Badge variant="secondary" className="gap-1"><Lock className="w-3 h-3" /> Closed</Badge>
                )}
              </div>
              {dao && (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <span className="font-mono text-xs bg-muted/50 px-1.5 py-0.5 rounded">ID: {dao.id}</span>
                  {dao.creator && (
                    <>
                      <span>•</span>
                      <span>Created by {dao.creator.slice(0, 4)}...{dao.creator.slice(-4)}</span>
                    </>
                  )}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/daos/${daoSlugForNav}`)}
              className="gap-2"
            >
              <Home className="w-4 h-4" />
              Overview
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/daos/${daoSlugForNav}/info`)}
              className="gap-2"
            >
              <FileText className="w-4 h-4" /> Info
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/daos/${daoSlugForNav}/members`)}
              className="gap-2"
            >
              <Users className="w-4 h-4" />
              Members
            </Button>

            {/* Join DAO button - show for non-members when membership is open */}
            {!hasMembership && dao?.membershipOpen && publicKey && (
              <Button
                variant="outline"
                onClick={handleJoinDao}
                disabled={joining}
                size="sm"
                className="gap-2"
              >
                {joining ? (
                  <>
                    <LoadingSpinner size="sm" />
                    Joining...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    Join DAO
                  </>
                )}
              </Button>
            )}

            {/* Register to Vote button - show for members who haven't registered */}
            {hasMembership && !isRegistered && publicKey && (
              <Button
                variant="outline"
                onClick={handleRegisterForVoting}
                disabled={registering}
                size="sm"
                className="gap-2"
              >
                {registering ? (
                  <>
                    <LoadingSpinner size="sm" />
                    {registrationStatus || "Registering..."}
                  </>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    Register to Vote
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Show action errors */}
        {actionError && (
          <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-md">
            {actionError}
          </div>
        )}

        {/* Proposal content */}
        <Card className="animate-fade-in">
          <CardContent className="p-6 space-y-6">
            {/* Loading state for proposal */}
            {loading && !proposal ? (
              <div className="flex items-center justify-center py-12">
                <LoadingSpinner size="lg" />
              </div>
            ) : proposal ? (
              <>
            {/* Header with back button and title */}
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate(`/daos/${daoSlugForNav}`)}
                className="flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-secondary hover:bg-accent transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-muted-foreground">
                    #{proposal.id}
                  </span>
                  {proposal.vkVersion !== undefined && proposal.vkVersion !== null && (
                    <Badge variant="purple" className="text-[10px] px-1.5 py-0 h-5">v{proposal.vkVersion}</Badge>
                  )}
                  <Badge variant={proposal.voteMode === "Fixed" ? "warning" : "success"} className="text-[10px] px-1.5 py-0 h-5">
                    {proposal.voteMode}
                  </Badge>
                  {proposal.hasVoted && <Badge variant="blue" className="text-[10px] px-1.5 py-0 h-5">Voted</Badge>}
                  {isPastDeadline && <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5">Closed</Badge>}
                </div>
                <div className="flex items-center justify-between gap-4">
                  <h1 className="text-2xl font-bold">{proposal.title}</h1>
                  {hasDeadline && (
                    <div className={`flex items-center gap-1.5 text-sm font-medium whitespace-nowrap ${getDeadlineColor()}`}>
                      <Clock className="w-4 h-4" />
                      {formatDeadline(proposal.endTime)}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Body content with media slider floated right */}
            {loadingMetadata && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <LoadingSpinner size="sm" />
                <span>Loading content...</span>
              </div>
            )}
            {metadataFailed && hasRichContent && (
              <p className="text-sm text-muted-foreground italic">
                Content unavailable from IPFS
              </p>
            )}

            <div className="clearfix">
              {/* Media slider floated to the right */}
              {(metadata?.image || metadata?.videoUrl) && (
                <div className="w-full md:float-right md:w-[320px] lg:w-[400px] md:ml-6 mb-4">
                  <MediaSlider image={metadata?.image} videoUrl={metadata?.videoUrl} />
                </div>
              )}

              {/* Body text wraps around the floated media */}
              {metadata?.body && (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{metadata.body}</ReactMarkdown>
                </div>
              )}
            </div>

            {/* Legacy content (non-CID) */}
            {!hasRichContent && proposal.contentCid && (
              <p className="text-muted-foreground">{proposal.contentCid}</p>
            )}

            {/* IPFS link */}
            {hasRichContent && (
              <div className="text-xs text-muted-foreground">
                <a
                  href={`${RELAYER_URL}/ipfs/${proposal.contentCid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  View on IPFS
                </a>
              </div>
            )}

            {/* Vote results */}
            <div className="space-y-3 pt-4 border-t border-border">
              <h3 className="text-sm font-semibold">Results</h3>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5 font-medium text-green-600 dark:text-green-500">
                    <CheckCircle className="w-4 h-4" />
                    {proposal.yesVotes} Yes
                  </span>
                  <span className="flex items-center gap-1.5 font-medium text-red-600 dark:text-red-500">
                    <XCircle className="w-4 h-4" />
                    {proposal.noVotes} No
                  </span>
                </div>
                <span className="text-muted-foreground">
                  {totalVotes} votes total
                </span>
              </div>

              <div className="h-3 w-full rounded-full bg-secondary overflow-hidden flex">
                <div
                  className="bg-green-500 transition-all duration-500"
                  style={{ width: `${yesPercentage}%` }}
                />
                <div
                  className="bg-red-500 transition-all duration-500"
                  style={{ width: `${noPercentage}%` }}
                />
              </div>

              {totalVotes > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{yesPercentage.toFixed(1)}% Yes</span>
                  <span>{noPercentage.toFixed(1)}% No</span>
                </div>
              )}
            </div>

            {/* Vote button */}
            {hasMembership && !proposal.hasVoted && (
              <div className="pt-4 flex justify-end">
                <Button
                  onClick={() => setShowVoteModal(true)}
                  disabled={!isRegistered || isPastDeadline}
                  variant="outline"
                  size="sm"
                >
                  {!isRegistered ? (
                    <>
                      <AlertCircle className="w-4 h-4 mr-1.5" />
                      Register
                    </>
                  ) : isPastDeadline ? (
                    "Closed"
                  ) : (
                    <>
                      <Vote className="w-4 h-4 mr-1.5" />
                      Vote
                    </>
                  )}
                </Button>
              </div>
            )}
              </>
            ) : null}
          </CardContent>
        </Card>

        {/* Comments section */}
        {proposal && numericDaoId !== null && publicKey && (
          <CommentSection
            daoId={numericDaoId}
            proposalId={proposal.id}
            publicKey={publicKey}
            kit={kit}
            hasMembership={hasMembership}
            isRegistered={isRegistered}
            eligibleRoot={proposal.eligibleRoot}
            isAdmin={dao?.isAdmin || false}
          />
        )}
      </div>

      {showVoteModal && numericDaoId !== null && proposal && (
        <VoteModal
          proposalId={proposal.id}
          eligibleRoot={proposal.eligibleRoot}
          voteMode={proposal.voteMode}
          vkVersion={proposal.vkVersion}
          daoId={numericDaoId}
          publicKey={publicKey || ""}
          kit={kit}
          onClose={() => setShowVoteModal(false)}
          onComplete={handleVoteComplete}
        />
      )}
    </>
  );
}
