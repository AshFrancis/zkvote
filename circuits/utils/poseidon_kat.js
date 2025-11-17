#!/usr/bin/env node
/**
 * Poseidon Known-Answer Test (KAT) Generator
 *
 * Generates test vectors from circomlib's Poseidon implementation.
 * These values MUST match the P25 env.crypto().poseidon_hash() output.
 *
 * Usage: node poseidon_kat.js
 */

const { buildPoseidon } = require("circomlibjs");

async function generateTestVectors() {
    console.log("Poseidon Known-Answer Test (KAT) Generator");
    console.log("============================================\n");

    const poseidon = await buildPoseidon();
    const F = poseidon.F;

    // Test cases with various inputs
    const testCases = [
        // Basic small values
        { name: "zeros", inputs: [0n, 0n] },
        { name: "ones", inputs: [1n, 1n] },
        { name: "small", inputs: [1n, 2n] },
        { name: "sequential", inputs: [123n, 456n] },

        // Larger values
        { name: "medium", inputs: [123456789n, 987654321n] },

        // Edge cases near field size (BN254 scalar field: ~21888242871839275222246405745257275088548364400416034343698204186575808495617)
        {
            name: "large",
            inputs: [
                1000000000000000000000000000n,
                2000000000000000000000000000n
            ]
        },

        // Simulated identity commitment inputs
        {
            name: "identity_commitment",
            inputs: [
                12345678901234567890n,  // secret
                98765432109876543210n   // salt
            ]
        },

        // Zero value constant (used in Merkle tree)
        { name: "zero_value", inputs: [0n] },

        // Tree operations (two inputs for hash_pair)
        {
            name: "tree_hash_pair",
            inputs: [
                0xdeadbeefn,
                0xcafebaben
            ]
        }
    ];

    const results = [];

    for (const tc of testCases) {
        try {
            // Convert inputs to field elements and hash
            const fieldInputs = tc.inputs.map(x => F.e(x));
            const hashResult = poseidon(fieldInputs);
            const hashBigInt = F.toObject(hashResult);

            // Format as hex (padded to 64 chars = 32 bytes)
            const hashHex = "0x" + hashBigInt.toString(16).padStart(64, '0');

            results.push({
                name: tc.name,
                inputs: tc.inputs.map(x => "0x" + x.toString(16)),
                inputs_decimal: tc.inputs.map(x => x.toString()),
                output_decimal: hashBigInt.toString(),
                output_hex: hashHex
            });

            console.log(`Test: ${tc.name}`);
            console.log(`  Inputs: [${tc.inputs.map(x => x.toString()).join(", ")}]`);
            console.log(`  Poseidon Hash: ${hashHex}`);
            console.log(`  Decimal: ${hashBigInt.toString()}`);
            console.log();

        } catch (err) {
            console.error(`Error with test case ${tc.name}:`, err.message);
        }
    }

    // Output as JSON for easy comparison
    console.log("\n=== JSON Test Vectors (for on-chain comparison) ===\n");
    console.log(JSON.stringify(results, null, 2));

    // Output as Rust test code
    console.log("\n=== Rust Test Code (requires P25 testnet) ===\n");
    generateRustTestCode(results);

    // Save to file
    const fs = require("fs");
    const outputPath = __dirname + "/poseidon_test_vectors.json";
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\nTest vectors saved to: ${outputPath}`);
}

function generateRustTestCode(results) {
    console.log(`// Add to contracts/membership-tree/src/lib.rs or integration tests
// Note: This test requires P25 host functions (won't work in unit tests)

#[test]
fn test_poseidon_known_answer_kat() {
    let env = Env::default();
    let field = Symbol::new(&env, "BN254");

    // Test vectors from circomlib Poseidon
    let test_cases = vec![`);

    for (const tc of results) {
        if (tc.inputs.length === 2) {
            console.log(`        // ${tc.name}`);
            console.log(`        (vec![`);
            for (const inp of tc.inputs_decimal) {
                console.log(`            U256::from_be_bytes(&env, &hex_to_bytes("${tc.inputs[tc.inputs_decimal.indexOf(inp)]}")),`);
            }
            console.log(`        ], "${tc.output_hex}"),`);
        }
    }

    console.log(`    ];

    for (inputs, expected_hex) in test_cases {
        let mut input_vec = Vec::new(&env);
        for inp in inputs {
            input_vec.push_back(inp);
        }

        let result = env.crypto().poseidon_hash(&input_vec, field.clone());
        let expected = U256::from_be_bytes(&env, &hex_to_bytes(expected_hex));

        assert_eq!(
            result, expected,
            "Poseidon KAT FAILED! Circuit and P25 implementations are INCOMPATIBLE."
        );
    }
}

fn hex_to_bytes(hex: &str) -> BytesN<32> {
    // Remove 0x prefix
    let hex_str = if hex.starts_with("0x") { &hex[2..] } else { hex };
    let bytes = hex::decode(hex_str).expect("Invalid hex");
    BytesN::from_array(&Env::default(), &bytes.try_into().unwrap())
}`);
}

// Run the generator
generateTestVectors().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
