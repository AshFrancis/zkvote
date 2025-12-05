#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Env, IntoVal, Symbol,
};

const REGISTRY: Symbol = symbol_short!("registry");
const VERSION: u32 = 1;
const VERSION_KEY: Symbol = symbol_short!("ver");

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SbtError {
    NotDaoAdmin = 1,
    AlreadyMinted = 2,
    NotMember = 3,
    NotOpenMembership = 4,
    AlreadyInitialized = 5,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Member(u64, Address),    // (dao_id, address)
    Alias(u64, Address),     // (dao_id, address) -> encrypted alias
    Revoked(u64, Address),   // (dao_id, address) -> bool (revocation flag)
    MemberCount(u64),        // dao_id -> total member count
    MemberAtIndex(u64, u64), // (dao_id, index) -> Address
}

// Typed Events
#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct SbtMintEvent {
    #[topic]
    pub dao_id: u64,
    pub to: Address,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct SbtRevokeEvent {
    #[topic]
    pub dao_id: u64,
    pub member: Address,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct SbtLeaveEvent {
    #[topic]
    pub dao_id: u64,
    pub member: Address,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct ContractUpgraded {
    pub from: u32,
    pub to: u32,
}

#[contract]
pub struct MembershipSbt;

#[contractimpl]
impl MembershipSbt {
    /// Constructor: Initialize contract with DAO Registry address
    pub fn __constructor(env: Env, registry: Address) {
        if env.storage().instance().has(&VERSION_KEY) {
            panic_with_error!(&env, SbtError::AlreadyInitialized);
        }
        env.storage().instance().set(&VERSION_KEY, &VERSION);
        ContractUpgraded {
            from: 0,
            to: VERSION,
        }
        .publish(&env);

        env.storage().instance().set(&REGISTRY, &registry);
    }

    fn registry_addr(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&REGISTRY)
            .unwrap_or_else(|| panic_with_error!(env, SbtError::NotDaoAdmin))
    }

    /// Helper: Add member to enumeration list
    fn add_member_to_list(env: &Env, dao_id: u64, member: &Address) {
        let count_key = DataKey::MemberCount(dao_id);
        let current_count: u64 = env.storage().persistent().get(&count_key).unwrap_or(0);

        // Add member at current index
        let index_key = DataKey::MemberAtIndex(dao_id, current_count);
        env.storage().persistent().set(&index_key, member);

        // Increment count
        env.storage()
            .persistent()
            .set(&count_key, &(current_count + 1));
    }

    /// Mint SBT to address for a specific DAO
    /// Only DAO admin can mint (verified via registry)
    /// Optionally stores an encrypted alias for the member
    /// Can re-mint to previously revoked members
    pub fn mint(
        env: Env,
        dao_id: u64,
        to: Address,
        admin: Address,
        encrypted_alias: Option<soroban_sdk::String>,
    ) {
        // Verify admin authorization
        admin.require_auth();

        // Verify this admin owns the DAO (cross-contract call to registry)
        let registry: Address = Self::registry_addr(&env);
        let dao_admin: Address = env.invoke_contract(
            &registry,
            &symbol_short!("get_admin"),
            soroban_sdk::vec![&env, dao_id.into_val(&env)],
        );

        if dao_admin != admin {
            panic_with_error!(&env, SbtError::NotDaoAdmin);
        }

        // Check if already has active SBT (not revoked)
        if Self::has(env.clone(), dao_id, to.clone()) {
            panic_with_error!(&env, SbtError::AlreadyMinted);
        }

        let member_key = DataKey::Member(dao_id, to.clone());
        let revoked_key = DataKey::Revoked(dao_id, to.clone());

        // Check if this is a new member (not just re-minting)
        let is_new_member = !env.storage().persistent().has(&member_key);

        // Set member
        env.storage().persistent().set(&member_key, &true);

        // Clear revoked flag if it exists (allows re-minting)
        if env.storage().persistent().has(&revoked_key) {
            env.storage().persistent().remove(&revoked_key);
        }

        // Store encrypted alias if provided
        if let Some(alias) = encrypted_alias {
            let alias_key = DataKey::Alias(dao_id, to.clone());
            env.storage().persistent().set(&alias_key, &alias);
        }

        // Add to enumeration list if new member
        if is_new_member {
            Self::add_member_to_list(&env, dao_id, &to);
        }

        SbtMintEvent { dao_id, to }.publish(&env);
    }

    /// Mint SBT from registry during DAO initialization
    /// This function is called by the registry contract during create_and_init_dao
    /// to avoid re-entrancy issues. The registry is a trusted system contract.
    pub fn mint_from_registry(env: Env, dao_id: u64, to: Address) {
        // Check not already minted
        if Self::has(env.clone(), dao_id, to.clone()) {
            panic_with_error!(&env, SbtError::AlreadyMinted);
        }

        let key = DataKey::Member(dao_id, to.clone());
        env.storage().persistent().set(&key, &true);

        // Add to enumeration list
        Self::add_member_to_list(&env, dao_id, &to);

        SbtMintEvent { dao_id, to }.publish(&env);
    }

    /// Check if address has SBT for a specific DAO (and is not revoked)
    pub fn has(env: Env, dao_id: u64, of: Address) -> bool {
        let member_key = DataKey::Member(dao_id, of.clone());
        let revoked_key = DataKey::Revoked(dao_id, of);

        // Must have SBT AND not be revoked
        let has_sbt = env.storage().persistent().get(&member_key).unwrap_or(false);
        let is_revoked = env
            .storage()
            .persistent()
            .get(&revoked_key)
            .unwrap_or(false);

        has_sbt && !is_revoked
    }

    /// Get registry address
    pub fn registry(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&REGISTRY)
            .unwrap_or_else(|| panic_with_error!(&env, SbtError::NotDaoAdmin))
    }

    /// Get encrypted alias for a member (if set)
    pub fn get_alias(env: Env, dao_id: u64, member: Address) -> Option<soroban_sdk::String> {
        let key = DataKey::Alias(dao_id, member);
        env.storage().persistent().get(&key)
    }

    /// Revoke an SBT (admin only)
    /// Sets revocation flag, keeping member entry and alias intact
    pub fn revoke(env: Env, dao_id: u64, member: Address, admin: Address) {
        // Verify admin authorization
        admin.require_auth();

        // Verify this admin owns the DAO (cross-contract call to registry)
        let registry: Address = Self::registry_addr(&env);
        let dao_admin: Address = env.invoke_contract(
            &registry,
            &symbol_short!("get_admin"),
            soroban_sdk::vec![&env, dao_id.into_val(&env)],
        );

        if dao_admin != admin {
            panic_with_error!(&env, SbtError::NotDaoAdmin);
        }

        // Member must exist
        let member_key = DataKey::Member(dao_id, member.clone());
        if !env.storage().persistent().has(&member_key) {
            panic_with_error!(&env, SbtError::NotMember);
        }

        // Set revoked flag
        let revoked_key = DataKey::Revoked(dao_id, member.clone());
        env.storage().persistent().set(&revoked_key, &true);

        SbtRevokeEvent { dao_id, member }.publish(&env);
    }

    /// Leave DAO voluntarily (member self-revokes)
    /// Sets revocation flag, keeping member entry and alias intact
    pub fn leave(env: Env, dao_id: u64, member: Address) {
        // Member must authorize their own departure
        member.require_auth();

        // Member must exist
        let member_key = DataKey::Member(dao_id, member.clone());
        if !env.storage().persistent().has(&member_key) {
            panic_with_error!(&env, SbtError::NotMember);
        }

        // Set revoked flag
        let revoked_key = DataKey::Revoked(dao_id, member.clone());
        env.storage().persistent().set(&revoked_key, &true);

        SbtLeaveEvent { dao_id, member }.publish(&env);
    }

    /// Self-join a DAO with open membership
    /// Allows users to mint their own SBT if the DAO allows open membership
    pub fn self_join(
        env: Env,
        dao_id: u64,
        member: Address,
        encrypted_alias: Option<soroban_sdk::String>,
    ) {
        // Member must authorize
        member.require_auth();

        // Check with registry if this DAO has open membership
        let registry: Address = Self::registry_addr(&env);
        let membership_open: bool = env.invoke_contract(
            &registry,
            &Symbol::new(&env, "is_membership_open"),
            soroban_sdk::vec![&env, dao_id.into_val(&env)],
        );

        if !membership_open {
            panic_with_error!(&env, SbtError::NotOpenMembership);
        }

        // Check if already has active SBT (not revoked)
        if Self::has(env.clone(), dao_id, member.clone()) {
            panic_with_error!(&env, SbtError::AlreadyMinted);
        }

        let member_key = DataKey::Member(dao_id, member.clone());
        let revoked_key = DataKey::Revoked(dao_id, member.clone());

        // Check if this is a new member (not just re-minting)
        let is_new_member = !env.storage().persistent().has(&member_key);

        // Set member
        env.storage().persistent().set(&member_key, &true);

        // Clear revoked flag if it exists (allows re-joining)
        if env.storage().persistent().has(&revoked_key) {
            env.storage().persistent().remove(&revoked_key);
        }

        // Store encrypted alias if provided
        if let Some(alias) = encrypted_alias {
            let alias_key = DataKey::Alias(dao_id, member.clone());
            env.storage().persistent().set(&alias_key, &alias);
        }

        // Add to enumeration list if new member
        if is_new_member {
            Self::add_member_to_list(&env, dao_id, &member);
        }

        SbtMintEvent { dao_id, to: member }.publish(&env);
    }

    /// Update encrypted alias for a member (admin only)
    pub fn update_alias(
        env: Env,
        dao_id: u64,
        member: Address,
        admin: Address,
        new_encrypted_alias: soroban_sdk::String,
    ) {
        // Verify admin authorization
        admin.require_auth();

        // Verify this admin owns the DAO (cross-contract call to registry)
        let registry: Address = Self::registry_addr(&env);
        let dao_admin: Address = env.invoke_contract(
            &registry,
            &symbol_short!("get_admin"),
            soroban_sdk::vec![&env, dao_id.into_val(&env)],
        );

        if dao_admin != admin {
            panic_with_error!(&env, SbtError::NotDaoAdmin);
        }

        // Member must exist
        let member_key = DataKey::Member(dao_id, member.clone());
        if !env.storage().persistent().has(&member_key) {
            panic_with_error!(&env, SbtError::NotMember);
        }

        // Update alias
        let alias_key = DataKey::Alias(dao_id, member);
        env.storage()
            .persistent()
            .set(&alias_key, &new_encrypted_alias);
    }

    /// Get total member count for a DAO
    pub fn get_member_count(env: Env, dao_id: u64) -> u64 {
        let count_key = DataKey::MemberCount(dao_id);
        env.storage().persistent().get(&count_key).unwrap_or(0)
    }

    /// Get member address at a specific index
    pub fn get_member_at_index(env: Env, dao_id: u64, index: u64) -> Option<Address> {
        let index_key = DataKey::MemberAtIndex(dao_id, index);
        env.storage().persistent().get(&index_key)
    }

    /// Get a batch of members for a DAO
    /// Returns addresses from offset to offset+limit (or end of list)
    pub fn get_members(
        env: Env,
        dao_id: u64,
        offset: u64,
        limit: u64,
    ) -> soroban_sdk::Vec<Address> {
        let mut members = soroban_sdk::Vec::new(&env);
        let count = Self::get_member_count(env.clone(), dao_id);

        let start = offset;
        let end = core::cmp::min(offset + limit, count);

        for i in start..end {
            if let Some(member) = Self::get_member_at_index(env.clone(), dao_id, i) {
                members.push_back(member);
            }
        }

        members
    }

    /// Contract version for upgrade tracking.
    pub fn version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&VERSION_KEY)
            .unwrap_or(VERSION)
    }
}

#[cfg(test)]
mod test;
