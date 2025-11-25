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
    // Real proof from circuits/build/proof_soroban_le.json
    voting::Proof {
        a: hex_to_bytes(
            env,
            "d0012166b4e9436363b3064a72d4cb991c41d9551cafcb26482ef894006e802df1bee17e9923cb4c7bf9534dc2ca893078204754bc68ebc8f5abe5900eacf227",
        ),
        b: hex_to_bytes(
            env,
            "d5459c47f81e2e12b9be2329f5516cadefb9192156d55debf8b042d4f655411f2d5a16dd0c2de66e2367481f00461424f2723de0ec0861552911260f019e9a07ac0f00c01f4702dddab63eb7eabb7c3fbf42d671d06c739e95be64913b35510d81fac50168e6dc7190ec1a9b1b68afe2568a22a23fb20a92ce158a3fbdfed808",
        ),
        c: hex_to_bytes(
            env,
            "9eb6e4562c91e96fcd73bfde8e6c12d20c239f94a2373dfd7d21c6667b6117146a4a4f06fc99802b11aba2dd8220da04e59e350e4f9f07467b14080ba9230305",
        ),
    }
}

fn get_valid_vk(env: &Env) -> voting::VerificationKey {
    // Valid VK from circuits/build/verification_key_soroban_le.json
    let mut ic = Vec::new(env);
    ic.push_back(hex_to_bytes(env, "82d1fb5ff9f0f05f4e560de6300a39ca299275601ca9fe517403775f7cc886034fd524ce1960f20a40838da392cb737c053ed1d347f93516f453b7da40306807"));
    ic.push_back(hex_to_bytes(env, "dd5741ac23f8f937634b58a35e3793ebebd994caf77646aae626c632c1e68d0bea010c57307a46d379296b0f2c7ed5ec4d759acf41500c3c47f4f28822e53d0b"));
    ic.push_back(hex_to_bytes(env, "2d678341b4fee186662e11eda006d6fe700a84197403ca1a31a45aaa66de9b137ad28a1f00547062f894c5bbcc26bf5927de7309acbaf0b12ac001a34f11560e"));
    ic.push_back(hex_to_bytes(env, "63ca5d5fa54cc42620255341341071467abc562865c5b1151041e93d9e1a7f2a0498f0c82363eb7a5252c8aab4d85be41096dbb5a05eba2c0968026d8eb30d2f"));
    ic.push_back(hex_to_bytes(env, "14aca87df38aa49461728f42f1e7745ba7190aaa18c90a8f09f8a693b7b9c5096a3384c850f02e56cd8e3e9c1760e43240524fc75a093cfa06f104375bdc2e12"));
    ic.push_back(hex_to_bytes(env, "7b5852da2af6d70ec8d8169cd29203c731d16dfc0cbcddd0ac1cad5a56063c14216f80d67d4b01effa63dade0c68238ba162573cda72b20688fee28fe689e113"));
    ic.push_back(hex_to_bytes(env, "f11f2e8805bcea12d80bdf5ffeda3c823278a8d140403ac419dc1cbfa8e1f21fb0a8c3eec803b79c0b5c5c4d2b8c9e8d93fdc1169a10ad73ecbd28e271f43921"));

    voting::VerificationKey {
        alpha: hex_to_bytes(env, "e2f26dbea299f5223b646cb1fb33eadb059d9407559d7441dfd902e3a79a4d2d26194d00ffca76f0010323190a8389ce45e39f2060ecd861b0ce373c50ddbe14"),
        beta: hex_to_bytes(env, "abb73dc17fbc13021e2471e0c08bd67d8401f52b73d6d07483794cad4778180e0c06f33bbc4c79a9cadef253a68084d382f17788f885c9afd176f7cb2f036709c8ced07a54067fd5a905ea3ec6b796f892912f4dd2233131c7a857a4b1c13917a74623114d9aa69d370d7a6bc4defdaa3c8c3fd947e8f5994a708ae0d1fb4c30"),
        gamma: hex_to_bytes(env, "edf692d95cbdde46ddda5ef7d422436779445c5e66006a42761e1f12efde0018c212f3aeb785e49712e7a9353349aaf1255dfb31b7bf60723a480d9293938e19aa7dfa6601cce64c7bd3430c69e7d1e38f40cb8d8071ab4aeb6d8cdba55ec8125b9722d1dcdaac55f38eb37033314bbc95330c69ad999eec75f05f58d0890609"),
        delta: hex_to_bytes(env, "be646ddb1d0b8b536365d1ef38f508b36f809fb810d954e2568a27a9acd13e1e3860f411b3dee7d6aaa8f9214eee89ce16475520199c8793ce71d3db1ce7bb23c6a6bc9f1a4122098339d1f718a2d8348a175b1a08f70cbd6ce7bad1e974280e597ee438d19c128651a5a7d928826061fa6fe9427e0c22606471d7315f9ace28"),
        ic,
    }
}

fn get_invalid_vk(env: &Env) -> voting::VerificationKey {
    // Invalid VK with point (5, 10) which is NOT on the BN254 curve
    // y² = 10² = 100
    // x³ + 3 = 5³ + 3 = 128
    // 100 ≠ 128 → Invalid point
    let mut ic = Vec::new(env);
    // Keep valid IC points (they're not used in alpha computation)
    ic.push_back(hex_to_bytes(env, "82d1fb5ff9f0f05f4e560de6300a39ca299275601ca9fe517403775f7cc886034fd524ce1960f20a40838da392cb737c053ed1d347f93516f453b7da40306807"));
    ic.push_back(hex_to_bytes(env, "dd5741ac23f8f937634b58a35e3793ebebd994caf77646aae626c632c1e68d0bea010c57307a46d379296b0f2c7ed5ec4d759acf41500c3c47f4f28822e53d0b"));
    ic.push_back(hex_to_bytes(env, "2d678341b4fee186662e11eda006d6fe700a84197403ca1a31a45aaa66de9b137ad28a1f00547062f894c5bbcc26bf5927de7309acbaf0b12ac001a34f11560e"));
    ic.push_back(hex_to_bytes(env, "63ca5d5fa54cc42620255341341071467abc562865c5b1151041e93d9e1a7f2a0498f0c82363eb7a5252c8aab4d85be41096dbb5a05eba2c0968026d8eb30d2f"));
    ic.push_back(hex_to_bytes(env, "14aca87df38aa49461728f42f1e7745ba7190aaa18c90a8f09f8a693b7b9c5096a3384c850f02e56cd8e3e9c1760e43240524fc75a093cfa06f104375bdc2e12"));
    ic.push_back(hex_to_bytes(env, "7b5852da2af6d70ec8d8169cd29203c731d16dfc0cbcddd0ac1cad5a56063c14216f80d67d4b01effa63dade0c68238ba162573cda72b20688fee28fe689e113"));
    ic.push_back(hex_to_bytes(env, "f11f2e8805bcea12d80bdf5ffeda3c823278a8d140403ac419dc1cbfa8e1f21fb0a8c3eec803b79c0b5c5c4d2b8c9e8d93fdc1169a10ad73ecbd28e271f43921"));

    voting::VerificationKey {
        // Invalid alpha point: (5, 10) encoded as 64 bytes (x || y)
        alpha: hex_to_bytes(env, "0000000000000000000000000000000000000000000000000000000000000005000000000000000000000000000000000000000000000000000000000000000a"),
        beta: hex_to_bytes(env, "abb73dc17fbc13021e2471e0c08bd67d8401f52b73d6d07483794cad4778180e0c06f33bbc4c79a9cadef253a68084d382f17788f885c9afd176f7cb2f036709c8ced07a54067fd5a905ea3ec6b796f892912f4dd2233131c7a857a4b1c13917a74623114d9aa69d370d7a6bc4defdaa3c8c3fd947e8f5994a708ae0d1fb4c30"),
        gamma: hex_to_bytes(env, "edf692d95cbdde46ddda5ef7d422436779445c5e66006a42761e1f12efde0018c212f3aeb785e49712e7a9353349aaf1255dfb31b7bf60723a480d9293938e19aa7dfa6601cce64c7bd3430c69e7d1e38f40cb8d8071ab4aeb6d8cdba55ec8125b9722d1dcdaac55f38eb37033314bbc95330c69ad999eec75f05f58d0890609"),
        delta: hex_to_bytes(env, "be646ddb1d0b8b536365d1ef38f508b36f809fb810d954e2568a27a9acd13e1e3860f411b3dee7d6aaa8f9214eee89ce16475520199c8793ce71d3db1ce7bb23c6a6bc9f1a4122098339d1f718a2d8348a175b1a08f70cbd6ce7bad1e974280e597ee438d19c128651a5a7d928826061fa6fe9427e0c22606471d7315f9ace28"),
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
