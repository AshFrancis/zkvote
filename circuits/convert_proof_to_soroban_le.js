#!/usr/bin/env node
// Convert snarkjs Groth16 proof to Soroban format (LITTLE-ENDIAN)
//
// BN254 host functions in Soroban expect little-endian byte order!
// snarkjs outputs big-endian, so we need to reverse bytes.

const fs = require('fs');

// Convert bigint to 32-byte hex string (LITTLE-ENDIAN!)
function toLE32ByteHex(n) {
    const hex = n.toString(16).padStart(64, '0');
    // Reverse byte order: big-endian → little-endian
    const bytes = hex.match(/.{2}/g);  // Split into bytes
    return bytes.reverse().join('');    // Reverse and rejoin
}

// Read proof
const proofFile = process.argv[2] || 'proof_real_test.json';
const publicFile = process.argv[3] || 'public_real_test.json';

const proof = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
const publicSignals = JSON.parse(fs.readFileSync(publicFile, 'utf8'));

// Convert proof points to little-endian hex
// G1 point: [x, y, z] where z should be 1 for affine
// We store only [x, y] in 64 bytes (32 + 32), LITTLE-ENDIAN
const pi_a_x = toLE32ByteHex(BigInt(proof.pi_a[0]));
const pi_a_y = toLE32ByteHex(BigInt(proof.pi_a[1]));

// G2 point: [[x1, x2], [y1, y2], [z1, z2]] where z should be [1, 0] for affine
// We store [x1, x2, y1, y2] in 128 bytes (32*4), LITTLE-ENDIAN
// Try natural order (NOT reversed) for Fq2 elements
const pi_b_x1 = toLE32ByteHex(BigInt(proof.pi_b[0][0])); // x1 (NOT reversed)
const pi_b_x2 = toLE32ByteHex(BigInt(proof.pi_b[0][1])); // x2
const pi_b_y1 = toLE32ByteHex(BigInt(proof.pi_b[1][0])); // y1
const pi_b_y2 = toLE32ByteHex(BigInt(proof.pi_b[1][1])); // y2

const pi_c_x = toLE32ByteHex(BigInt(proof.pi_c[0]));
const pi_c_y = toLE32ByteHex(BigInt(proof.pi_c[1]));

// Build proof object
const sorobanProof = {
    a: pi_a_x + pi_a_y,
    b: pi_b_x1 + pi_b_x2 + pi_b_y1 + pi_b_y2,
    c: pi_c_x + pi_c_y
};

console.log('Converting proof to Soroban format (LITTLE-ENDIAN)...\n');

console.log('=== Proof (Hex, LE) ===');
console.log(`A (G1, 64 bytes): ${sorobanProof.a}`);
console.log(`B (G2, 128 bytes): ${sorobanProof.b}`);
console.log(`C (G1, 64 bytes): ${sorobanProof.c}`);
console.log('');

console.log('=== Public Signals ===');
publicSignals.forEach((sig, i) => {
    const labels = ['Root', 'Nullifier', 'DAO ID', 'Proposal ID', 'Vote Choice'];
    console.log(`[${i}] ${labels[i]}: ${sig}`);
});
console.log('');

// Save to file
const outputFile = proofFile.replace('.json', '_soroban_le.json');
fs.writeFileSync(outputFile, JSON.stringify(sorobanProof, null, 2));

console.log(`Saved to ${outputFile}\n`);

console.log('=== Stellar CLI Vote Command ===\n');
console.log(`stellar contract invoke \\`);
console.log(`  --id <VOTING_CONTRACT_ID> \\`);
console.log(`  --source-account relayer \\`);
console.log(`  -- vote \\`);
console.log(`  --dao_id ${publicSignals[2]} \\`);
console.log(`  --proposal_id ${publicSignals[3]} \\`);
console.log(`  --vote_choice ${publicSignals[4] === '1' ? 'true' : 'false'} \\`);
console.log(`  --nullifier ${publicSignals[1]} \\`);
console.log(`  --root ${publicSignals[0]} \\`);
console.log(`  --proof '${JSON.stringify(sorobanProof)}'`);
console.log('  ');
