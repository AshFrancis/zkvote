import { useState } from "react";

interface ProposalCardProps {
  proposal: {
    id: number;
    description: string;
    yesVotes: number;
    noVotes: number;
    hasVoted: boolean;
  };
  daoId: number;
  publicKey: string;
  hasMembership: boolean;
  onVoteComplete: () => void;
}

export default function ProposalCard({
  proposal,
  daoId,
  publicKey,
  hasMembership,
  onVoteComplete,
}: ProposalCardProps) {
  const [showVoteModal, setShowVoteModal] = useState(false);

  const totalVotes = proposal.yesVotes + proposal.noVotes;
  const yesPercentage = totalVotes > 0 ? (proposal.yesVotes / totalVotes) * 100 : 0;
  const noPercentage = totalVotes > 0 ? (proposal.noVotes / totalVotes) * 100 : 0;

  return (
    <>
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Proposal #{proposal.id}
              </span>
              {proposal.hasVoted && (
                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200">
                  Voted
                </span>
              )}
            </div>
            <p className="text-gray-900 dark:text-gray-100 mb-4">
              {proposal.description}
            </p>

            {/* Vote Results */}
            <div className="space-y-2">
              <div>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-gray-600 dark:text-gray-400">Yes</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {proposal.yesVotes} ({yesPercentage.toFixed(1)}%)
                  </span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-green-600 h-2 rounded-full transition-all"
                    style={{ width: `${yesPercentage}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-gray-600 dark:text-gray-400">No</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {proposal.noVotes} ({noPercentage.toFixed(1)}%)
                  </span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-red-600 h-2 rounded-full transition-all"
                    style={{ width: `${noPercentage}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Vote Button */}
        {hasMembership && !proposal.hasVoted && (
          <button
            onClick={() => setShowVoteModal(true)}
            className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-md transition-colors"
          >
            Vote (Anonymous)
          </button>
        )}
      </div>

      {/* Vote Modal */}
      {showVoteModal && (
        <VoteModal
          proposalId={proposal.id}
          daoId={daoId}
          publicKey={publicKey}
          onClose={() => setShowVoteModal(false)}
          onComplete={() => {
            setShowVoteModal(false);
            onVoteComplete();
          }}
        />
      )}
    </>
  );
}

// Import VoteModal (will be created next)
import VoteModal from "./VoteModal";
