import { useState, useEffect } from "react";
import { initializeContractClients } from "../lib/contracts";
import { getReadOnlyDaoRegistry } from "../lib/readOnlyContracts";
import ProposalCard from "./ProposalCard";

interface ProposalListProps {
  publicKey: string | null;
  daoId: number;
  hasMembership: boolean;
  vkSet: boolean;
  isInitializing?: boolean;
}

interface Proposal {
  id: number;
  description: string;
  yesVotes: number;
  noVotes: number;
  hasVoted: boolean;
}

export default function ProposalList({ publicKey, daoId, hasMembership, vkSet, isInitializing = false }: ProposalListProps) {
  const [proposals, setProposals] = useState<Proposal[]>(() => {
    // Initialize with cached data if available
    const cacheKey = `proposals_${daoId}`;
    const cached = localStorage.getItem(cacheKey);
    return cached ? JSON.parse(cached) : [];
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
      console.log('[ProposalList] Waiting for wallet initialization...');
      return;
    }
    console.log('[ProposalList] Loading proposals for DAO:', daoId, 'publicKey:', publicKey);
    loadProposals();
  }, [daoId, isInitializing]);

  const loadProposals = async () => {
    const cacheKey = `proposals_${daoId}`;

    try {
      // Load from cache first
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const cachedData = JSON.parse(cached);
        setProposals(cachedData);
        setLoading(false);
      }

      // For now, load proposals 1-5 (we'll need to track total count in production)
      const proposalPromises = [];
      for (let i = 1; i <= 5; i++) {
        proposalPromises.push(loadProposal(i));
      }

      const loadedProposals = (await Promise.all(proposalPromises)).filter(
        (p): p is Proposal => p !== null
      );

      setProposals(loadedProposals);

      // Update cache
      localStorage.setItem(cacheKey, JSON.stringify(loadedProposals));
    } catch (err) {
      console.error("Failed to load proposals:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadProposal = async (proposalId: number): Promise<Proposal | null> => {
    try {
      // Use read-only client if wallet not connected
      const clients = publicKey ? initializeContractClients(publicKey) : { voting: getReadOnlyDaoRegistry() };

      // Get proposal info
      const proposalResult = await clients.voting.get_proposal({
        dao_id: BigInt(daoId),
        proposal_id: BigInt(proposalId),
      });

      // Proposal info already includes vote counts in the generated type
      const proposal = proposalResult.result;

      return {
        id: proposalId,
        description: proposal.description,
        yesVotes: Number(proposal.yes_votes),
        noVotes: Number(proposal.no_votes),
        hasVoted: false, // TODO: Track voted nullifiers
      };
    } catch (err) {
      return null;
    }
  };

  if (loading && proposals.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Proposals List */}
      {proposals.length === 0 ? (
        <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
          <p className="text-gray-600 dark:text-gray-400">No proposals yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              daoId={daoId}
              publicKey={publicKey}
              hasMembership={hasMembership}
              onVoteComplete={loadProposals}
            />
          ))}
        </div>
      )}
    </div>
  );
}
