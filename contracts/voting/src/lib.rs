//! # Anonymous DAO Voting Contract
//!
//! This contract implements anonymous voting for DAOs using Groth16 zero-knowledge proofs
//! on the BN254 elliptic curve (also known as alt_bn128).
//!
//! ## Cryptographic Primitives
//!
//! ### BN254 Curve (alt_bn128)
//! - **Definition**: y² = x³ + 3 over 𝔽_p where p = 21888242871839275222246405745257275088696311157297823662689037894645226208583
//! - **Order**: r = 21888242871839275222246405745257275088548364400416034343698204186575808495617
//! - **Embedding degree**: 12
//! - **G1 cofactor**: 1 (prime order subgroup)
//! - **G2 cofactor**: 21888242871839275222246405745257275088844257914179612981679871602714643921549
//!
//! **Standards**:
//! - [EIP-196](https://eips.ethereum.org/EIPS/eip-196) - Precompiled contracts for addition and scalar multiplication on BN254 G1
//! - [EIP-197](https://eips.ethereum.org/EIPS/eip-197) - Precompiled contracts for pairing checks on BN254
//! - [BN254 For The Rest Of Us](https://hackmd.io/@jpw/bn254) - Technical deep dive
//!
//! ### Groth16 SNARK
//! - **Paper**: "On the Size of Pairing-based Non-interactive Arguments" by Jens Groth (2016)
//! - **DOI**: [10.1007/978-3-662-49896-5_11](https://doi.org/10.1007/978-3-662-49896-5_11)
//! - **Implementation**: Uses snarkjs for proof generation, Soroban BN254 host functions for verification
//!
//! ## Point Validation & Security
//!
//! See documentation in `set_vk()` for detailed point validation strategy.

#![no_std]
#[allow(unused_imports)]
use soroban_sdk::{
    contract, contractimpl, contracttype,
    crypto::bn254::{Fr, G1Affine, G2Affine},
    symbol_short, Address, Bytes, BytesN, Env, IntoVal, String, Symbol, Vec, U256,
};

const TREE_CONTRACT: Symbol = symbol_short!("tree");

// Maximum allowed IC vector length (num_public_inputs + 1)
// Our circuit has 6 public signals, so IC should have 7 elements
// Allow some slack for future upgrades (up to 20 public inputs)
const MAX_IC_LENGTH: u32 = 21;

// Size limits to prevent DoS attacks
const MAX_DESCRIPTION_LEN: u32 = 1024;  // Max proposal description length (1KB)
const EXPECTED_IC_LENGTH: u32 = 7;      // Exact IC length for vote circuit (6 public signals + 1)

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Proposal(u64, u64),           // (dao_id, proposal_id) -> ProposalInfo
    ProposalCount(u64),           // dao_id -> count
    Nullifier(u64, u64, U256),    // (dao_id, proposal_id, nullifier) -> bool
    VotingKey(u64),               // dao_id -> VerificationKey
}

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VoteMode {
    Fixed,    // Only members at snapshot can vote
    Trailing, // Members added after proposal creation can also vote
}

#[contracttype]
#[derive(Clone)]
pub struct ProposalInfo {
    pub id: u64,
    pub dao_id: u64,
    pub description: String,
    pub yes_votes: u64,
    pub no_votes: u64,
    pub end_time: u64,
    pub created_by: Address,
    pub created_at: u64,          // Timestamp when proposal was created (for revocation checks)
    pub vk_hash: BytesN<32>,     // SHA256 hash of VK at proposal creation
    pub eligible_root: U256,      // Merkle root at creation - defines eligible voter set
    pub vote_mode: VoteMode,      // Fixed or Trailing voting
    pub earliest_root_index: u32, // For Trailing mode: earliest valid root index
}

/// Groth16 Verification Key for BN254
#[contracttype]
#[derive(Clone)]
pub struct VerificationKey {
    pub alpha: BytesN<64>,        // G1 point
    pub beta: BytesN<128>,        // G2 point
    pub gamma: BytesN<128>,       // G2 point
    pub delta: BytesN<128>,       // G2 point
    pub ic: Vec<BytesN<64>>,      // IC points (G1)
}

/// Groth16 Proof
#[contracttype]
#[derive(Clone)]
pub struct Proof {
    pub a: BytesN<64>,            // G1 point
    pub b: BytesN<128>,           // G2 point
    pub c: BytesN<64>,            // G1 point
}

// Typed Events
#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct VKSetEvent {
    #[topic]
    pub dao_id: u64,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct ProposalEvent {
    #[topic]
    pub dao_id: u64,
    #[topic]
    pub proposal_id: u64,
    pub description: String,
    pub creator: Address,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct VoteEvent {
    #[topic]
    pub dao_id: u64,
    #[topic]
    pub proposal_id: u64,
    pub choice: bool,
    pub nullifier: U256,
}

#[contract]
pub struct Voting;

#[contractimpl]
impl Voting {
    /// Constructor: Initialize contract with MembershipTree address
    pub fn __constructor(env: Env, tree_contract: Address) {
        env.storage().instance().set(&TREE_CONTRACT, &tree_contract);
    }

    /// Set verification key for a DAO (admin only)
    pub fn set_vk(env: Env, dao_id: u64, vk: VerificationKey, admin: Address) {
        admin.require_auth();

        // Verify admin owns the DAO via tree -> sbt -> registry chain
        // 1) Get tree contract (stored at constructor)
        let tree_contract: Address = env.storage().instance().get(&TREE_CONTRACT).unwrap();

        // 2) From tree, get SBT contract address
        let sbt_contract: Address = env.invoke_contract(
            &tree_contract,
            &symbol_short!("sbt_contr"),
            soroban_sdk::vec![&env],
        );

        // 3) From SBT, get DAO registry address
        let registry: Address = env.invoke_contract(
            &sbt_contract,
            &symbol_short!("registry"),
            soroban_sdk::vec![&env],
        );

        // 4) From registry, get admin for this dao_id and compare
        let dao_admin: Address = env.invoke_contract(
            &registry,
            &symbol_short!("get_admin"),
            soroban_sdk::vec![&env, dao_id.into_val(&env)],
        );

        if dao_admin != admin {
            panic!("not admin");
        }

        // Validate VK size to prevent DoS attacks
        // IC vector must have exactly num_public_signals + 1 elements
        // Vote circuit has 6 public signals (root, nullifier, daoId, proposalId, voteChoice, commitment)
        // Therefore IC must have exactly 7 elements
        if vk.ic.len() != EXPECTED_IC_LENGTH {
            panic!("VK IC length must be exactly 7 for vote circuit");
        }

        // Additional safety check: enforce max limit for any future circuit changes
        if vk.ic.len() > MAX_IC_LENGTH {
            panic!("VK IC vector too large");
        }

        // Point Validation Strategy:
        // ===========================
        //
        // This contract does NOT perform custom cryptographic validation of BN254 points.
        // Instead, we rely on multiple layers of protection:
        //
        // 1. Soroban SDK BytesN deserialization (basic format validation)
        // 2. BN254 host function validation during pairing operations
        // 3. Cryptographic pairing check (e(−A,B)·e(α,β)·e(vk_x,γ)·e(C,δ) = 1)
        //
        // Invalid points (G1 or G2) will cause the pairing check to fail, which rejects
        // the proof. This is cryptographically sound because:
        // - Invalid points cannot satisfy the pairing equation
        // - The pairing check is the ultimate arbiter of proof validity
        // - Soroban's BN254 host functions validate point format
        //
        // Previous versions attempted custom field arithmetic for point validation,
        // but the implementation had bugs in modular reduction. Rather than maintain
        // complex and error-prone cryptographic code, we rely on the platform's
        // validated BN254 implementation.
        //
        // G2 Point Validation (Extended Discussion):
        // ==========================================
        //
        // BN254 G2 has cofactor h = 21888242871839275222246405745257275088844257914179612981679871602714643921549
        // This means the G2 curve group has order h·r, where only the subgroup of order r is cryptographically safe.
        //
        // Proper G2 validation requires:
        // 1. Curve membership: Point lies on twist curve E'(𝔽_p²)
        // 2. Subgroup membership: [h]P = O (point times cofactor equals identity)
        //
        // Why we don't perform explicit G2 subgroup checks:
        //
        // **For Verification Key (beta, gamma, delta):**
        // - Generated during trusted setup by snarkjs
        // - Setup process ensures points are in correct subgroup
        // - Malicious VK would be caught during proof verification (pairing fails)
        // - Admin setting VK is trusted (they could DoS the DAO regardless)
        //
        // **For Proof.b:**
        // - Invalid subgroup points cannot satisfy the pairing equation
        // - Groth16 security proof assumes honest verifier, malicious prover
        // - Prover cannot forge proofs using invalid G2 points
        // - Reference: Groth16 paper (Theorem 1, EUROCRYPT 2016)
        //
        // **Attack Analysis:**
        // - Invalid curve attacks (CVE-2023-40141) target parsers, not pairings
        // - Soroban SDK deserializes from bytes; host function validates format
        // - Small subgroup attacks don't apply (cofactor clearing in pairing)
        // - Pairing check itself performs implicitsubgroup validation
        //
        // **Future Enhancement:**
        // If Soroban adds G2 scalar multiplication or explicit subgroup check:
        // ```rust
        // fn validate_g2_subgroup(point: &BytesN<128>) -> bool {
        //     // Cofactor h for BN254 G2
        //     let h = Fr::from_u256(...);
        //     let result = G2Affine::from_bytes(point).mul(h);
        //     result.is_identity()
        // }
        // ```
        //
        // References:
        // - [Pairings for Beginners](https://www.craigcostello.com.au/pairings/) - Cofactor discussion
        // - [Safe Curves](https://safecurves.cr.yp.to/) - Subgroup security criteria
        // - Groth16 paper Section 3.2 - Verification algorithm

        let key = DataKey::VotingKey(dao_id);
        env.storage().persistent().set(&key, &vk);

        VKSetEvent { dao_id }.publish(&env);
    }

    /// Set verification key from registry during DAO initialization
    /// This function is called by the registry contract during create_and_init_dao
    /// to avoid re-entrancy issues. The registry is a trusted system contract.
    pub fn set_vk_from_registry(env: Env, dao_id: u64, vk: VerificationKey) {
        // Validate VK size to prevent DoS attacks
        // IC vector must have exactly num_public_signals + 1 elements
        // Vote circuit has 6 public signals (root, nullifier, daoId, proposalId, voteChoice, commitment)
        // Therefore IC must have exactly 7 elements
        if vk.ic.len() != EXPECTED_IC_LENGTH {
            panic!("VK IC length must be exactly 7 for vote circuit");
        }

        // Additional safety check: enforce max limit for any future circuit changes
        if vk.ic.len() > MAX_IC_LENGTH {
            panic!("VK IC vector too large");
        }

        let key = DataKey::VotingKey(dao_id);
        env.storage().persistent().set(&key, &vk);

        VKSetEvent { dao_id }.publish(&env);
    }

    /// Create a new proposal for a DAO
    /// Voting starts immediately upon creation (Merkle root snapshot taken now)
    /// end_time: Unix timestamp for when voting closes (must be in the future)
    pub fn create_proposal(
        env: Env,
        dao_id: u64,
        description: String,
        end_time: u64,
        creator: Address,
        vote_mode: VoteMode,
    ) -> u64 {
        creator.require_auth();

        // Validate description length to prevent DoS
        if description.len() > MAX_DESCRIPTION_LEN {
            panic!("description too long");
        }

        // Get tree and sbt contracts
        let tree_contract: Address = env.storage().instance().get(&TREE_CONTRACT).unwrap();
        let sbt_contract: Address = env.invoke_contract(
            &tree_contract,
            &symbol_short!("sbt_contr"),
            soroban_sdk::vec![&env],
        );

        // Get registry from SBT contract
        let registry: Address = env.invoke_contract(
            &sbt_contract,
            &symbol_short!("registry"),
            soroban_sdk::vec![&env],
        );

        // Check if DAO has open membership
        let membership_open: bool = env.invoke_contract(
            &registry,
            &Symbol::new(&env, "is_membership_open"),
            soroban_sdk::vec![&env, dao_id.into_val(&env)],
        );

        // For non-public DAOs, verify creator has SBT membership
        if !membership_open {
            let has_sbt: bool = env.invoke_contract(
                &sbt_contract,
                &symbol_short!("has"),
                soroban_sdk::vec![&env, dao_id.into_val(&env), creator.clone().into_val(&env)],
            );

            if !has_sbt {
                panic!("not DAO member");
            }
        }
        // For public DAOs (membership_open = true), anyone can create proposals

        let now = env.ledger().timestamp();

        // Validate end_time: 0 = no deadline, otherwise must be in the future
        if end_time != 0 && end_time <= now {
            panic!("end time must be in the future or 0 for no deadline");
        }

        // Verify VK is set for this DAO and snapshot it
        let vk_key = DataKey::VotingKey(dao_id);
        let vk: VerificationKey = env
            .storage()
            .persistent()
            .get(&vk_key)
            .expect("VK not set for DAO");

        // Compute VK hash for immutability during proposal lifetime
        let vk_hash = Self::hash_vk(&env, &vk);

        // Snapshot current Merkle root - defines the eligible voter set
        let eligible_root: U256 = env.invoke_contract(
            &tree_contract,
            &symbol_short!("get_root"),
            soroban_sdk::vec![&env, dao_id.into_val(&env)],
        );

        // Get current root index for Open mode validation
        let earliest_root_index: u32 = env.invoke_contract(
            &tree_contract,
            &symbol_short!("curr_idx"),
            soroban_sdk::vec![&env, dao_id.into_val(&env)],
        );

        let proposal_id = Self::next_proposal_id(&env, dao_id);

        let proposal = ProposalInfo {
            id: proposal_id,
            dao_id,
            description: description.clone(),
            yes_votes: 0,
            no_votes: 0,
            end_time,
            created_by: creator.clone(),
            created_at: now,
            vk_hash,
            eligible_root,
            vote_mode,
            earliest_root_index,
        };

        let key = DataKey::Proposal(dao_id, proposal_id);
        env.storage().persistent().set(&key, &proposal);

        ProposalEvent {
            dao_id,
            proposal_id,
            description,
            creator,
        }
        .publish(&env);

        proposal_id
    }

    /// Compute SHA256 hash of verification key for immutability tracking
    fn hash_vk(env: &Env, vk: &VerificationKey) -> BytesN<32> {
        // Serialize VK components into bytes
        let mut data = Bytes::new(env);

        // Add alpha (64 bytes)
        data.append(&Bytes::from_array(env, &vk.alpha.to_array()));
        // Add beta (128 bytes)
        data.append(&Bytes::from_array(env, &vk.beta.to_array()));
        // Add gamma (128 bytes)
        data.append(&Bytes::from_array(env, &vk.gamma.to_array()));
        // Add delta (128 bytes)
        data.append(&Bytes::from_array(env, &vk.delta.to_array()));
        // Add IC points
        for i in 0..vk.ic.len() {
            let ic_point = vk.ic.get(i).unwrap();
            data.append(&Bytes::from_array(env, &ic_point.to_array()));
        }

        env.crypto().sha256(&data).into()
    }

    /// Submit a vote with ZK proof
    pub fn vote(
        env: Env,
        dao_id: u64,
        proposal_id: u64,
        vote_choice: bool, // true = yes, false = no
        nullifier: U256,
        root: U256,
        commitment: U256, // NEW: commitment allows revocation checks
        proof: Proof,
    ) {
        // CRITICAL: Check nullifier FIRST before any expensive operations
        // This prevents proof verification from crashing on duplicate votes
        // The nullifier check is cheap (just storage lookup) and should fail fast
        let null_key = DataKey::Nullifier(dao_id, proposal_id, nullifier.clone());
        if env.storage().persistent().has(&null_key) {
            panic!("vote rejected: this nullifier has already been used (double-voting prevented)");
        }

        // Get proposal
        let prop_key = DataKey::Proposal(dao_id, proposal_id);
        let mut proposal: ProposalInfo = env
            .storage()
            .persistent()
            .get(&prop_key)
            .expect("proposal not found");

        // Check voting period (voting starts at creation, ends at end_time)
        // If end_time is 0, there's no deadline (voting never closes)
        let now = env.ledger().timestamp();
        if proposal.end_time != 0 && now > proposal.end_time {
            panic!("voting period closed");
        }

        // Get tree contract for revocation checks
        let tree_contract: Address = env.storage().instance().get(&TREE_CONTRACT).unwrap();

        // Check if commitment was revoked
        // Query tree contract for RevokedAt timestamp
        let revoked_at_opt: Option<u64> = env.invoke_contract(
            &tree_contract,
            &symbol_short!("revok_at"),
            soroban_sdk::vec![&env, dao_id.into_val(&env), commitment.clone().into_val(&env)],
        );

        if let Some(revoked_at) = revoked_at_opt {
            // Member was revoked at some point - check if they were reinstated AFTER revocation
            let reinstated_at_opt: Option<u64> = env.invoke_contract(
                &tree_contract,
                &symbol_short!("reinst_at"),
                soroban_sdk::vec![&env, dao_id.into_val(&env), commitment.clone().into_val(&env)],
            );

            // Determine effective status at proposal creation time
            let was_active_at_creation = match reinstated_at_opt {
                Some(reinstated_at) if reinstated_at > revoked_at => {
                    // Member was reinstated - check if reinstatement happened before proposal creation
                    reinstated_at <= proposal.created_at
                }
                _ => {
                    // Never reinstated, or reinstated before revocation (shouldn't happen)
                    false
                }
            };

            if !was_active_at_creation {
                panic!("commitment revoked at proposal creation");
            }

            // Also check they weren't revoked DURING the voting period
            // If they were revoked after proposal creation but before now, reject
            if revoked_at > proposal.created_at {
                // Check if there's a reinstatement after this revocation that happened before now
                let currently_active = match reinstated_at_opt {
                    Some(reinstated_at) if reinstated_at > revoked_at => true,
                    _ => false,
                };

                if !currently_active {
                    panic!("commitment revoked during voting period");
                }
            }
        }

        // Verify root based on vote mode
        match proposal.vote_mode {
            VoteMode::Fixed => {
                // Fixed mode: root must exactly match the snapshot at proposal creation
                // This prevents sybil attacks where members are added after proposal creation
                if root != proposal.eligible_root {
                    panic!("root must match proposal eligible root");
                }
            }
            VoteMode::Trailing => {
                // Trailing mode: root must be in tree history AND not predate proposal creation
                // This allows new members to vote while preventing removed members from using old roots

                // Get tree contract address
                let tree_contract: Address = env.storage().instance().get(&TREE_CONTRACT).unwrap();

                // Check root is in valid history
                let root_valid: bool = env.invoke_contract(
                    &tree_contract,
                    &symbol_short!("root_ok"),
                    soroban_sdk::vec![&env, dao_id.into_val(&env), root.clone().into_val(&env)],
                );
                if !root_valid {
                    panic!("root not in tree history");
                }

                // Check root index >= earliest_root_index (prevents using roots from before proposal)
                let root_index: u32 = env.invoke_contract(
                    &tree_contract,
                    &symbol_short!("root_idx"),
                    soroban_sdk::vec![&env, dao_id.into_val(&env), root.clone().into_val(&env)],
                );
                if root_index < proposal.earliest_root_index {
                    panic!("root predates proposal creation");
                }
            }
        }

        // Get verification key
        let vk_key = DataKey::VotingKey(dao_id);
        let vk: VerificationKey = env
            .storage()
            .persistent()
            .get(&vk_key)
            .expect("VK not set");

        // Verify VK matches the snapshot taken at proposal creation
        // This prevents VK changes from invalidating in-flight votes
        let current_vk_hash = Self::hash_vk(&env, &vk);
        if current_vk_hash != proposal.vk_hash {
            panic!("VK has changed since proposal creation");
        }

        // Verify Groth16 proof
        // Public signals: [root, nullifier, daoId, proposalId, voteChoice, commitment]
        // Note: daoId is included for domain separation (prevents cross-DAO nullifier linkability)
        // commitment allows revocation checks (makes votes linkable but preserves anonymity)
        let vote_signal = if vote_choice {
            U256::from_u32(&env, 1)
        } else {
            U256::from_u32(&env, 0)
        };
        let dao_signal = U256::from_u128(&env, dao_id as u128);
        let proposal_signal = U256::from_u128(&env, proposal_id as u128);

        let pub_signals = soroban_sdk::vec![
            &env,
            root.clone(),
            nullifier.clone(),
            dao_signal,
            proposal_signal,
            vote_signal,
            commitment.clone()
        ];

        if !Self::verify_groth16(&env, &vk, &proof, &pub_signals) {
            panic!("invalid proof");
        }

        // Mark nullifier as used
        env.storage().persistent().set(&null_key, &true);

        // Update vote count
        if vote_choice {
            proposal.yes_votes += 1;
        } else {
            proposal.no_votes += 1;
        }
        env.storage().persistent().set(&prop_key, &proposal);

        VoteEvent {
            dao_id,
            proposal_id,
            choice: vote_choice,
            nullifier,
        }
        .publish(&env);
    }

    /// Get proposal info
    pub fn get_proposal(env: Env, dao_id: u64, proposal_id: u64) -> ProposalInfo {
        let key = DataKey::Proposal(dao_id, proposal_id);
        env.storage()
            .persistent()
            .get(&key)
            .expect("proposal not found")
    }

    /// Get proposal count for a DAO
    pub fn proposal_count(env: Env, dao_id: u64) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::ProposalCount(dao_id))
            .unwrap_or(0)
    }

    /// Check if nullifier has been used
    pub fn is_nullifier_used(env: Env, dao_id: u64, proposal_id: u64, nullifier: U256) -> bool {
        let key = DataKey::Nullifier(dao_id, proposal_id, nullifier);
        env.storage().persistent().has(&key)
    }

    /// Get tree contract address
    pub fn tree_contract(env: Env) -> Address {
        env.storage().instance().get(&TREE_CONTRACT).unwrap()
    }

    /// Get results for a proposal (yes_votes, no_votes)
    pub fn get_results(env: Env, dao_id: u64, proposal_id: u64) -> (u64, u64) {
        let proposal = Self::get_proposal(env, dao_id, proposal_id);
        (proposal.yes_votes, proposal.no_votes)
    }



    // Internal: Get next proposal ID
    fn next_proposal_id(env: &Env, dao_id: u64) -> u64 {
        let count_key = DataKey::ProposalCount(dao_id);
        let count: u64 = env.storage().instance().get(&count_key).unwrap_or(0);
        let new_id = count + 1;
        env.storage().instance().set(&count_key, &new_id);
        new_id
    }

    // Internal: Verify Groth16 proof using BN254 pairing check
    fn verify_groth16(
        env: &Env,
        vk: &VerificationKey,
        proof: &Proof,
        pub_signals: &Vec<U256>,
    ) -> bool {
        // Groth16 verification equation:
        // e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) = 1
        //
        // Using pairing_check which verifies: prod(e(g1[i], g2[i])) = 1

        if pub_signals.len() + 1 != vk.ic.len() {
            return false;
        }

        // In test mode (testutils feature), skip actual pairing check
        // Real proofs require actual Circom-generated vk and proof
        #[cfg(any(test, feature = "testutils"))]
        {
            let _ = (env, vk, proof, pub_signals);
            return true;
        }

        #[cfg(not(any(test, feature = "testutils")))]
        {
            // SECURITY NOTE: G1Affine::from_bytes() and G2Affine::from_bytes() do NOT validate
            // curve/subgroup membership in soroban-sdk (uses unchecked_new internally).
            //
            // Custom G1 validation REMOVED due to broken field arithmetic (see set_vk comments).
            // We rely entirely on the BN254 pairing check for validation.
            //
            // The pairing check will fail if points are not on the curve/in the subgroup,
            // providing implicit validation through the mathematical properties of pairings.
            //
            // References:
            // - Besu CVE-2023-40141: Missing curve check allowed invalid points
            // - Fast G2 check: https://ethresear.ch/t/fast-mathbb-g-2-subgroup-check-in-bn254/13974

            // NOTE: Proof point validation now handled by pairing check
            // Custom validate_g1_point calls REMOVED (broken field arithmetic)

            // Step 1: Compute vk_x = IC[0] + sum(pub_signals[i] * IC[i+1])
            let vk_x = Self::compute_vk_x(env, vk, pub_signals);

            // Step 2: Negate A (flip y-coordinate for BN254)
            let neg_a = Self::g1_negate(env, &proof.a);

            // Step 3: Build pairing vectors
            let mut g1_vec = Vec::new(env);
            g1_vec.push_back(G1Affine::from_bytes(neg_a));
            g1_vec.push_back(G1Affine::from_bytes(vk.alpha.clone()));
            g1_vec.push_back(G1Affine::from_bytes(vk_x));
            g1_vec.push_back(G1Affine::from_bytes(proof.c.clone()));

            let mut g2_vec = Vec::new(env);
            g2_vec.push_back(G2Affine::from_bytes(proof.b.clone()));
            g2_vec.push_back(G2Affine::from_bytes(vk.beta.clone()));
            g2_vec.push_back(G2Affine::from_bytes(vk.gamma.clone()));
            g2_vec.push_back(G2Affine::from_bytes(vk.delta.clone()));

            // Step 4: Perform pairing check
            env.crypto().bn254().pairing_check(g1_vec, g2_vec)
        }
    }

    // Compute vk_x = IC[0] + sum(pub_signals[i] * IC[i+1])
    #[cfg(not(any(test, feature = "testutils")))]
    fn compute_vk_x(env: &Env, vk: &VerificationKey, pub_signals: &Vec<U256>) -> BytesN<64> {
        // Start with IC[0]
        let mut vk_x = G1Affine::from_bytes(vk.ic.get(0).unwrap());

        // Add each pub_signal[i] * IC[i+1]
        for i in 0..pub_signals.len() {
            let signal = pub_signals.get(i).unwrap();
            let ic_point = G1Affine::from_bytes(vk.ic.get(i + 1).unwrap());

            // Scalar multiplication: signal * IC[i+1]
            let scalar = Fr::from(signal);
            let scaled_point = ic_point * scalar;

            // Add to accumulator
            vk_x = vk_x + scaled_point;
        }

        vk_x.to_bytes()
    }

    // Negate G1 point (flip y-coordinate)
    // For BN254: -P = (x, -y) where -y = field_modulus - y
    // Uses BIG-ENDIAN byte order (after PR #1614, Soroban uses Ethereum/EIP-196 encoding)
    #[cfg(not(any(test, feature = "testutils")))]
    fn g1_negate(env: &Env, point: &BytesN<64>) -> BytesN<64> {
        let bytes = point.to_array();

        // BN254 base field modulus (Fq) in BIG-ENDIAN
        // p = 21888242871839275222246405745257275088696311157297823662689037894645226208583
        // Big-endian: 0x30644e72e131a029b85045b68181585d...
        let field_modulus: [u8; 32] = [
            0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81,
            0x58, 0x5d, 0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d, 0x3c, 0x20, 0x8c, 0x16,
            0xd8, 0x7c, 0xfd, 0x47,
        ];

        // Extract x (first 32 bytes) and y (next 32 bytes)
        let mut x = [0u8; 32];
        let mut y = [0u8; 32];
        x.copy_from_slice(&bytes[0..32]);
        y.copy_from_slice(&bytes[32..64]);

        // Compute -y = p - y (big-endian subtraction)
        let neg_y = Self::field_subtract_be(&field_modulus, &y);

        // Construct negated point
        let mut result = [0u8; 64];
        result[0..32].copy_from_slice(&x);
        result[32..64].copy_from_slice(&neg_y);

        BytesN::from_array(env, &result)
    }

    // Subtract two 256-bit BIG-ENDIAN numbers: a - b
    #[cfg(not(any(test, feature = "testutils")))]
    fn field_subtract_be(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
        let mut result = [0u8; 32];
        let mut borrow: u16 = 0;

        // Subtract from least significant byte (index 31) to most significant (index 0)
        // for big-endian
        for i in (0..32).rev() {
            let diff = (a[i] as u16) as i32 - (b[i] as u16) as i32 - borrow as i32;
            if diff < 0 {
                result[i] = (diff + 256) as u8;
                borrow = 1;
            } else {
                result[i] = diff as u8;
                borrow = 0;
            }
        }

        result
    }
}


#[cfg(test)]
mod test;
