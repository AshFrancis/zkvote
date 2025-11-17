#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Events as _, Env};

// Mock registry contract for testing
mod mock_registry {
    use soroban_sdk::{contract, contractimpl, Address, Env};

    #[contract]
    pub struct MockRegistry;

    #[contractimpl]
    impl MockRegistry {
        pub fn set_admin(env: Env, dao_id: u64, admin: Address) {
            env.storage().persistent().set(&dao_id, &admin);
        }

        pub fn get_admin(env: Env, dao_id: u64) -> Address {
            env.storage().persistent().get(&dao_id).unwrap()
        }
    }
}

fn setup_env() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let registry_id = env.register(mock_registry::MockRegistry, ());
    let registry_client = mock_registry::MockRegistryClient::new(&env, &registry_id);

    // Register SBT with constructor
    let sbt_id = env.register(MembershipSbt, (registry_id.clone(),));
    let _sbt_client = MembershipSbtClient::new(&env, &sbt_id);

    let admin = Address::generate(&env);
    let member = Address::generate(&env);

    // Set up mock registry with admin for DAO 1
    registry_client.set_admin(&1u64, &admin);

    (env, sbt_id, registry_id, admin, member)
}

#[test]
fn test_constructor() {
    let env = Env::default();
    env.mock_all_auths();

    let registry_id = env.register(mock_registry::MockRegistry, ());
    let sbt_id = env.register(MembershipSbt, (registry_id.clone(),));
    let client = MembershipSbtClient::new(&env, &sbt_id);

    assert_eq!(client.registry(), registry_id);
}

#[test]
fn test_mint() {
    let (env, sbt_id, _, admin, member) = setup_env();
    let client = MembershipSbtClient::new(&env, &sbt_id);

    assert!(!client.has(&1u64, &member));
    client.mint(&1u64, &member, &admin);
    assert!(client.has(&1u64, &member));
}

#[test]
#[should_panic(expected = "already minted")]
fn test_mint_twice_fails() {
    let (env, sbt_id, _, admin, member) = setup_env();
    let client = MembershipSbtClient::new(&env, &sbt_id);

    client.mint(&1u64, &member, &admin);
    client.mint(&1u64, &member, &admin); // Should panic
}

#[test]
fn test_has_returns_false_for_non_member() {
    let (env, sbt_id, _, _, _) = setup_env();
    let client = MembershipSbtClient::new(&env, &sbt_id);

    let non_member = Address::generate(&env);
    assert!(!client.has(&1u64, &non_member));
}

#[test]
fn test_mint_multiple_members_same_dao() {
    let (env, sbt_id, _, admin, member1) = setup_env();
    let client = MembershipSbtClient::new(&env, &sbt_id);

    let member2 = Address::generate(&env);
    let member3 = Address::generate(&env);

    client.mint(&1u64, &member1, &admin);
    client.mint(&1u64, &member2, &admin);
    client.mint(&1u64, &member3, &admin);

    assert!(client.has(&1u64, &member1));
    assert!(client.has(&1u64, &member2));
    assert!(client.has(&1u64, &member3));
}

#[test]
fn test_same_member_different_daos() {
    let (env, sbt_id, registry_id, admin, member) = setup_env();
    let client = MembershipSbtClient::new(&env, &sbt_id);
    let registry_client = mock_registry::MockRegistryClient::new(&env, &registry_id);

    // Set up admin for DAO 2
    registry_client.set_admin(&2u64, &admin);

    // Member joins both DAOs
    client.mint(&1u64, &member, &admin);
    client.mint(&2u64, &member, &admin);

    assert!(client.has(&1u64, &member));
    assert!(client.has(&2u64, &member));
}

#[test]
fn test_different_daos_isolated() {
    let (env, sbt_id, registry_id, admin1, member1) = setup_env();
    let client = MembershipSbtClient::new(&env, &sbt_id);
    let registry_client = mock_registry::MockRegistryClient::new(&env, &registry_id);

    let admin2 = Address::generate(&env);
    let member2 = Address::generate(&env);

    // Set up admin for DAO 2
    registry_client.set_admin(&2u64, &admin2);

    // Mint to different DAOs
    client.mint(&1u64, &member1, &admin1);
    client.mint(&2u64, &member2, &admin2);

    // Members are isolated per DAO
    assert!(client.has(&1u64, &member1));
    assert!(!client.has(&1u64, &member2));
    assert!(!client.has(&2u64, &member1));
    assert!(client.has(&2u64, &member2));
}

#[test]
#[should_panic(expected = "not DAO admin")]
fn test_wrong_admin_cannot_mint() {
    let (env, sbt_id, _, _, member) = setup_env();
    let client = MembershipSbtClient::new(&env, &sbt_id);

    let wrong_admin = Address::generate(&env);
    client.mint(&1u64, &member, &wrong_admin); // Should panic
}

#[test]
fn test_events_emitted_on_mint() {
    let (env, sbt_id, _, admin, member) = setup_env();
    let client = MembershipSbtClient::new(&env, &sbt_id);

    client.mint(&1u64, &member, &admin);

    let events = env.events().all();
    // Find SbtMint event (skip registry events)
    let mut sbt_event_count = 0u32;
    for event in events.iter() {
        if event.0 == sbt_id {
            sbt_event_count += 1;
        }
    }
    assert_eq!(sbt_event_count, 1);
}

#[test]
#[should_panic]
fn test_mint_to_nonexistent_dao_fails() {
    let (env, sbt_id, _, admin, member) = setup_env();
    let client = MembershipSbtClient::new(&env, &sbt_id);

    // DAO 999 doesn't exist in registry
    client.mint(&999u64, &member, &admin);
}

#[test]
fn test_has_on_nonexistent_dao_returns_false() {
    let (env, sbt_id, _, _, member) = setup_env();
    let client = MembershipSbtClient::new(&env, &sbt_id);

    // DAO 999 doesn't exist, but has() should just return false
    assert!(!client.has(&999u64, &member));
}
