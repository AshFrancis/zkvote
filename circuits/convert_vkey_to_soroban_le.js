#!/usr/bin/env node
// Convert snarkjs verification key to Soroban format (LITTLE-ENDIAN)
//
// BN254 host functions in Soroban expect little-endian byte order!

const fs = require('fs');

// Convert bigint to 32-byte hex string (LITTLE-ENDIAN!)
function toLE32ByteHex(n) {
    const hex = n.toString(16).padStart(64, '0');
    // Reverse byte order: big-endian → little-endian
    const bytes = hex.match(/.{2}/g);  // Split into bytes
    return bytes.reverse().join('');    // Reverse and rejoin
}

// Read verification key
const vkeyFile = process.argv[2] || 'build/verification_key.json';
const vkey = JSON.parse(fs.readFileSync(vkeyFile, 'utf8'));

console.log('Converting verification key to Soroban format (LITTLE-ENDIAN)...\n');

// Convert alpha (G1)
const alpha_x = toLE32ByteHex(BigInt(vkey.vk_alpha_1[0]));
const alpha_y = toLE32ByteHex(BigInt(vkey.vk_alpha_1[1]));
const alpha = alpha_x + alpha_y;

// Convert beta (G2)
// Try natural order (NOT reversed) for Fq2 elements
const beta_x1 = toLE32ByteHex(BigInt(vkey.vk_beta_2[0][0]));  // x1 (NOT reversed)
const beta_x2 = toLE32ByteHex(BigInt(vkey.vk_beta_2[0][1]));  // x2
const beta_y1 = toLE32ByteHex(BigInt(vkey.vk_beta_2[1][0]));  // y1
const beta_y2 = toLE32ByteHex(BigInt(vkey.vk_beta_2[1][1]));  // y2
const beta = beta_x1 + beta_x2 + beta_y1 + beta_y2;

// Convert gamma (G2)
const gamma_x1 = toLE32ByteHex(BigInt(vkey.vk_gamma_2[0][0]));
const gamma_x2 = toLE32ByteHex(BigInt(vkey.vk_gamma_2[0][1]));
const gamma_y1 = toLE32ByteHex(BigInt(vkey.vk_gamma_2[1][0]));
const gamma_y2 = toLE32ByteHex(BigInt(vkey.vk_gamma_2[1][1]));
const gamma = gamma_x1 + gamma_x2 + gamma_y1 + gamma_y2;

// Convert delta (G2)
const delta_x1 = toLE32ByteHex(BigInt(vkey.vk_delta_2[0][0]));
const delta_x2 = toLE32ByteHex(BigInt(vkey.vk_delta_2[0][1]));
const delta_y1 = toLE32ByteHex(BigInt(vkey.vk_delta_2[1][0]));
const delta_y2 = toLE32ByteHex(BigInt(vkey.vk_delta_2[1][1]));
const delta = delta_x1 + delta_x2 + delta_y1 + delta_y2;

// Convert IC points (G1 array)
const ic = vkey.IC.map((point) => {
    const x = toLE32ByteHex(BigInt(point[0]));
    const y = toLE32ByteHex(BigInt(point[1]));
    return x + y;
});

console.log('=== Verification Key (Hex, LE) ===');
console.log(`Alpha (G1, 64 bytes): ${alpha}`);
console.log(`Beta  (G2, 128 bytes): ${beta}`);
console.log(`Gamma (G2, 128 bytes): ${gamma}`);
console.log(`Delta (G2, 128 bytes): ${delta}`);
console.log(`IC (${ic.length} G1 points):`);
ic.forEach((point, i) => {
    console.log(`  IC[${i}]: ${point}`);
});
console.log('');

// Build Soroban VK object
const sorobanVK = {
    alpha,
    beta,
    gamma,
    delta,
    ic
};

// Save to file
const outputFile = vkeyFile.replace('.json', '_soroban_le.json');
fs.writeFileSync(outputFile, JSON.stringify(sorobanVK, null, 2));

console.log(`Saved to ${outputFile}\n`);

console.log('=== Rust Code Snippet ===\n');
console.log('// In your Soroban contract:');
console.log('let vk = VerificationKey {');
console.log(`    alpha: BytesN::from_array(&env, &hex::decode("${alpha}").unwrap().try_into().unwrap()),`);
console.log(`    beta: BytesN::from_array(&env, &hex::decode("${beta}").unwrap().try_into().unwrap()),`);
console.log(`    gamma: BytesN::from_array(&env, &hex::decode("${gamma}").unwrap().try_into().unwrap()),`);
console.log(`    delta: BytesN::from_array(&env, &hex::decode("${delta}").unwrap().try_into().unwrap()),`);
console.log('    ic: vec![&env,');
ic.forEach((point, i) => {
    const comma = i < ic.length - 1 ? ',' : '';
    console.log(`        BytesN::from_array(&env, &hex::decode("${point}").unwrap().try_into().unwrap())${comma}`);
});
console.log('    ],');
console.log('};');
console.log('  ');
