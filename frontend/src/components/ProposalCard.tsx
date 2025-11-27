import { useState } from "react";
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { getZKCredentials } from "../lib/zk";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card, CardContent, CardFooter, CardHeader } from "./ui/Card";
import VoteModal from "./VoteModal";
import { Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react";

interface ProposalCardProps {
  proposal: {
    id: number;
    description: string;
    yesVotes: number;
    noVotes: number;
    hasVoted: boolean;
    eligibleRoot: bigint;
    voteMode: "Fixed" | "Trailing";
    endTime: number;
    vkVersion?: number | null;
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

  const isRegistered = publicKey ? !!getZKCredentials(daoId, publicKey) : false;

  const now = Math.floor(Date.now() / 1000);
  const hasDeadline = proposal.endTime > 0;
  const isPastDeadline = hasDeadline && now > proposal.endTime;

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

    const timeLeft = proposal.endTime - now;
    if (timeLeft < 86400) return "text-orange-500";
    return "text-muted-foreground";
  };

  return (
    <>
      <Card className="transition-all hover:shadow-md">
        <CardContent className="p-6">
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
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
                <p className="text-base font-medium leading-normal">
                  {proposal.description}
                </p>
              </div>

              {hasDeadline && (
                <div className={`flex items-center gap-1.5 text-xs font-medium ${getDeadlineColor()}`}>
                  <Clock className="w-3.5 h-3.5" />
                  {formatDeadline(proposal.endTime)}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 font-medium text-green-600 dark:text-green-500">
                    <CheckCircle className="w-4 h-4" />
                    {proposal.yesVotes}
                  </span>
                  <span className="flex items-center gap-1.5 font-medium text-red-600 dark:text-red-500">
                    <XCircle className="w-4 h-4" />
                    {proposal.noVotes}
                  </span>
                </div>
                <span className="text-muted-foreground text-xs">
                  {totalVotes} votes total
                </span>
              </div>

              <div className="h-2 w-full rounded-full bg-secondary overflow-hidden flex">
                <div
                  className="bg-green-500 transition-all duration-500"
                  style={{ width: `${yesPercentage}%` }}
                />
                <div
                  className="bg-red-500 transition-all duration-500"
                  style={{ width: `${noPercentage}%` }}
                />
              </div>
            </div>

            {hasMembership && !proposal.hasVoted && (
              <div className="pt-2">
                <Button
                  onClick={() => setShowVoteModal(true)}
                  disabled={!isRegistered || isPastDeadline}
                  className="w-full sm:w-auto"
                  variant={isRegistered && !isPastDeadline ? "default" : "secondary"}
                  size="sm"
                >
                  {!isRegistered ? (
                    <>
                      <AlertCircle className="w-4 h-4 mr-2" />
                      Register to Vote
                    </>
                  ) : isPastDeadline ? (
                    "Voting Closed"
                  ) : (
                    "Vote (Anonymous)"
                  )}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {showVoteModal && (
        <VoteModal
          proposalId={proposal.id}
          eligibleRoot={proposal.eligibleRoot}
          voteMode={proposal.voteMode}
          vkVersion={proposal.vkVersion}
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
