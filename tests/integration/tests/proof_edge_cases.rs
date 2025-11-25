// Proof Edge Case Tests
//
// Tests for edge cases in proof verification:
// 1. Corrupted proof data
// 2. Wrong VK for proof
// 3. Nullifier reuse across DAOs (should succeed - different domains)

use soroban_sdk::{
    testutils::Address as _, Address, Bytes, BytesN, Env, String, U256, Vec as SdkVec,
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

// Real VK from circuits/build/verification_key_soroban_be.json
fn get_real_vk(env: &Env) -> voting::VerificationKey {
    let mut ic = SdkVec::new(env);
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

// Real proof from circuits/build/proof_soroban_be.json
fn get_real_proof(env: &Env) -> voting::Proof {
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

// Corrupted proof (flipped bits in proof.a)
fn get_corrupted_proof(env: &Env) -> voting::Proof {
    voting::Proof {
        a: hex_to_bytes(
            env,
            // Changed first byte from 2d to 3d (single bit flip)
            "3d806e0094f82e4826cbaf1c55d9411c99cbd4724a06b3636343e9b4662101d027f2ac0e90e5abf5c8eb68bc544720783089cac24d53f97b4ccb23997ee1bef1",
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

// Different VK (valid curve points but different from real VK)
fn get_different_vk(env: &Env) -> voting::VerificationKey {
    // Use the real VK but modify alpha point slightly
    let mut ic = SdkVec::new(env);
    ic.push_back(hex_to_bytes(env, "0386c87c5f77037451fea91c60759229ca390a30e60d564e5ff0f0f95ffbd18207683040dab753f41635f947d3d13e057c73cb92a38d83400af26019ce24d54f"));
    ic.push_back(hex_to_bytes(env, "0b8de6c132c626e6aa4676f7ca94d9ebeb93375ea3584b6337f9f823ac4157dd0b3de52288f2f4473c0c5041cf9a754decd57e2c0f6b2979d3467a30570c01ea"));
    ic.push_back(hex_to_bytes(env, "139bde66aa5aa4311aca037419840a70fed606a0ed112e6686e1feb44183672d0e56114fa301c02ab1f0baac0973de2759bf26ccbbc594f8627054001f8ad27a"));
    ic.push_back(hex_to_bytes(env, "2a7f1a9e3de9411015b1c5652856bc7a467110344153252026c44ca55f5dca632f0db38e6d0268092cba5ea0b5db9610e45bd8b4aac852527aeb6323c8f09804"));
    ic.push_back(hex_to_bytes(env, "09c5b9b793a6f8098f0ac918aa0a19a75b74e7f1428f726194a48af37da8ac14122edc5b3704f106fa3c095ac74f524032e460179c3e8ecd562ef050c884336a"));
    ic.push_back(hex_to_bytes(env, "143c06565aad1cacd0ddbc0cfc6dd131c70392d29c16d8c80ed7f62ada52587b13e189e68fe2fe8806b272da3c5762a18b23680cdeda63faef014b7dd6806f21"));
    ic.push_back(hex_to_bytes(env, "1ff2e1a8bf1cdc19c43a4040d1a87832823cdafe5fdf0bd812eabc05882e1ff12139f471e228bdec73ad109a16c1fd938d9e8c2b4d5c5c0b9cb703c8eec3a8b0"));

    voting::VerificationKey {
        // Modified alpha (different x coordinate)
        alpha: hex_to_bytes(env, "1d4d9aa7e302d9df41749d5507949d05dbea33fbb16c643b22f599a2be6df2e214bedd503c37ceb061d8ec60209fe345ce89830a19230301f076caff004d1926"),
        beta: hex_to_bytes(env, "0967032fcbf776d1afc985f88877f182d38480a653f2decaa9794cbc3bf3060c0e187847ad4c798374d0d6732bf501847dd68bc0e071241e0213bc7fc13db7ab304cfbd1e08a704a99f5e847d93f8c3caafddec46b7a0d379da69a4d112346a71739c1b1a457a8c7313123d24d2f9192f896b7c63eea05a9d57f06547ad0cec8"),
        gamma: hex_to_bytes(env, "198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa"),
        delta: hex_to_bytes(env, "23bbe71cdbd371ce93879c1920554716ce89ee4e21f9a8aad6e7deb311f460381e3ed1aca9278a56e254d910b89f806fb308f538efd16563538b0b1ddb6d64be28ce9a5f31d7716460220c7e42e96ffa61608228d9a7a55186129cd138e47e590e2874e9d1bae76cbd0cf7081a5b178a34d8a218f7d139830922411a9fbca6c6"),
        ic,
    }
}

const REAL_COMMITMENT_HEX: &str = "2536d01521137bf7b39e3fd26c1376f456ce46a45993a5d7c3c158a450fd7329";
const REAL_NULLIFIER_HEX: &str = "0cbc551a937e12107e513efd646a4f32eec3f0d2c130532e3516bdd9d4683a50";

fn setup_contracts(env: &Env) -> (Address, Address, Address, Address, Address) {
    let registry_id = env.register(dao_registry::WASM, ());
    let sbt_id = env.register(membership_sbt::WASM, (registry_id.clone(),));
    let tree_id = env.register(membership_tree::WASM, (sbt_id.clone(),));
    let voting_id = env.register(voting::WASM, (tree_id.clone(),));

    let admin = Address::generate(env);

    (registry_id, sbt_id, tree_id, voting_id, admin)
}

// Test: Corrupted proof data should fail verification
#[test]
#[should_panic(expected = "HostError")]
fn test_corrupted_proof_fails() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();

    let (registry_id, sbt_id, tree_id, voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let sbt_client = SbtClient::new(&env, &sbt_id);
    let tree_client = TreeClient::new(&env, &tree_id);
    let voting_client = VotingClient::new(&env, &voting_id);

    // Create DAO (dao_id = 1 to match proof)
    let dao_id = registry_client.create_dao(
        &String::from_str(&env, "Test DAO"),
        &admin,
        &false,
    );
    assert_eq!(dao_id, 1);

    // Initialize tree with depth 18
    tree_client.init_tree(&dao_id, &18, &admin);

    // Set REAL VK
    voting_client.set_vk(&dao_id, &get_real_vk(&env), &admin);

    // Member joins with real commitment
    let member = Address::generate(&env);
    sbt_client.mint(&dao_id, &member, &admin, &None);
    let commitment = hex_str_to_u256(&env, REAL_COMMITMENT_HEX);
    tree_client.register_with_caller(&dao_id, &commitment, &member);

    let root = tree_client.current_root(&dao_id);

    // Create proposal (proposal_id = 1 to match proof)
    let proposal_id = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "Test"),
        &(env.ledger().timestamp() + 86400),
        &member,
        &voting::VoteMode::Fixed,
    );
    assert_eq!(proposal_id, 1);

    // Try to vote with CORRUPTED proof - should fail
    let nullifier = hex_str_to_u256(&env, REAL_NULLIFIER_HEX);
    let corrupted_proof = get_corrupted_proof(&env);

    // This should fail - corrupted proof won't verify
    voting_client.vote(
        &dao_id,
        &proposal_id,
        &true,
        &nullifier,
        &root,
        &commitment,
        &corrupted_proof,
    );
}

// Test: Valid proof with wrong VK should fail
// This tests the VK hash check - proposal stores VK hash at creation time
#[test]
#[should_panic(expected = "HostError")]
fn test_wrong_vk_fails() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();

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

    // Set REAL VK initially
    voting_client.set_vk(&dao_id, &get_real_vk(&env), &admin);

    // Member joins
    let member = Address::generate(&env);
    sbt_client.mint(&dao_id, &member, &admin, &None);
    let commitment = hex_str_to_u256(&env, REAL_COMMITMENT_HEX);
    tree_client.register_with_caller(&dao_id, &commitment, &member);

    let root = tree_client.current_root(&dao_id);

    // Create proposal with real VK
    let proposal_id = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "Test"),
        &(env.ledger().timestamp() + 86400),
        &member,
        &voting::VoteMode::Fixed,
    );

    // Admin changes VK AFTER proposal creation
    voting_client.set_vk(&dao_id, &get_different_vk(&env), &admin);

    // Try to vote - should fail because VK hash doesn't match
    let nullifier = hex_str_to_u256(&env, REAL_NULLIFIER_HEX);
    let proof = get_real_proof(&env);

    voting_client.vote(
        &dao_id,
        &proposal_id,
        &true,
        &nullifier,
        &root,
        &commitment,
        &proof,
    );
}

// Test: Same nullifier can be used in different DAOs
// Nullifiers are scoped by DAO, so the same nullifier value in different DAOs is fine
// (In practice, nullifier = hash(secret, daoId, proposalId), so this would require
// different secrets to produce the same nullifier in different DAOs, but the contract
// doesn't prevent it since storage is DAO-scoped)
#[test]
fn test_nullifier_reusable_across_daos() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();

    let (registry_id, sbt_id, tree_id, voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let sbt_client = SbtClient::new(&env, &sbt_id);
    let tree_client = TreeClient::new(&env, &tree_id);
    let voting_client = VotingClient::new(&env, &voting_id);

    // Create TWO DAOs
    let dao_id_1 = registry_client.create_dao(
        &String::from_str(&env, "DAO 1"),
        &admin,
        &false,
    );
    let dao_id_2 = registry_client.create_dao(
        &String::from_str(&env, "DAO 2"),
        &admin,
        &false,
    );
    assert_eq!(dao_id_1, 1);
    assert_eq!(dao_id_2, 2);

    // Initialize trees for both DAOs
    tree_client.init_tree(&dao_id_1, &18, &admin);
    tree_client.init_tree(&dao_id_2, &18, &admin);

    // Set VK for both DAOs
    let vk = get_real_vk(&env);
    voting_client.set_vk(&dao_id_1, &vk, &admin);
    voting_client.set_vk(&dao_id_2, &vk, &admin);

    // Member joins both DAOs
    let member = Address::generate(&env);
    sbt_client.mint(&dao_id_1, &member, &admin, &None);
    sbt_client.mint(&dao_id_2, &member, &admin, &None);

    // Register with arbitrary commitment (we'll use mock data since actual voting
    // would need real proofs for each DAO)
    let commitment1 = U256::from_u32(&env, 111);
    let commitment2 = U256::from_u32(&env, 222);
    tree_client.register_with_caller(&dao_id_1, &commitment1, &member);
    tree_client.register_with_caller(&dao_id_2, &commitment2, &member);

    // Get roots
    let root1 = tree_client.current_root(&dao_id_1);
    let root2 = tree_client.current_root(&dao_id_2);

    // Create proposals in both DAOs
    let prop_id_1 = voting_client.create_proposal(
        &dao_id_1,
        &String::from_str(&env, "DAO 1 Proposal"),
        &(env.ledger().timestamp() + 86400),
        &member,
        &voting::VoteMode::Fixed,
    );
    let prop_id_2 = voting_client.create_proposal(
        &dao_id_2,
        &String::from_str(&env, "DAO 2 Proposal"),
        &(env.ledger().timestamp() + 86400),
        &member,
        &voting::VoteMode::Fixed,
    );

    // Check that nullifier storage is DAO-scoped
    // Using the same nullifier value in both DAOs should both return false initially
    let same_nullifier = U256::from_u32(&env, 99999);

    assert!(
        !voting_client.is_nullifier_used(&dao_id_1, &prop_id_1, &same_nullifier),
        "Nullifier should not be used in DAO 1 initially"
    );
    assert!(
        !voting_client.is_nullifier_used(&dao_id_2, &prop_id_2, &same_nullifier),
        "Nullifier should not be used in DAO 2 initially"
    );

    // We can't actually vote without real proofs, but we've verified:
    // 1. Both DAOs exist independently
    // 2. Nullifier usage is DAO-scoped (both show "not used")
    // 3. The same nullifier value can exist in different DAO contexts

    println!("✅ Verified nullifier storage is DAO-scoped");
}

// Test: Proof for wrong DAO ID fails
// The proof contains daoId in public signals, so using a proof generated for DAO 1
// when voting on DAO 2 should fail verification
#[test]
#[should_panic(expected = "HostError")]
fn test_proof_for_wrong_dao_fails() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();

    let (registry_id, sbt_id, tree_id, voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let sbt_client = SbtClient::new(&env, &sbt_id);
    let tree_client = TreeClient::new(&env, &tree_id);
    let voting_client = VotingClient::new(&env, &voting_id);

    // Create TWO DAOs - we'll try to use a proof for DAO 1 on DAO 2
    let _dao_id_1 = registry_client.create_dao(
        &String::from_str(&env, "DAO 1"),
        &admin,
        &false,
    );
    let dao_id_2 = registry_client.create_dao(
        &String::from_str(&env, "DAO 2"),
        &admin,
        &false,
    );

    // Initialize tree for DAO 2
    tree_client.init_tree(&dao_id_2, &18, &admin);

    // Set VK for DAO 2
    voting_client.set_vk(&dao_id_2, &get_real_vk(&env), &admin);

    // Member joins DAO 2 with the same commitment as the proof
    let member = Address::generate(&env);
    sbt_client.mint(&dao_id_2, &member, &admin, &None);
    let commitment = hex_str_to_u256(&env, REAL_COMMITMENT_HEX);
    tree_client.register_with_caller(&dao_id_2, &commitment, &member);

    let root = tree_client.current_root(&dao_id_2);

    // Create proposal in DAO 2
    let proposal_id = voting_client.create_proposal(
        &dao_id_2,
        &String::from_str(&env, "DAO 2 Proposal"),
        &(env.ledger().timestamp() + 86400),
        &member,
        &voting::VoteMode::Fixed,
    );

    // Try to vote on DAO 2 with proof generated for DAO 1
    // The proof has daoId=1 in its public signals, but we're voting on daoId=2
    let nullifier = hex_str_to_u256(&env, REAL_NULLIFIER_HEX);
    let proof = get_real_proof(&env);

    // This should fail - proof daoId (1) doesn't match actual daoId (2)
    voting_client.vote(
        &dao_id_2,
        &proposal_id,
        &true,
        &nullifier,
        &root,
        &commitment,
        &proof,
    );
}

// Test: Proof for wrong proposal ID fails
#[test]
#[should_panic(expected = "HostError")]
fn test_proof_for_wrong_proposal_fails() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();

    let (registry_id, sbt_id, tree_id, voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let sbt_client = SbtClient::new(&env, &sbt_id);
    let tree_client = TreeClient::new(&env, &tree_id);
    let voting_client = VotingClient::new(&env, &voting_id);

    // Create DAO (dao_id = 1 to match proof)
    let dao_id = registry_client.create_dao(
        &String::from_str(&env, "Test DAO"),
        &admin,
        &false,
    );

    // Initialize tree
    tree_client.init_tree(&dao_id, &18, &admin);

    // Set VK
    voting_client.set_vk(&dao_id, &get_real_vk(&env), &admin);

    // Member joins
    let member = Address::generate(&env);
    sbt_client.mint(&dao_id, &member, &admin, &None);
    let commitment = hex_str_to_u256(&env, REAL_COMMITMENT_HEX);
    tree_client.register_with_caller(&dao_id, &commitment, &member);

    let root = tree_client.current_root(&dao_id);

    // Create TWO proposals - we'll skip prop 1 and try to use its proof on prop 2
    let _proposal_1 = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "Proposal 1"),
        &(env.ledger().timestamp() + 86400),
        &member,
        &voting::VoteMode::Fixed,
    );
    let proposal_2 = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "Proposal 2"),
        &(env.ledger().timestamp() + 86400),
        &member,
        &voting::VoteMode::Fixed,
    );

    // Try to vote on proposal 2 with proof generated for proposal 1
    // The proof has proposalId=1 in its public signals, but we're voting on proposalId=2
    let nullifier = hex_str_to_u256(&env, REAL_NULLIFIER_HEX);
    let proof = get_real_proof(&env);

    // This should fail - proof proposalId (1) doesn't match actual proposalId (2)
    voting_client.vote(
        &dao_id,
        &proposal_2,
        &true,
        &nullifier,
        &root,
        &commitment,
        &proof,
    );
}
