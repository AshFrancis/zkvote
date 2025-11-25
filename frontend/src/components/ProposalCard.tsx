import { useState } from "react";
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";

interface ProposalCardProps {
  proposal: {
    id: number;
    description: string;
    yesVotes: number;
    noVotes: number;
    hasVoted: boolean;
    eligibleRoot: bigint; // Snapshot of Merkle root when proposal was created
    voteMode: "Fixed" | "Trailing"; // Vote mode: Fixed (snapshot) or Trailing (dynamic)
    endTime: number; // Unix timestamp in seconds
  };
  daoId: number;
  publicKey: string;
  kit: StellarWalletsKit | null;
  hasMembership: boolean;
  onVoteComplete: () => void;
}

export default function ProposalCard({
  proposal,
  daoId,
  publicKey,
  kit,
  hasMembership,
  onVoteComplete,
}: ProposalCardProps) {
  const [showVoteModal, setShowVoteModal] = useState(false);

  const totalVotes = proposal.yesVotes + proposal.noVotes;
  const yesPercentage = totalVotes > 0 ? (proposal.yesVotes / totalVotes) * 100 : 0;
  const noPercentage = totalVotes > 0 ? (proposal.noVotes / totalVotes) * 100 : 0;

  // Check if user is registered for voting
  const isRegistered = publicKey ? (() => {
    const registrationKey = `voting_registration_${daoId}_${publicKey}`;
    return localStorage.getItem(registrationKey) !== null;
  })() : false;

  // Deadline logic
  const now = Math.floor(Date.now() / 1000); // Current time in seconds
  const hasDeadline = proposal.endTime > 0;
  const isPastDeadline = hasDeadline && now > proposal.endTime;

  const formatDeadline = (timestamp: number): string => {
    if (timestamp === 0) return "No deadline";

    const date = new Date(timestamp * 1000);
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
    if (!hasDeadline) return "text-gray-600 dark:text-gray-400";
    if (isPastDeadline) return "text-red-600 dark:text-red-400";

    const timeLeft = proposal.endTime - now;
    if (timeLeft < 86400) return "text-orange-600 dark:text-orange-400"; // Less than 1 day
    return "text-gray-600 dark:text-gray-400";
  };

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
              {isPastDeadline && (
                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200">
                  Closed
                </span>
              )}
            </div>
            {hasDeadline && (
              <div className={`text-sm font-medium mb-2 ${getDeadlineColor()}`}>
                {formatDeadline(proposal.endTime)}
              </div>
            )}
            <p className="text-gray-900 dark:text-gray-100 mb-4">
              {proposal.description}
            </p>

            {/* Vote Results */}
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="font-medium text-green-600 dark:text-green-400">
                  Yes: {proposal.yesVotes}
                </span>
                <span className="font-medium text-red-600 dark:text-red-400">
                  No: {proposal.noVotes}
                </span>
              </div>
              <div className="w-full flex h-3 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
                <div
                  className="bg-green-600 transition-all"
                  style={{ width: `${yesPercentage}%` }}
                />
                <div
                  className="bg-red-600 transition-all"
                  style={{ width: `${noPercentage}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Vote Button */}
        {hasMembership && !proposal.hasVoted && (
          <>
            <button
              onClick={() => setShowVoteModal(true)}
              disabled={!isRegistered || isPastDeadline}
              className={`w-full mt-4 font-medium px-4 py-2 rounded-md transition-colors ${
                isRegistered && !isPastDeadline
                  ? "bg-blue-600 hover:bg-blue-700 text-white"
                  : "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
              }`}
              title={
                !isRegistered
                  ? "Please register for voting first"
                  : isPastDeadline
                  ? "Voting period has ended"
                  : ""
              }
            >
              {isPastDeadline ? "Voting Closed" : "Vote (Anonymous)"}
            </button>
          </>
        )}
      </div>

      {/* Vote Modal */}
      {showVoteModal && (
        <VoteModal
          proposalId={proposal.id}
          eligibleRoot={proposal.eligibleRoot}
          voteMode={proposal.voteMode}
          daoId={daoId}
          publicKey={publicKey}
          kit={kit}
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
