#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol};

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
    /// Create a new DAO with specified admin.
    /// Admin must authorize this call.
    pub fn create_dao(env: Env, name: String, admin: Address) -> u64 {
        admin.require_auth();

        // Validate name length to prevent DoS
        if name.len() > MAX_DAO_NAME_LEN {
            panic!("DAO name too long");
        }

        let dao_id = Self::next_dao_id(&env);

        let info = DaoInfo {
            id: dao_id,
            name: name.clone(),
            admin: admin.clone(),
            created_at: env.ledger().timestamp(),
        };

        let key = Self::dao_key(dao_id);
        env.storage().persistent().set(&key, &info);

        DaoCreateEvent {
            dao_id,
            admin,
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
