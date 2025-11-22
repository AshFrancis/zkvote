pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "merkle_tree.circom";

// DaoVote Anonymous Vote Circuit
//
// Proves:
// 1. Voter knows secret & salt that hash to a leaf in the Merkle tree
// 2. Nullifier is correctly derived from secret, daoId, and proposalId (domain-separated)
// 3. Vote choice is binary (0 or 1)
//
// Public signals: [root, nullifier, daoId, proposalId, voteChoice]
// Private signals: secret, salt, pathElements, pathIndices
template Vote(levels) {
    // Public inputs
    signal input root;              // Merkle tree root (verified on-chain)
    signal input nullifier;         // Prevents double voting (domain-separated)
    signal input daoId;             // DAO identifier (for domain separation)
    signal input proposalId;        // Which proposal this vote is for
    signal input voteChoice;        // 0 = against, 1 = for

    // Private inputs
    signal input secret;            // Voter's secret (like password)
    signal input salt;              // Random salt for commitment
    signal input pathElements[levels];  // Merkle proof siblings
    signal input pathIndices[levels];   // Merkle proof path (0=left, 1=right)

    // 1. Compute identity commitment: Poseidon(secret, salt)
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== secret;
    commitmentHasher.inputs[1] <== salt;
    signal commitment <== commitmentHasher.out;

    // 2. Verify Merkle tree inclusion
    component merkleProof = MerkleTreeInclusionProof(levels);
    merkleProof.leaf <== commitment;
    for (var i = 0; i < levels; i++) {
        merkleProof.pathElements[i] <== pathElements[i];
        merkleProof.pathIndices[i] <== pathIndices[i];
    }

    // Constrain computed root to match public root
    root === merkleProof.root;

    // 3. Compute nullifier: Poseidon(secret, daoId, proposalId)
    // Domain separation: includes daoId to prevent cross-DAO nullifier linkability
    // This ensures a voter can't be linked across DAOs even if reusing the same secret
    component nullifierHasher = Poseidon(3);
    nullifierHasher.inputs[0] <== secret;
    nullifierHasher.inputs[1] <== daoId;
    nullifierHasher.inputs[2] <== proposalId;

    // Constrain computed nullifier to match public nullifier
    nullifier === nullifierHasher.out;

    // 4. Verify vote choice is binary (0 or 1)
    voteChoice * (voteChoice - 1) === 0;
}

// Default tree depth of 18 (supports ~262K members)
component main {public [root, nullifier, daoId, proposalId, voteChoice]} = Vote(18);
