#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal, Symbol,
};

const REGISTRY: Symbol = symbol_short!("registry");

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Member(u64, Address), // (dao_id, address)
}

// Typed Events
#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct SbtMintEvent {
    #[topic]
    pub dao_id: u64,
    pub to: Address,
}

#[contract]
pub struct MembershipSbt;

#[contractimpl]
impl MembershipSbt {
    /// Constructor: Initialize contract with DAO Registry address
    pub fn __constructor(env: Env, registry: Address) {
        env.storage().instance().set(&REGISTRY, &registry);
    }

    /// Mint SBT to address for a specific DAO
    /// Only DAO admin can mint (verified via registry)
    pub fn mint(env: Env, dao_id: u64, to: Address, admin: Address) {
        // Verify admin authorization
        admin.require_auth();

        // Verify this admin owns the DAO (cross-contract call to registry)
        let registry: Address = env.storage().instance().get(&REGISTRY).unwrap();
        let dao_admin: Address = env.invoke_contract(
            &registry,
            &symbol_short!("get_admin"),
            soroban_sdk::vec![&env, dao_id.into_val(&env)],
        );

        if dao_admin != admin {
            panic!("not DAO admin");
        }

        // Check not already minted
        if Self::has(env.clone(), dao_id, to.clone()) {
            panic!("already minted");
        }

        let key = DataKey::Member(dao_id, to.clone());
        env.storage().persistent().set(&key, &true);

        SbtMintEvent { dao_id, to }.publish(&env);
    }

    /// Check if address has SBT for a specific DAO
    pub fn has(env: Env, dao_id: u64, of: Address) -> bool {
        let key = DataKey::Member(dao_id, of);
        env.storage().persistent().get(&key).unwrap_or(false)
    }

    /// Get registry address
    pub fn registry(env: Env) -> Address {
        env.storage().instance().get(&REGISTRY).unwrap()
    }
}

#[cfg(test)]
mod test;
