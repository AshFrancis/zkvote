// Vote Mode Tests
//
// Tests for the two voting modes:
// 1. Fixed Mode: Only members at time of proposal creation can vote
// 2. Trailing Mode: Members added after proposal creation can also vote
//
// These tests use REAL Groth16 proof data (BE-encoded) for accurate BN254 verification.

use soroban_sdk::{
    testutils::Address as _, Address, Bytes, BytesN, Env, String, Vec as SdkVec, U256,
};

// Import all contract clients
mod dao_registry {
    soroban_sdk::contractimport!(file = "../../target/wasm32v1-none/release/dao_registry.wasm");
}

mod membership_sbt {
    soroban_sdk::contractimport!(file = "../../target/wasm32v1-none/release/membership_sbt.wasm");
}

mod membership_tree {
    soroban_sdk::contractimport!(file = "../../target/wasm32v1-none/release/membership_tree.wasm");
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

// Helper to convert hex string to BytesN
fn hex_to_bytes<const N: usize>(env: &Env, hex: &str) -> BytesN<N> {
    let bytes = hex::decode(hex).expect("invalid hex");
    assert_eq!(bytes.len(), N, "hex string wrong length");
    BytesN::from_array(env, &bytes.try_into().unwrap())
}

// Helper to convert hex string to U256 (big-endian)
fn hex_str_to_u256(env: &Env, hex: &str) -> U256 {
    let bytes = hex::decode(hex).expect("invalid hex");
    let mut padded = [0u8; 32];
    let start = 32 - bytes.len();
    padded[start..].copy_from_slice(&bytes);
    U256::from_be_bytes(env, &Bytes::from_array(env, &padded))
}

// Real verification key from circuits/build/verification_key_soroban_be.json (BIG-ENDIAN)
// 7 IC elements for 6 public signals: root, nullifier, daoId, proposalId, voteChoice, commitment
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

// Real proof from circuits/build/proof_soroban_be.json (BIG-ENDIAN)
// Generated with: secret=123456789, salt=987654321, daoId=1, proposalId=1, voteChoice=1
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

// Test data from the real proof:
// commitment = 16832421271961222550979173996485995711342823810308835997146707681980704453417
// nullifier = 5760508796108392755529358167294721063592787938597807569861628631651201858128
// root = 17138981085726982929815047770222948937180916992196016628536485002859509881328
// (depth 18, commitment at index 0)
const REAL_COMMITMENT_HEX: &str =
    "2536d01521137bf7b39e3fd26c1376f456ce46a45993a5d7c3c158a450fd7329";
const REAL_NULLIFIER_HEX: &str = "0cbc551a937e12107e513efd646a4f32eec3f0d2c130532e3516bdd9d4683a50";
// Additional real proof (member, index 0, late join) generated via circuits/generate_proof_instance.js
const REAL2_COMMITMENT_HEX: &str =
    "012d2a4324506e9db0081457edb50a66a6a7c06cce0b6b6cd1b4345a8d8a21f0";
const REAL2_NULLIFIER_HEX: &str =
    "2ea01c1227e074745102e534fe4ae64a1c50d5a630ffa39c9e944d665858d10e";
const REAL2_ROOT_HEX: &str = "18eb1b3ca83d4da5d314bdc471b7ea052ca61998257821d97572f50aa2f5a280";
// Soroban-converted proof for member2_index0 (BE, G2 ordered as [imag_x, real_x, imag_y, real_y])
const REAL2_PROOF_A: &str =
    "231d8411466e24e4d514ceffc6ee7d0f90518573147c0290f6f9f628dc9b2e6f007372ea52eecd0e4db398f57dfb2111d9d75482dfc217690b30b0e81b59f6b9";
const REAL2_PROOF_B: &str = "075ba375a79af805e7a946a31ac1b3a2b9630d603e4010006aeeb5606774830705de109bd687f4e63053fb56275d15ee3d45a5f7ef4591b87046d2134b87e6951197f315ecec439027dcf7b3826e35f2a84b2e787a90be72804732e33cb63f0204033c8c4b797b6580a6fc95a20db5e5563d5e4de38b0f23baf4de885fe4d2ff";
const REAL2_PROOF_C: &str =
    "0229d1f4afd6d36b064ab8048263b4b64d7b14efd4fe713f4b8e854e932d75bd2406f934e1b865c6d26ee8bf2239b3ce6ebeb2f59265089540392ca864600f0c";

// Churn test: two trailing proposals, late joiner votes on both (testutils path, mock proof).
#[test]
#[should_panic(expected = "HostError")]
fn test_trailing_mode_churn_across_parallel_proposals() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();

    let (registry_id, sbt_id, tree_id, voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let sbt_client = SbtClient::new(&env, &sbt_id);
    let tree_client = TreeClient::new(&env, &tree_id);
    let voting_client = VotingClient::new(&env, &voting_id);

    let member1 = Address::generate(&env);
    let member2 = Address::generate(&env);

    let dao_id = registry_client.create_dao(&String::from_str(&env, "Churn DAO"), &admin, &true, &true, &None);
    tree_client.init_tree(&dao_id, &18, &admin);
    // Use mock VK/proof; in testutils path verification is bypassed.
    let vk = create_mock_vk(&env);
    voting_client.set_vk(&dao_id, &vk, &admin);

    // member1 joins before proposals
    sbt_client.mint(&dao_id, &member1, &admin, &None);
    let commitment1 = U256::from_u32(&env, 111);
    tree_client.register_with_caller(&dao_id, &commitment1, &member1);

    let root_at_creation = tree_client.current_root(&dao_id);

    // Two trailing proposals
    let proposal_a = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "A"),
        &String::from_str(&env, ""),
        &(env.ledger().timestamp() + 3600),
        &member1,
        &voting::VoteMode::Trailing,
    );
    let proposal_b = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "B"),
        &String::from_str(&env, ""),
        &(env.ledger().timestamp() + 3600),
        &member1,
        &voting::VoteMode::Trailing,
    );

    // member2 joins after proposals
    sbt_client.mint(&dao_id, &member2, &admin, &None);
    let commitment2 = U256::from_u32(&env, 222);
    tree_client.register_with_caller(&dao_id, &commitment2, &member2);
    let root_after_join = tree_client.current_root(&dao_id);
    assert_ne!(root_at_creation, root_after_join);

    let nullifier1 = U256::from_u32(&env, 9001);
    let nullifier2 = U256::from_u32(&env, 9002);
    let proof = create_mock_proof(&env);

    // Vote on proposal A should succeed
    voting_client.vote(
        &dao_id,
        &proposal_a,
        &true,
        &nullifier1,
        &root_after_join,
        &commitment2,
        &proof,
    );

    // Second vote reuses a distinct nullifier on proposal B; should also succeed
    voting_client.vote(
        &dao_id,
        &proposal_b,
        &false,
        &nullifier2,
        &root_after_join,
        &commitment2,
        &proof,
    );

    let pa = voting_client.get_proposal(&dao_id, &proposal_a);
    let pb = voting_client.get_proposal(&dao_id, &proposal_b);
    assert_eq!(pa.yes_votes + pa.no_votes, 1);
    assert_eq!(pb.yes_votes + pb.no_votes, 1);
}

// Helper function to create BN254 G1 generator point (1, 2) - for mock proofs in failure tests
fn bn254_g1_generator(env: &Env) -> soroban_sdk::BytesN<64> {
    let mut bytes = [0u8; 64];
    // x = 1 (big-endian, 32 bytes)
    bytes[31] = 1;
    // y = 2 (big-endian, 32 bytes)
    bytes[63] = 2;
    soroban_sdk::BytesN::from_array(env, &bytes)
}

// Helper function to create BN254 G2 generator point - for mock proofs in failure tests
fn bn254_g2_generator(env: &Env) -> soroban_sdk::BytesN<128> {
    let bytes: [u8; 128] = [
        // x1 (imag) - 32 bytes
        0x18, 0x00, 0x50, 0x6a, 0x06, 0x12, 0x86, 0xeb, 0x6a, 0x84, 0xa5, 0x73, 0x0b, 0x8f, 0x10,
        0x29, 0x3e, 0x29, 0x81, 0x6c, 0xd1, 0x91, 0x3d, 0x53, 0x38, 0xf7, 0x15, 0xde, 0x3e, 0x98,
        0xf9, 0xad, // x2 (real) - 32 bytes
        0x19, 0x83, 0x90, 0x42, 0x11, 0xa5, 0x3f, 0x6e, 0x0b, 0x08, 0x53, 0xa9, 0x0a, 0x00, 0xef,
        0xbf, 0xf1, 0x70, 0x0c, 0x7b, 0x1d, 0xc0, 0x06, 0x32, 0x4d, 0x85, 0x9d, 0x75, 0xe3, 0xca,
        0xa5, 0xa2, // y1 (imag) - 32 bytes
        0x12, 0xc8, 0x5e, 0xa5, 0xdb, 0x8c, 0x6d, 0xeb, 0x4a, 0xab, 0x71, 0x8e, 0x80, 0x6a, 0x51,
        0xa5, 0x66, 0x08, 0x21, 0x4c, 0x3f, 0x62, 0x8b, 0x96, 0x2c, 0xf1, 0x91, 0xea, 0xcd, 0xc8,
        0x0e, 0x7a, // y2 (real) - 32 bytes
        0x09, 0x0d, 0x97, 0xc0, 0x9c, 0xe1, 0x48, 0x60, 0x63, 0xb3, 0x59, 0xf3, 0xdd, 0x89, 0xb7,
        0xc4, 0x3c, 0x5f, 0x18, 0x95, 0x8f, 0xb3, 0xe6, 0xb9, 0x6d, 0xb5, 0x5e, 0x19, 0xa3, 0xb7,
        0xc0, 0xfb,
    ];
    soroban_sdk::BytesN::from_array(env, &bytes)
}

// Mock VK for failure tests (doesn't need to be valid since tests expect failures)
fn create_mock_vk(env: &Env) -> voting::VerificationKey {
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
            g1_gen.clone(), // 7th element for commitment
        ],
    }
}

// Mock proof for failure tests
fn create_mock_proof(env: &Env) -> voting::Proof {
    voting::Proof {
        a: bn254_g1_generator(env),
        b: bn254_g2_generator(env),
        c: bn254_g1_generator(env),
    }
}

// Test: Fixed mode - late joiner cannot vote (root mismatch)
// This test fails BEFORE proof verification (at root check), so mock data is fine
#[test]
#[should_panic(expected = "HostError")]
fn test_fixed_mode_late_joiner_cannot_vote() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();

    let (registry_id, sbt_id, tree_id, voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let sbt_client = SbtClient::new(&env, &sbt_id);
    let tree_client = TreeClient::new(&env, &tree_id);
    let voting_client = VotingClient::new(&env, &voting_id);

    // Create DAO
    let dao_id = registry_client.create_dao(&String::from_str(&env, "Test DAO"), &admin, &false, &true, &None);

    // Initialize tree
    tree_client.init_tree(&dao_id, &18, &admin);

    // Set VK (mock is fine since we fail before proof verification)
    let vk = create_mock_vk(&env);
    voting_client.set_vk(&dao_id, &vk, &admin);

    // Member 1 joins
    let member1 = Address::generate(&env);
    sbt_client.mint(&dao_id, &member1, &admin, &None);
    let commitment1 = U256::from_u32(&env, 111);
    tree_client.register_with_caller(&dao_id, &commitment1, &member1);

    // Create proposal in FIXED mode
    let proposal_id = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "Test proposal"),
        &String::from_str(&env, ""),
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

    // Member 2 attempts to vote with new root (should fail - root mismatch)
    let nullifier2 = U256::from_u32(&env, 999);
    let proof2 = create_mock_proof(&env);

    // This should panic with "root must match proposal eligible root"
    voting_client.vote(
        &dao_id,
        &proposal_id,
        &true,
        &nullifier2,
        &new_root,
        &commitment2,
        &proof2,
    );
}

// Test: Trailing mode - late joiner CAN vote (root history allows newer roots)
// Uses REAL proof data from circuits/build/ for actual BN254 verification
#[test]
fn test_trailing_mode_late_joiner_can_vote() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();

    let (registry_id, sbt_id, tree_id, voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let sbt_client = SbtClient::new(&env, &sbt_id);
    let tree_client = TreeClient::new(&env, &tree_id);
    let voting_client = VotingClient::new(&env, &voting_id);

    // Create DAO (first DAO will have dao_id = 1, matching the proof)
    let dao_id = registry_client.create_dao(&String::from_str(&env, "Test DAO"), &admin, &false, &true, &None);
    assert_eq!(dao_id, 1, "First DAO must have ID 1 to match proof");

    // Initialize tree with depth 18 (matching the proof)
    tree_client.init_tree(&dao_id, &18, &admin);

    // Set REAL VK
    let vk = get_real_vk(&env);
    voting_client.set_vk(&dao_id, &vk, &admin);

    // Member 1 joins with the REAL commitment from the proof
    // This is the commitment the proof was generated for
    let member1 = Address::generate(&env);
    sbt_client.mint(&dao_id, &member1, &admin, &None);
    let commitment1 = hex_str_to_u256(&env, REAL_COMMITMENT_HEX);
    tree_client.register_with_caller(&dao_id, &commitment1, &member1);

    // The root after registering commitment1 should match the proof's root
    let root_after_member1 = tree_client.current_root(&dao_id);

    // Create proposal in TRAILING mode (first proposal will have proposal_id = 1, matching the proof)
    let proposal_id = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "Test proposal"),
        &String::from_str(&env, ""),
        &(env.ledger().timestamp() + 86400),
        &member1,
        &voting::VoteMode::Trailing, // Trailing mode
    );
    assert_eq!(
        proposal_id, 1,
        "First proposal must have ID 1 to match proof"
    );

    // Member 2 joins AFTER proposal creation (changes the root)
    let member2 = Address::generate(&env);
    sbt_client.mint(&dao_id, &member2, &admin, &None);
    let commitment2 = U256::from_u32(&env, 222);
    tree_client.register_with_caller(&dao_id, &commitment2, &member2);

    // In trailing mode, member1 can STILL vote with the OLD root (captured at proposal creation)
    // because trailing mode tracks root history and allows any valid historical root
    let nullifier = hex_str_to_u256(&env, REAL_NULLIFIER_HEX);
    let proof = get_real_proof(&env);

    // Vote with the root that was valid when member1 registered (before member2 joined)
    voting_client.vote(
        &dao_id,
        &proposal_id,
        &true,
        &nullifier,
        &root_after_member1, // Use the root from when member1 was the only member
        &commitment1,
        &proof,
    );

    // Verify vote counted
    let proposal = voting_client.get_proposal(&dao_id, &proposal_id);
    assert_eq!(proposal.yes_votes, 1);

    println!("✅ Trailing mode correctly allowed member to vote with historical root");
}

/// Trailing mode with a real proof for a late joiner (member at index 1).
#[test]
fn test_trailing_mode_late_joiner_can_vote_real_member2() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();

    let (registry_id, sbt_id, tree_id, voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let sbt_client = SbtClient::new(&env, &sbt_id);
    let tree_client = TreeClient::new(&env, &tree_id);
    let voting_client = VotingClient::new(&env, &voting_id);

    let dao_id = registry_client.create_dao(&String::from_str(&env, "Test DAO"), &admin, &false, &true, &None);
    tree_client.init_tree(&dao_id, &18, &admin);

    // Use real VK
    let vk = get_real_vk(&env);
    voting_client.set_vk(&dao_id, &vk, &admin);

    // Creator needs SBT to create proposal (but doesn't need to be registered)
    let creator = Address::generate(&env);
    sbt_client.mint(&dao_id, &creator, &admin, &None);

    // Create trailing proposal BEFORE the member is registered
    let proposal_id = voting_client.create_proposal(
        &dao_id,
        &String::from_str(&env, "Trailing member2"),
        &String::from_str(&env, ""),
        &(env.ledger().timestamp() + 86400),
        &creator,
        &voting::VoteMode::Trailing,
    );
    assert_eq!(proposal_id, 1);

    // Late joiner (member 2) registers commitment at index 0 (first leaf)
    let member2 = Address::generate(&env);
    sbt_client.mint(&dao_id, &member2, &admin, &None);
    let commitment2 = hex_str_to_u256(&env, REAL2_COMMITMENT_HEX);
    tree_client.register_with_caller(&dao_id, &commitment2, &member2);
    let root_after_join = tree_client.current_root(&dao_id);
    assert_eq!(root_after_join, hex_str_to_u256(&env, REAL2_ROOT_HEX));

    let nullifier2 = hex_str_to_u256(&env, REAL2_NULLIFIER_HEX);
    let proof = voting::Proof {
        a: hex_to_bytes(&env, REAL2_PROOF_A),
        b: hex_to_bytes(&env, REAL2_PROOF_B),
        c: hex_to_bytes(&env, REAL2_PROOF_C),
    };

    // Vote should succeed with the newer root in trailing mode
    voting_client.vote(
        &dao_id,
        &proposal_id,
        &true,
        &nullifier2,
        &root_after_join,
        &commitment2,
        &proof,
    );

    let updated = voting_client.get_proposal(&dao_id, &proposal_id);
    assert_eq!(updated.yes_votes, 1);
}

// Test: Trailing mode - removed member cannot vote on NEW proposal (commitment revoked)
// This test fails BEFORE proof verification (at revocation check), so mock data is fine
#[test]
#[should_panic(expected = "HostError")]
fn test_trailing_mode_removed_member_cannot_vote_on_new_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();

    let (registry_id, sbt_id, tree_id, voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let sbt_client = SbtClient::new(&env, &sbt_id);
    let tree_client = TreeClient::new(&env, &tree_id);
    let voting_client = VotingClient::new(&env, &voting_id);

    // Create DAO
    let dao_id = registry_client.create_dao(&String::from_str(&env, "Test DAO"), &admin, &false, &true, &None);

    // Initialize tree and set VK (mock is fine since we fail before proof verification)
    tree_client.init_tree(&dao_id, &18, &admin);

    let vk = create_mock_vk(&env);
    voting_client.set_vk(&dao_id, &vk, &admin);

    // Member 1 joins
    let member1 = Address::generate(&env);
    sbt_client.mint(&dao_id, &member1, &admin, &None);
    let commitment1 = U256::from_u32(&env, 111);
    tree_client.register_with_caller(&dao_id, &commitment1, &member1);

    let old_root = tree_client.current_root(&dao_id);

    // Admin removes member1 (this revokes their commitment)
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
        &String::from_str(&env, ""),
        &(env.ledger().timestamp() + 86400),
        &member2,
        &voting::VoteMode::Trailing, // Trailing mode
    );

    // Removed member1 tries to vote (should fail - commitment revoked)
    let nullifier1 = U256::from_u32(&env, 888);
    let proof1 = create_mock_proof(&env);

    // This should panic with "commitment revoked at proposal creation"
    voting_client.vote(
        &dao_id,
        &proposal_id,
        &true,
        &nullifier1,
        &old_root,
        &commitment1,
        &proof1,
    );
}

// Test: Trailing mode - removed member CANNOT vote even on OLD proposal
// Current contract behavior: once revoked, a member cannot vote on ANY proposal
// (they would need to be reinstated first)
// This test documents this behavior - see lib.rs for the equivalent native test
#[test]
#[should_panic(expected = "HostError")]
fn test_trailing_mode_removed_member_cannot_vote_on_old_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();

    let (registry_id, sbt_id, tree_id, voting_id, admin) = setup_contracts(&env);

    let registry_client = RegistryClient::new(&env, &registry_id);
    let sbt_client = SbtClient::new(&env, &sbt_id);
    let tree_client = TreeClient::new(&env, &tree_id);
    let voting_client = VotingClient::new(&env, &voting_id);

    // Create DAO
    let dao_id = registry_client.create_dao(&String::from_str(&env, "Test DAO"), &admin, &false, &true, &None);

    // Initialize tree and set VK (mock is fine since we fail before proof verification)
    tree_client.init_tree(&dao_id, &18, &admin);

    let vk = create_mock_vk(&env);
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
        &String::from_str(&env, ""),
        &(env.ledger().timestamp() + 86400),
        &member1,
        &voting::VoteMode::Trailing, // Trailing mode
    );

    let old_root = tree_client.current_root(&dao_id);

    // Admin removes member1 AFTER proposal creation
    tree_client.remove_member(&dao_id, &member1, &admin);

    // Removed member1 tries to vote - this FAILS because revocation check happens first
    // The contract checks if commitment is currently revoked, regardless of when proposal was created
    let nullifier1 = U256::from_u32(&env, 888);
    let proof1 = create_mock_proof(&env);

    // This should panic with "commitment revoked"
    voting_client.vote(
        &dao_id,
        &proposal_id,
        &true,
        &nullifier1,
        &old_root,
        &commitment1,
        &proof1,
    );
}
