/**
 * ZK Proof utilities for e2e tests
 */

import fs from 'node:fs';
import path from 'node:path';
import { getCircuitsPath } from '../config.js';

// These will be lazily loaded
let poseidon = null;
let snarkjs = null;

/**
 * Initialize Poseidon hasher
 */
export async function initPoseidon() {
  if (!poseidon) {
    const circomlibjs = await import('circomlibjs');
    poseidon = await circomlibjs.buildPoseidon();
  }
  return poseidon;
}

/**
 * Initialize snarkjs
 */
export async function initSnarkjs() {
  if (!snarkjs) {
    snarkjs = await import('snarkjs');
  }
  return snarkjs;
}

/**
 * Generate random field element (< BN254 scalar field)
 */
export function randomFieldElement() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // Ensure it's less than the field modulus by zeroing top bits
  bytes[0] &= 0x1f;
  return BigInt('0x' + Buffer.from(bytes).toString('hex'));
}

/**
 * Compute Poseidon hash
 */
export async function poseidonHash(inputs) {
  const p = await initPoseidon();
  const hash = p(inputs.map(x => BigInt(x)));
  return p.F.toString(hash);
}

/**
 * Compute commitment = Poseidon(secret, salt)
 */
export async function computeCommitment(secret, salt) {
  return poseidonHash([secret, salt]);
}

/**
 * Compute nullifier = Poseidon(secret, daoId, proposalId)
 */
export async function computeNullifier(secret, daoId, proposalId) {
  return poseidonHash([secret, daoId, proposalId]);
}

/**
 * Generate ZK credentials for voting
 */
export async function generateCredentials() {
  const secret = randomFieldElement();
  const salt = randomFieldElement();
  const commitment = await computeCommitment(secret, salt);

  return { secret, salt, commitment };
}

/**
 * Build Merkle proof for a commitment
 * @param leafIndex - Index of the leaf in the tree
 * @param siblings - Array of sibling hashes (from contract)
 * @returns {pathElements, pathIndices}
 */
export function buildMerkleProof(leafIndex, siblings) {
  const pathIndices = [];
  let idx = leafIndex;

  for (let i = 0; i < siblings.length; i++) {
    pathIndices.push(idx & 1);
    idx = idx >> 1;
  }

  return {
    pathElements: siblings,
    pathIndices,
  };
}

/**
 * Generate Groth16 proof for voting
 */
export async function generateVoteProof({
  secret,
  salt,
  commitment,
  root,
  nullifier,
  daoId,
  proposalId,
  voteChoice,
  pathElements,
  pathIndices,
}) {
  const snarky = await initSnarkjs();
  const circuitsPath = getCircuitsPath();

  const wasmPath = path.join(circuitsPath, 'vote.wasm');
  const zkeyPath = path.join(circuitsPath, 'vote_final.zkey');

  if (!fs.existsSync(wasmPath)) {
    throw new Error(`Circuit WASM not found: ${wasmPath}`);
  }
  if (!fs.existsSync(zkeyPath)) {
    throw new Error(`Circuit zkey not found: ${zkeyPath}`);
  }

  const input = {
    secret: secret.toString(),
    salt: salt.toString(),
    pathElements: pathElements.map(x => x.toString()),
    pathIndices: pathIndices.map(x => x.toString()),
    daoId: daoId.toString(),
    proposalId: proposalId.toString(),
    voteChoice: voteChoice ? '1' : '0',
  };

  console.log('  Generating Groth16 proof...');
  const { proof, publicSignals } = await snarky.groth16.fullProve(input, wasmPath, zkeyPath);
  console.log('  Proof generated');

  // Verify locally
  const vkeyPath = path.join(circuitsPath, 'verification_key.json');
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf-8'));
  const valid = await snarky.groth16.verify(vkey, publicSignals, proof);

  if (!valid) {
    throw new Error('Generated proof failed local verification');
  }

  return { proof, publicSignals };
}

/**
 * Convert snarkjs proof to Soroban format
 */
export function proofToSoroban(proof) {
  // Helper to convert field element to big-endian hex
  const toHexBE = (value) => {
    const bigInt = BigInt(value);
    return bigInt.toString(16).padStart(64, '0');
  };

  // G1 point: X || Y (64 bytes each as BE)
  const encodeG1 = (point) => {
    return toHexBE(point[0]) + toHexBE(point[1]);
  };

  // G2 point: X_c1 || X_c0 || Y_c1 || Y_c0 (swap within pairs)
  const encodeG2 = (point) => {
    return toHexBE(point[0][1]) + toHexBE(point[0][0]) +
           toHexBE(point[1][1]) + toHexBE(point[1][0]);
  };

  return {
    a: encodeG1(proof.pi_a),
    b: encodeG2(proof.pi_b),
    c: encodeG1(proof.pi_c),
  };
}

export default {
  initPoseidon,
  initSnarkjs,
  randomFieldElement,
  poseidonHash,
  computeCommitment,
  computeNullifier,
  generateCredentials,
  buildMerkleProof,
  generateVoteProof,
  proofToSoroban,
};
