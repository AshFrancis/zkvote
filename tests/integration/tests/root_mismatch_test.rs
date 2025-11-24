// Test: Vote with Wrong Root Should Fail
//
// This test verifies that the contract's root check (voting/src/lib.rs:417-419) works correctly.
// We use a real proof generated for root_A, but pass root_B to the contract.
// The vote MUST fail with "root must match proposal eligible root".

use soroban_sdk::{
    testutils::Address as _,
    Address, Bytes, BytesN, Env, String, Vec as SdkVec, U256,
};

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
    // Real proof from standalone test (generated for a specific root)
    voting::Proof {
        a: hex_to_bytes(
            env,
            "54f558fca3ae990d199f05f1351f7909fa4a5540936d705a6c153628fe5ab6110c12c592108e4c4d5eac2c33eddd9d3d5c568647abe791136d19f33ca3669620",
        ),
        b: hex_to_bytes(
            env,
            "f59ab459228fa9f302e67621923bcb6bf2f5d4615def50c4b45b9c1e46c9b814f9f5e66cf599e13630ab3b7ddbdae67082f771cd5cc4bd13d0abcbcc65a02a0bc77bf2141857569cfac2acea49cfa9309954ba844018fdb3b8bf636bb8f7ea29cf2ddc1a07d0a5aa0b994aa0f3a7cfbc2fedd59ea783416758eadab66c473c1d",
        ),
        c: hex_to_bytes(
            env,
            "a46962366b50a0c9a27e69511ae2d183bb462f43dd213ca32c8e74a86f1a3903ee2656a4bf4943f3c2efcf7b0c431aeffb80362fd7f48e33974a1b8ee5564b17",
        ),
    }
}

fn get_verification_key(env: &Env) -> voting::VerificationKey {
    // VK from standalone test
    let mut ic = SdkVec::new(env);

    ic.push_back(hex_to_bytes(
        env,
        "ef0630dec3ad685545f0d198824213e9f71235685979fba3d5e32e7c388bbf014893499ff0be943558b9d01817a878ce76d7bb0ebea3c0d9894c73bc7707981c",
    ));
    ic.push_back(hex_to_bytes(
        env,
        "3cbde84b103b8af6f1b4e76ff3515a2a33b5b80036e361629dd4415a971a0d19b6cc9eba3b6123dfe8f2f029e19506ba9339fce92686d8376884376059c25310",
    ));
    ic.push_back(hex_to_bytes(
        env,
        "83320a5c58bfecdca854a4a8e0a820f873f0a67e4791e8c3a23422ec29aee01aa1aef755d94f25e8462d780a5d33d80c4ff26bde7ba808d2559a7a7e32bf2415",
    ));
    ic.push_back(hex_to_bytes(
        env,
        "46111c538eb1637f9669c52e3038658195ecda946b712479d017c2cc6c04732b3b0f3dd4fa6d6c0ce8734344c4c334f79e271829805b314c8d2d859e1eadef02",
    ));
    ic.push_back(hex_to_bytes(
        env,
        "0da2a4435eb3f812b90ba2c5802d006d2407488ab2c483d6ab7912761191351b4cf8c263e9dc695e1972f0e944bd0365c35a07e19be57032b5c325d6027d7c04",
    ));
    ic.push_back(hex_to_bytes(
        env,
        "2313e0a2ca4854465d3bd39e3c317744c50fe1a014958024453aa3392ad7e72d8f6bbd47aec66b837adf7b682f18748e209c7a35bf8ca61ffe4f85dae7da2804",
    ));

    voting::VerificationKey {
        alpha: hex_to_bytes(
            env,
            "e2f26dbea299f5223b646cb1fb33eadb059d9407559d7441dfd902e3a79a4d2d26194d00ffca76f0010323190a8389ce45e39f2060ecd861b0ce373c50ddbe14",
        ),
        beta: hex_to_bytes(
            env,
            "abb73dc17fbc13021e2471e0c08bd67d8401f52b73d6d07483794cad4778180e0c06f33bbc4c79a9cadef253a68084d382f17788f885c9afd176f7cb2f036709c8ced07a54067fd5a905ea3ec6b796f892912f4dd2233131c7a857a4b1c13917a74623114d9aa69d370d7a6bc4defdaa3c8c3fd947e8f5994a708ae0d1fb4c30",
        ),
        gamma: hex_to_bytes(
            env,
            "edf692d95cbdde46ddda5ef7d422436779445c5e66006a42761e1f12efde0018c212f3aeb785e49712e7a9353349aaf1255dfb31b7bf60723a480d9293938e19aa7dfa6601cce64c7bd3430c69e7d1e38f40cb8d8071ab4aeb6d8cdba55ec8125b9722d1dcdaac55f38eb37033314bbc95330c69ad999eec75f05f58d0890609",
        ),
        delta: hex_to_bytes(
            env,
            "0f39ec5884b6a91dbb21fd8dd55a87fb6867f2eb6f7547ce6b3f1c0fa35247209f9e49599cabf9f40b1bacb316f5ccb53c703c4e3801eee773c677523c8aa6222d1f6e392f7989220677b968d1747a858b4fc29d588070275c89ae10ca6d6525fe81aa0515743c98be2d1c20da4aef1aa538d88920c466f812ea3dd651bc892b",
        ),
        ic,
    }
}

#[test]
#[should_panic(expected = "root must match proposal eligible root")]
fn test_vote_with_wrong_root_fails() {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy contracts
    let registry_id = env.register(dao_registry::WASM, ());
    let sbt_id = env.register(membership_sbt::WASM, (registry_id.clone(),));
    let tree_id = env.register(membership_tree::WASM, (sbt_id.clone(),));
    let voting_id = env.register(voting::WASM, (tree_id.clone(),));

    let admin = Address::generate(&env);
    let member = Address::generate(&env);

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

    tree_client.init_tree(&dao_id, &20, &admin);

    // Give admin an SBT (needed to create proposals)
    sbt_client.mint(&dao_id, &admin, &admin, &None);

    // Add member and register
    sbt_client.mint(&dao_id, &member, &admin, &None);

    // Use the commitment from the standalone test (secret=123456789, salt=987654321)
    let commitment = hex_str_to_u256(&env, "0ba5c527b25bf1b3ebb63f7e4d7e2b41bea69cfc6b0ce1a684ac54a1eba98b1e");
    tree_client.register_with_caller(&dao_id, &commitment, &member);

    let root_A = tree_client.current_root(&dao_id);
    println!("Root A (with commitment): {:?}", root_A);

    // Set VK and create Proposal 1 with root_A as eligible_root
    let vk = get_verification_key(&env);
    voting_client.set_vk(&dao_id, &vk, &admin);

    let proposal_1_id = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "Proposal 1"),
        &1000u64,
        &admin,
        &voting::VoteMode::Fixed,
    );

    let proposal_1 = voting_client.get_proposal(&dao_id, &proposal_1_id);
    assert_eq!(proposal_1.eligible_root, root_A, "Proposal 1 should have root_A");

    // Use the nullifier from standalone test
    let nullifier = hex_str_to_u256(&env, "2e63a8df7e70db756c4ae0daf7effd4b4b86e8a8e5a91195b8b3c24f68adf41f");

    // Get the real proof (generated for root_A)
    let proof = get_real_proof(&env);

    // Vote should SUCCEED with correct root (root_A)
    voting_client.vote(
        &dao_id,
        &proposal_1_id,
        &true,
        &nullifier,
        &root_A, // Correct root
        &commitment,
        &proof,
    );

    let proposal_after = voting_client.get_proposal(&dao_id, &proposal_1_id);
    assert_eq!(proposal_after.yes_votes, 1, "Vote with correct root should succeed");
    println!("✅ Vote with correct root succeeded");

    // Now create Proposal 2 with a DIFFERENT eligible_root
    // We'll remove the member to change the root
    tree_client.remove_member(&dao_id, &member, &admin);
    let root_B = tree_client.current_root(&dao_id);

    assert_ne!(root_A, root_B, "Roots must be different");
    println!("Root B (with zeroed leaf): {:?}", root_B);

    let proposal_2_id = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "Proposal 2"),
        &2000u64,
        &admin,
        &voting::VoteMode::Fixed,
    );

    let proposal_2 = voting_client.get_proposal(&dao_id, &proposal_2_id);
    assert_eq!(proposal_2.eligible_root, root_B, "Proposal 2 should have root_B");

    // Try to vote on Proposal 2 with the SAME proof (which was generated for root_A)
    // But the proposal has eligible_root = root_B
    // This simulates the frontend bug: passing wrong root to contract

    let nullifier_2 = hex_str_to_u256(&env, "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");

    println!("🔍 Attempting vote with WRONG root (proof for root_A, but proposal has root_B)...");

    // This MUST fail with "root must match proposal eligible root"
    voting_client.vote(
        &dao_id,
        &proposal_2_id,
        &true,
        &nullifier_2,
        &root_A, // ❌ WRONG! Proof claims root_A but proposal has root_B
        &commitment,
        &proof,
    );

    // Should panic before reaching here
}

#[test]
fn test_vote_with_correct_root_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy contracts
    let registry_id = env.register(dao_registry::WASM, ());
    let sbt_id = env.register(membership_sbt::WASM, (registry_id.clone(),));
    let tree_id = env.register(membership_tree::WASM, (sbt_id.clone(),));
    let voting_id = env.register(voting::WASM, (tree_id.clone(),));

    let admin = Address::generate(&env);
    let member = Address::generate(&env);

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

    tree_client.init_tree(&dao_id, &20, &admin);

    // Give admin an SBT (needed to create proposals)
    sbt_client.mint(&dao_id, &admin, &admin, &None);

    // Add member and register with the commitment from standalone test
    sbt_client.mint(&dao_id, &member, &admin, &None);
    let commitment = hex_str_to_u256(&env, "0ba5c527b25bf1b3ebb63f7e4d7e2b41bea69cfc6b0ce1a684ac54a1eba98b1e");
    tree_client.register_with_caller(&dao_id, &commitment, &member);

    let root = tree_client.current_root(&dao_id);

    // Set VK and create proposal
    let vk = get_verification_key(&env);
    voting_client.set_vk(&dao_id, &vk, &admin);

    let proposal_id = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "Test Proposal"),
        &1000u64,
        &admin,
        &voting::VoteMode::Fixed,
    );

    // Vote with matching root
    let nullifier = hex_str_to_u256(&env, "2e63a8df7e70db756c4ae0daf7effd4b4b86e8a8e5a91195b8b3c24f68adf41f");
    let proof = get_real_proof(&env);

    voting_client.vote(
        &dao_id,
        &proposal_id,
        &true,
        &nullifier,
        &root, // Correct root
        &commitment,
        &proof,
    );

    let proposal_after = voting_client.get_proposal(&dao_id, &proposal_id);
    assert_eq!(proposal_after.yes_votes, 1);

    println!("✅ Vote with correct root succeeded");
}
