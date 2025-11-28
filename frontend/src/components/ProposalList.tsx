import { useState, useEffect } from "react";
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { initializeContractClients } from "../lib/contracts";
import { getReadOnlyVoting } from "../lib/readOnlyContracts";
import { calculateNullifier } from "../lib/zkproof";
import ProposalCard from "./ProposalCard";
import { getZKCredentials } from "../lib/zk";
import { LoadingSpinner } from "./ui";

interface ProposalListProps {
  publicKey: string | null;
  daoId: number;
  daoName?: string;
  kit: StellarWalletsKit | null;
  hasMembership: boolean;
  vkSet: boolean;
  isInitializing?: boolean;
}

interface Proposal {
  id: number;
  title: string;
  contentCid: string;
  yesVotes: number;
  noVotes: number;
  hasVoted: boolean;
  eligibleRoot: bigint; // Snapshot of Merkle root when proposal was created
  voteMode: "Fixed" | "Trailing"; // Vote mode: Fixed (snapshot) or Trailing (dynamic)
  endTime: number; // Unix timestamp in seconds
  vkVersion?: number | null;
}

export default function ProposalList({ publicKey, daoId, daoName, kit, hasMembership, vkSet, isInitializing = false }: ProposalListProps) {
  const [proposals, setProposals] = useState<Proposal[]>(() => {
    // Initialize with cached data if available
    const cacheKey = `proposals_${daoId}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        // Convert eligibleRoot strings back to bigints
        const proposals = parsed.map((p: any) => ({
          ...p,
          eligibleRoot: BigInt(p.eligibleRoot)
        }));
        // Sort by proposal ID descending (newest first)
        proposals.sort((a: Proposal, b: Proposal) => b.id - a.id);
        return proposals;
      } catch {
        return [];
      }
    }
    return [];
  });
  const [loading, setLoading] = useState(() => {
    // Only show loading indicator if no cache exists
    const cacheKey = `proposals_${daoId}`;
    const cached = localStorage.getItem(cacheKey);
    return !cached;
  });

  useEffect(() => {
    // Wait for wallet initialization before loading
    if (isInitializing) {
      return;
    }
    loadProposals();
  }, [daoId, isInitializing]);

  const loadProposals = async () => {
    const cacheKey = `proposals_${daoId}`;

    try {
      // Load from cache first
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const cachedData = JSON.parse(cached);
          // Convert eligibleRoot strings back to bigints
          const proposals = cachedData.map((p: any) => ({
            ...p,
            eligibleRoot: BigInt(p.eligibleRoot)
          }));
          // Sort by proposal ID descending (newest first)
          proposals.sort((a: Proposal, b: Proposal) => b.id - a.id);
          setProposals(proposals);
          setLoading(false);
        } catch {
          // Ignore cache errors
        }
      }

      // For now, load proposals 1-5 (we'll need to track total count in production)
      const proposalPromises = [];
      for (let i = 1; i <= 5; i++) {
        proposalPromises.push(loadProposal(i));
      }

      const loadedProposals = (await Promise.all(proposalPromises)).filter(
        (p): p is Proposal => p !== null
      );

      // Sort by proposal ID descending (newest first)
      loadedProposals.sort((a, b) => b.id - a.id);

      setProposals(loadedProposals);

      // Update cache (convert BigInts to strings for serialization)
      const serializable = loadedProposals.map(p => ({
        ...p,
        eligibleRoot: p.eligibleRoot.toString()
      }));
      localStorage.setItem(cacheKey, JSON.stringify(serializable));
    } catch (err) {
      console.error("Failed to load proposals:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadProposal = async (proposalId: number): Promise<Proposal | null> => {
    try {
      const votingClient: any = publicKey ? initializeContractClients(publicKey).voting : getReadOnlyVoting();

      // Get proposal info
      const proposalResult = await votingClient.get_proposal({
        dao_id: BigInt(daoId),
        proposal_id: BigInt(proposalId),
      });

      // Proposal info already includes vote counts in the generated type
      const proposal = proposalResult.result;

      // Check if user has already voted
      let hasVoted = false;
      if (publicKey) {
        try {
          const cached = getZKCredentials(daoId, publicKey);

          if (cached) {
            const { secret } = cached;
            const nullifier = await calculateNullifier(
              secret,
              daoId.toString(),
              proposalId.toString()
            );

            // Check if this nullifier has been used
            const nullifierUsedResult = await votingClient.is_nullifier_used({
              dao_id: BigInt(daoId),
              proposal_id: BigInt(proposalId),
              nullifier: BigInt(nullifier),
            });
            hasVoted = nullifierUsedResult.result;
          }
        } catch (err) {
          console.error("Failed to check if voted:", err);
          // Default to false to allow voting attempt
        }
      }

      return {
        id: proposalId,
        title: proposal.title,
        contentCid: proposal.content_cid,
        yesVotes: Number(proposal.yes_votes),
        noVotes: Number(proposal.no_votes),
        hasVoted,
        eligibleRoot: proposal.eligible_root, // Pass through the snapshot root
        voteMode: proposal.vote_mode.tag as "Fixed" | "Trailing", // Extract vote mode from enum
        endTime: Number(proposal.end_time), // Unix timestamp in seconds
        vkVersion: (proposal as any).vk_version !== undefined ? Number((proposal as any).vk_version) : null,
      };
    } catch (err) {
      return null;
    }
  };

  if (loading && proposals.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <LoadingSpinner size="md" color="blue" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Proposals List */}
      {proposals.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center">
          <p className="text-muted-foreground">No proposals yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              daoId={daoId}
              daoName={daoName}
              publicKey={publicKey}
              kit={kit}
              hasMembership={hasMembership}
              onVoteComplete={loadProposals}
            />
          ))}
        </div>
      )}
    </div>
  );
}
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
