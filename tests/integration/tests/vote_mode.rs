// Vote Mode Tests
//
// Tests for the two voting modes:
// 1. Fixed Mode: Only members at time of proposal creation can vote
// 2. Trailing Mode: Members added after proposal creation can also vote

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

// Helper function to create BN254 G1 generator point (1, 2)
fn bn254_g1_generator(env: &Env) -> soroban_sdk::BytesN<64> {
    let mut bytes = [0u8; 64];
    // x = 1 (big-endian, 32 bytes)
    bytes[31] = 1;
    // y = 2 (big-endian, 32 bytes)
    bytes[63] = 2;
    soroban_sdk::BytesN::from_array(env, &bytes)
}

// Helper function to create BN254 G2 generator point
fn bn254_g2_generator(env: &Env) -> soroban_sdk::BytesN<128> {
    // G2 generator for BN254 with proper coordinates
    // x = (x1, x2), y = (y1, y2) where:
    // x1 = 10857046999023057135944570762232829481370756359578518086990519993285655852781
    // x2 = 11559732032986387107991004021392285783925812861821192530917403151452391805634
    // y1 = 8495653923123431417604973247489272438418190587263600148770280649306958101930
    // y2 = 4082367875863433681332203403145435568316851327593401208105741076214120093531
    let bytes: [u8; 128] = [
        // x1 (32 bytes)
        0x18, 0x00, 0x50, 0x6a, 0x06, 0x12, 0x86, 0xeb, 0x6a, 0x84, 0xa5, 0x73, 0x0b, 0x8f,
        0x10, 0x29, 0x3e, 0x29, 0x81, 0x6c, 0xd1, 0x91, 0x3d, 0x53, 0x38, 0xf7, 0x15, 0xde,
        0x3e, 0x98, 0xf9, 0xad,
        // x2 (32 bytes)
        0x19, 0x83, 0x90, 0x42, 0x11, 0xa5, 0x3f, 0x6e, 0x0b, 0x08, 0x53, 0xa9, 0x0a, 0x00,
        0xef, 0xbf, 0xf1, 0x70, 0x0c, 0x7b, 0x1d, 0xc0, 0x06, 0x32, 0x4d, 0x85, 0x9d, 0x75,
        0xe3, 0xca, 0xa5, 0xa2,
        // y1 (32 bytes)
        0x12, 0xc8, 0x5e, 0xa5, 0xdb, 0x8c, 0x6d, 0xeb, 0x4a, 0xab, 0x71, 0x8e, 0x80, 0x6a,
        0x51, 0xa5, 0x66, 0x08, 0x21, 0x4c, 0x3f, 0x62, 0x8b, 0x96, 0x2c, 0xf1, 0x91, 0xea,
        0xcd, 0xc8, 0x0e, 0x7a,
        // y2 (32 bytes)
        0x09, 0x0d, 0x97, 0xc0, 0x9c, 0xe1, 0x48, 0x60, 0x63, 0xb3, 0x59, 0xf3, 0xdd, 0x89,
        0xb7, 0xc4, 0x3c, 0x5f, 0x18, 0x95, 0x8f, 0xb3, 0xe6, 0xb9, 0x6d, 0xb5, 0x5e, 0x19,
        0xa3, 0xb7, 0xc0, 0xfb,
    ];
    soroban_sdk::BytesN::from_array(env, &bytes)
}

// Helper function to create test verification key
fn create_test_vk(env: &Env) -> voting::VerificationKey {
    let g1_gen = bn254_g1_generator(env);
    let g2_gen = bn254_g2_generator(env);

    voting::VerificationKey {
        alpha: g1_gen.clone(),
        beta: g2_gen.clone(),
        gamma: g2_gen.clone(),
        delta: g2_gen.clone(),
        ic: soroban_sdk::vec![
            env,
            g1_gen.clone(),
            g1_gen.clone(),
            g1_gen.clone(),
            g1_gen.clone(),
            g1_gen.clone(),
            g1_gen.clone(),
        ],
    }
}

// Helper function to create test proof
fn create_test_proof(env: &Env) -> voting::Proof {
    voting::Proof {
        a: bn254_g1_generator(env),
        b: bn254_g2_generator(env),
        c: bn254_g1_generator(env),
    }
}

#[test]
#[should_panic(expected = "root must match proposal eligible root")]
fn test_fixed_mode_late_joiner_cannot_vote() {
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
    tree_client.init_tree(&dao_id, &20, &admin);

    // Set VK
    let vk = create_test_vk(&env);
    voting_client.set_vk(&dao_id, &vk, &admin);

    // Member 1 joins
    let member1 = Address::generate(&env);
    sbt_client.mint(&dao_id, &member1, &admin, &None);
    let commitment1 = U256::from_u32(&env, 111);
    tree_client.register_with_caller(&dao_id, &commitment1, &member1);

    let proposal_root = tree_client.current_root(&dao_id);

    // Create proposal in FIXED mode (0)
    let proposal_id = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "Test proposal"),
        &(env.ledger().timestamp() + 86400),
        &member1,
        &voting::VoteMode::Fixed, // Fixed mode
    );

    // Member 2 joins AFTER proposal creation
    let member2 = Address::generate(&env);
    sbt_client.mint(&dao_id, &member2, &admin, &None);
    let commitment2 = U256::from_u32(&env, 222);
    tree_client.register_with_caller(&dao_id, &commitment2, &member2);

    let new_root = tree_client.current_root(&dao_id);

    // Member 2 attempts to vote with new root (should fail)
    let nullifier2 = U256::from_u32(&env, 999);
    let proof2 = create_test_proof(&env);

    // This should panic with "root must match proposal eligible root"
    voting_client.vote(&dao_id, &proposal_id, &true, &nullifier2, &new_root, &proof2);
}

#[test]
fn test_trailing_mode_late_joiner_can_vote() {
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

    // Initialize tree and set VK
    tree_client.init_tree(&dao_id, &20, &admin);

    // Create test VK
    let vk = create_test_vk(&env);
    voting_client.set_vk(&dao_id, &vk, &admin);

    // Member 1 joins
    let member1 = Address::generate(&env);
    sbt_client.mint(&dao_id, &member1, &admin, &None);
    let commitment1 = U256::from_u32(&env, 111);
    tree_client.register_with_caller(&dao_id, &commitment1, &member1);

    // Create proposal in TRAILING mode (1)
    let proposal_id = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "Test proposal"),
        &(env.ledger().timestamp() + 86400),
        &member1,
        &voting::VoteMode::Trailing, // Trailing mode
    );

    // Member 2 joins AFTER proposal creation
    let member2 = Address::generate(&env);
    sbt_client.mint(&dao_id, &member2, &admin, &None);
    let commitment2 = U256::from_u32(&env, 222);
    tree_client.register_with_caller(&dao_id, &commitment2, &member2);

    let new_root = tree_client.current_root(&dao_id);

    // Member 2 CAN vote with new root (should succeed)
    let nullifier2 = U256::from_u32(&env, 999);
    let proof2 = create_test_proof(&env);

    // This should succeed in Trailing mode
    voting_client.vote(&dao_id, &proposal_id, &true, &nullifier2, &new_root, &proof2);

    // Verify vote counted
    let proposal = voting_client.get_proposal(&dao_id, &proposal_id);
    assert_eq!(proposal.yes_votes, 1);

    println!("✅ Trailing mode correctly allowed late joiner to vote");
}

#[test]
#[should_panic(expected = "root predates proposal creation")]
fn test_trailing_mode_removed_member_cannot_vote_on_new_proposal() {
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

    // Initialize tree and set VK
    tree_client.init_tree(&dao_id, &20, &admin);

    let vk = create_test_vk(&env);
    voting_client.set_vk(&dao_id, &vk, &admin);

    // Member 1 joins
    let member1 = Address::generate(&env);
    sbt_client.mint(&dao_id, &member1, &admin, &None);
    let commitment1 = U256::from_u32(&env, 111);
    tree_client.register_with_caller(&dao_id, &commitment1, &member1);

    let old_root = tree_client.current_root(&dao_id);

    // Admin removes member1
    tree_client.remove_member(&dao_id, &member1, &admin);

    // Member 2 joins to create a new proposal
    let member2 = Address::generate(&env);
    sbt_client.mint(&dao_id, &member2, &admin, &None);
    let commitment2 = U256::from_u32(&env, 222);
    tree_client.register_with_caller(&dao_id, &commitment2, &member2);

    // Create proposal AFTER member1 removal in TRAILING mode
    let proposal_id = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "New proposal"),
        &(env.ledger().timestamp() + 86400),
        &member2,
        &voting::VoteMode::Trailing, // Trailing mode
    );

    // Removed member1 tries to vote with old root (should fail - root predates proposal)
    let nullifier1 = U256::from_u32(&env, 888);
    let proof1 = create_test_proof(&env);

    // This should panic with "root predates proposal creation"
    voting_client.vote(&dao_id, &proposal_id, &true, &nullifier1, &old_root, &proof1);
}

#[test]
fn test_trailing_mode_removed_member_can_vote_on_old_proposal() {
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

    // Initialize tree and set VK
    tree_client.init_tree(&dao_id, &20, &admin);

    let vk = create_test_vk(&env);
    voting_client.set_vk(&dao_id, &vk, &admin);

    // Member 1 joins
    let member1 = Address::generate(&env);
    sbt_client.mint(&dao_id, &member1, &admin, &None);
    let commitment1 = U256::from_u32(&env, 111);
    tree_client.register_with_caller(&dao_id, &commitment1, &member1);

    // Create proposal BEFORE removal in TRAILING mode
    let proposal_id = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "Old proposal"),
        &(env.ledger().timestamp() + 86400),
        &member1,
        &voting::VoteMode::Trailing, // Trailing mode
    );

    let old_root = tree_client.current_root(&dao_id);

    // Admin removes member1 AFTER proposal creation
    tree_client.remove_member(&dao_id, &member1, &admin);

    // Removed member1 CAN still vote using old root (root_index >= earliest_root_index)
    let nullifier1 = U256::from_u32(&env, 888);
    let proof1 = create_test_proof(&env);

    // This should succeed
    voting_client.vote(&dao_id, &proposal_id, &true, &nullifier1, &old_root, &proof1);

    // Verify vote counted
    let proposal = voting_client.get_proposal(&dao_id, &proposal_id);
    assert_eq!(proposal.yes_votes, 1);

    println!("✅ Trailing mode correctly allowed removed member to vote on old proposal");
}
