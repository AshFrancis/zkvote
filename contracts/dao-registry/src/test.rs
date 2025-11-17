#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env, String};

#[test]
fn test_create_dao() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DaoRegistry, ());
    let client = DaoRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let name = String::from_str(&env, "Test DAO");

    let dao_id = client.create_dao(&name, &admin);
    assert_eq!(dao_id, 1);

    let info = client.get_dao(&dao_id);
    assert_eq!(info.id, 1);
    assert_eq!(info.admin, admin);
    assert_eq!(info.name, name);
}

#[test]
fn test_create_multiple_daos() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DaoRegistry, ());
    let client = DaoRegistryClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);

    let dao1 = client.create_dao(&String::from_str(&env, "DAO 1"), &admin1);
    let dao2 = client.create_dao(&String::from_str(&env, "DAO 2"), &admin2);
    let dao3 = client.create_dao(&String::from_str(&env, "DAO 3"), &admin1);

    assert_eq!(dao1, 1);
    assert_eq!(dao2, 2);
    assert_eq!(dao3, 3);

    assert_eq!(client.get_admin(&dao1), admin1);
    assert_eq!(client.get_admin(&dao2), admin2);
    assert_eq!(client.get_admin(&dao3), admin1);

    assert_eq!(client.dao_count(), 3);
}

#[test]
fn test_dao_exists() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DaoRegistry, ());
    let client = DaoRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let dao_id = client.create_dao(&String::from_str(&env, "Test"), &admin);

    assert!(client.dao_exists(&dao_id));
    assert!(!client.dao_exists(&999));
}

#[test]
fn test_transfer_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DaoRegistry, ());
    let client = DaoRegistryClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);

    let dao_id = client.create_dao(&String::from_str(&env, "Test"), &admin1);
    assert_eq!(client.get_admin(&dao_id), admin1);

    client.transfer_admin(&dao_id, &admin2);
    assert_eq!(client.get_admin(&dao_id), admin2);
}

#[test]
#[should_panic(expected = "DAO not found")]
fn test_get_nonexistent_dao_fails() {
    let env = Env::default();

    let contract_id = env.register(DaoRegistry, ());
    let client = DaoRegistryClient::new(&env, &contract_id);

    client.get_dao(&999);
}

#[test]
fn test_create_dao_requires_admin_auth() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DaoRegistry, ());
    let client = DaoRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.create_dao(&String::from_str(&env, "Test"), &admin);

    // Verify admin auth was required
    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, admin);
}

#[test]
fn test_transfer_admin_requires_current_admin_auth() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DaoRegistry, ());
    let client = DaoRegistryClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);

    let dao_id = client.create_dao(&String::from_str(&env, "Test"), &admin1);
    client.transfer_admin(&dao_id, &admin2);

    // Verify old admin auth was required for transfer
    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, admin1);
}

#[test]
fn test_dao_count_consistency() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DaoRegistry, ());
    let client = DaoRegistryClient::new(&env, &contract_id);

    assert_eq!(client.dao_count(), 0);

    let admin = Address::generate(&env);
    client.create_dao(&String::from_str(&env, "DAO 1"), &admin);
    assert_eq!(client.dao_count(), 1);

    client.create_dao(&String::from_str(&env, "DAO 2"), &admin);
    assert_eq!(client.dao_count(), 2);

    client.create_dao(&String::from_str(&env, "DAO 3"), &admin);
    assert_eq!(client.dao_count(), 3);
}
