//! # Anonymous Comments Contract
//!
//! This contract implements anonymous commenting for DAO proposals using Groth16
//! zero-knowledge proofs on the BN254 elliptic curve.
//!
//! This contract uses the SAME vote circuit as the voting contract. The key insight
//! is that nullifier uniqueness is a CONTRACT-level concern, not a circuit concern:
//! - Vote contract: enforces nullifier uniqueness (one vote per user per proposal)
//! - Comment contract: just verifies proof for membership (allows multiple comments)
//!
//! ## Public Signals (Vote Circuit - shared with voting contract)
//! [root, nullifier, daoId, proposalId, voteChoice, commitment]
//!
//! The voteChoice signal is ignored for comments - we just verify membership.

#![no_std]
#[allow(unused_imports)]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bn254::{Fr, G1Affine, G2Affine},
    panic_with_error, symbol_short, Address, Bytes, BytesN, Env, IntoVal, String, Symbol, Vec,
    U256,
};

const TREE_CONTRACT: Symbol = symbol_short!("tree");
const VERSION: u32 = 2;
const VERSION_KEY: Symbol = symbol_short!("ver");

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum CommentsError {
    NotAdmin = 1,
    Unauthorized = 19,
    NotDaoMember = 5,
    CommitmentRevoked = 9,
    RootNotInHistory = 12,
    InvalidProof = 15,
    ContractNotSet = 16,
    AlreadyInitialized = 18,
    CommentNotFound = 22,
    CommentDeleted = 23,
    NotCommentOwner = 24,
    InvalidParentComment = 25,
    CommentContentTooLong = 27,
    ProposalNotFound = 28,
    RootMismatch = 29,        // Fixed mode: root must match proposal snapshot
    RootPredatesProposal = 30, // Trailing mode: root is too old
}

/// Vote mode for proposal eligibility (mirrors voting contract)
#[contracttype]
#[derive(Clone, PartialEq)]
pub enum VoteMode {
    Fixed,    // Only members at snapshot can comment
    Trailing, // Members added after proposal creation can also comment
}

// Size limits
const MAX_CID_LEN: u32 = 64;
const MAX_REVISIONS: u32 = 50;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Comment(u64, u64, u64),           // (dao_id, proposal_id, comment_id) -> CommentInfo
    CommentCount(u64, u64),           // (dao_id, proposal_id) -> comment count
    CommentNullifier(u64, u64, U256), // (dao_id, proposal_id, nullifier) -> bool (for duplicate detection)
    CommitmentNonce(u64, u64, U256),  // (dao_id, proposal_id, commitment) -> next nonce for this commitment
    VotingContract,                   // Address of voting contract for proposal lookups and VK
}

/// Who deleted a comment
pub const DELETED_BY_NONE: u32 = 0;
pub const DELETED_BY_USER: u32 = 1;
pub const DELETED_BY_ADMIN: u32 = 2;

/// Comment on a proposal
#[contracttype]
#[derive(Clone)]
pub struct CommentInfo {
    pub id: u64,
    pub dao_id: u64,
    pub proposal_id: u64,
    pub author: Option<Address>,
    pub content_cid: String,
    pub parent_id: Option<u64>,
    pub created_at: u64,
    pub updated_at: u64,
    pub revision_cids: Vec<String>,
    pub deleted: bool,
    pub deleted_by: u32,
    pub nullifier: Option<U256>,
    pub comment_nonce: Option<u64>, // For anonymous comments, tracks which nonce was used
}

/// Groth16 Verification Key for BN254
#[contracttype]
#[derive(Clone)]
pub struct VerificationKey {
    pub alpha: BytesN<64>,
    pub beta: BytesN<128>,
    pub gamma: BytesN<128>,
    pub delta: BytesN<128>,
    pub ic: Vec<BytesN<64>>,
}

/// Groth16 Proof
#[contracttype]
#[derive(Clone)]
pub struct Proof {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}

// Events
#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct CommentCreatedEvent {
    #[topic]
    pub dao_id: u64,
    #[topic]
    pub proposal_id: u64,
    pub comment_id: u64,
    pub is_anonymous: bool,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct CommentEditedEvent {
    #[topic]
    pub dao_id: u64,
    #[topic]
    pub proposal_id: u64,
    pub comment_id: u64,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct CommentDeletedEvent {
    #[topic]
    pub dao_id: u64,
    #[topic]
    pub proposal_id: u64,
    pub comment_id: u64,
    pub deleted_by: u32,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct ContractUpgraded {
    pub from: u32,
    pub to: u32,
}

#[contract]
pub struct Comments;

#[contractimpl]
impl Comments {
    /// Constructor: Initialize contract with MembershipTree and Voting contract addresses
    pub fn __constructor(env: Env, tree_contract: Address, voting_contract: Address) {
        if env.storage().instance().has(&VERSION_KEY) {
            panic_with_error!(&env, CommentsError::AlreadyInitialized);
        }

        env.storage().instance().set(&VERSION_KEY, &VERSION);
        ContractUpgraded {
            from: 0,
            to: VERSION,
        }
        .publish(&env);

        env.storage().instance().set(&TREE_CONTRACT, &tree_contract);
        env.storage().instance().set(&DataKey::VotingContract, &voting_contract);
    }

    /// Get VK from voting contract (single source of truth)
    fn get_vk_from_voting(env: &Env, dao_id: u64) -> VerificationKey {
        let voting_contract: Address = Self::voting_contract(env.clone());
        env.invoke_contract(
            &voting_contract,
            &symbol_short!("get_vk"),
            soroban_sdk::vec![env, dao_id.into_val(env)],
        )
    }

    /// Get proposal info from voting contract for eligibility checks
    /// Returns: (vote_mode, eligible_root, earliest_root_index)
    fn get_proposal_eligibility(env: &Env, dao_id: u64, proposal_id: u64) -> (VoteMode, U256, u32) {
        let voting_contract: Address = Self::voting_contract(env.clone());

        // Get vote_mode from proposal
        let vote_mode_val: u32 = env.invoke_contract(
            &voting_contract,
            &Symbol::new(env, "get_vote_mode"),
            soroban_sdk::vec![env, dao_id.into_val(env), proposal_id.into_val(env)],
        );

        let vote_mode = if vote_mode_val == 0 {
            VoteMode::Fixed
        } else {
            VoteMode::Trailing
        };

        // Get eligible_root from proposal
        let eligible_root: U256 = env.invoke_contract(
            &voting_contract,
            &Symbol::new(env, "get_eligible_root"),
            soroban_sdk::vec![env, dao_id.into_val(env), proposal_id.into_val(env)],
        );

        // Get earliest_root_index from proposal
        let earliest_root_index: u32 = env.invoke_contract(
            &voting_contract,
            &Symbol::new(env, "get_earliest_idx"),
            soroban_sdk::vec![env, dao_id.into_val(env), proposal_id.into_val(env)],
        );

        (vote_mode, eligible_root, earliest_root_index)
    }

    /// Validate root matches proposal eligibility (Fixed vs Trailing mode)
    fn validate_root_eligibility(env: &Env, dao_id: u64, proposal_id: u64, root: &U256) {
        let (vote_mode, eligible_root, earliest_root_index) =
            Self::get_proposal_eligibility(env, dao_id, proposal_id);

        let tree_contract: Address = Self::tree_contract(env.clone());

        match vote_mode {
            VoteMode::Fixed => {
                // Fixed mode: root must exactly match the snapshot at proposal creation
                if root != &eligible_root {
                    panic_with_error!(env, CommentsError::RootMismatch);
                }
            }
            VoteMode::Trailing => {
                // Trailing mode: check root is in valid history
                let root_valid: bool = env.invoke_contract(
                    &tree_contract,
                    &symbol_short!("root_ok"),
                    soroban_sdk::vec![env, dao_id.into_val(env), root.clone().into_val(env)],
                );
                if !root_valid {
                    panic_with_error!(env, CommentsError::RootNotInHistory);
                }

                // Check root index >= earliest_root_index
                let root_index: u32 = env.invoke_contract(
                    &tree_contract,
                    &symbol_short!("root_idx"),
                    soroban_sdk::vec![env, dao_id.into_val(env), root.clone().into_val(env)],
                );
                if root_index < earliest_root_index {
                    panic_with_error!(env, CommentsError::RootPredatesProposal);
                }
            }
        }
    }

    fn assert_admin(env: &Env, dao_id: u64, admin: &Address) {
        let tree_contract: Address = Self::tree_contract(env.clone());
        let sbt_contract: Address = env.invoke_contract(
            &tree_contract,
            &symbol_short!("sbt_contr"),
            soroban_sdk::vec![env],
        );
        let registry: Address = env.invoke_contract(
            &sbt_contract,
            &symbol_short!("registry"),
            soroban_sdk::vec![env],
        );
        let dao_admin: Address = env.invoke_contract(
            &registry,
            &symbol_short!("get_admin"),
            soroban_sdk::vec![env, dao_id.into_val(env)],
        );

        if &dao_admin != admin {
            panic_with_error!(env, CommentsError::NotAdmin);
        }
    }

    /// Add a public comment (author is visible)
    pub fn add_comment(
        env: Env,
        dao_id: u64,
        proposal_id: u64,
        content_cid: String,
        parent_id: Option<u64>,
        author: Address,
    ) -> u64 {
        author.require_auth();

        if content_cid.len() > MAX_CID_LEN {
            panic_with_error!(&env, CommentsError::CommentContentTooLong);
        }

        // Check membership
        Self::assert_membership(&env, dao_id, &author);

        // Validate proposal exists (call voting contract)
        Self::assert_proposal_exists(&env, dao_id, proposal_id);

        // Validate parent exists if provided
        if let Some(pid) = parent_id {
            let parent_key = DataKey::Comment(dao_id, proposal_id, pid);
            if !env.storage().persistent().has(&parent_key) {
                panic_with_error!(&env, CommentsError::InvalidParentComment);
            }
        }

        let comment_id = Self::next_comment_id(&env, dao_id, proposal_id);
        let now = env.ledger().timestamp();

        let comment = CommentInfo {
            id: comment_id,
            dao_id,
            proposal_id,
            author: Some(author),
            content_cid,
            parent_id,
            created_at: now,
            updated_at: now,
            revision_cids: Vec::new(&env),
            deleted: false,
            deleted_by: DELETED_BY_NONE,
            nullifier: None,
            comment_nonce: None,
        };

        let key = DataKey::Comment(dao_id, proposal_id, comment_id);
        env.storage().persistent().set(&key, &comment);

        CommentCreatedEvent {
            dao_id,
            proposal_id,
            comment_id,
            is_anonymous: false,
        }
        .publish(&env);

        comment_id
    }

    /// Add an anonymous comment (requires ZK proof with vote circuit)
    /// Uses the same vote circuit as voting - just verifies membership without tracking nullifiers.
    /// This allows multiple comments from the same user (different from voting which enforces uniqueness).
    pub fn add_anonymous_comment(
        env: Env,
        dao_id: u64,
        proposal_id: u64,
        content_cid: String,
        parent_id: Option<u64>,
        nullifier: U256,
        root: U256,
        commitment: U256,
        vote_choice: bool, // From vote circuit - we ignore the value, just verify the proof
        proof: Proof,
    ) -> u64 {
        if content_cid.len() > MAX_CID_LEN {
            panic_with_error!(&env, CommentsError::CommentContentTooLong);
        }

        // NOTE: We intentionally do NOT check nullifier uniqueness for comments!
        // This allows users to post multiple anonymous comments per proposal.
        // The nullifier is still stored with the comment for ownership verification (edit/delete).

        // Validate parent exists if provided
        if let Some(pid) = parent_id {
            let parent_key = DataKey::Comment(dao_id, proposal_id, pid);
            if !env.storage().persistent().has(&parent_key) {
                panic_with_error!(&env, CommentsError::InvalidParentComment);
            }
        }

        // Validate proposal exists
        Self::assert_proposal_exists(&env, dao_id, proposal_id);

        // Validate root eligibility (Fixed vs Trailing mode - matches voting contract logic)
        Self::validate_root_eligibility(&env, dao_id, proposal_id, &root);

        // Get VK from voting contract (single source of truth)
        let vk = Self::get_vk_from_voting(&env, dao_id);

        // Public signals: [root, nullifier, daoId, proposalId, voteChoice, commitment]
        // Same as vote circuit - we just ignore voteChoice value for comments
        let dao_signal = U256::from_u128(&env, dao_id as u128);
        let proposal_signal = U256::from_u128(&env, proposal_id as u128);
        let choice_signal = if vote_choice {
            U256::from_u32(&env, 1)
        } else {
            U256::from_u32(&env, 0)
        };

        let pub_signals = soroban_sdk::vec![
            &env,
            root.clone(),
            nullifier.clone(),
            dao_signal,
            proposal_signal,
            choice_signal,
            commitment.clone()
        ];

        if !Self::verify_groth16(&env, &vk, &proof, &pub_signals) {
            panic_with_error!(&env, CommentsError::InvalidProof);
        }

        // No nullifier tracking for comments - allow unlimited comments per user

        let comment_id = Self::next_comment_id(&env, dao_id, proposal_id);
        let now = env.ledger().timestamp();

        let comment = CommentInfo {
            id: comment_id,
            dao_id,
            proposal_id,
            author: None,
            content_cid,
            parent_id,
            created_at: now,
            updated_at: now,
            revision_cids: Vec::new(&env),
            deleted: false,
            deleted_by: DELETED_BY_NONE,
            nullifier: Some(nullifier),
            comment_nonce: None, // No longer tracking nonce
        };

        let key = DataKey::Comment(dao_id, proposal_id, comment_id);
        env.storage().persistent().set(&key, &comment);

        CommentCreatedEvent {
            dao_id,
            proposal_id,
            comment_id,
            is_anonymous: true,
        }
        .publish(&env);

        comment_id
    }

    /// Edit a public comment (owner only)
    pub fn edit_comment(
        env: Env,
        dao_id: u64,
        proposal_id: u64,
        comment_id: u64,
        new_content_cid: String,
        author: Address,
    ) {
        author.require_auth();

        if new_content_cid.len() > MAX_CID_LEN {
            panic_with_error!(&env, CommentsError::CommentContentTooLong);
        }

        let key = DataKey::Comment(dao_id, proposal_id, comment_id);
        let mut comment: CommentInfo = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, CommentsError::CommentNotFound));

        if comment.deleted {
            panic_with_error!(&env, CommentsError::CommentDeleted);
        }

        match &comment.author {
            Some(original_author) if original_author == &author => {}
            _ => panic_with_error!(&env, CommentsError::NotCommentOwner),
        }

        if comment.revision_cids.len() < MAX_REVISIONS {
            comment.revision_cids.push_back(comment.content_cid.clone());
        }

        comment.content_cid = new_content_cid;
        comment.updated_at = env.ledger().timestamp();

        env.storage().persistent().set(&key, &comment);

        CommentEditedEvent {
            dao_id,
            proposal_id,
            comment_id,
        }
        .publish(&env);
    }

    /// Edit an anonymous comment (requires proof with same nullifier)
    /// We verify the user owns the comment by checking the stored nullifier
    pub fn edit_anonymous_comment(
        env: Env,
        dao_id: u64,
        proposal_id: u64,
        comment_id: u64,
        new_content_cid: String,
        nullifier: U256,
        root: U256,
        commitment: U256,
        vote_choice: bool, // From vote circuit - we ignore the value
        proof: Proof,
    ) {
        if new_content_cid.len() > MAX_CID_LEN {
            panic_with_error!(&env, CommentsError::CommentContentTooLong);
        }

        let key = DataKey::Comment(dao_id, proposal_id, comment_id);
        let mut comment: CommentInfo = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, CommentsError::CommentNotFound));

        if comment.deleted {
            panic_with_error!(&env, CommentsError::CommentDeleted);
        }

        // Verify this is the same user by checking nullifier
        // The nullifier is derived from (secret, daoId, proposalId) - same for all comments on this proposal
        match &comment.nullifier {
            Some(original_nullifier) => {
                // For edits, we verify the proof produces the same nullifier
                if &nullifier != original_nullifier {
                    panic_with_error!(&env, CommentsError::NotCommentOwner);
                }
            }
            _ => panic_with_error!(&env, CommentsError::NotCommentOwner),
        }

        // Verify ZK proof using VK from voting contract
        let vk = Self::get_vk_from_voting(&env, dao_id);

        let dao_signal = U256::from_u128(&env, dao_id as u128);
        let proposal_signal = U256::from_u128(&env, proposal_id as u128);
        let choice_signal = if vote_choice {
            U256::from_u32(&env, 1)
        } else {
            U256::from_u32(&env, 0)
        };

        let pub_signals = soroban_sdk::vec![
            &env,
            root.clone(),
            nullifier.clone(),
            dao_signal,
            proposal_signal,
            choice_signal,
            commitment.clone()
        ];

        if !Self::verify_groth16(&env, &vk, &proof, &pub_signals) {
            panic_with_error!(&env, CommentsError::InvalidProof);
        }

        if comment.revision_cids.len() < MAX_REVISIONS {
            comment.revision_cids.push_back(comment.content_cid.clone());
        }

        comment.content_cid = new_content_cid;
        comment.updated_at = env.ledger().timestamp();

        env.storage().persistent().set(&key, &comment);

        CommentEditedEvent {
            dao_id,
            proposal_id,
            comment_id,
        }
        .publish(&env);
    }

    /// Delete a public comment (owner only)
    pub fn delete_comment(
        env: Env,
        dao_id: u64,
        proposal_id: u64,
        comment_id: u64,
        author: Address,
    ) {
        author.require_auth();

        let key = DataKey::Comment(dao_id, proposal_id, comment_id);
        let mut comment: CommentInfo = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, CommentsError::CommentNotFound));

        if comment.deleted {
            return;
        }

        match &comment.author {
            Some(original_author) if original_author == &author => {}
            _ => panic_with_error!(&env, CommentsError::NotCommentOwner),
        }

        comment.deleted = true;
        comment.deleted_by = DELETED_BY_USER;
        comment.updated_at = env.ledger().timestamp();

        env.storage().persistent().set(&key, &comment);

        CommentDeletedEvent {
            dao_id,
            proposal_id,
            comment_id,
            deleted_by: DELETED_BY_USER,
        }
        .publish(&env);
    }

    /// Delete an anonymous comment (requires proof)
    pub fn delete_anonymous_comment(
        env: Env,
        dao_id: u64,
        proposal_id: u64,
        comment_id: u64,
        nullifier: U256,
        root: U256,
        commitment: U256,
        vote_choice: bool, // From vote circuit - we ignore the value
        proof: Proof,
    ) {
        let key = DataKey::Comment(dao_id, proposal_id, comment_id);
        let mut comment: CommentInfo = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, CommentsError::CommentNotFound));

        if comment.deleted {
            return;
        }

        // Verify ownership via nullifier
        match &comment.nullifier {
            Some(original_nullifier) if original_nullifier == &nullifier => {}
            _ => panic_with_error!(&env, CommentsError::NotCommentOwner),
        }

        // Verify ZK proof using VK from voting contract
        let vk = Self::get_vk_from_voting(&env, dao_id);

        let dao_signal = U256::from_u128(&env, dao_id as u128);
        let proposal_signal = U256::from_u128(&env, proposal_id as u128);
        let choice_signal = if vote_choice {
            U256::from_u32(&env, 1)
        } else {
            U256::from_u32(&env, 0)
        };

        let pub_signals = soroban_sdk::vec![
            &env,
            root.clone(),
            nullifier.clone(),
            dao_signal,
            proposal_signal,
            choice_signal,
            commitment.clone()
        ];

        if !Self::verify_groth16(&env, &vk, &proof, &pub_signals) {
            panic_with_error!(&env, CommentsError::InvalidProof);
        }

        comment.deleted = true;
        comment.deleted_by = DELETED_BY_USER;
        comment.updated_at = env.ledger().timestamp();

        env.storage().persistent().set(&key, &comment);

        CommentDeletedEvent {
            dao_id,
            proposal_id,
            comment_id,
            deleted_by: DELETED_BY_USER,
        }
        .publish(&env);
    }

    /// Admin delete any comment
    pub fn admin_delete_comment(
        env: Env,
        dao_id: u64,
        proposal_id: u64,
        comment_id: u64,
        admin: Address,
    ) {
        admin.require_auth();
        Self::assert_admin(&env, dao_id, &admin);

        let key = DataKey::Comment(dao_id, proposal_id, comment_id);
        let mut comment: CommentInfo = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, CommentsError::CommentNotFound));

        if comment.deleted {
            return;
        }

        comment.deleted = true;
        comment.deleted_by = DELETED_BY_ADMIN;
        comment.updated_at = env.ledger().timestamp();

        env.storage().persistent().set(&key, &comment);

        CommentDeletedEvent {
            dao_id,
            proposal_id,
            comment_id,
            deleted_by: DELETED_BY_ADMIN,
        }
        .publish(&env);
    }

    /// Get a single comment
    pub fn get_comment(env: Env, dao_id: u64, proposal_id: u64, comment_id: u64) -> CommentInfo {
        let key = DataKey::Comment(dao_id, proposal_id, comment_id);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, CommentsError::CommentNotFound))
    }

    /// Get comment count for a proposal
    pub fn comment_count(env: Env, dao_id: u64, proposal_id: u64) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::CommentCount(dao_id, proposal_id))
            .unwrap_or(0)
    }

    /// Get comments paginated
    pub fn get_comments(
        env: Env,
        dao_id: u64,
        proposal_id: u64,
        start_id: u64,
        limit: u64,
    ) -> Vec<CommentInfo> {
        let total = Self::comment_count(env.clone(), dao_id, proposal_id);
        let mut comments = Vec::new(&env);

        let end = if start_id + limit > total {
            total
        } else {
            start_id + limit
        };

        for i in start_id..end {
            let comment_id = i + 1;
            let key = DataKey::Comment(dao_id, proposal_id, comment_id);
            if let Some(comment) = env.storage().persistent().get::<DataKey, CommentInfo>(&key) {
                comments.push_back(comment);
            }
        }

        comments
    }

    /// Get tree contract address
    pub fn tree_contract(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&TREE_CONTRACT)
            .unwrap_or_else(|| panic_with_error!(&env, CommentsError::ContractNotSet))
    }

    /// Get voting contract address
    pub fn voting_contract(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::VotingContract)
            .unwrap_or_else(|| panic_with_error!(&env, CommentsError::ContractNotSet))
    }

    /// Get the next available comment nonce for a commitment on a proposal
    /// This is used by the relayer to tell users what nonce to use for their next anonymous comment
    pub fn get_comment_nonce(env: Env, dao_id: u64, proposal_id: u64, commitment: U256) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::CommitmentNonce(dao_id, proposal_id, commitment))
            .unwrap_or(0)
    }

    /// Contract version
    pub fn version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&VERSION_KEY)
            .unwrap_or(VERSION)
    }

    // Internal helpers

    fn next_comment_id(env: &Env, dao_id: u64, proposal_id: u64) -> u64 {
        let count_key = DataKey::CommentCount(dao_id, proposal_id);
        let count: u64 = env.storage().instance().get(&count_key).unwrap_or(0);
        let new_id = count + 1;
        env.storage().instance().set(&count_key, &new_id);
        new_id
    }

    fn assert_membership(env: &Env, dao_id: u64, member: &Address) {
        let tree_contract: Address = Self::tree_contract(env.clone());
        let sbt_contract: Address = env.invoke_contract(
            &tree_contract,
            &symbol_short!("sbt_contr"),
            soroban_sdk::vec![env],
        );

        let has_sbt: bool = env.invoke_contract(
            &sbt_contract,
            &symbol_short!("has"),
            soroban_sdk::vec![env, dao_id.into_val(env), member.clone().into_val(env)],
        );

        if !has_sbt {
            panic_with_error!(env, CommentsError::NotDaoMember);
        }
    }

    fn assert_proposal_exists(env: &Env, dao_id: u64, proposal_id: u64) {
        let voting_contract: Address = Self::voting_contract(env.clone());

        // Get proposal count - will panic if DAO doesn't exist in voting contract
        let count: u64 = env.invoke_contract(
            &voting_contract,
            &Symbol::new(env, "proposal_count"),
            soroban_sdk::vec![env, dao_id.into_val(env)],
        );

        // Check if proposal_id is within valid range
        if proposal_id == 0 || proposal_id > count {
            panic_with_error!(env, CommentsError::ProposalNotFound);
        }
    }

    // Groth16 verification (same as voting contract)
    fn verify_groth16(
        env: &Env,
        vk: &VerificationKey,
        proof: &Proof,
        pub_signals: &Vec<U256>,
    ) -> bool {
        if pub_signals.len() + 1 != vk.ic.len() {
            return false;
        }

        #[cfg(any(test, feature = "testutils"))]
        {
            let _ = (vk, proof, pub_signals);
            return true;
        }

        #[cfg(not(any(test, feature = "testutils")))]
        {
            let vk_x = Self::compute_vk_x(env, vk, pub_signals);
            let neg_a = Self::g1_negate(env, &proof.a);

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

            env.crypto().bn254().pairing_check(g1_vec, g2_vec)
        }
    }

    #[cfg(not(any(test, feature = "testutils")))]
    fn compute_vk_x(_env: &Env, vk: &VerificationKey, pub_signals: &Vec<U256>) -> BytesN<64> {
        let mut vk_x = G1Affine::from_bytes(vk.ic.get(0).unwrap());

        for i in 0..pub_signals.len() {
            let signal = pub_signals.get(i).unwrap();
            let ic_point = G1Affine::from_bytes(vk.ic.get(i + 1).unwrap());
            let scalar = Fr::from(signal);
            let scaled_point = ic_point * scalar;
            vk_x = vk_x + scaled_point;
        }

        vk_x.to_bytes()
    }

    #[cfg(not(any(test, feature = "testutils")))]
    fn g1_negate(env: &Env, point: &BytesN<64>) -> BytesN<64> {
        let bytes = point.to_array();

        let field_modulus: [u8; 32] = [
            0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81,
            0x58, 0x5d, 0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d, 0x3c, 0x20, 0x8c, 0x16,
            0xd8, 0x7c, 0xfd, 0x47,
        ];

        let mut x = [0u8; 32];
        let mut y = [0u8; 32];
        x.copy_from_slice(&bytes[0..32]);
        y.copy_from_slice(&bytes[32..64]);

        let neg_y = Self::field_subtract_be(&field_modulus, &y);

        let mut result = [0u8; 64];
        result[0..32].copy_from_slice(&x);
        result[32..64].copy_from_slice(&neg_y);

        BytesN::from_array(env, &result)
    }

    #[cfg(not(any(test, feature = "testutils")))]
    fn field_subtract_be(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
        let mut result = [0u8; 32];
        let mut borrow: u16 = 0;

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
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_contract_creation() {
        let env = Env::default();
        let tree = Address::generate(&env);
        let voting = Address::generate(&env);
        let _contract = env.register(Comments, (&tree, &voting));
    }
}
