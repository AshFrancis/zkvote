#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal, Symbol, Vec, U256,
};

const SBT_CONTRACT: Symbol = symbol_short!("sbt");
const MAX_ROOTS: u32 = 30;
const MAX_TREE_DEPTH: u32 = 32;
const ZEROS_CACHE: Symbol = symbol_short!("zeros");

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    TreeDepth(u64),                   // dao_id -> depth
    NextLeafIndex(u64),               // dao_id -> next index
    FilledSubtrees(u64),              // dao_id -> Vec<U256>
    Roots(u64),                       // dao_id -> Vec<U256> (history)
    LeafIndex(u64, U256),             // (dao_id, commitment) -> index
}

// Typed Events
#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct TreeInitEvent {
    #[topic]
    pub dao_id: u64,
    pub depth: u32,
    pub empty_root: U256,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct CommitEvent {
    #[topic]
    pub dao_id: u64,
    pub commitment: U256,
    pub index: u32,
    pub new_root: U256,
}

#[contract]
pub struct MembershipTree;

#[contractimpl]
impl MembershipTree {
    /// Constructor: Initialize contract with SBT contract address
    pub fn __constructor(env: Env, sbt_contract: Address) {
        env.storage().instance().set(&SBT_CONTRACT, &sbt_contract);
    }

    /// Initialize a tree for a specific DAO
    /// Only DAO admin can initialize (via SBT contract which checks registry)
    pub fn init_tree(env: Env, dao_id: u64, depth: u32, admin: Address) {
        admin.require_auth();

        // Verify admin owns the DAO via SBT -> Registry chain
        let sbt_contract: Address = env.storage().instance().get(&SBT_CONTRACT).unwrap();
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
            panic!("not admin");
        }

        if depth == 0 || depth > 32 {
            panic!("invalid depth");
        }

        let depth_key = DataKey::TreeDepth(dao_id);
        if env.storage().persistent().has(&depth_key) {
            panic!("tree already initialized");
        }

        // Store tree parameters
        env.storage().persistent().set(&depth_key, &depth);
        env.storage()
            .persistent()
            .set(&DataKey::NextLeafIndex(dao_id), &0u32);

        // Initialize filled subtrees with zeros
        let zero = Self::zero_value(&env);
        let mut filled = Vec::new(&env);
        let mut current_zero = zero;
        for _ in 0..depth {
            filled.push_back(current_zero.clone());
            current_zero = Self::hash_pair(&env, &current_zero, &current_zero);
        }
        env.storage()
            .persistent()
            .set(&DataKey::FilledSubtrees(dao_id), &filled);

        // Initialize root history with empty tree root
        let empty_root = current_zero;
        let mut roots = Vec::new(&env);
        roots.push_back(empty_root.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Roots(dao_id), &roots);

        TreeInitEvent {
            dao_id,
            depth,
            empty_root,
        }
        .publish(&env);
    }

    /// Register a commitment with explicit caller (requires SBT membership)
    pub fn register_with_caller(env: Env, dao_id: u64, commitment: U256, caller: Address) {
        caller.require_auth();

        // Verify caller has SBT for this DAO
        let sbt_contract: Address = env.storage().instance().get(&SBT_CONTRACT).unwrap();
        let has_sbt: bool = env.invoke_contract(
            &sbt_contract,
            &symbol_short!("has"),
            soroban_sdk::vec![&env, dao_id.into_val(&env), caller.clone().into_val(&env)],
        );

        if !has_sbt {
            panic!("no SBT for DAO");
        }

        // Check tree is initialized
        let depth_key = DataKey::TreeDepth(dao_id);
        if !env.storage().persistent().has(&depth_key) {
            panic!("tree not initialized");
        }

        // Check commitment not already registered
        let leaf_key = DataKey::LeafIndex(dao_id, commitment.clone());
        if env.storage().persistent().has(&leaf_key) {
            panic!("commitment already registered");
        }

        // Get tree parameters
        let depth: u32 = env.storage().persistent().get(&depth_key).unwrap();
        let next_index: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::NextLeafIndex(dao_id))
            .unwrap();

        if next_index >= (1u32 << depth) {
            panic!("tree is full");
        }

        // Insert leaf into tree
        let new_root = Self::insert_leaf(&env, dao_id, commitment.clone(), next_index, depth);

        // Update next index
        env.storage()
            .persistent()
            .set(&DataKey::NextLeafIndex(dao_id), &(next_index + 1));

        // Store leaf index for this commitment
        env.storage().persistent().set(&leaf_key, &next_index);

        CommitEvent {
            dao_id,
            commitment,
            index: next_index,
            new_root,
        }
        .publish(&env);
    }

    /// Get current root for a DAO
    pub fn current_root(env: Env, dao_id: u64) -> U256 {
        let roots: Vec<U256> = env
            .storage()
            .persistent()
            .get(&DataKey::Roots(dao_id))
            .expect("tree not initialized");
        roots.get(roots.len() - 1).unwrap()
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

        let roots: Vec<U256> = env.storage().persistent().get(&roots_key).unwrap();
        for i in 0..roots.len() {
            if roots.get(i).unwrap() == root {
                return true;
            }
        }
        false
    }

    /// Get leaf index for a commitment
    pub fn get_leaf_index(env: Env, dao_id: u64, commitment: U256) -> u32 {
        let key = DataKey::LeafIndex(dao_id, commitment);
        env.storage()
            .persistent()
            .get(&key)
            .expect("commitment not found")
    }

    /// Get tree info for a DAO
    pub fn get_tree_info(env: Env, dao_id: u64) -> (u32, u32, U256) {
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
        let root = Self::current_root(env, dao_id);
        (depth, next_index, root)
    }

    /// Get SBT contract address
    pub fn sbt_contr(env: Env) -> Address {
        env.storage().instance().get(&SBT_CONTRACT).unwrap()
    }

    // Internal: Insert leaf and update tree
    fn insert_leaf(env: &Env, dao_id: u64, leaf: U256, index: u32, depth: u32) -> U256 {
        let mut filled: Vec<U256> = env
            .storage()
            .persistent()
            .get(&DataKey::FilledSubtrees(dao_id))
            .unwrap();

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

        current_hash
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
}

#[cfg(test)]
mod test;

