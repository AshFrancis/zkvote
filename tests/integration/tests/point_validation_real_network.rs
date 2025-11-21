// Point Validation Test - MUST RUN ON REAL P25 NETWORK
//
// This test verifies that G1 point validation correctly rejects invalid points.
// The validation is disabled in test environment (#[cfg(not(test))]) so this
// must be compiled and run as a regular integration test, not a cargo test.
//
// This test validates security against CVE-2023-40141 (Besu invalid curve attack)

use soroban_sdk::{
    testutils::Address as _, Address, Bytes, BytesN, Env, String, U256, Vec,
};

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
    soroban_sdk::contractimport!(file = "../../target/wasm32v1-none/release/voting.wasm");
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

// Create a valid VK template (from real snarkjs output)
fn create_valid_vk_template(env: &Env) -> voting::VerificationKey {
    // Valid BN254 generator point for testing
    // G1 generator: (1, 2) in affine coordinates
    let valid_alpha_bytes: [u8; 64] = [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, // x = 1
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, // y = 2
    ];

    let alpha = BytesN::from_array(env, &valid_alpha_bytes);

    // Create 6 valid IC points (all using generator for this test)
    let ic = Vec::from_array(
        env,
        [
            alpha.clone(),
            alpha.clone(),
            alpha.clone(),
            alpha.clone(),
            alpha.clone(),
            alpha.clone(),
        ],
    );

    // Dummy G2 points (validation not yet implemented for G2)
    let dummy_g2_bytes: [u8; 128] = [0u8; 128];
    let beta = BytesN::from_array(env, &dummy_g2_bytes);
    let gamma = BytesN::from_array(env, &dummy_g2_bytes);
    let delta = BytesN::from_array(env, &dummy_g2_bytes);

    voting::VerificationKey {
        alpha,
        beta,
        gamma,
        delta,
        ic,
    }
}

#[test]
#[should_panic(expected = "invalid VK alpha")]
fn test_invalid_alpha_point() {
    // ============================================
    // Point Validation Test: Invalid Alpha Point
    // ============================================
    //
    // This test verifies that set_vk rejects a VK with an invalid alpha point.
    // The point (5, 10) is NOT on the BN254 curve (y² ≠ x³ + 3).
    //
    // Expected behavior: Panic with "invalid VK alpha"

    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let (registry_id, _sbt_id, _tree_id, voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let voting_client = VotingClient::new(&env, &voting_id);

    // Create test DAO
    let dao_id = registry_client.create_dao(&String::from_str(&env, "VK Test DAO"), &admin, &false);

    // Create VK with invalid alpha point
    let mut vk = create_valid_vk_template(&env);

    // Point (5, 10) is NOT on the curve
    // Check: 10² = 100, but 5³ + 3 = 125 + 3 = 128
    // 100 ≠ 128 (mod p), so this point is invalid
    let invalid_alpha_bytes: [u8; 64] = [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, // x = 5
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, // y = 10
    ];

    vk.alpha = BytesN::from_array(&env, &invalid_alpha_bytes);

    println!("Attempting to set VK with invalid alpha point (5, 10)...");

    // This should panic with "invalid VK alpha"
    voting_client.set_vk(&dao_id, &vk, &admin);

    panic!("Should have panicked before reaching here!");
}

#[test]
#[should_panic(expected = "invalid VK IC point")]
fn test_invalid_ic_point() {
    // ============================================
    // Point Validation Test: Invalid IC Point
    // ============================================
    //
    // This test verifies that set_vk rejects a VK with an invalid IC point.
    //
    // Expected behavior: Panic with "invalid VK IC point"

    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let (registry_id, _sbt_id, _tree_id, voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let voting_client = VotingClient::new(&env, &voting_id);

    // Create test DAO
    let dao_id = registry_client.create_dao(&String::from_str(&env, "VK Test DAO"), &admin, &false);

    // Create VK with invalid IC point
    let mut vk = create_valid_vk_template(&env);

    // Point (7, 15) is NOT on the curve
    // Check: 15² = 225, but 7³ + 3 = 343 + 3 = 346
    // 225 ≠ 346 (mod p), so this point is invalid
    let invalid_ic_bytes: [u8; 64] = [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, // x = 7
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 15, // y = 15
    ];

    // Replace first IC point with invalid point
    let invalid_point = BytesN::from_array(&env, &invalid_ic_bytes);
    vk.ic.set(0, invalid_point);

    println!("Attempting to set VK with invalid IC[0] point (7, 15)...");

    // This should panic with "invalid VK IC point"
    voting_client.set_vk(&dao_id, &vk, &admin);

    panic!("Should have panicked before reaching here!");
}

#[test]
fn test_valid_vk_accepted() {
    // ============================================
    // Point Validation Test: Valid VK Accepted
    // ============================================
    //
    // This test verifies that a VK with all valid points is accepted.
    // Uses the BN254 generator point (1, 2) which is guaranteed to be on the curve.
    //
    // Expected behavior: VK is set successfully, no panic

    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let (registry_id, _sbt_id, _tree_id, voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let voting_client = VotingClient::new(&env, &voting_id);

    // Create test DAO
    let dao_id = registry_client.create_dao(&String::from_str(&env, "VK Test DAO"), &admin, &false);

    // Create VK with all valid points
    let vk = create_valid_vk_template(&env);

    println!("Setting VK with all valid points (generator point)...");

    // This should succeed
    voting_client.set_vk(&dao_id, &vk, &admin);

    println!("✅ Valid VK was accepted successfully!");
}

#[test]
#[should_panic(expected = "invalid VK alpha")]
fn test_point_at_infinity() {
    // ============================================
    // Point Validation Test: Point at Infinity
    // ============================================
    //
    // This test verifies that the point at infinity (0, 0) is rejected.
    // In affine coordinates, (0, 0) is sometimes used to represent the
    // point at infinity, but it's not valid for our verification keys.
    //
    // Expected behavior: Panic with "invalid VK alpha"

    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let (registry_id, _sbt_id, _tree_id, voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let voting_client = VotingClient::new(&env, &voting_id);

    // Create test DAO
    let dao_id = registry_client.create_dao(&String::from_str(&env, "VK Test DAO"), &admin, &false);

    // Create VK with point at infinity
    let mut vk = create_valid_vk_template(&env);

    let zero_point_bytes: [u8; 64] = [0u8; 64]; // All zeros

    vk.alpha = BytesN::from_array(&env, &zero_point_bytes);

    println!("Attempting to set VK with point at infinity (0, 0)...");

    // This should panic with "invalid VK alpha"
    voting_client.set_vk(&dao_id, &vk, &admin);

    panic!("Should have panicked before reaching here!");
}
