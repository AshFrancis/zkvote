#![no_std]
#[allow(unused_imports)]
use soroban_sdk::{
    contract, contractimpl, contracttype,
    crypto::bn254::{Fr, G1Affine, G2Affine},
    symbol_short, Address, Bytes, BytesN, Env, IntoVal, String, Symbol, Vec, U256,
};

const TREE_CONTRACT: Symbol = symbol_short!("tree");

// Maximum allowed IC vector length (num_public_inputs + 1)
// Our circuit has 5 public signals, so IC should have 6 elements
// Allow some slack for future upgrades (up to 20 public inputs)
const MAX_IC_LENGTH: u32 = 21;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Proposal(u64, u64),           // (dao_id, proposal_id) -> ProposalInfo
    ProposalCount(u64),           // dao_id -> count
    Nullifier(u64, u64, U256),    // (dao_id, proposal_id, nullifier) -> bool
    VotingKey(u64),               // dao_id -> VerificationKey
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
    pub vk_hash: BytesN<32>,     // SHA256 hash of VK at proposal creation
    pub eligible_root: U256,      // Merkle root at creation - defines eligible voter set
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
        // IC vector must have at least 1 element (for IC[0]) and at most MAX_IC_LENGTH
        if vk.ic.is_empty() {
            panic!("VK IC vector cannot be empty");
        }
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
    ) -> u64 {
        creator.require_auth();

        // Verify creator has SBT membership (via tree contract)
        let tree_contract: Address = env.storage().instance().get(&TREE_CONTRACT).unwrap();
        let sbt_contract: Address = env.invoke_contract(
            &tree_contract,
            &symbol_short!("sbt_contr"),
            soroban_sdk::vec![&env],
        );

        let has_sbt: bool = env.invoke_contract(
            &sbt_contract,
            &symbol_short!("has"),
            soroban_sdk::vec![&env, dao_id.into_val(&env), creator.clone().into_val(&env)],
        );

        if !has_sbt {
            panic!("not DAO member");
        }

        let now = env.ledger().timestamp();

        // Validate end_time is in the future
        if end_time <= now {
            panic!("end time must be in the future");
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

        let proposal_id = Self::next_proposal_id(&env, dao_id);

        let proposal = ProposalInfo {
            id: proposal_id,
            dao_id,
            description: description.clone(),
            yes_votes: 0,
            no_votes: 0,
            end_time,
            created_by: creator.clone(),
            vk_hash,
            eligible_root,
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
        proof: Proof,
    ) {
        // Get proposal
        let prop_key = DataKey::Proposal(dao_id, proposal_id);
        let mut proposal: ProposalInfo = env
            .storage()
            .persistent()
            .get(&prop_key)
            .expect("proposal not found");

        // Check voting period (voting starts at creation, ends at end_time)
        let now = env.ledger().timestamp();
        if now > proposal.end_time {
            panic!("voting period closed");
        }

        // Check nullifier not used (prevent double voting)
        let null_key = DataKey::Nullifier(dao_id, proposal_id, nullifier.clone());
        if env.storage().persistent().has(&null_key) {
            panic!("already voted");
        }

        // Verify root matches the eligible voter set from proposal creation
        // This prevents sybil attacks where members are added after proposal creation
        if root != proposal.eligible_root {
            panic!("root must match proposal eligible root");
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
        // Public signals: [root, nullifier, daoId, proposalId, voteChoice]
        // Note: daoId is included for domain separation (prevents cross-DAO nullifier linkability)
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
            vote_signal
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
            // Current assumption: We rely on the host function (pairing_check) to validate points.
            // If the host function doesn't validate, this creates attack vectors:
            // - Invalid curve attacks (points not on BN254)
            // - Small subgroup attacks (for G2, cofactor > 1)
            //
            // TODO (before mainnet): Add explicit validation:
            // 1. For G1: Check y² = x³ + 3 (mod p) - [cofactor=1, so this suffices]
            // 2. For G2: Check curve membership + subgroup check via endomorphism
            //    ([x+1]P + ψ([x]P) + ψ²(xP) = ψ³([2x]P) where x = BN254 seed)
            //
            // References:
            // - Besu CVE: Missing curve check before subgroup check allowed invalid points
            // - Fast G2 check: https://ethresear.ch/t/fast-mathbb-g-2-subgroup-check-in-bn254/13974
            // - See audit.md for implementation plan

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
    #[cfg(not(any(test, feature = "testutils")))]
    fn g1_negate(env: &Env, point: &BytesN<64>) -> BytesN<64> {
        let bytes = point.to_array();

        // BN254 base field modulus (Fq)
        // p = 21888242871839275222246405745257275088696311157297823662689037894645226208583
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
        let neg_y = Self::field_subtract(&field_modulus, &y);

        // Construct negated point
        let mut result = [0u8; 64];
        result[0..32].copy_from_slice(&x);
        result[32..64].copy_from_slice(&neg_y);

        BytesN::from_array(env, &result)
    }

    // Subtract two 256-bit big-endian numbers: a - b
    #[cfg(not(any(test, feature = "testutils")))]
    fn field_subtract(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
        let mut result = [0u8; 32];
        let mut borrow: u16 = 0;

        // Subtract from least significant byte (index 31) to most significant (index 0)
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
