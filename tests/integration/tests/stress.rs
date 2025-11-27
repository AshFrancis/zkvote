#![allow(deprecated)]

// Ignored large-scale smoke to gauge capacity (members + proposals).
// Run manually with `cargo test --test stress -- --ignored` when profiling.

use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

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

fn zero_g1(env: &Env) -> BytesN<64> {
    BytesN::from_array(env, &[0u8; 64])
}

fn zero_g2(env: &Env) -> BytesN<128> {
    BytesN::from_array(env, &[0u8; 128])
}

fn dummy_vk(env: &Env) -> voting::VerificationKey {
    let mut ic = soroban_sdk::Vec::new(env);
    for _ in 0..7 {
        ic.push_back(zero_g1(env));
    }
    voting::VerificationKey {
        alpha: zero_g1(env),
        beta: zero_g2(env),
        gamma: zero_g2(env),
        delta: zero_g2(env),
        ic,
    }
}

#[test]
#[ignore]
fn stress_many_members_and_proposals() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();

    let registry_id = env.register(dao_registry::WASM, ());
    let sbt_id = env.register(membership_sbt::WASM, (registry_id.clone(),));
    let tree_id = env.register(membership_tree::WASM, (sbt_id.clone(),));
    let voting_id = env.register(voting::WASM, (tree_id.clone(),));

    let registry = RegistryClient::new(&env, &registry_id);
    let sbt = SbtClient::new(&env, &sbt_id);
    let tree = TreeClient::new(&env, &tree_id);
    let voting = VotingClient::new(&env, &voting_id);

    let admin = Address::generate(&env);
    let dao_id = registry.create_dao(&String::from_str(&env, "Stress DAO"), &admin, &false);
    // Use depth 18 to stay within tested bounds
    tree.init_tree(&dao_id, &18, &admin);
    sbt.mint(&dao_id, &admin, &admin, &None);
    voting.set_vk(&dao_id, &dummy_vk(&env), &admin);

    // Add a few hundred members
    for _ in 0..300u32 {
        let member = Address::generate(&env);
        sbt.mint(&dao_id, &member, &admin, &None);
        // Skip registering commitments to save time; tree capacity is exercised via depth.
    }

    // Create many proposals
    for i in 0..200u32 {
        let desc = String::from_str(&env, &format!("Prop {}", i));
        let _ = voting.create_proposal(&dao_id, &desc, &0u64, &admin, &voting::VoteMode::Fixed);
    }
}
