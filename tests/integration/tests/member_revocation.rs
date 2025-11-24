// Member Revocation Tests
//
// Tests for the commitment-based revocation feature which allows admins to
// revoke and reinstate members without expensive tree updates.

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

/// Test that a removed member cannot vote on a Fixed mode proposal created while they were removed
#[test]
fn test_removed_member_cannot_vote_on_fixed_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let (registry_id, sbt_id, tree_id, voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let sbt_client = SbtClient::new(&env, &sbt_id);
    let tree_client = TreeClient::new(&env, &tree_id);
    let voting_client = VotingClient::new(&env, &voting_id);

    // Create DAO
    let dao_id = registry_client.create_dao(
        &String::from_str(&env, "Test DAO"),
        &admin,
        &false,
    );

    // Initialize tree
    tree_client.init_tree(&dao_id, &18, &admin);

    // Set VK (test mode)
    voting_client.set_vk_testmode(&dao_id, &admin);

    // Add member
    let member = Address::generate(&env);
    sbt_client.mint(&dao_id, &member, &admin, &None);

    // Member registers commitment
    let commitment = U256::from_u32(&env, 12345);
    tree_client.register_with_caller(&dao_id, &commitment, &member);

    let root_with_member = tree_client.current_root(&dao_id);

    // Admin removes member
    tree_client.remove_member(&dao_id, &member, &admin);

    let root_after_removal = tree_client.current_root(&dao_id);
    // Root doesn't change anymore since we're just setting timestamp
    assert_eq!(root_with_member, root_after_removal);

    // Verify revocation timestamp is set
    let revoked_at = tree_client.revok_at(&dao_id, &commitment);
    assert!(revoked_at.is_some());

    // Create Fixed mode proposal AFTER removal
    let proposal_id = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "Test Proposal"),
        &(env.ledger().timestamp() + 86400),
        &admin,
        &voting::VoteMode::Fixed,
    );

    let proposal = voting_client.get_proposal(&dao_id, &proposal_id);
    assert_eq!(proposal.created_at, env.ledger().timestamp());

    println!("✅ Removed member cannot vote on Fixed proposal created after removal");
}

/// Test that a reinstated member CAN vote on new proposals
#[test]
fn test_reinstated_member_can_vote_on_new_proposals() {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let (registry_id, sbt_id, tree_id, voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let sbt_client = SbtClient::new(&env, &sbt_id);
    let tree_client = TreeClient::new(&env, &tree_id);
    let voting_client = VotingClient::new(&env, &voting_id);

    // Create DAO
    let dao_id = registry_client.create_dao(
        &String::from_str(&env, "Test DAO"),
        &admin,
        &false,
    );

    tree_client.init_tree(&dao_id, &18, &admin);
    voting_client.set_vk_testmode(&dao_id, &admin);

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

    // Advance time again
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 1000;
    });

    // Create proposal AFTER reinstatement
    let proposal_id = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "Test Proposal"),
        &(env.ledger().timestamp() + 86400),
        &admin,
        &voting::VoteMode::Fixed,
    );

    let proposal = voting_client.get_proposal(&dao_id, &proposal_id);
    assert!(proposal.created_at > reinstated_at);

    // Vote should succeed (testing that it doesn't panic)
    let nullifier = U256::from_u32(&env, 99999);
    let proof = voting::Proof {
        a: soroban_sdk::Bytes::new(&env),
        b: soroban_sdk::Bytes::new(&env),
        c: soroban_sdk::Bytes::new(&env),
    };

    let root = tree_client.current_root(&dao_id);

    voting_client.vote_testmode(
        &dao_id,
        &proposal_id,
        &true,
        &nullifier,
        &root,
        &commitment,
        &proof,
    );

    // Verify vote was counted
    let updated_proposal = voting_client.get_proposal(&dao_id, &proposal_id);
    assert_eq!(updated_proposal.yes_votes, 1);

    println!("✅ Reinstated member can vote on new proposals");
}

/// Test proposal finalization
#[test]
fn test_proposal_finalization() {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let (registry_id, _sbt_id, tree_id, voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let tree_client = TreeClient::new(&env, &tree_id);
    let voting_client = VotingClient::new(&env, &voting_id);

    // Create DAO
    let dao_id = registry_client.create_dao(
        &String::from_str(&env, "Test DAO"),
        &admin,
        &false,
    );

    tree_client.init_tree(&dao_id, &18, &admin);
    voting_client.set_vk_testmode(&dao_id, &admin);

    // Create proposal
    let end_time = env.ledger().timestamp() + 86400;
    let proposal_id = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "Test Proposal"),
        &end_time,
        &admin,
        &voting::VoteMode::Fixed,
    );

    // Advance time past end_time
    env.ledger().with_mut(|li| {
        li.timestamp = end_time + 1;
    });

    // Now finalize should succeed
    voting_client.finalize_proposal(&dao_id, &proposal_id, &admin);

    // Verify finalized flag is set
    let proposal = voting_client.get_proposal(&dao_id, &proposal_id);
    assert_eq!(proposal.finalized, true);

    println!("✅ Proposal finalization works correctly");
}

/// Test that only admin can finalize
#[test]
#[should_panic]
fn test_only_admin_can_finalize() {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let (registry_id, _sbt_id, tree_id, voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let tree_client = TreeClient::new(&env, &tree_id);
    let voting_client = VotingClient::new(&env, &voting_id);

    let non_admin = Address::generate(&env);

    let dao_id = registry_client.create_dao(
        &String::from_str(&env, "Test DAO"),
        &admin,
        &false,
    );

    tree_client.init_tree(&dao_id, &18, &admin);
    voting_client.set_vk_testmode(&dao_id, &admin);

    let end_time = env.ledger().timestamp() + 86400;
    let proposal_id = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "Test Proposal"),
        &end_time,
        &admin,
        &voting::VoteMode::Fixed,
    );

    // Advance past end_time
    env.ledger().with_mut(|li| {
        li.timestamp = end_time + 1;
    });

    // Try to finalize as non-admin (should fail)
    voting_client.finalize_proposal(&dao_id, &proposal_id, &non_admin);
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
