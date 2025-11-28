/**
 * Test script to verify ZK proofs locally before sending to contract
 * This helps debug proof/VK mismatch issues without hitting the contract
 */

import * as snarkjs from 'snarkjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the verification key (original snarkjs format, not Soroban format)
const vkPath = path.join(__dirname, '../frontend/public/circuits/verification_key.json');
const vk = JSON.parse(fs.readFileSync(vkPath, 'utf8'));

// Sample proof data from a failed anonymous comment attempt
// Replace these with actual values from the relayer logs when debugging
const testData = {
  // These are the public signals in order: [root, nullifier, daoId, proposalId, voteChoice, commitment]
  publicSignals: [
    "10912007527438244775867254754938194121310370739162387502363473270273298123227", // root
    "5322587706750606152189193969400459537515798747030534651406821846555094720534",  // nullifier
    "1", // daoId
    "1", // proposalId
    "0", // voteChoice (false = 0)
    "17255683380825043705403703708003604566805400890853522875863387107315730708245", // commitment
  ],

  // The proof in snarkjs format (convert from hex to arrays)
  // These are from the relayer log - need to be converted from hex strings
  proofHex: {
    a: "0b7fbd05a26e3964730b4c44ee7899688f36c280e746cf07ed5f7322c4bcc895199b9cf9eb43ee7de3346abfda591179e6235aa2281cd9b947fdfa7a31ac115b",
    b: "28e4ec9d884d1b43b2968f1fb1d9435f17f1a77bfb871a437b89612ec9e9fbc00ae207bc742a6fe66619069a109f8876100cddc3ccd772a44892a3ee73289ee41150f7c247773f933c8d2494348c82d6ab3efa1e1cd4dce84b931d6efffc07dc2f77fe1bf2734bbeff6a3af09688e4ae31f4ab4f1abbefe0ca77c14b36846748",
    c: "2de656ba9ee814d71a67866fd5e484cf8bf0c55ac07fe5b71a31616d1883356c1c1767da669ab3243b6a4fbd0387906d14ddd4769e248d5b6d1598422242c1e9"
  }
};

// Convert big-endian hex to BigInt string
function hexBEToBigInt(hex) {
  if (hex.startsWith('0x')) hex = hex.slice(2);
  return BigInt('0x' + hex).toString();
}

// Convert the Soroban-formatted proof back to snarkjs format
function sorobanProofToSnarkjs(proofHex) {
  const a = proofHex.a;
  const b = proofHex.b;
  const c = proofHex.c;

  // G1: be_bytes(X) || be_bytes(Y)
  const pi_a = [
    hexBEToBigInt(a.slice(0, 64)),
    hexBEToBigInt(a.slice(64, 128)),
    "1" // Projective coordinate
  ];

  // G2: be_bytes(X_c1) || be_bytes(X_c0) || be_bytes(Y_c1) || be_bytes(Y_c0)
  // snarkjs format: [[X.c0, X.c1], [Y.c0, Y.c1]]
  // Soroban format: [X.c1, X.c0, Y.c1, Y.c0]
  // So we need to swap back: [c1, c0] -> [c0, c1]
  const pi_b = [
    [
      hexBEToBigInt(b.slice(64, 128)),  // X.c0
      hexBEToBigInt(b.slice(0, 64))     // X.c1
    ],
    [
      hexBEToBigInt(b.slice(192, 256)), // Y.c0
      hexBEToBigInt(b.slice(128, 192))  // Y.c1
    ],
    ["1", "0"] // Projective coordinate
  ];

  // G1: be_bytes(X) || be_bytes(Y)
  const pi_c = [
    hexBEToBigInt(c.slice(0, 64)),
    hexBEToBigInt(c.slice(64, 128)),
    "1" // Projective coordinate
  ];

  return {
    pi_a,
    pi_b,
    pi_c,
    protocol: "groth16",
    curve: "bn128"
  };
}

async function main() {
  console.log('=== Local ZK Proof Verification Test ===\n');

  console.log('Verification Key:');
  console.log('  Protocol:', vk.protocol);
  console.log('  Curve:', vk.curve);
  console.log('  nPublic:', vk.nPublic);
  console.log('  IC length:', vk.IC?.length || vk.vk_ic?.length);
  console.log();

  // Convert proof from Soroban hex format back to snarkjs format
  const proof = sorobanProofToSnarkjs(testData.proofHex);

  console.log('Proof (snarkjs format):');
  console.log('  pi_a:', proof.pi_a);
  console.log('  pi_b:', proof.pi_b);
  console.log('  pi_c:', proof.pi_c);
  console.log();

  console.log('Public Signals:');
  testData.publicSignals.forEach((sig, i) => {
    const labels = ['root', 'nullifier', 'daoId', 'proposalId', 'voteChoice', 'commitment'];
    console.log(`  [${i}] ${labels[i] || 'unknown'}: ${sig}`);
  });
  console.log();

  // Verify the proof using snarkjs
  console.log('Verifying proof with snarkjs.groth16.verify()...\n');

  try {
    const valid = await snarkjs.groth16.verify(vk, testData.publicSignals, proof);

    if (valid) {
      console.log('✅ PROOF IS VALID!');
      console.log('The proof passes snarkjs verification.');
      console.log('If the contract is still failing, the issue is in:');
      console.log('  1. VK format conversion (snarkjs -> Soroban)');
      console.log('  2. Proof format conversion (snarkjs -> Soroban)');
      console.log('  3. Public signal encoding differences');
    } else {
      console.log('❌ PROOF IS INVALID!');
      console.log('The proof does not pass snarkjs verification.');
      console.log('This means the proof itself is incorrect, not the contract.');
      console.log('Check:');
      console.log('  1. Circuit inputs match the public signals');
      console.log('  2. Merkle path is correct');
      console.log('  3. Nullifier/commitment calculations');
    }
  } catch (err) {
    console.error('❌ Verification threw an error:', err.message);
    console.log('\nThis usually means:');
    console.log('  1. VK format is wrong');
    console.log('  2. Proof format is wrong');
    console.log('  3. Public signals array length mismatch');
  }
}

main().catch(console.error);
