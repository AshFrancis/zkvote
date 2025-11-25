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

    let dao_id = client.create_dao(&name, &admin, &false);
    assert_eq!(dao_id, 1);

    let info = client.get_dao(&dao_id);
    assert_eq!(info.id, 1);
    assert_eq!(info.admin, admin);
    assert_eq!(info.name, name);
    assert_eq!(info.membership_open, false);
}

#[test]
fn test_create_multiple_daos() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DaoRegistry, ());
    let client = DaoRegistryClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);

    let dao1 = client.create_dao(&String::from_str(&env, "DAO 1"), &admin1, &false);
    let dao2 = client.create_dao(&String::from_str(&env, "DAO 2"), &admin2, &true);
    let dao3 = client.create_dao(&String::from_str(&env, "DAO 3"), &admin1, &false);

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
    let dao_id = client.create_dao(&String::from_str(&env, "Test"), &admin, &false);

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

    let dao_id = client.create_dao(&String::from_str(&env, "Test"), &admin1, &false);
    assert_eq!(client.get_admin(&dao_id), admin1);

    client.transfer_admin(&dao_id, &admin2);
    assert_eq!(client.get_admin(&dao_id), admin2);
}

#[test]
#[should_panic(expected = "HostError")]
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
    client.create_dao(&String::from_str(&env, "Test"), &admin, &false);

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

    let dao_id = client.create_dao(&String::from_str(&env, "Test"), &admin1, &false);
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
    client.create_dao(&String::from_str(&env, "DAO 1"), &admin, &false);
    assert_eq!(client.dao_count(), 1);

    client.create_dao(&String::from_str(&env, "DAO 2"), &admin, &true);
    assert_eq!(client.dao_count(), 2);

    client.create_dao(&String::from_str(&env, "DAO 3"), &admin, &false);
    assert_eq!(client.dao_count(), 3);
}

#[test]
fn test_create_dao_max_name_length_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DaoRegistry, ());
    let client = DaoRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    // Create name exactly 256 chars (MAX_DAO_NAME_LEN)
    let max_name = "a".repeat(256);

    let dao_id = client.create_dao(&String::from_str(&env, &max_name), &admin, &false);
    assert_eq!(dao_id, 1);

    let info = client.get_dao(&dao_id);
    assert_eq!(info.name.len(), 256);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_create_dao_name_too_long_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DaoRegistry, ());
    let client = DaoRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    // Create name > 256 chars (MAX_DAO_NAME_LEN)
    let long_name = "a".repeat(257);

    client.create_dao(&String::from_str(&env, &long_name), &admin, &false);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_create_dao_name_extremely_long_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DaoRegistry, ());
    let client = DaoRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    // Create name much larger than limit (5KB)
    let extreme_name = "a".repeat(5000);

    client.create_dao(&String::from_str(&env, &extreme_name), &admin, &false);
}

#[test]
fn test_membership_open_field() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DaoRegistry, ());
    let client = DaoRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);

    // Create closed membership DAO
    let closed_dao_id = client.create_dao(&String::from_str(&env, "Closed DAO"), &admin, &false);
    assert_eq!(client.is_membership_open(&closed_dao_id), false);

    // Create open membership DAO
    let open_dao_id = client.create_dao(&String::from_str(&env, "Open DAO"), &admin, &true);
    assert_eq!(client.is_membership_open(&open_dao_id), true);

    // Verify info struct contains correct value
    let closed_info = client.get_dao(&closed_dao_id);
    assert_eq!(closed_info.membership_open, false);

    let open_info = client.get_dao(&open_dao_id);
    assert_eq!(open_info.membership_open, true);
}
