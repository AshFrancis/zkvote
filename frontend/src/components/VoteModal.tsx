import { useState } from "react";
import { Button, Banner } from "@stellar/design-system";
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { initializeContractClients } from "../lib/contracts";
import {
  generateVoteProof,
  formatProofForSoroban,
  calculateNullifier,
  type ProofInput,
} from "../lib/zkproof";
import { getMerklePath } from "../lib/merkletree";
import {
  generateDeterministicZKCredentials,
  getZKCredentials,
  storeZKCredentials,
} from "../lib/zk";

interface VoteModalProps {
  proposalId: number;
  eligibleRoot: bigint; // Snapshot of Merkle root when proposal was created
  voteMode: "Fixed" | "Trailing"; // Vote mode: Fixed (snapshot) or Trailing (dynamic)
  vkVersion?: number | null;
  daoId: number;
  publicKey: string;
  kit: StellarWalletsKit | null;
  onClose: () => void;
  onComplete: () => void;
}

type VoteStep = "select" | "generating" | "submitting" | "success" | "error";

export default function VoteModal({
  proposalId,
  eligibleRoot,
  voteMode,
  vkVersion,
  daoId,
  publicKey,
  kit,
  onClose,
  onComplete,
}: VoteModalProps) {
  const [step, setStep] = useState<VoteStep>("select");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

  const handleVote = async (choice: boolean) => {
    setStep("generating");
    setError(null);

    try {
      // Initialize contract clients
      const clients = initializeContractClients(publicKey);

      // Step 1: Load registration data (or regenerate from wallet)
      setProgress("Loading voting credentials...");
      let secret: string, salt: string, commitment: string, leafIndex: number;

      const cached = getZKCredentials(daoId, publicKey);

      if (!cached) {
        // Try to regenerate from wallet signature
        console.log("[Vote] No cached credentials, attempting to regenerate...");

        if (!kit) {
          throw new Error("You must register for voting first. Please click 'Register for Voting' button.");
        }

        setProgress("Regenerating credentials from wallet signature...");
        const credentials = await generateDeterministicZKCredentials(kit, daoId);

        // Get leaf index from contract
        const leafIndexResult = await clients.membershipTree.get_leaf_index({
          dao_id: BigInt(daoId),
          commitment: BigInt(credentials.commitment),
        });

        leafIndex = Number(leafIndexResult.result);
        secret = credentials.secret;
        salt = credentials.salt;
        commitment = credentials.commitment;

        // Cache for next time
        storeZKCredentials(daoId, publicKey, credentials, leafIndex);

        console.log("[Vote] Credentials regenerated successfully");
      } else {
        secret = cached.secret;
        salt = cached.salt;
        commitment = cached.commitment;
        leafIndex = cached.leafIndex;
      }

      console.log("Using credentials:");
      console.log("Secret:", secret);
      console.log("Salt:", salt);
      console.log("Leaf Index:", leafIndex);

      // Step 2: Select root based on vote mode
      // Fixed mode: Use snapshot root from proposal creation
      // Trailing mode: Use current root (allows new members to vote)
      let root: bigint;
      if (voteMode === "Fixed") {
        setProgress("Using proposal snapshot root (Fixed mode)...");
        root = eligibleRoot;
        console.log("Fixed mode - using snapshot root (eligible_root):", root.toString());
      } else {
        setProgress("Fetching current root (Trailing mode)...");
        const currentRootResult = await clients.membershipTree.current_root({ dao_id: BigInt(daoId) });
        root = currentRootResult.result;
        console.log("Trailing mode - using current root:", root.toString());
        console.log("(eligible_root was:", eligibleRoot.toString(), ")");
      }

      // Step 3: Get Merkle path from contract
      setProgress("Fetching Merkle path from tree...");
      const { pathElements, pathIndices } = await getMerklePath(leafIndex, daoId, publicKey);

      console.log("Merkle path computed:");
      console.log("Path elements:", pathElements);
      console.log("Path indices:", pathIndices);

      // Step 4: Compute nullifier using Poseidon hash
      // nullifier = Poseidon(secret, daoId, proposalId)
      setProgress("Computing nullifier...");
      const nullifier = await calculateNullifier(
        secret,
        daoId.toString(),
        proposalId.toString()
      );

      // Step 4: Generate ZK proof
      setProgress("Generating zero-knowledge proof...");
      const wasmPath = "/circuits/vote.wasm";
      const zkeyPath = "/circuits/vote_final.zkey";

      const proofInput: ProofInput = {
        // Public signals
        root: root.toString(),
        nullifier: nullifier.toString(),
        daoId: daoId.toString(),
        proposalId: proposalId.toString(),
        voteChoice: choice ? "1" : "0",
        commitment: commitment.toString(), // NEW: allows revocation checks
        vkVersion: vkVersion?.toString() ?? undefined,
        // Private signals
        secret: secret.toString(),
        salt: salt.toString(),
        pathElements,
        pathIndices,
      };

      console.log("=== PROOF INPUT DEBUG ===");
      console.log("Root (eligible_root):", root.toString());
      console.log("Commitment:", commitment);
      console.log("Secret:", secret);
      console.log("Salt:", salt);
      console.log("LeafIndex:", leafIndex);
      console.log("Path elements:", pathElements);
      console.log("Full proof input:", proofInput);
      console.log("========================");

      const { proof, publicSignals } = await generateVoteProof(
        proofInput,
        wasmPath,
        zkeyPath
      );

      // Step 4.5: Verify proof locally before submitting
      setProgress("Verifying proof locally...");
      const { verifyProofLocally } = await import("../lib/zkproof");
      const isValid = await verifyProofLocally(
        proof,
        publicSignals,
        "/circuits/verification_key.json"
      );

      console.log("Local proof verification result:", isValid);
      console.log("Public signals:", publicSignals);

      if (!isValid) {
        throw new Error("Proof verification failed locally! This indicates a bug in proof generation.");
      }

      // Step 5: Format proof for Soroban
      setProgress("Formatting proof...");
      const { proof_a, proof_b, proof_c } = formatProofForSoroban(proof);

      // Step 6: Submit vote through anonymous relay
      setStep("submitting");
      setProgress("Submitting anonymous vote through relay...");

      // Convert U256 to big-endian hex (U256 values use big-endian, unlike BN254 curve points which use little-endian)
      const toHexBE = (value: string | bigint): string => {
        const bigInt = typeof value === 'string' ? BigInt(value) : value;
        return bigInt.toString(16).padStart(64, "0");
      };

      // Submit to relay server (provides anonymity by hiding voter's public key)
      const response = await fetch("http://localhost:3001/vote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          daoId: Number(daoId),
          proposalId: Number(proposalId),
          choice: choice,
          nullifier: toHexBE(nullifier),
          root: toHexBE(root),
          commitment: toHexBE(commitment), // NEW: for revocation checks
          proof: {
            a: proof_a,
            b: proof_b,
            c: proof_c,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMsg = errorData.error || "Failed to submit vote through relay";

        // Detect double-vote error
        if (errorMsg.includes("already voted") || errorMsg.includes("UnreachableCodeReached")) {
          throw new Error("You have already voted on this proposal. Each member can only vote once per proposal.");
        }

        throw new Error(errorMsg);
      }

      const result = await response.json();
      console.log("Vote submitted successfully:", result);

      setStep("success");
      setTimeout(() => {
        onComplete();
      }, 2000);
    } catch (err) {
      setStep("error");
      let errorMsg = err instanceof Error ? err.message : "Failed to submit vote";

      // Detect Merkle root mismatch (joined after proposal creation)
      if (errorMsg.includes("Assert Failed") || errorMsg.includes("Error in template Vote")) {
        if (voteMode === "Fixed") {
          errorMsg = "Cannot vote on this proposal. You joined the DAO after this proposal was created. Only members who were present when the proposal was created can vote on it (snapshot voting).";
        } else {
          errorMsg = "Proof generation failed. This may indicate an issue with your voting credentials or the Merkle tree state. Please try registering for voting again.";
        }
      }

      setError(errorMsg);
      console.error("Vote submission failed:", err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="relative bg-white dark:bg-gray-800 rounded-lg max-w-md w-full p-6">
        {/* Close button - positioned outside modal */}
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 p-1 hover:opacity-70 transition-opacity"
          aria-label="Close"
        >
          <svg
            className="w-4 h-4 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {step === "select" && (
          <>
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              Cast Your Anonymous Vote
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Your vote will be verified using zero-knowledge proofs to ensure anonymity
              while proving you're a DAO member.
              {voteMode === "Fixed" ? (
                <span className="block mt-2 text-sm text-yellow-600 dark:text-yellow-400">
                  Note: Only members who were present when this proposal was created can vote (snapshot voting).
                </span>
              ) : (
                <span className="block mt-2 text-sm text-green-600 dark:text-green-400">
                  Note: Members can vote even if they joined after this proposal was created.
                </span>
              )}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleVote(true)}
                className="flex-1 px-6 py-3 text-white bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition-colors shadow-sm hover:shadow-md"
              >
                Vote Yes
              </button>
              <button
                onClick={() => handleVote(false)}
                className="flex-1 px-6 py-3 text-white bg-red-600 hover:bg-red-700 rounded-lg font-semibold transition-colors shadow-sm hover:shadow-md"
              >
                Vote No
              </button>
            </div>
          </>
        )}

        {(step === "generating" || step === "submitting") && (
          <>
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              {step === "generating" ? "Generating Proof" : "Submitting Vote"}
            </h3>
            <div className="flex flex-col items-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400 text-center">{progress}</p>
            </div>
            <Banner variant="primary">
              This may take a minute. Please don't close this window.
            </Banner>
          </>
        )}

        {step === "success" && (
          <>
            <div className="text-center py-8">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/30 mb-4">
                <svg
                  className="h-6 w-6 text-green-600 dark:text-green-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                Vote Submitted!
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                Your anonymous vote has been recorded.
              </p>
            </div>
          </>
        )}

        {step === "error" && (
          <>
            <h3 className="text-xl font-bold mb-4">
              Error
            </h3>
            <div className="mb-6">
              <Banner variant="error">
                {error}
              </Banner>
            </div>
            <Button
              variant="secondary"
              size="lg"
              isFullWidth
              onClick={onClose}
            >
              Close
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
