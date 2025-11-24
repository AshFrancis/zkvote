// Member Revocation Tests
//
// Tests for the commitment-based revocation feature which allows admins to
// revoke and reinstate members without expensive tree updates.

use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env, String, U256};

// Import all contract clients
mod dao_registry {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/dao_registry.wasm"
    );
}

mod membership_sbt {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/membership_sbt.wasm"
    );
}

mod membership_tree {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/membership_tree.wasm"
    );
}

mod voting {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/release/voting.wasm"
    );
}

use dao_registry::Client as RegistryClient;
use membership_sbt::Client as SbtClient;
use membership_tree::Client as TreeClient;
use voting::Client as VotingClient;

fn setup_contracts(env: &Env) -> (Address, Address, Address, Address, Address) {
    // Deploy contracts
    let registry_id = env.register(dao_registry::WASM, ());
    let sbt_id = env.register(membership_sbt::WASM, (registry_id.clone(),));
    let tree_id = env.register(membership_tree::WASM, (sbt_id.clone(),));
    let voting_id = env.register(voting::WASM, (tree_id.clone(),));

    let admin = Address::generate(env);

    (registry_id, sbt_id, tree_id, voting_id, admin)
}

/// Test that admin can successfully revoke a member's commitment
#[test]
fn test_admin_can_revoke_member() {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let (registry_id, sbt_id, tree_id, _voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let sbt_client = SbtClient::new(&env, &sbt_id);
    let tree_client = TreeClient::new(&env, &tree_id);

    // Create DAO
    let dao_id = registry_client.create_dao(
        &String::from_str(&env, "Test DAO"),
        &admin,
        &false,
    );

    // Initialize tree
    tree_client.init_tree(&dao_id, &18, &admin);

    // Add member
    let member = Address::generate(&env);
    sbt_client.mint(&dao_id, &member, &admin, &None);

    // Member registers commitment
    let commitment = U256::from_u32(&env, 12345);
    tree_client.register_with_caller(&dao_id, &commitment, &member);

    let root_before = tree_client.current_root(&dao_id);

    // Admin removes member
    tree_client.remove_member(&dao_id, &member, &admin);

    let root_after = tree_client.current_root(&dao_id);
    // Root doesn't change with commitment-based revocation
    assert_eq!(root_before, root_after);

    // Verify revocation timestamp is set
    let revoked_at = tree_client.revok_at(&dao_id, &commitment);
    assert!(revoked_at.is_some());
    assert_eq!(revoked_at.unwrap(), env.ledger().timestamp());

    println!("✅ Admin can successfully revoke member");
}

/// Test that admin can reinstate a revoked member
#[test]
fn test_admin_can_reinstate_member() {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let (registry_id, sbt_id, tree_id, _voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let sbt_client = SbtClient::new(&env, &sbt_id);
    let tree_client = TreeClient::new(&env, &tree_id);

    // Create DAO
    let dao_id = registry_client.create_dao(
        &String::from_str(&env, "Test DAO"),
        &admin,
        &false,
    );

    tree_client.init_tree(&dao_id, &18, &admin);

    let member = Address::generate(&env);
    sbt_client.mint(&dao_id, &member, &admin, &None);

    let commitment = U256::from_u32(&env, 12345);
    tree_client.register_with_caller(&dao_id, &commitment, &member);

    // Remove member
    tree_client.remove_member(&dao_id, &member, &admin);

    let revoked_at = tree_client.revok_at(&dao_id, &commitment).unwrap();

    // Advance time
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 1000;
    });

    // Reinstate member
    tree_client.reinstate_member(&dao_id, &member, &admin);

    let reinstated_at = tree_client.reinst_at(&dao_id, &commitment).unwrap();
    assert!(reinstated_at > revoked_at);

    // Verify both timestamps are set correctly
    assert_eq!(tree_client.revok_at(&dao_id, &commitment), Some(revoked_at));
    assert_eq!(tree_client.reinst_at(&dao_id, &commitment), Some(reinstated_at));

    println!("✅ Admin can reinstate revoked member");
}

/// Test multiple revoke/reinstate cycles
#[test]
fn test_multiple_revoke_reinstate_cycles() {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let (registry_id, sbt_id, tree_id, _voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let sbt_client = SbtClient::new(&env, &sbt_id);
    let tree_client = TreeClient::new(&env, &tree_id);

    let dao_id = registry_client.create_dao(
        &String::from_str(&env, "Test DAO"),
        &admin,
        &false,
    );

    tree_client.init_tree(&dao_id, &18, &admin);

    let member = Address::generate(&env);
    sbt_client.mint(&dao_id, &member, &admin, &None);

    let commitment = U256::from_u32(&env, 12345);
    tree_client.register_with_caller(&dao_id, &commitment, &member);

    // First revoke
    tree_client.remove_member(&dao_id, &member, &admin);
    let revoked_at_1 = tree_client.revok_at(&dao_id, &commitment).unwrap();

    env.ledger().with_mut(|li| li.timestamp = li.timestamp + 100);

    // First reinstate
    tree_client.reinstate_member(&dao_id, &member, &admin);
    let reinstated_at_1 = tree_client.reinst_at(&dao_id, &commitment).unwrap();
    assert!(reinstated_at_1 > revoked_at_1);

    env.ledger().with_mut(|li| li.timestamp = li.timestamp + 100);

    // Second revoke
    tree_client.remove_member(&dao_id, &member, &admin);
    let revoked_at_2 = tree_client.revok_at(&dao_id, &commitment).unwrap();
    assert!(revoked_at_2 > reinstated_at_1);

    println!("✅ Multiple revoke/reinstate cycles work correctly");
}

/// Test that only admin can remove members
#[test]
#[should_panic]
fn test_only_admin_can_remove_member() {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let (registry_id, sbt_id, tree_id, _voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let sbt_client = SbtClient::new(&env, &sbt_id);
    let tree_client = TreeClient::new(&env, &tree_id);

    let non_admin = Address::generate(&env);
    let member = Address::generate(&env);

    let dao_id = registry_client.create_dao(
        &String::from_str(&env, "Test DAO"),
        &admin,
        &false,
    );

    tree_client.init_tree(&dao_id, &18, &admin);

    sbt_client.mint(&dao_id, &member, &admin, &None);
    let commitment = U256::from_u32(&env, 12345);
    tree_client.register_with_caller(&dao_id, &commitment, &member);

    // Try to remove as non-admin (should fail)
    tree_client.remove_member(&dao_id, &member, &non_admin);
}

/// Test that only admin can reinstate members
#[test]
#[should_panic]
fn test_only_admin_can_reinstate_member() {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let (registry_id, sbt_id, tree_id, _voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let sbt_client = SbtClient::new(&env, &sbt_id);
    let tree_client = TreeClient::new(&env, &tree_id);

    let non_admin = Address::generate(&env);
    let member = Address::generate(&env);

    let dao_id = registry_client.create_dao(
        &String::from_str(&env, "Test DAO"),
        &admin,
        &false,
    );

    tree_client.init_tree(&dao_id, &18, &admin);

    sbt_client.mint(&dao_id, &member, &admin, &None);
    let commitment = U256::from_u32(&env, 12345);
    tree_client.register_with_caller(&dao_id, &commitment, &member);

    // Remove member
    tree_client.remove_member(&dao_id, &member, &admin);

    // Try to reinstate as non-admin (should fail)
    tree_client.reinstate_member(&dao_id, &member, &non_admin);
}
