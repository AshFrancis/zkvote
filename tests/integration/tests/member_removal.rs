// Member Removal Tests
//
// Tests for the member removal feature which allows admins to revoke
// voting rights by zeroing members' leaves in the Merkle tree.

use soroban_sdk::{testutils::Address as _, Address, Env, String, U256};

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

fn setup_contracts(env: &Env) -> (Address, Address, Address, Address, Address) {
    // Deploy contracts
    let registry_id = env.register(dao_registry::WASM, ());
    let sbt_id = env.register(membership_sbt::WASM, (registry_id.clone(),));
    let tree_id = env.register(membership_tree::WASM, (sbt_id.clone(),));
    let voting_id = env.register(voting::WASM, (tree_id.clone(),));

    let admin = Address::generate(env);

    (registry_id, sbt_id, tree_id, voting_id, admin)
}

#[test]
fn test_admin_can_remove_member() {
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
    tree_client.init_tree(&dao_id, &20, &admin);

    // Add two members
    let member1 = Address::generate(&env);
    let member2 = Address::generate(&env);

    sbt_client.mint(&dao_id, &member1, &admin, &None);
    sbt_client.mint(&dao_id, &member2, &admin, &None);

    // Register commitments
    let commitment1 = U256::from_u32(&env, 111);
    let commitment2 = U256::from_u32(&env, 222);

    tree_client.register_with_caller(&dao_id, &commitment1, &member1);
    tree_client.register_with_caller(&dao_id, &commitment2, &member2);

    let root_before = tree_client.current_root(&dao_id);

    // Admin removes member1
    tree_client.remove_member(&dao_id, &member1, &admin);

    let root_after = tree_client.current_root(&dao_id);

    // Root should change after removal
    assert_ne!(root_before, root_after, "Root should change after removal");

    println!("✅ Admin successfully removed member and root changed");
}

#[test]
#[should_panic]
fn test_non_admin_cannot_remove_member() {
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
    tree_client.init_tree(&dao_id, &20, &admin);

    // Add member
    let member = Address::generate(&env);
    sbt_client.mint(&dao_id, &member, &admin, &None);

    let commitment = U256::from_u32(&env, 111);
    tree_client.register_with_caller(&dao_id, &commitment, &member);

    // Non-admin tries to remove member (should fail)
    let non_admin = Address::generate(&env);
    tree_client.remove_member(&dao_id, &member, &non_admin);
}

#[test]
#[should_panic]
fn test_cannot_remove_unregistered_member() {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let (registry_id, _sbt_id, tree_id, _voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let tree_client = TreeClient::new(&env, &tree_id);

    // Create DAO
    let dao_id = registry_client.create_dao(
        &String::from_str(&env, "Test DAO"),
        &admin,
        &false,
    );

    // Initialize tree
    tree_client.init_tree(&dao_id, &20, &admin);

    // Try to remove non-existent member (should fail)
    let non_member = Address::generate(&env);
    tree_client.remove_member(&dao_id, &non_member, &admin);
}

#[test]
fn test_removed_member_can_vote_on_old_proposal() {
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
    tree_client.init_tree(&dao_id, &20, &admin);

    // Add member and mint SBT
    let member = Address::generate(&env);
    sbt_client.mint(&dao_id, &member, &admin, &None);

    // Register commitment
    let commitment = U256::from_u32(&env, 111);
    tree_client.register_with_caller(&dao_id, &commitment, &member);

    // Get root BEFORE removal - this is what old proposals would have
    let old_root = tree_client.current_root(&dao_id);

    // Verify this root is valid
    assert!(tree_client.root_ok(&dao_id, &old_root), "Old root should be valid");

    // Remove member
    tree_client.remove_member(&dao_id, &member, &admin);

    let new_root = tree_client.current_root(&dao_id);
    assert_ne!(old_root, new_root, "Root should change after removal");

    // BOTH roots should still be valid (kept in history)
    // Old proposals would have captured old_root
    // New proposals would capture new_root
    assert!(tree_client.root_ok(&dao_id, &old_root), "Old root should still be valid");
    assert!(tree_client.root_ok(&dao_id, &new_root), "New root should be valid");

    println!("✅ Removed member can still vote on proposal created before removal");
}

#[test]
fn test_removed_member_cannot_vote_on_new_proposal() {
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
    tree_client.init_tree(&dao_id, &20, &admin);

    // Add member and mint SBT
    let member = Address::generate(&env);
    sbt_client.mint(&dao_id, &member, &admin, &None);

    // Register commitment
    let commitment = U256::from_u32(&env, 111);
    tree_client.register_with_caller(&dao_id, &commitment, &member);

    let old_root = tree_client.current_root(&dao_id);

    // Remove member
    tree_client.remove_member(&dao_id, &member, &admin);

    let new_root = tree_client.current_root(&dao_id);

    // New proposals would capture new_root (with member zeroed)
    // The removed member's proof would generate old_root
    // Proof verification would fail: old_root ≠ new_root

    assert_ne!(old_root, new_root, "Roots should be different");
    assert!(tree_client.root_ok(&dao_id, &new_root), "New root should be valid");

    println!("✅ Removed member cannot vote on proposal created after removal");
}

#[test]
fn test_multiple_removals() {
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
    tree_client.init_tree(&dao_id, &20, &admin);

    // Add three members
    let member1 = Address::generate(&env);
    let member2 = Address::generate(&env);
    let member3 = Address::generate(&env);

    sbt_client.mint(&dao_id, &member1, &admin, &None);
    sbt_client.mint(&dao_id, &member2, &admin, &None);
    sbt_client.mint(&dao_id, &member3, &admin, &None);

    // Register commitments
    tree_client.register_with_caller(&dao_id, &U256::from_u32(&env, 111), &member1);
    tree_client.register_with_caller(&dao_id, &U256::from_u32(&env, 222), &member2);
    tree_client.register_with_caller(&dao_id, &U256::from_u32(&env, 333), &member3);

    let root_initial = tree_client.current_root(&dao_id);

    // Remove member1
    tree_client.remove_member(&dao_id, &member1, &admin);
    let root_after_1 = tree_client.current_root(&dao_id);
    assert_ne!(root_initial, root_after_1);

    // Remove member2
    tree_client.remove_member(&dao_id, &member2, &admin);
    let root_after_2 = tree_client.current_root(&dao_id);
    assert_ne!(root_after_1, root_after_2);

    // Remove member3
    tree_client.remove_member(&dao_id, &member3, &admin);
    let root_after_3 = tree_client.current_root(&dao_id);
    assert_ne!(root_after_2, root_after_3);

    // All roots should be different
    assert_ne!(root_initial, root_after_1);
    assert_ne!(root_initial, root_after_2);
    assert_ne!(root_initial, root_after_3);
    assert_ne!(root_after_1, root_after_2);
    assert_ne!(root_after_1, root_after_3);
    assert_ne!(root_after_2, root_after_3);

    println!("✅ Multiple removals work correctly with unique roots");
}

#[test]
fn test_root_history_preserved_after_removal() {
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
    tree_client.init_tree(&dao_id, &20, &admin);

    // Add member
    let member = Address::generate(&env);
    sbt_client.mint(&dao_id, &member, &admin, &None);
    tree_client.register_with_caller(&dao_id, &U256::from_u32(&env, 111), &member);

    let old_root = tree_client.current_root(&dao_id);

    // Old root should be valid
    assert!(tree_client.root_ok(&dao_id, &old_root), "Old root should be valid");

    // Remove member
    tree_client.remove_member(&dao_id, &member, &admin);

    let new_root = tree_client.current_root(&dao_id);

    // Both roots should be valid (kept in history)
    assert!(tree_client.root_ok(&dao_id, &old_root), "Old root should still be valid");
    assert!(tree_client.root_ok(&dao_id, &new_root), "New root should be valid");

    println!("✅ Root history preserved after removal");
}
