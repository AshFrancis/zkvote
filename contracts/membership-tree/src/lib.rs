#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Env, IntoVal, Symbol, Vec, U256,
};

const SBT_CONTRACT: Symbol = symbol_short!("sbt");
const MAX_ROOTS: u32 = 30;
const MAX_TREE_DEPTH: u32 = 18; // Supports ~262K members (2^18 = 262,144)
const ZEROS_CACHE: Symbol = symbol_short!("zeros");
const VERSION: u32 = 1;
const VERSION_KEY: Symbol = symbol_short!("ver");

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum TreeError {
    NotAdmin = 1,
    InvalidDepth = 2,
    TreeInitialized = 3,
    TreeNotInitialized = 4,
    CommitmentExists = 5,
    MemberExists = 6,
    TreeFull = 7,
    NoSbt = 8,
    NotOpenMembership = 9,
    LeafOutOfBounds = 10,
    MemberRemoved = 11,
    MemberNotInTree = 12,
    RootNotFound = 13,
    AlreadyInitialized = 14,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    TreeDepth(u64),                // dao_id -> depth
    NextLeafIndex(u64),            // dao_id -> next index
    FilledSubtrees(u64),           // dao_id -> Vec<U256>
    Roots(u64),                    // dao_id -> Vec<U256> (history)
    LeafIndex(u64, U256),          // (dao_id, commitment) -> index
    MemberLeafIndex(u64, Address), // (dao_id, member) -> index
    LeafValue(u64, u32),           // (dao_id, index) -> commitment (or 0 if removed)
    NextRootIndex(u64),            // dao_id -> next root index counter
    RootIndex(u64, U256),          // (dao_id, root) -> root index
    RevokedAt(u64, U256),          // (dao_id, commitment) -> timestamp when revoked
    ReinstatedAt(u64, U256),       // (dao_id, commitment) -> timestamp when reinstated
}

// Typed Events
#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct TreeInitEvent {
    #[topic]
    pub dao_id: u64,
    pub depth: u32,
    pub empty_root: U256,
    pub root_index: u32,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct CommitEvent {
    #[topic]
    pub dao_id: u64,
    pub commitment: U256,
    pub index: u32,
    pub new_root: U256,
    pub root_index: u32,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct RemovalEvent {
    #[topic]
    pub dao_id: u64,
    #[topic]
    pub member: Address,
    pub index: u32,
    pub new_root: U256,
    pub root_index: u32,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct ReinstatementEvent {
    #[topic]
    pub dao_id: u64,
    #[topic]
    pub member: Address,
    pub reinstated_at: u64,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct ContractUpgraded {
    pub from: u32,
    pub to: u32,
}

#[contract]
pub struct MembershipTree;

#[contractimpl]
impl MembershipTree {
    /// Constructor: Initialize contract with SBT contract address
    /// Also pre-computes zeros cache to avoid expensive initialization during first DAO creation
    pub fn __constructor(env: Env, sbt_contract: Address) {
        if env.storage().instance().has(&VERSION_KEY) {
            panic_with_error!(&env, TreeError::AlreadyInitialized);
        }
        env.storage().instance().set(&VERSION_KEY, &VERSION);
        ContractUpgraded {
            from: 0,
            to: VERSION,
        }
        .publish(&env);

        env.storage().instance().set(&SBT_CONTRACT, &sbt_contract);

        // Pre-initialize zeros cache during deployment to spread the cost
        // This avoids hitting budget limits during first DAO creation
        Self::ensure_zeros_cache(&env);
    }

    fn sbt_contract(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&SBT_CONTRACT)
            .unwrap_or_else(|| panic_with_error!(env, TreeError::TreeNotInitialized))
    }

    /// Initialize a tree for a specific DAO
    /// Only DAO admin can initialize (via SBT contract which checks registry)
    pub fn init_tree(env: Env, dao_id: u64, depth: u32, admin: Address) {
        admin.require_auth();

        // Verify admin owns the DAO via SBT -> Registry chain
        let sbt_contract: Address = Self::sbt_contract(&env);
        let registry: Address = env.invoke_contract(
            &sbt_contract,
            &symbol_short!("registry"),
            soroban_sdk::vec![&env],
        );
        let dao_admin: Address = env.invoke_contract(
            &registry,
            &symbol_short!("get_admin"),
            soroban_sdk::vec![&env, dao_id.into_val(&env)],
        );
        if dao_admin != admin {
            panic_with_error!(&env, TreeError::NotAdmin);
        }

        if depth == 0 || depth > MAX_TREE_DEPTH {
            panic_with_error!(&env, TreeError::InvalidDepth);
        }

        let depth_key = DataKey::TreeDepth(dao_id);
        if env.storage().persistent().has(&depth_key) {
            panic_with_error!(&env, TreeError::TreeInitialized);
        }

        // Store tree parameters
        env.storage().persistent().set(&depth_key, &depth);
        env.storage()
            .persistent()
            .set(&DataKey::NextLeafIndex(dao_id), &0u32);

        // Initialize root index counter
        env.storage()
            .persistent()
            .set(&DataKey::NextRootIndex(dao_id), &0u32);

        // Initialize filled subtrees with zeros (use cached zeros for O(1) lookup)
        let mut filled = Vec::new(&env);
        for level in 0..depth {
            filled.push_back(Self::zero_at_level(&env, level));
        }
        env.storage()
            .persistent()
            .set(&DataKey::FilledSubtrees(dao_id), &filled);

        // Initialize root history with empty tree root (cached zero at depth level)
        let empty_root = Self::zero_at_level(&env, depth);
        let mut roots = Vec::new(&env);
        roots.push_back(empty_root.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Roots(dao_id), &roots);

        // Store root index for empty root
        env.storage()
            .persistent()
            .set(&DataKey::RootIndex(dao_id, empty_root.clone()), &0u32);

        TreeInitEvent {
            dao_id,
            depth,
            empty_root,
            root_index: 0,
        }
        .publish(&env);
    }

    /// Initialize tree from registry during DAO initialization
    /// This function is called by the registry contract during create_and_init_dao
    /// to avoid re-entrancy issues. The registry is a trusted system contract.
    pub fn init_tree_from_registry(env: Env, dao_id: u64, depth: u32) {
        if depth == 0 || depth > MAX_TREE_DEPTH {
            panic_with_error!(&env, TreeError::InvalidDepth);
        }

        let depth_key = DataKey::TreeDepth(dao_id);
        if env.storage().persistent().has(&depth_key) {
            panic_with_error!(&env, TreeError::TreeInitialized);
        }

        // Store tree parameters
        env.storage().persistent().set(&depth_key, &depth);
        env.storage()
            .persistent()
            .set(&DataKey::NextLeafIndex(dao_id), &0u32);

        // Initialize root index counter
        env.storage()
            .persistent()
            .set(&DataKey::NextRootIndex(dao_id), &0u32);

        // Initialize filled subtrees with zeros (use cached zeros for O(1) lookup)
        let mut filled = Vec::new(&env);
        for level in 0..depth {
            filled.push_back(Self::zero_at_level(&env, level));
        }
        env.storage()
            .persistent()
            .set(&DataKey::FilledSubtrees(dao_id), &filled);

        // Initialize root history with empty tree root (cached zero at depth level)
        let empty_root = Self::zero_at_level(&env, depth);
        let mut roots = Vec::new(&env);
        roots.push_back(empty_root.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Roots(dao_id), &roots);

        // Store root index for empty root
        env.storage()
            .persistent()
            .set(&DataKey::RootIndex(dao_id, empty_root.clone()), &0u32);

        TreeInitEvent {
            dao_id,
            depth,
            empty_root,
            root_index: 0,
        }
        .publish(&env);
    }

    /// Register a commitment from registry during DAO initialization
    /// This function is called by the registry contract during create_and_init_dao
    /// to automatically register the creator's commitment.
    /// The registry is trusted to have already verified SBT ownership.
    pub fn register_from_registry(env: Env, dao_id: u64, commitment: U256, member: Address) {
        // Check tree is initialized
        let depth_key = DataKey::TreeDepth(dao_id);
        if !env.storage().persistent().has(&depth_key) {
            panic_with_error!(&env, TreeError::TreeNotInitialized);
        }

        // Check commitment not already registered
        let leaf_key = DataKey::LeafIndex(dao_id, commitment.clone());
        if env.storage().persistent().has(&leaf_key) {
            panic_with_error!(&env, TreeError::CommitmentExists);
        }

        // Check member hasn't already registered
        let member_key = DataKey::MemberLeafIndex(dao_id, member.clone());
        if env.storage().persistent().has(&member_key) {
            panic_with_error!(&env, TreeError::MemberExists);
        }

        // Get tree parameters
        let depth: u32 = env
            .storage()
            .persistent()
            .get(&depth_key)
            .unwrap_or_else(|| panic_with_error!(&env, TreeError::TreeNotInitialized));
        let next_index: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::NextLeafIndex(dao_id))
            .unwrap();

        if next_index >= (1u32 << depth) {
            panic_with_error!(&env, TreeError::TreeFull);
        }

        // Insert leaf into tree
        let (new_root, root_index) =
            Self::insert_leaf(&env, dao_id, commitment.clone(), next_index, depth);

        // Update next index
        env.storage()
            .persistent()
            .set(&DataKey::NextLeafIndex(dao_id), &(next_index + 1));

        // Store leaf index for this commitment
        env.storage().persistent().set(&leaf_key, &next_index);

        // Store member -> index mapping
        env.storage().persistent().set(&member_key, &next_index);

        // Store leaf value
        let leaf_value_key = DataKey::LeafValue(dao_id, next_index);
        env.storage().persistent().set(&leaf_value_key, &commitment);

        CommitEvent {
            dao_id,
            commitment,
            index: next_index,
            new_root,
            root_index,
        }
        .publish(&env);
    }

    /// Register a commitment with explicit caller (requires SBT membership)
    pub fn register_with_caller(env: Env, dao_id: u64, commitment: U256, caller: Address) {
        caller.require_auth();

        // Verify caller has SBT for this DAO
        let sbt_contract: Address = Self::sbt_contract(&env);
        let has_sbt: bool = env.invoke_contract(
            &sbt_contract,
            &symbol_short!("has"),
            soroban_sdk::vec![&env, dao_id.into_val(&env), caller.clone().into_val(&env)],
        );

        if !has_sbt {
            panic_with_error!(&env, TreeError::NoSbt);
        }

        // Check tree is initialized
        let depth_key = DataKey::TreeDepth(dao_id);
        if !env.storage().persistent().has(&depth_key) {
            panic_with_error!(&env, TreeError::TreeNotInitialized);
        }

        // Check commitment not already registered
        let leaf_key = DataKey::LeafIndex(dao_id, commitment.clone());
        if env.storage().persistent().has(&leaf_key) {
            panic_with_error!(&env, TreeError::CommitmentExists);
        }

        // Check member hasn't already registered
        let member_key = DataKey::MemberLeafIndex(dao_id, caller.clone());
        if env.storage().persistent().has(&member_key) {
            panic_with_error!(&env, TreeError::MemberExists);
        }

        // Get tree parameters
        let depth: u32 = env.storage().persistent().get(&depth_key).unwrap();
        let next_index: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::NextLeafIndex(dao_id))
            .unwrap();

        if next_index >= (1u32 << depth) {
            panic_with_error!(&env, TreeError::TreeFull);
        }

        // Insert leaf into tree
        let (new_root, root_index) =
            Self::insert_leaf(&env, dao_id, commitment.clone(), next_index, depth);

        // Update next index
        env.storage()
            .persistent()
            .set(&DataKey::NextLeafIndex(dao_id), &(next_index + 1));

        // Store leaf index for this commitment
        env.storage().persistent().set(&leaf_key, &next_index);

        // Store member -> index mapping
        env.storage().persistent().set(&member_key, &next_index);

        // Store leaf value
        let leaf_value_key = DataKey::LeafValue(dao_id, next_index);
        env.storage().persistent().set(&leaf_value_key, &commitment);

        CommitEvent {
            dao_id,
            commitment,
            index: next_index,
            new_root,
            root_index,
        }
        .publish(&env);
    }

    /// Self-register a commitment in a public DAO (requires SBT membership)
    /// For public DAOs, anyone with an SBT can register their commitment
    pub fn self_register(env: Env, dao_id: u64, commitment: U256, member: Address) {
        member.require_auth();

        // Get SBT contract and verify membership
        let sbt_contract: Address = Self::sbt_contract(&env);
        let has_sbt: bool = env.invoke_contract(
            &sbt_contract,
            &symbol_short!("has"),
            soroban_sdk::vec![&env, dao_id.into_val(&env), member.clone().into_val(&env)],
        );

        if !has_sbt {
            panic_with_error!(&env, TreeError::NoSbt);
        }

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

        if !membership_open {
            panic_with_error!(&env, TreeError::NotOpenMembership);
        }

        // Check tree is initialized
        let depth_key = DataKey::TreeDepth(dao_id);
        if !env.storage().persistent().has(&depth_key) {
            panic_with_error!(&env, TreeError::TreeNotInitialized);
        }

        // Check commitment not already registered
        let leaf_key = DataKey::LeafIndex(dao_id, commitment.clone());
        if env.storage().persistent().has(&leaf_key) {
            panic_with_error!(&env, TreeError::CommitmentExists);
        }

        // Check member hasn't already registered
        let member_key = DataKey::MemberLeafIndex(dao_id, member.clone());
        if env.storage().persistent().has(&member_key) {
            panic_with_error!(&env, TreeError::MemberExists);
        }

        // Get tree parameters
        let depth: u32 = env.storage().persistent().get(&depth_key).unwrap();
        let next_index: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::NextLeafIndex(dao_id))
            .unwrap();

        if next_index >= (1u32 << depth) {
            panic_with_error!(&env, TreeError::TreeFull);
        }

        // Insert leaf into tree
        let (new_root, root_index) =
            Self::insert_leaf(&env, dao_id, commitment.clone(), next_index, depth);

        // Update next index
        env.storage()
            .persistent()
            .set(&DataKey::NextLeafIndex(dao_id), &(next_index + 1));

        // Store leaf index for this commitment
        env.storage().persistent().set(&leaf_key, &next_index);

        // Store member -> index mapping
        env.storage().persistent().set(&member_key, &next_index);

        // Store leaf value
        let leaf_value_key = DataKey::LeafValue(dao_id, next_index);
        env.storage().persistent().set(&leaf_value_key, &commitment);

        CommitEvent {
            dao_id,
            commitment,
            index: next_index,
            new_root,
            root_index,
        }
        .publish(&env);
    }

    /// Get current root for a DAO
    pub fn current_root(env: Env, dao_id: u64) -> U256 {
        let roots_key = DataKey::Roots(dao_id);
        let roots: Vec<U256> = env
            .storage()
            .persistent()
            .get(&roots_key)
            .unwrap_or_else(|| panic_with_error!(&env, TreeError::TreeNotInitialized));
        roots
            .get(roots.len().saturating_sub(1))
            .unwrap_or_else(|| panic_with_error!(&env, TreeError::TreeNotInitialized))
    }

    /// Get current root (short alias for cross-contract calls)
    pub fn get_root(env: Env, dao_id: u64) -> U256 {
        Self::current_root(env, dao_id)
    }

    /// Check if a root is valid (in history)
    pub fn root_ok(env: Env, dao_id: u64, root: U256) -> bool {
        let roots_key = DataKey::Roots(dao_id);
        if !env.storage().persistent().has(&roots_key) {
            return false;
        }

        let roots: Vec<U256> = env
            .storage()
            .persistent()
            .get(&roots_key)
            .unwrap_or_else(|| panic_with_error!(&env, TreeError::TreeNotInitialized));
        for i in 0..roots.len() {
            if roots
                .get(i)
                .unwrap_or_else(|| panic_with_error!(&env, TreeError::TreeNotInitialized))
                == root
            {
                return true;
            }
        }
        false
    }

    /// Get root index for a specific root (for vote mode validation)
    pub fn root_idx(env: Env, dao_id: u64, root: U256) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::RootIndex(dao_id, root))
            .unwrap_or_else(|| panic_with_error!(&env, TreeError::RootNotFound))
    }

    /// Get current root index (for proposal creation)
    pub fn curr_idx(env: Env, dao_id: u64) -> u32 {
        let current_root = Self::current_root(env.clone(), dao_id);
        Self::root_idx(env, dao_id, current_root)
    }

    /// Get leaf index for a commitment
    pub fn get_leaf_index(env: Env, dao_id: u64, commitment: U256) -> u32 {
        let key = DataKey::LeafIndex(dao_id, commitment);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, TreeError::MemberNotInTree))
    }

    /// Get tree info for a DAO
    pub fn get_tree_info(env: Env, dao_id: u64) -> (u32, u32, U256) {
        let depth: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::TreeDepth(dao_id))
            .unwrap_or_else(|| panic_with_error!(&env, TreeError::TreeNotInitialized));
        let next_index: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::NextLeafIndex(dao_id))
            .unwrap();
        let root = Self::current_root(env, dao_id);
        (depth, next_index, root)
    }

    /// Get Merkle path for a specific leaf index
    /// Returns (pathElements, pathIndices) where:
    /// - pathElements[i] is the sibling hash at level i
    /// - pathIndices[i] is 0 if leaf is left child, 1 if right child
    pub fn get_merkle_path(env: Env, dao_id: u64, leaf_index: u32) -> (Vec<U256>, Vec<u32>) {
        let depth: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::TreeDepth(dao_id))
            .expect("tree not initialized");

        let next_index: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::NextLeafIndex(dao_id))
            .unwrap();

        if leaf_index >= next_index {
            panic_with_error!(&env, TreeError::LeafOutOfBounds);
        }

        let mut path_elements = Vec::new(&env);
        let mut path_indices = Vec::new(&env);
        let mut current_index = leaf_index;

        for level in 0..depth {
            // Determine if current node is left (0) or right (1) child
            let is_left = current_index % 2 == 0;
            path_indices.push_back(if is_left { 0 } else { 1 });

            // Calculate sibling index at THIS LEVEL
            let sibling_index = if is_left {
                current_index + 1
            } else {
                current_index - 1
            };

            // Get sibling value
            let sibling = if level == 0 {
                // Level 0: sibling is a raw leaf (commitment value)
                if sibling_index < next_index {
                    let leaf_key = DataKey::LeafValue(dao_id, sibling_index);
                    env.storage()
                        .persistent()
                        .get(&leaf_key)
                        .unwrap_or_else(|| Self::zero_value(&env))
                } else {
                    // Sibling leaf doesn't exist, use zero
                    Self::zero_value(&env)
                }
            } else {
                // Level > 0: sibling is an intermediate hash node
                // Calculate which leaves this subtree covers
                let leaves_per_subtree = 1u32 << level; // 2^level
                let start_leaf = sibling_index * leaves_per_subtree;

                if start_leaf >= next_index {
                    // Entire subtree is empty
                    Self::zero_at_level(&env, level)
                } else {
                    // Reconstruct the hash by hashing up from stored leaves
                    Self::reconstruct_subtree(&env, dao_id, sibling_index, level, next_index)
                }
            };

            path_elements.push_back(sibling);
            current_index /= 2; // Move to parent level
        }

        (path_elements, path_indices)
    }

    /// Get SBT contract address
    pub fn sbt_contr(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&SBT_CONTRACT)
            .unwrap_or_else(|| panic_with_error!(&env, TreeError::TreeNotInitialized))
    }

    /// Pre-initialize the zeros cache to avoid budget issues during first tree operations.
    /// This should be called once during deployment to precompute zero values for all levels.
    pub fn init_zeros_cache(env: Env) {
        Self::ensure_zeros_cache(&env);
    }

    /// Remove a member by zeroing their leaf and recomputing the root
    /// Only callable by DAO admin
    /// Remove member by recording revocation timestamp (cheap, no tree update)
    /// This prevents the member from voting on proposals created after this timestamp
    pub fn remove_member(env: Env, dao_id: u64, member: Address, admin: Address) {
        admin.require_auth();

        // Verify admin owns the DAO via SBT -> Registry chain
        let sbt_contract: Address = Self::sbt_contr(env.clone());
        let registry: Address = env.invoke_contract(
            &sbt_contract,
            &symbol_short!("registry"),
            soroban_sdk::vec![&env],
        );
        let dao_admin: Address = env.invoke_contract(
            &registry,
            &symbol_short!("get_admin"),
            soroban_sdk::vec![&env, dao_id.into_val(&env)],
        );
        if dao_admin != admin {
            panic_with_error!(&env, TreeError::NotAdmin);
        }

        // Get member's leaf index
        let member_key = DataKey::MemberLeafIndex(dao_id, member.clone());
        let leaf_index: u32 = env
            .storage()
            .persistent()
            .get(&member_key)
            .unwrap_or_else(|| panic_with_error!(&env, TreeError::MemberNotInTree));

        // Get their commitment from the tree
        let commitment: U256 = env
            .storage()
            .persistent()
            .get(&DataKey::LeafValue(dao_id, leaf_index))
            .unwrap_or_else(|| panic_with_error!(&env, TreeError::MemberNotInTree));

        if commitment == Self::zero_value(&env) {
            panic_with_error!(&env, TreeError::MemberRemoved);
        }

        // Record revocation timestamp
        let revoked_at = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&DataKey::RevokedAt(dao_id, commitment.clone()), &revoked_at);

        RemovalEvent {
            dao_id,
            member,
            index: leaf_index,
            new_root: U256::from_u32(&env, 0), // Not updating root
            root_index: 0,                     // Not updating root
        }
        .publish(&env);
    }

    /// Reinstate a previously removed member
    /// Records the reinstatement timestamp, allowing them to vote on future proposals
    pub fn reinstate_member(env: Env, dao_id: u64, member: Address, admin: Address) {
        admin.require_auth();

        // Verify admin is the DAO admin via cross-contract call
        let sbt_contract: Address = Self::sbt_contr(env.clone());
        let registry: Address = env.invoke_contract(
            &sbt_contract,
            &symbol_short!("registry"),
            soroban_sdk::vec![&env],
        );
        let dao_admin: Address = env.invoke_contract(
            &registry,
            &symbol_short!("get_admin"),
            soroban_sdk::vec![&env, dao_id.into_val(&env)],
        );

        if admin != dao_admin {
            panic_with_error!(&env, TreeError::NotAdmin);
        }

        // Get member's commitment
        let leaf_index_key = DataKey::MemberLeafIndex(dao_id, member.clone());
        let leaf_index: u32 = env
            .storage()
            .persistent()
            .get(&leaf_index_key)
            .unwrap_or_else(|| panic_with_error!(&env, TreeError::MemberNotInTree));

        let commitment: U256 = env
            .storage()
            .persistent()
            .get(&DataKey::LeafValue(dao_id, leaf_index))
            .unwrap_or_else(|| panic_with_error!(&env, TreeError::MemberNotInTree));

        if commitment == Self::zero_value(&env) {
            panic_with_error!(&env, TreeError::MemberNotInTree);
        }

        // Record reinstatement timestamp
        let reinstated_at = env.ledger().timestamp();
        env.storage().persistent().set(
            &DataKey::ReinstatedAt(dao_id, commitment.clone()),
            &reinstated_at,
        );

        // Emit event
        ReinstatementEvent {
            dao_id,
            member,
            reinstated_at,
        }
        .publish(&env);
    }

    /// Get revocation timestamp for a commitment (returns None if never revoked)
    /// Used by voting contract to check if member was revoked
    pub fn revok_at(env: Env, dao_id: u64, commitment: U256) -> Option<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::RevokedAt(dao_id, commitment))
    }

    /// Get reinstatement timestamp for a commitment (returns None if never reinstated)
    /// Used by voting contract to check if member was reinstated after revocation
    pub fn reinst_at(env: Env, dao_id: u64, commitment: U256) -> Option<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::ReinstatedAt(dao_id, commitment))
    }

    // Internal: Reconstruct the hash of a subtree at a given level and index
    // This recursively computes the hash from stored leaf values
    fn reconstruct_subtree(
        env: &Env,
        dao_id: u64,
        subtree_index: u32,
        level: u32,
        next_index: u32,
    ) -> U256 {
        if level == 0 {
            // Base case: return the leaf value
            let leaf_key = DataKey::LeafValue(dao_id, subtree_index);
            return env
                .storage()
                .persistent()
                .get(&leaf_key)
                .unwrap_or_else(|| Self::zero_value(env));
        }

        // Recursive case: hash the two children
        let left_index = subtree_index * 2;
        let right_index = left_index + 1;

        let leaves_per_child = 1u32 << (level - 1); // 2^(level-1)
        let right_start_leaf = right_index * leaves_per_child;

        let left_hash = Self::reconstruct_subtree(env, dao_id, left_index, level - 1, next_index);

        let right_hash = if right_start_leaf >= next_index {
            // Right subtree is empty
            Self::zero_at_level(env, level - 1)
        } else {
            Self::reconstruct_subtree(env, dao_id, right_index, level - 1, next_index)
        };

        Self::hash_pair(env, &left_hash, &right_hash)
    }

    // Internal: Insert leaf and update tree
    fn insert_leaf(env: &Env, dao_id: u64, leaf: U256, index: u32, depth: u32) -> (U256, u32) {
        let mut filled: Vec<U256> = env
            .storage()
            .persistent()
            .get(&DataKey::FilledSubtrees(dao_id))
            .unwrap();

        // Fast path for first leaf (index 0): pre-compute root directly
        // Since all siblings are zeros, we can compute the root in a tight loop
        // without repeatedly calling zero_at_level
        if index == 0 {
            filled.set(0, leaf.clone());
            let mut current_hash = leaf;
            for level in 0..depth {
                let zero = Self::zero_at_level(env, level);
                current_hash = Self::hash_pair(env, &current_hash, &zero);
            }

            env.storage()
                .persistent()
                .set(&DataKey::FilledSubtrees(dao_id), &filled);

            // Update root history
            let mut roots: Vec<U256> = env
                .storage()
                .persistent()
                .get(&DataKey::Roots(dao_id))
                .unwrap();
            roots.push_back(current_hash.clone());
            if roots.len() > MAX_ROOTS {
                let mut new_roots = Vec::new(env);
                for i in 1..roots.len() {
                    new_roots.push_back(roots.get(i).unwrap());
                }
                roots = new_roots;
            }
            env.storage()
                .persistent()
                .set(&DataKey::Roots(dao_id), &roots);

            // Get and increment root index
            let root_index: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::NextRootIndex(dao_id))
                .unwrap();
            env.storage()
                .persistent()
                .set(&DataKey::NextRootIndex(dao_id), &(root_index + 1));

            // Store root index mapping
            env.storage().persistent().set(
                &DataKey::RootIndex(dao_id, current_hash.clone()),
                &root_index,
            );

            return (current_hash, root_index);
        }

        // General case for index > 0
        let mut current_hash = leaf;
        let mut current_index = index;

        for i in 0..depth {
            let level = i as u32;
            if current_index % 2 == 0 {
                // Left child - update filled subtree at this level
                filled.set(level, current_hash.clone());
                let zero_at_level = Self::zero_at_level(env, level);
                current_hash = Self::hash_pair(env, &current_hash, &zero_at_level);
            } else {
                // Right child - use filled subtree from left
                let left = filled.get(level).unwrap();
                current_hash = Self::hash_pair(env, &left, &current_hash);
            }
            current_index /= 2;
        }

        // Save updated filled subtrees
        env.storage()
            .persistent()
            .set(&DataKey::FilledSubtrees(dao_id), &filled);

        // Update root history with FIFO cap
        let mut roots: Vec<U256> = env
            .storage()
            .persistent()
            .get(&DataKey::Roots(dao_id))
            .unwrap();

        roots.push_back(current_hash.clone());

        // Maintain max roots cap (FIFO)
        if roots.len() > MAX_ROOTS {
            let mut new_roots = Vec::new(env);
            for i in 1..roots.len() {
                new_roots.push_back(roots.get(i).unwrap());
            }
            roots = new_roots;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Roots(dao_id), &roots);

        // Get and increment root index
        let root_index: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::NextRootIndex(dao_id))
            .unwrap();
        env.storage()
            .persistent()
            .set(&DataKey::NextRootIndex(dao_id), &(root_index + 1));

        // Store root index mapping
        env.storage().persistent().set(
            &DataKey::RootIndex(dao_id, current_hash.clone()),
            &root_index,
        );

        (current_hash, root_index)
    }

    // Internal: Poseidon hash of two U256 values
    fn hash_pair(env: &Env, left: &U256, right: &U256) -> U256 {
        let field = Symbol::new(env, "BN254");
        let inputs = soroban_sdk::vec![env, left.clone(), right.clone()];
        env.crypto().poseidon_hash(&inputs, field)
    }

    // Internal: Zero value (empty leaf)
    fn zero_value(_env: &Env) -> U256 {
        // Standard Semaphore zero value
        U256::from_u32(_env, 0)
    }

    // Internal: Ensure zeros cache is initialized (lazy init, shared across all DAOs)
    fn ensure_zeros_cache(env: &Env) {
        if env.storage().instance().has(&ZEROS_CACHE) {
            return;
        }

        // Precompute zeros[0..MAX_TREE_DEPTH+1]
        // zeros[0] = 0
        // zeros[i+1] = Poseidon(zeros[i], zeros[i])
        let mut zeros = Vec::new(env);
        let mut current = Self::zero_value(env);
        zeros.push_back(current.clone());

        for _ in 0..MAX_TREE_DEPTH {
            current = Self::hash_pair(env, &current, &current);
            zeros.push_back(current.clone());
        }

        env.storage().instance().set(&ZEROS_CACHE, &zeros);
    }

    // Internal: O(1) lookup for precomputed zero at each level
    fn zero_at_level(env: &Env, level: u32) -> U256 {
        Self::ensure_zeros_cache(env);
        let zeros: Vec<U256> = env.storage().instance().get(&ZEROS_CACHE).unwrap();
        zeros.get(level).unwrap()
    }

    /// Contract version for upgrade tracking.
    pub fn version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&VERSION_KEY)
            .unwrap_or(VERSION)
    }
}

// Test-only functions in separate contractimpl block
// This prevents the macro from generating references to these functions in production builds
#[cfg(any(test, feature = "testutils"))]
#[contractimpl]
impl MembershipTree {
    /// Test helper: Expose Poseidon hash for KAT verification
    /// This function is used to verify that Stellar P25's Poseidon implementation
    /// matches circomlib's parameters. Compare results with circuits/utils/poseidon_kat.js
    pub fn test_poseidon_hash(env: Env, a: U256, b: U256) -> U256 {
        Self::hash_pair(&env, &a, &b)
    }

    /// Test helper: Get zero value at specific tree level
    /// Used to verify Merkle tree zero values match between on-chain and circuit
    pub fn test_zero_at_level(env: Env, level: u32) -> U256 {
        Self::zero_at_level(&env, level)
    }
}

#[cfg(test)]
mod test;
