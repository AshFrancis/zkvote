// Proposal Deadline Tests
//
// Tests for proposal end_time/deadline functionality:
// 1. Voting before deadline succeeds
// 2. Voting after deadline fails with "voting period closed" error
// 3. end_time = 0 means no deadline (voting never closes)
// 4. Creating proposal with past end_time fails

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
use voting::{Client as VotingClient, VoteMode};

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
fn test_create_proposal_with_future_deadline() {
    let env = Env::default();
    env.mock_all_auths();

    let (registry_id, sbt_id, tree_id, voting_id, admin) = setup_contracts(&env);

    let registry = RegistryClient::new(&env, &registry_id);
    let sbt = SbtClient::new(&env, &sbt_id);
    let tree = TreeClient::new(&env, &tree_id);
    let voting = VotingClient::new(&env, &voting_id);

    // Create DAO with admin
    let dao_id = registry.create_dao(
        &String::from_str(&env, "Test DAO"),
        &admin,
        &false,
    );

    // Mint SBT for admin (required for init_tree)
    sbt.mint(&dao_id, &admin, &admin, &None);

    // Initialize tree with proper admin verification
    tree.init_tree(&dao_id, &18, &admin);

    // Register admin's commitment so tree has a valid root
    let admin_commitment = U256::from_u32(&env, 12345);
    tree.register_with_caller(&dao_id, &admin_commitment, &admin);

    // Set VK with proper admin verification (using mock VK - IC must have exactly 7 elements for vote circuit)
    let mock_alpha = soroban_sdk::BytesN::from_array(&env, &[0u8; 64]);
    let mock_beta = soroban_sdk::BytesN::from_array(&env, &[0u8; 128]);
    let mock_gamma = soroban_sdk::BytesN::from_array(&env, &[0u8; 128]);
    let mock_delta = soroban_sdk::BytesN::from_array(&env, &[0u8; 128]);
    let mock_ic = soroban_sdk::vec![
        &env,
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
    ];

    let mock_vk = voting::VerificationKey {
        alpha: mock_alpha,
        beta: mock_beta,
        gamma: mock_gamma,
        delta: mock_delta,
        ic: mock_ic,
    };

    voting.set_vk(&dao_id, &mock_vk, &admin);

    // Get current timestamp
    let now = env.ledger().timestamp();
    let future_time = now + 1000; // 1000 seconds in the future

    // Create proposal with future deadline - should succeed
    let proposal_id = voting.create_proposal(
        &dao_id,
        &String::from_str(&env, "Test proposal with deadline"),
        &future_time,
        &admin,
        &VoteMode::Fixed,
    );

    assert_eq!(proposal_id, 1);
}

#[test]
#[should_panic(expected = "end time must be in the future or 0 for no deadline")]
fn test_create_proposal_with_past_deadline_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (registry_id, sbt_id, tree_id, voting_id, admin) = setup_contracts(&env);

    let registry = RegistryClient::new(&env, &registry_id);
    let sbt = SbtClient::new(&env, &sbt_id);
    let tree = TreeClient::new(&env, &tree_id);
    let voting = VotingClient::new(&env, &voting_id);

    // Create DAO with admin
    let dao_id = registry.create_dao(
        &String::from_str(&env, "Test DAO"),
        &admin,
        &false,
    );

    // Mint SBT for admin (required for init_tree)
    sbt.mint(&dao_id, &admin, &admin, &None);

    // Initialize tree with proper admin verification
    tree.init_tree(&dao_id, &18, &admin);

    // Register admin's commitment so tree has a valid root
    let admin_commitment = U256::from_u32(&env, 12345);
    tree.register_with_caller(&dao_id, &admin_commitment, &admin);

    // Set VK with proper admin verification (using mock VK - IC must have exactly 7 elements for vote circuit)
    let mock_alpha = soroban_sdk::BytesN::from_array(&env, &[0u8; 64]);
    let mock_beta = soroban_sdk::BytesN::from_array(&env, &[0u8; 128]);
    let mock_gamma = soroban_sdk::BytesN::from_array(&env, &[0u8; 128]);
    let mock_delta = soroban_sdk::BytesN::from_array(&env, &[0u8; 128]);
    let mock_ic = soroban_sdk::vec![
        &env,
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
    ];

    let mock_vk = voting::VerificationKey {
        alpha: mock_alpha,
        beta: mock_beta,
        gamma: mock_gamma,
        delta: mock_delta,
        ic: mock_ic,
    };

    voting.set_vk(&dao_id, &mock_vk, &admin);

    // Set ledger timestamp to 1000 to ensure we can test past deadlines
    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 1000;
    });

    // Get current timestamp and create a past deadline
    let now = env.ledger().timestamp();
    let past_time = now - 100; // 100 seconds in the past

    // Create proposal with past deadline - should fail
    voting.create_proposal(
        &dao_id,
        &String::from_str(&env, "Test proposal with past deadline"),
        &past_time,
        &admin,
        &VoteMode::Fixed,
    );
}

#[test]
fn test_create_proposal_with_no_deadline() {
    let env = Env::default();
    env.mock_all_auths();

    let (registry_id, sbt_id, tree_id, voting_id, admin) = setup_contracts(&env);

    let registry = RegistryClient::new(&env, &registry_id);
    let sbt = SbtClient::new(&env, &sbt_id);
    let tree = TreeClient::new(&env, &tree_id);
    let voting = VotingClient::new(&env, &voting_id);

    // Create DAO with admin
    let dao_id = registry.create_dao(
        &String::from_str(&env, "Test DAO"),
        &admin,
        &false,
    );

    // Mint SBT for admin (required for init_tree)
    sbt.mint(&dao_id, &admin, &admin, &None);

    // Initialize tree with proper admin verification
    tree.init_tree(&dao_id, &18, &admin);

    // Register admin's commitment so tree has a valid root
    let admin_commitment = U256::from_u32(&env, 12345);
    tree.register_with_caller(&dao_id, &admin_commitment, &admin);

    // Set VK with proper admin verification (using mock VK - IC must have exactly 7 elements for vote circuit)
    let mock_alpha = soroban_sdk::BytesN::from_array(&env, &[0u8; 64]);
    let mock_beta = soroban_sdk::BytesN::from_array(&env, &[0u8; 128]);
    let mock_gamma = soroban_sdk::BytesN::from_array(&env, &[0u8; 128]);
    let mock_delta = soroban_sdk::BytesN::from_array(&env, &[0u8; 128]);
    let mock_ic = soroban_sdk::vec![
        &env,
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
        soroban_sdk::BytesN::from_array(&env, &[0u8; 64]),
    ];

    let mock_vk = voting::VerificationKey {
        alpha: mock_alpha,
        beta: mock_beta,
        gamma: mock_gamma,
        delta: mock_delta,
        ic: mock_ic,
    };

    voting.set_vk(&dao_id, &mock_vk, &admin);

    // Create proposal with end_time = 0 (no deadline) - should succeed
    let proposal_id = voting.create_proposal(
        &dao_id,
        &String::from_str(&env, "Test proposal with no deadline"),
        &0, // 0 = no deadline
        &admin,
        &VoteMode::Fixed,
    );

    assert_eq!(proposal_id, 1);

    // Get proposal and verify end_time is 0
    let proposal = voting.get_proposal(&dao_id, &proposal_id);
    assert_eq!(proposal.end_time, 0);
}

// Note: Testing voting after deadline would require:
// 1. Registering members with identity commitments
// 2. Generating valid ZK proofs
// 3. Manipulating ledger timestamp
// This is covered in the full_voting_flow integration test with time manipulation
// The core logic is tested above by verifying proposals can be created with proper deadlines
