import { useState } from "react";
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { Button } from "./ui/Button";
import { Textarea } from "./ui/Textarea";
import { Label } from "./ui/Label";
import { Badge } from "./ui/Badge";
import { MessageSquare, Eye, EyeOff, Loader2, AlertTriangle } from "lucide-react";
import { uploadCommentContent, saveAnonymousComment, getNextNonce } from "../lib/comments";
import { getZKCredentials, generateVoteProof } from "../lib/zk";

const RELAYER_URL = import.meta.env.VITE_RELAYER_URL || "http://localhost:3001";

interface CommentFormProps {
  daoId: number;
  proposalId: number;
  publicKey: string;
  kit: StellarWalletsKit | null;
  hasMembership: boolean;
  isRegistered: boolean;
  eligibleRoot: bigint;
  parentId?: number;
  onSubmit: () => void;
  onCancel?: () => void;
  placeholder?: string;
}

export default function CommentForm({
  daoId,
  proposalId,
  publicKey,
  hasMembership,
  isRegistered,
  eligibleRoot,
  parentId,
  onSubmit,
  onCancel,
  placeholder = "Write your comment...",
}: CommentFormProps) {
  const [body, setBody] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canComment = hasMembership && (isAnonymous ? isRegistered : true);

  const handleSubmit = async () => {
    if (!body.trim()) {
      setError("Comment cannot be empty");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Upload content to IPFS
      const { cid } = await uploadCommentContent(body.trim());

      if (isAnonymous) {
        // Generate ZK proof for anonymous comment
        const credentials = getZKCredentials(daoId, publicKey);
        if (!credentials) {
          throw new Error("No ZK credentials found. Please register first.");
        }

        const nonce = getNextNonce(daoId, proposalId);

        // Generate proof (using vote circuit with comment nonce)
        // Note: In production, this would use a separate comment circuit
        const proofData = await generateVoteProof({
          commitment: credentials.commitment,
          secret: credentials.secret,
          merkleProof: credentials.merkleProof,
          proposalId,
          daoId,
          voteChoice: 0, // Not used for comments, but required by circuit
          root: eligibleRoot.toString(),
        });

        // Submit anonymous comment via relayer
        const response = await fetch(`${RELAYER_URL}/comment/anonymous`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            daoId,
            proposalId,
            contentCid: cid,
            parentId: parentId ?? null,
            proof: proofData.proof,
            publicSignals: [proofData.root, proofData.nullifier],
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to submit anonymous comment");
        }

        // Save anonymous comment record for edit/delete capability
        saveAnonymousComment({
          commentId: data.commentId,
          proposalId,
          daoId,
          nullifier: proofData.nullifier,
          nonce,
        });
      } else {
        // Submit public comment via relayer
        const response = await fetch(`${RELAYER_URL}/comment/public`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            daoId,
            proposalId,
            contentCid: cid,
            parentId: parentId ?? null,
            author: publicKey,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to submit comment");
        }
      }

      // Success - clear form and notify parent
      setBody("");
      onSubmit();
    } catch (err) {
      console.error("Failed to submit comment:", err);
      setError(err instanceof Error ? err.message : "Failed to submit comment");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!hasMembership) {
    return (
      <div className="bg-muted/50 rounded-lg p-4 text-center text-muted-foreground">
        <MessageSquare className="w-5 h-5 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Only DAO members can comment on proposals.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label htmlFor="comment-body" className="text-sm font-medium">
          {parentId ? "Write a reply" : "Add a comment"}
        </Label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsAnonymous(!isAnonymous)}
            disabled={!isRegistered}
            className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-colors ${
              isAnonymous
                ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            } ${!isRegistered ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            title={!isRegistered ? "Register to comment anonymously" : "Toggle anonymous mode"}
          >
            {isAnonymous ? (
              <>
                <EyeOff className="w-3 h-3" />
                Anonymous
              </>
            ) : (
              <>
                <Eye className="w-3 h-3" />
                Public
              </>
            )}
          </button>
          {isAnonymous && (
            <Badge variant="purple" className="text-[10px]">
              ZK Proof
            </Badge>
          )}
        </div>
      </div>

      <Textarea
        id="comment-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="resize-none"
        disabled={isSubmitting}
      />

      {isAnonymous && (
        <div className="flex items-start gap-2 p-2 bg-purple-50 dark:bg-purple-900/20 rounded-md text-xs text-purple-700 dark:text-purple-300">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <p>
            Anonymous comments use zero-knowledge proofs. Generating the proof may take a few seconds.
          </p>
        </div>
      )}

      {error && (
        <div className="p-2 bg-destructive/10 text-destructive text-sm rounded-md">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        )}
        <Button
          onClick={handleSubmit}
          disabled={!canComment || !body.trim() || isSubmitting}
          size="sm"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              {isAnonymous ? "Generating proof..." : "Posting..."}
            </>
          ) : (
            <>
              <MessageSquare className="w-4 h-4 mr-1.5" />
              {parentId ? "Reply" : "Comment"}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
