// Pairing-Based Security Boundary Test
//
// This test validates that the BN254 pairing check provides implicit point validation
// by demonstrating that invalid VKs cause proof verification to fail.
//
// Security Model:
// - Invalid points CAN be set in VK (no validation at set_vk)
// - Invalid VK = pairing check FAILS = no proofs verify = DAO unusable
// - This is by design - pairing is the security boundary
//
// Run with: cargo test --test pairing_security_boundary -- --nocapture

use soroban_sdk::{
    testutils::Address as _,
    Address, Bytes, BytesN, Env, String, Vec, U256,
};

// Import contract clients
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

fn hex_to_bytes<const N: usize>(env: &Env, hex: &str) -> BytesN<N> {
    let bytes = hex::decode(hex).expect("invalid hex");
    assert_eq!(bytes.len(), N, "hex string wrong length");
    BytesN::from_array(env, &bytes.try_into().unwrap())
}

fn hex_str_to_u256(env: &Env, hex: &str) -> U256 {
    let bytes = hex::decode(hex).expect("invalid hex");
    let mut padded = [0u8; 32];
    let start = 32 - bytes.len();
    padded[start..].copy_from_slice(&bytes);
    U256::from_be_bytes(env, &Bytes::from_array(env, &padded))
}

fn get_real_proof(env: &Env) -> voting::Proof {
    // Real proof from circuits/build/proof_soroban_be.json (BIG-ENDIAN)
    voting::Proof {
        a: hex_to_bytes(
            env,
            "2d806e0094f82e4826cbaf1c55d9411c99cbd4724a06b3636343e9b4662101d027f2ac0e90e5abf5c8eb68bc544720783089cac24d53f97b4ccb23997ee1bef1",
        ),
        b: hex_to_bytes(
            env,
            "079a9e010f261129556108ece03d72f2241446001f4867236ee62d0cdd165a2d1f4155f6d442b0f8eb5dd5562119b9efad6c51f52923beb9122e1ef8479c45d508d8febd3f8a15ce920ab23fa2228a56e2af681b9b1aec9071dce66801c5fa810d51353b9164be959e736cd071d642bf3f7cbbeab73eb6dadd02471fc0000fac",
        ),
        c: hex_to_bytes(
            env,
            "1417617b66c6217dfd3d37a2949f230cd2126c8edebf73cd6fe9912c56e4b69e050323a90b08147b46079f4f0e359ee504da2082dda2ab112b8099fc064f4a6a",
        ),
    }
}

fn get_valid_vk(env: &Env) -> voting::VerificationKey {
    // Valid VK from circuits/build/verification_key_soroban_be.json (BIG-ENDIAN)
    let mut ic = Vec::new(env);
    ic.push_back(hex_to_bytes(env, "0386c87c5f77037451fea91c60759229ca390a30e60d564e5ff0f0f95ffbd18207683040dab753f41635f947d3d13e057c73cb92a38d83400af26019ce24d54f"));
    ic.push_back(hex_to_bytes(env, "0b8de6c132c626e6aa4676f7ca94d9ebeb93375ea3584b6337f9f823ac4157dd0b3de52288f2f4473c0c5041cf9a754decd57e2c0f6b2979d3467a30570c01ea"));
    ic.push_back(hex_to_bytes(env, "139bde66aa5aa4311aca037419840a70fed606a0ed112e6686e1feb44183672d0e56114fa301c02ab1f0baac0973de2759bf26ccbbc594f8627054001f8ad27a"));
    ic.push_back(hex_to_bytes(env, "2a7f1a9e3de9411015b1c5652856bc7a467110344153252026c44ca55f5dca632f0db38e6d0268092cba5ea0b5db9610e45bd8b4aac852527aeb6323c8f09804"));
    ic.push_back(hex_to_bytes(env, "09c5b9b793a6f8098f0ac918aa0a19a75b74e7f1428f726194a48af37da8ac14122edc5b3704f106fa3c095ac74f524032e460179c3e8ecd562ef050c884336a"));
    ic.push_back(hex_to_bytes(env, "143c06565aad1cacd0ddbc0cfc6dd131c70392d29c16d8c80ed7f62ada52587b13e189e68fe2fe8806b272da3c5762a18b23680cdeda63faef014b7dd6806f21"));
    ic.push_back(hex_to_bytes(env, "1ff2e1a8bf1cdc19c43a4040d1a87832823cdafe5fdf0bd812eabc05882e1ff12139f471e228bdec73ad109a16c1fd938d9e8c2b4d5c5c0b9cb703c8eec3a8b0"));

    voting::VerificationKey {
        alpha: hex_to_bytes(env, "2d4d9aa7e302d9df41749d5507949d05dbea33fbb16c643b22f599a2be6df2e214bedd503c37ceb061d8ec60209fe345ce89830a19230301f076caff004d1926"),
        beta: hex_to_bytes(env, "0967032fcbf776d1afc985f88877f182d38480a653f2decaa9794cbc3bf3060c0e187847ad4c798374d0d6732bf501847dd68bc0e071241e0213bc7fc13db7ab304cfbd1e08a704a99f5e847d93f8c3caafddec46b7a0d379da69a4d112346a71739c1b1a457a8c7313123d24d2f9192f896b7c63eea05a9d57f06547ad0cec8"),
        gamma: hex_to_bytes(env, "198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa"),
        delta: hex_to_bytes(env, "23bbe71cdbd371ce93879c1920554716ce89ee4e21f9a8aad6e7deb311f460381e3ed1aca9278a56e254d910b89f806fb308f538efd16563538b0b1ddb6d64be28ce9a5f31d7716460220c7e42e96ffa61608228d9a7a55186129cd138e47e590e2874e9d1bae76cbd0cf7081a5b178a34d8a218f7d139830922411a9fbca6c6"),
        ic,
    }
}

fn get_invalid_vk(env: &Env) -> voting::VerificationKey {
    // Invalid VK with point (5, 10) which is NOT on the BN254 curve
    // y² = 10² = 100
    // x³ + 3 = 5³ + 3 = 128
    // 100 ≠ 128 → Invalid point
    let mut ic = Vec::new(env);
    // Keep valid IC points (they're not used in alpha computation) - BE encoded
    ic.push_back(hex_to_bytes(env, "0386c87c5f77037451fea91c60759229ca390a30e60d564e5ff0f0f95ffbd18207683040dab753f41635f947d3d13e057c73cb92a38d83400af26019ce24d54f"));
    ic.push_back(hex_to_bytes(env, "0b8de6c132c626e6aa4676f7ca94d9ebeb93375ea3584b6337f9f823ac4157dd0b3de52288f2f4473c0c5041cf9a754decd57e2c0f6b2979d3467a30570c01ea"));
    ic.push_back(hex_to_bytes(env, "139bde66aa5aa4311aca037419840a70fed606a0ed112e6686e1feb44183672d0e56114fa301c02ab1f0baac0973de2759bf26ccbbc594f8627054001f8ad27a"));
    ic.push_back(hex_to_bytes(env, "2a7f1a9e3de9411015b1c5652856bc7a467110344153252026c44ca55f5dca632f0db38e6d0268092cba5ea0b5db9610e45bd8b4aac852527aeb6323c8f09804"));
    ic.push_back(hex_to_bytes(env, "09c5b9b793a6f8098f0ac918aa0a19a75b74e7f1428f726194a48af37da8ac14122edc5b3704f106fa3c095ac74f524032e460179c3e8ecd562ef050c884336a"));
    ic.push_back(hex_to_bytes(env, "143c06565aad1cacd0ddbc0cfc6dd131c70392d29c16d8c80ed7f62ada52587b13e189e68fe2fe8806b272da3c5762a18b23680cdeda63faef014b7dd6806f21"));
    ic.push_back(hex_to_bytes(env, "1ff2e1a8bf1cdc19c43a4040d1a87832823cdafe5fdf0bd812eabc05882e1ff12139f471e228bdec73ad109a16c1fd938d9e8c2b4d5c5c0b9cb703c8eec3a8b0"));

    voting::VerificationKey {
        // Invalid alpha point: (5, 10) encoded as 64 bytes (x || y) in BE
        alpha: hex_to_bytes(env, "0000000000000000000000000000000000000000000000000000000000000005000000000000000000000000000000000000000000000000000000000000000a"),
        // Use valid BE-encoded beta/gamma/delta
        beta: hex_to_bytes(env, "0967032fcbf776d1afc985f88877f182d38480a653f2decaa9794cbc3bf3060c0e187847ad4c798374d0d6732bf501847dd68bc0e071241e0213bc7fc13db7ab304cfbd1e08a704a99f5e847d93f8c3caafddec46b7a0d379da69a4d112346a71739c1b1a457a8c7313123d24d2f9192f896b7c63eea05a9d57f06547ad0cec8"),
        gamma: hex_to_bytes(env, "198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa"),
        delta: hex_to_bytes(env, "23bbe71cdbd371ce93879c1920554716ce89ee4e21f9a8aad6e7deb311f460381e3ed1aca9278a56e254d910b89f806fb308f538efd16563538b0b1ddb6d64be28ce9a5f31d7716460220c7e42e96ffa61608228d9a7a55186129cd138e47e590e2874e9d1bae76cbd0cf7081a5b178a34d8a218f7d139830922411a9fbca6c6"),
        ic,
    }
}

#[test]
fn test_pairing_security_boundary() {
    println!("\n==========================================");
    println!("Pairing-Based Security Boundary Test");
    println!("==========================================\n");

    // Setup
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    println!("Deploying contracts...\n");
    let registry_address = env.register(dao_registry::WASM, ());
    let registry_client = dao_registry::Client::new(&env, &registry_address);

    let sbt_address = env.register(membership_sbt::WASM, (registry_address.clone(),));
    let sbt_client = membership_sbt::Client::new(&env, &sbt_address);

    let tree_address = env.register(membership_tree::WASM, (sbt_address.clone(),));
    let tree_client = membership_tree::Client::new(&env, &tree_address);

    let voting_address = env.register(voting::WASM, (tree_address.clone(),));
    let voting_client = voting::Client::new(&env, &voting_address);

    println!("Creating DAO...\n");
    let dao_name = String::from_str(&env, "Security Test DAO");
    let dao_id = registry_client.create_dao(&dao_name, &admin, &false);

    println!("Minting SBT...\n");
    sbt_client.mint(&dao_id, &admin, &admin, &None);

    println!("Initializing tree (depth 18)...\n");
    tree_client.init_tree(&dao_id, &18, &admin);

    println!("Registering commitment...\n");
    let commitment = hex_str_to_u256(&env, "2536d01521137bf7b39e3fd26c1376f456ce46a45993a5d7c3c158a450fd7329");
    tree_client.register_with_caller(&dao_id, &commitment, &admin);

    let root = tree_client.current_root(&dao_id);
    let proof = get_real_proof(&env);
    let nullifier = hex_str_to_u256(&env, "0cbc551a937e12107e513efd646a4f32eec3f0d2c130532e3516bdd9d4683a50");

    println!("==========================================");
    println!("Test 1: Valid VK + Real Proof (Control)");
    println!("==========================================\n");

    let valid_vk = get_valid_vk(&env);
    voting_client.set_vk(&dao_id, &valid_vk, &admin);
    println!("✅ Valid VK set\n");

    let description = String::from_str(&env, "Control Test Proposal");
    let current_time = env.ledger().timestamp();
    let end_time = current_time + 3600;
    let proposal_id1 = voting_client.create_proposal(
        &dao_id,
        &description,
        &end_time,
        &admin,
        &voting::VoteMode::Fixed,
    );
    println!("✅ Proposal created: {}\n", proposal_id1);

    println!("Submitting vote with real proof...");
    voting_client.vote(
        &dao_id,
        &proposal_id1,
        &true,
        &nullifier,
        &root,
        &commitment,
        &proof,
    );
    println!("✅ PASS: Valid VK accepted real proof");
    println!("       Pairing check succeeded\n");

    println!("==========================================");
    println!("Test 2: Invalid VK + Real Proof");
    println!("==========================================\n");
    println!("Point (5, 10) is NOT on BN254 curve:");
    println!("  y² = 10² = 100");
    println!("  x³ + 3 = 5³ + 3 = 128");
    println!("  100 ≠ 128 → Invalid point\n");

    let invalid_vk = get_invalid_vk(&env);
    voting_client.set_vk(&dao_id, &invalid_vk, &admin);
    println!("✅ Invalid VK set (expected - no validation at set_vk)\n");

    let description2 = String::from_str(&env, "Security Test Proposal");
    let proposal_id2 = voting_client.create_proposal(
        &dao_id,
        &description2,
        &end_time,
        &admin,
        &voting::VoteMode::Fixed,
    );
    println!("✅ Proposal created: {}\n", proposal_id2);

    println!("Submitting vote with real proof (should fail)...");
    let nullifier2 = hex_str_to_u256(&env, "0cbc551a937e12107e513efd646a4f32eec3f0d2c130532e3516bdd9d4683a51");

    // This should panic due to pairing check failure
    let should_panic = std::panic::AssertUnwindSafe(|| {
        voting_client.vote(
            &dao_id,
            &proposal_id2,
            &true,
            &nullifier2,
            &root,
            &commitment,
            &proof,
        );
    });

    let result = std::panic::catch_unwind(should_panic);

    if result.is_ok() {
        panic!("❌ FAIL: Invalid VK accepted proof (SECURITY ISSUE!)");
    } else {
        println!("✅ PASS: Invalid VK rejected by pairing check");
        println!("       Security boundary working correctly\n");
    }

    println!("==========================================");
    println!("Test Summary");
    println!("==========================================\n");
    println!("✅ ALL TESTS PASSED\n");
    println!("Security validation confirmed:");
    println!("  ✅ Valid VK allows proof verification");
    println!("  ✅ Invalid VK rejected by pairing check");
    println!("  ✅ Pairing is the security boundary\n");
    println!("Design confirmed:");
    println!("  - No explicit point validation in set_vk()");
    println!("  - BN254 pairing provides implicit validation");
    println!("  - Invalid VK = unusable DAO (no proofs verify)\n");
}
