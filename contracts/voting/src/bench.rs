#![cfg(test)]

//! Lightweight stress harness for large-tree/proposal scenarios.
//! Not part of the main test run; mark ignored to avoid CI time unless profiling.

use soroban_sdk::{testutils::Address as _, Address, Env, String};

mod dao_registry {
    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/dao_registry.wasm");
}

mod membership_sbt {
    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/membership_sbt.wasm");
}

mod membership_tree {
    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/membership_tree.wasm");
}

mod voting {
    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/voting.wasm");
}

use dao_registry::Client as RegistryClient;
use membership_sbt::Client as SbtClient;
use membership_tree::Client as TreeClient;
use voting::Client as VotingClient;

#[test]
#[ignore]
fn stress_many_proposals_and_members() {
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
    tree.init_tree(&dao_id, &20, &admin);
    voting.set_vk(&dao_id, &crate::test::create_dummy_vk(&env), &admin);

    // Populate 100 members
    for i in 0..100u32 {
        let member = Address::generate(&env);
        sbt.mint(&dao_id, &member, &admin, &None);
        // Commitments are not used further in this smoke; tree depth handles capacity check
    }

    // Create 100 proposals
    for i in 0..100u32 {
        let desc = String::from_str(&env, &format!("Prop {}", i));
        let _pid = voting.create_proposal(&dao_id, &desc, &0u64, &admin, &voting::VoteMode::Fixed);
    }
}
