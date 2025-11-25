#![no_std]
use soroban_sdk::{contract, contractimpl, vec, Env, Symbol, U256};

/// Minimal contract to test P25 feature availability:
/// - Poseidon hashing (BN254 field)
/// - BN254 curve operations
#[contract]
pub struct P25FeatureCheck;

#[contractimpl]
impl P25FeatureCheck {
    /// Test if Poseidon hash is available
    /// Returns the Poseidon hash of two field elements
    pub fn test_poseidon(env: Env, a: U256, b: U256) -> U256 {
        let field = Symbol::new(&env, "BN254");
        let inputs = vec![&env, a, b];
        env.crypto().poseidon_hash(&inputs, field)
    }

    /// Test if BN254 operations are available
    /// Returns true if we can access BN254 functionality
    pub fn test_bn254_available(env: Env) -> bool {
        // Try to access BN254 module
        // If this compiles and runs, BN254 is available
        let _ = env.crypto().bn254();
        true
    }

    /// Combined test - returns hash if both features work
    pub fn test_p25_features(env: Env) -> U256 {
        // Test Poseidon
        let field = Symbol::new(&env, "BN254");
        let inputs = vec![&env, U256::from_u32(&env, 1), U256::from_u32(&env, 2)];
        let hash = env.crypto().poseidon_hash(&inputs, field);

        // Test BN254 access
        let _ = env.crypto().bn254();

        hash
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_poseidon_local() {
        let env = Env::default();
        let contract_id = env.register(P25FeatureCheck, ());
        let client = P25FeatureCheckClient::new(&env, &contract_id);

        let a = U256::from_u32(&env, 12345);
        let b = U256::from_u32(&env, 67890);

        let hash = client.test_poseidon(&a, &b);

        // Hash should not be zero
        assert_ne!(hash, U256::from_u32(&env, 0));
    }

    #[test]
    fn test_bn254_local() {
        let env = Env::default();
        let contract_id = env.register(P25FeatureCheck, ());
        let client = P25FeatureCheckClient::new(&env, &contract_id);

        assert!(client.test_bn254_available());
    }

    #[test]
    fn test_combined() {
        let env = Env::default();
        let contract_id = env.register(P25FeatureCheck, ());
        let client = P25FeatureCheckClient::new(&env, &contract_id);

        let hash = client.test_p25_features();
        assert_ne!(hash, U256::from_u32(&env, 0));
    }
}
