#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, String, Symbol, Vec};

const DAO_COUNT: Symbol = symbol_short!("dao_cnt");

// Size limit to prevent DoS attacks
const MAX_DAO_NAME_LEN: u32 = 256;  // Max DAO name length (256 chars)

#[contracttype]
#[derive(Clone)]
pub struct DaoInfo {
    pub id: u64,
    pub name: String,
    pub admin: Address,
    pub created_at: u64,
    pub membership_open: bool,
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

// Typed Events
#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct DaoCreateEvent {
    #[topic]
    pub dao_id: u64,
    pub admin: Address,
    pub name: String,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct AdminXferEvent {
    #[topic]
    pub dao_id: u64,
    pub old_admin: Address,
    pub new_admin: Address,
}

#[contract]
pub struct DaoRegistry;

#[contractimpl]
impl DaoRegistry {
    /// Create a new DAO (permissionless).
    /// Creator automatically becomes the admin.
    /// Cannot create DAOs for other people - you can only create your own DAO.
    pub fn create_dao(env: Env, name: String, creator: Address, membership_open: bool) -> u64 {
        creator.require_auth();

        // Validate name length to prevent DoS
        if name.len() > MAX_DAO_NAME_LEN {
            panic!("DAO name too long");
        }

        let dao_id = Self::next_dao_id(&env);

        // Creator automatically becomes admin (prevents making others admin without consent)
        let info = DaoInfo {
            id: dao_id,
            name: name.clone(),
            admin: creator.clone(),
            created_at: env.ledger().timestamp(),
            membership_open,
        };

        let key = Self::dao_key(dao_id);
        env.storage().persistent().set(&key, &info);

        DaoCreateEvent {
            dao_id,
            admin: creator,
            name,
        }
        .publish(&env);

        dao_id
    }

    /// Get DAO info
    pub fn get_dao(env: Env, dao_id: u64) -> DaoInfo {
        let key = Self::dao_key(dao_id);
        env.storage()
            .persistent()
            .get(&key)
            .expect("DAO not found")
    }

    /// Check if DAO exists
    pub fn dao_exists(env: Env, dao_id: u64) -> bool {
        let key = Self::dao_key(dao_id);
        env.storage().persistent().has(&key)
    }

    /// Get admin of a DAO
    pub fn get_admin(env: Env, dao_id: u64) -> Address {
        Self::get_dao(env, dao_id).admin
    }

    /// Transfer admin rights (current admin only)
    pub fn transfer_admin(env: Env, dao_id: u64, new_admin: Address) {
        let key = Self::dao_key(dao_id);
        let mut info: DaoInfo = env.storage().persistent().get(&key).expect("DAO not found");

        info.admin.require_auth();

        let old_admin = info.admin.clone();
        info.admin = new_admin.clone();
        env.storage().persistent().set(&key, &info);

        AdminXferEvent {
            dao_id,
            old_admin,
            new_admin,
        }
        .publish(&env);
    }

    /// Get total number of DAOs created
    pub fn dao_count(env: Env) -> u64 {
        env.storage().instance().get(&DAO_COUNT).unwrap_or(0)
    }

    /// Check if a DAO has open membership
    pub fn is_membership_open(env: Env, dao_id: u64) -> bool {
        Self::get_dao(env, dao_id).membership_open
    }

    /// Create and initialize DAO without registering creator for voting.
    /// Creator must register separately using deterministic credentials.
    /// This calls:
    /// 1. create_dao (creates registry entry)
    /// 2. membership_sbt.mint (mints SBT to creator)
    /// 3. membership_tree.init_tree (initializes Merkle tree)
    /// 4. voting.set_vk (sets verification key)
    pub fn create_and_init_dao_no_reg(
        env: Env,
        name: String,
        creator: Address,
        membership_open: bool,
        sbt_contract: Address,
        tree_contract: Address,
        voting_contract: Address,
        tree_depth: u32,
        vk: VerificationKey,
    ) -> u64 {
        creator.require_auth();

        // Validate name length to prevent DoS
        if name.len() > MAX_DAO_NAME_LEN {
            panic!("DAO name too long");
        }

        // Step 1: Create DAO registry entry
        let dao_id = Self::next_dao_id(&env);
        let info = DaoInfo {
            id: dao_id,
            name: name.clone(),
            admin: creator.clone(),
            created_at: env.ledger().timestamp(),
            membership_open,
        };

        let key = Self::dao_key(dao_id);
        env.storage().persistent().set(&key, &info);

        DaoCreateEvent {
            dao_id,
            admin: creator.clone(),
            name,
        }
        .publish(&env);

        // Step 2: Mint SBT to creator
        use soroban_sdk::IntoVal;
        let mint_args = soroban_sdk::vec![
            &env,
            dao_id.into_val(&env),
            creator.clone().into_val(&env)
        ];
        env.invoke_contract::<()>(
            &sbt_contract,
            &Symbol::new(&env, "mint_from_registry"),
            mint_args
        );

        // Step 3: Initialize Merkle tree
        let init_tree_args = soroban_sdk::vec![
            &env,
            dao_id.into_val(&env),
            tree_depth.into_val(&env)
        ];
        env.invoke_contract::<()>(
            &tree_contract,
            &Symbol::new(&env, "init_tree_from_registry"),
            init_tree_args
        );

        // Step 4: Set verification key
        let set_vk_args = soroban_sdk::vec![
            &env,
            dao_id.into_val(&env),
            vk.into_val(&env)
        ];
        env.invoke_contract::<()>(
            &voting_contract,
            &Symbol::new(&env, "set_vk_from_registry"),
            set_vk_args
        );

        dao_id
    }

    /// Create and fully initialize a DAO in a single transaction.
    /// This calls:
    /// 1. create_dao (creates registry entry)
    /// 2. membership_sbt.mint (mints SBT to creator)
    /// 3. membership_tree.init_tree (initializes Merkle tree)
    /// 4. membership_tree.register_from_registry (registers creator's commitment)
    /// 5. voting.set_vk (sets verification key)
    pub fn create_and_init_dao(
        env: Env,
        name: String,
        creator: Address,
        membership_open: bool,
        sbt_contract: Address,
        tree_contract: Address,
        voting_contract: Address,
        tree_depth: u32,
        creator_commitment: soroban_sdk::U256,
        vk: VerificationKey,
    ) -> u64 {
        creator.require_auth();

        // Validate name length to prevent DoS
        if name.len() > MAX_DAO_NAME_LEN {
            panic!("DAO name too long");
        }

        // Step 1: Create DAO registry entry
        let dao_id = Self::next_dao_id(&env);
        let info = DaoInfo {
            id: dao_id,
            name: name.clone(),
            admin: creator.clone(),
            created_at: env.ledger().timestamp(),
            membership_open,
        };

        let key = Self::dao_key(dao_id);
        env.storage().persistent().set(&key, &info);

        DaoCreateEvent {
            dao_id,
            admin: creator.clone(),
            name,
        }
        .publish(&env);

        // Step 2: Mint SBT to creator (using mint_from_registry to avoid re-entrancy)
        use soroban_sdk::IntoVal;
        let mint_args = soroban_sdk::vec![
            &env,
            dao_id.into_val(&env),
            creator.clone().into_val(&env)
        ];
        env.invoke_contract::<()>(
            &sbt_contract,
            &Symbol::new(&env, "mint_from_registry"),
            mint_args
        );

        // Step 3: Initialize Merkle tree (using init_tree_from_registry to avoid re-entrancy)
        let init_tree_args = soroban_sdk::vec![
            &env,
            dao_id.into_val(&env),
            tree_depth.into_val(&env)
        ];
        env.invoke_contract::<()>(
            &tree_contract,
            &Symbol::new(&env, "init_tree_from_registry"),
            init_tree_args
        );

        // Step 4: Register creator's commitment in the tree
        let register_args = soroban_sdk::vec![
            &env,
            dao_id.into_val(&env),
            creator_commitment.into_val(&env),
            creator.clone().into_val(&env)
        ];
        env.invoke_contract::<()>(
            &tree_contract,
            &Symbol::new(&env, "register_from_registry"),
            register_args
        );

        // Step 5: Set verification key (using set_vk_from_registry to avoid re-entrancy)
        let set_vk_args = soroban_sdk::vec![
            &env,
            dao_id.into_val(&env),
            vk.into_val(&env)
        ];
        env.invoke_contract::<()>(
            &voting_contract,
            &Symbol::new(&env, "set_vk_from_registry"),
            set_vk_args
        );

        dao_id
    }

    // Internal helpers

    fn next_dao_id(env: &Env) -> u64 {
        let count: u64 = env.storage().instance().get(&DAO_COUNT).unwrap_or(0);
        let new_id = count + 1;
        env.storage().instance().set(&DAO_COUNT, &new_id);
        new_id
    }

    fn dao_key(dao_id: u64) -> (Symbol, u64) {
        (symbol_short!("dao"), dao_id)
    }
}

#[cfg(test)]
mod test;
