import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { useProposalListQuery, useInvalidateProposals } from "../queries";
import ProposalCard from "./ProposalCard";
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

export default function ProposalList({
  publicKey,
  daoId,
  daoName,
  kit,
  hasMembership,
  vkSet: _vkSet,
  isInitializing = false,
}: ProposalListProps) {
  const {
    data: proposals = [],
    isLoading,
    refetch,
  } = useProposalListQuery({
    daoId,
    publicKey,
    enabled: !isInitializing && daoId > 0,
  });

  const invalidateProposals = useInvalidateProposals();

  const handleVoteComplete = () => {
    invalidateProposals(daoId);
    refetch();
  };

  if (isLoading && proposals.length === 0) {
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
              publicKey={publicKey || ""}
              kit={kit}
              hasMembership={hasMembership}
              onVoteComplete={handleVoteComplete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
