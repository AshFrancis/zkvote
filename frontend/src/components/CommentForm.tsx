import { useState } from "react";
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { Button } from "./ui/Button";
import { Textarea } from "./ui/Textarea";
import { Label } from "./ui/Label";
import { Badge } from "./ui/Badge";
import { MessageSquare, Eye, EyeOff, Loader2, AlertTriangle } from "lucide-react";
import {
  uploadCommentContent,
  saveAnonymousComment,
  getNextNonce,
} from "../lib/comments";
import {
  generateDeterministicZKCredentials,
  getZKCredentials,
  storeZKCredentials,
} from "../lib/zk";
import {
  generateVoteProof,
  formatProofForSoroban,
  type ProofInput,
} from "../lib/zkproof";
import { getMerklePath } from "../lib/merkletree";
import { initializeContractClients } from "../lib/contracts";
import { buildPoseidon } from "circomlibjs";

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

/**
 * Calculate comment nullifier using Poseidon hash
 * commentNullifier = Poseidon(secret, daoId, proposalId, nonce)
 * The nonce allows multiple anonymous comments per user per proposal
 */
async function calculateCommentNullifier(
  secret: string,
  daoId: number,
  proposalId: number,
  nonce: number
): Promise<string> {
  const poseidon = await buildPoseidon();
  const hash = poseidon.F.toString(
    poseidon([BigInt(secret), BigInt(daoId), BigInt(proposalId), BigInt(nonce)])
  );
  return hash;
}

export default function CommentForm({
  daoId,
  proposalId,
  publicKey,
  kit,
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
  const [progress, setProgress] = useState("");

  const canComment = hasMembership && (isAnonymous ? isRegistered : true);

  const handleSubmit = async () => {
    if (!body.trim()) {
      setError("Comment cannot be empty");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setProgress("");

    try {
      // Upload content to IPFS
      setProgress("Uploading comment...");
      const { cid } = await uploadCommentContent(body.trim());

      if (isAnonymous) {
        // Generate ZK proof for anonymous comment (same flow as voting)
        setProgress("Loading credentials...");
        const clients = initializeContractClients(publicKey);

        let secret: string, salt: string, commitment: string, leafIndex: number;
        const cached = getZKCredentials(daoId, publicKey);

        if (!cached) {
          if (!kit) {
            throw new Error("You must register for anonymous comments first.");
          }

          setProgress("Regenerating credentials...");
          const credentials = await generateDeterministicZKCredentials(kit, daoId);

          const leafIndexResult = await clients.membershipTree.get_leaf_index({
            dao_id: BigInt(daoId),
            commitment: BigInt(credentials.commitment),
          });

          leafIndex = Number(leafIndexResult.result);
          secret = credentials.secret;
          salt = credentials.salt;
          commitment = credentials.commitment;

          storeZKCredentials(daoId, publicKey, credentials, leafIndex);
        } else {
          secret = cached.secret;
          salt = cached.salt;
          commitment = cached.commitment;
          leafIndex = cached.leafIndex;
        }

        // Get next nonce for this user's anonymous comments
        const nonce = getNextNonce(daoId, proposalId);

        // Calculate comment-specific nullifier (includes nonce for multiple comments)
        setProgress("Computing nullifier...");
        const nullifier = await calculateCommentNullifier(
          secret,
          daoId,
          proposalId,
          nonce
        );

        // Get Merkle path
        setProgress("Fetching Merkle path...");
        const { pathElements, pathIndices } = await getMerklePath(
          leafIndex,
          daoId,
          publicKey
        );

        // Use eligible_root from proposal (snapshot of when proposal was created)
        const root = eligibleRoot;

        // Generate ZK proof using same vote circuit
        // We use voteChoice=0 as a placeholder since it's not used for comments
        setProgress("Generating ZK proof...");
        const wasmPath = "/circuits/vote.wasm";
        const zkeyPath = "/circuits/vote_final.zkey";

        const proofInput: ProofInput = {
          root: root.toString(),
          nullifier: nullifier.toString(),
          daoId: daoId.toString(),
          proposalId: proposalId.toString(),
          voteChoice: "0", // Not used for comments
          commitment: commitment.toString(),
          secret: secret.toString(),
          salt: salt.toString(),
          pathElements,
          pathIndices,
        };

        const { proof } = await generateVoteProof(proofInput, wasmPath, zkeyPath);

        // Format proof for Soroban
        const { proof_a, proof_b, proof_c } = formatProofForSoroban(proof);

        // Convert to hex strings
        const toHexBE = (value: string | bigint): string => {
          const bigInt = typeof value === "string" ? BigInt(value) : value;
          return bigInt.toString(16).padStart(64, "0");
        };

        // Submit anonymous comment via relayer
        setProgress("Submitting comment...");
        const response = await fetch(`${RELAYER_URL}/comment/anonymous`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            daoId,
            proposalId,
            contentCid: cid,
            parentId: parentId ?? null,
            nullifier: toHexBE(nullifier),
            root: toHexBE(root),
            commitment: toHexBE(commitment),
            nonce,
            proof: {
              a: proof_a,
              b: proof_b,
              c: proof_c,
            },
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
          nullifier,
          nonce,
        });
      } else {
        // Submit public comment via relayer (simpler, no ZK proof needed)
        setProgress("Submitting comment...");
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
      setProgress("");
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

      {progress && isSubmitting && (
        <div className="text-xs text-muted-foreground">{progress}</div>
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
