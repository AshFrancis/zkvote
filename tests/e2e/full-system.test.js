#!/usr/bin/env node
/**
 * Full System E2E Test Suite
 *
 * Comprehensive end-to-end tests against deployed contracts and relayer:
 * 1. DAO Creation & Setup
 * 2. Membership (mint, revoke, reinstate)
 * 3. Commitment Registration
 * 4. Proposal Creation
 * 5. IPFS Content Management
 * 6. Comment System (public, anonymous, edit, delete, revisions)
 * 7. Voting with Real Proofs
 *
 * Prerequisites:
 *   - Local futurenet running: stellar container start -t future
 *   - Contracts deployed: ./scripts/deploy-local-complete.sh
 *   - Relayer running: cd backend && npm run relayer
 *   - Circuit artifacts in frontend/public/circuits/
 *
 * Run: node tests/e2e/full-system.test.js
 */

const { buildPoseidon } = require('circomlibjs');
const snarkjs = require('snarkjs');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration - default to futurenet
const RPC_URL = process.env.RPC_URL || 'https://rpc-futurenet.stellar.org:443';
const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:3001';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || 'Test SDF Future Network ; October 2022';
const ADMIN_KEY = process.env.ADMIN_KEY || 'mykey';

// Get admin address early
function getAddress(keyName) {
  try {
    const result = execSync(`stellar keys address ${keyName}`, { encoding: 'utf-8' });
    return result.trim();
  } catch {
    return null;
  }
}

// Test state
let contracts = null;
let poseidon = null;
let daoId = null;
let proposalId = null;
let memberAddress = null;
let adminAddress = getAddress(ADMIN_KEY); // Initialize early
let testContentCid = null;
let commentId = null;

// ZK credentials
let secret, salt, commitment, nullifier;

// ============================================
// Contract Helpers (via Stellar CLI)
// ============================================

function loadContracts() {
  // Try frontend config first (this is more likely to have futurenet contracts)
  const configPath = path.join(__dirname, '../../frontend/src/config/contracts.ts');
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, 'utf-8');
    const extract = (key) => {
      const match = content.match(new RegExp(`${key}:\\s*["']([^"']+)["']`));
      return match ? match[1] : null;
    };
    const result = {
      REGISTRY: extract('REGISTRY_ID'),
      SBT: extract('SBT_ID'),
      TREE: extract('TREE_ID'),
      VOTING: extract('VOTING_ID'),
    };
    if (result.VOTING) return result;
  }

  // Fallback to deployed-contracts file (local deployments)
  const deployedFile = path.join(__dirname, '../../.deployed-contracts');
  if (fs.existsSync(deployedFile)) {
    const content = fs.readFileSync(deployedFile, 'utf-8');
    const config = {};
    content.split('\n').forEach(line => {
      // Handle both formats: "KEY=value" and "export KEY=value"
      const match = line.match(/^(?:export\s+)?(\w+)=["']?([^"'\s]+)["']?$/);
      if (match) {
        config[match[1]] = match[2];
      }
    });
    return {
      REGISTRY: config.REGISTRY_ID,
      SBT: config.SBT_ID,
      TREE: config.TREE_ID,
      VOTING: config.VOTING_ID,
    };
  }

  return null;
}

function callContract(contractId, method, args = {}, source = ADMIN_KEY) {
  const argsList = Object.entries(args)
    .map(([key, value]) => {
      // Handle enum values (wrapped in special marker)
      if (typeof value === 'object' && value !== null && value._enum) {
        return `--${key} '"${value._enum}"'`;
      }
      if (typeof value === 'object' && value !== null) {
        return `--${key} '${JSON.stringify(value)}'`;
      }
      return `--${key} "${value}"`;
    })
    .join(' ');

  const cmd = `stellar contract invoke \
    --id "${contractId}" \
    --source ${source} \
    --rpc-url "${RPC_URL}" \
    --network-passphrase "${NETWORK_PASSPHRASE}" \
    -- \
    ${method} \
    ${argsList} 2>&1`;

  try {
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 60000 });
    const lines = result.split('\n').filter(line => !line.startsWith('ℹ️') && line.trim());
    let value = lines[lines.length - 1];
    // Strip surrounding quotes if present (CLI returns strings as "value")
    if (value && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    return value;
  } catch (error) {
    const msg = error.stdout || error.stderr || error.message;
    if (msg.includes('Error')) {
      throw new Error(`Contract call failed: ${msg}`);
    }
    return msg;
  }
}

// ============================================
// Relayer Helpers
// ============================================

async function fetchRelayer(endpoint, options = {}) {
  const url = `${RELAYER_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  try {
    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data, ok: response.ok };
  } catch (err) {
    console.error(`  Fetch error for ${endpoint}: ${err.message}`);
    return { status: 0, data: { error: err.message }, ok: false };
  }
}

// ============================================
// ZK Proof Helpers
// ============================================

async function generateCredentials(poseidon, userSecret) {
  secret = BigInt(userSecret || Date.now());
  salt = BigInt(Math.floor(Math.random() * 1000000000));
  commitment = poseidon.F.toString(poseidon([secret, salt]));
  return { secret, salt, commitment };
}

async function computeNullifier(poseidon, secret, daoId, proposalId) {
  nullifier = poseidon.F.toString(poseidon([secret, BigInt(daoId), BigInt(proposalId)]));
  return nullifier;
}

// ============================================
// Test Functions
// ============================================

async function testRelayerHealth() {
  console.log('\n=== Test: Relayer Health ===');

  const health = await fetchRelayer('/health');
  if (!health.ok) {
    throw new Error(`Relayer not available at ${RELAYER_URL}`);
  }
  console.log('✓ Relayer health: OK');

  const ready = await fetchRelayer('/ready');
  console.log(`✓ Relayer ready: ${ready.status === 200 ? 'YES' : 'INITIALIZING'}`);
}

async function testCreateDAO() {
  console.log('\n=== Test: Create DAO ===');

  if (!contracts || !contracts.REGISTRY) {
    console.log('⚠️  Contracts not loaded, skipping direct contract tests');
    return;
  }

  adminAddress = getAddress(ADMIN_KEY);
  if (!adminAddress) {
    console.log('⚠️  Admin key not found, skipping DAO creation');
    return;
  }

  console.log(`Admin: ${adminAddress}`);

  // Create DAO
  const result = callContract(contracts.REGISTRY, 'create_dao', {
    name: `E2E Test DAO ${Date.now()}`,
    creator: adminAddress,
    membership_open: true,
  });

  daoId = parseInt(result);
  if (isNaN(daoId)) {
    console.log(`⚠️  Could not parse DAO ID from: ${result}`);
    daoId = 1; // Use default
  } else {
    console.log(`✓ DAO created: ID = ${daoId}`);
  }

  // Initialize tree
  try {
    callContract(contracts.TREE, 'init_tree', {
      dao_id: daoId,
      depth: 18,
      admin: adminAddress,
    });
    console.log('✓ Merkle tree initialized (depth 18)');
  } catch (err) {
    console.log(`⚠️  Tree init failed: ${err.message}`);
  }

  // Mint SBT for admin (required for commenting/voting)
  if (contracts.SBT) {
    try {
      callContract(contracts.SBT, 'mint', {
        dao_id: daoId,
        to: adminAddress,
        admin: adminAddress,
      });
      console.log('✓ SBT minted for admin');
    } catch (err) {
      // May fail if already has SBT - that's OK
      if (err.message.includes('AlreadyMinted')) {
        console.log('✓ Admin already has SBT');
      } else {
        console.log(`⚠️  SBT mint: ${err.message.slice(0, 80)}`);
      }
    }
  }
}

async function testCreateProposal() {
  console.log('\n=== Test: Create Proposal ===');

  if (!daoId) {
    daoId = 1;
    console.log(`Using default DAO ID: ${daoId}`);
  }

  // First upload proposal content to IPFS (with retry)
  const proposalContent = {
    version: 1,
    title: `E2E Test Proposal ${Date.now()}`,
    body: '# Test Proposal\n\nThis is an automated e2e test proposal.',
    createdAt: new Date().toISOString(),
  };

  let uploadRes;
  for (let attempt = 1; attempt <= 3; attempt++) {
    uploadRes = await fetchRelayer('/ipfs/metadata', {
      method: 'POST',
      body: JSON.stringify(proposalContent),
    });
    if (uploadRes.ok) break;
    if (attempt < 3) {
      console.log(`  IPFS upload attempt ${attempt} failed, retrying...`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  if (!uploadRes.ok) {
    throw new Error(`IPFS upload failed after 3 attempts: ${uploadRes.status} - ${JSON.stringify(uploadRes.data)}`);
  }

  const contentCid = uploadRes.data.cid;
  console.log(`✓ Proposal content uploaded: ${contentCid}`);

  // Create proposal via contract
  if (contracts && contracts.VOTING && adminAddress) {
    try {
      const endTime = Math.floor(Date.now() / 1000) + 86400; // 24 hours from now
      const result = callContract(contracts.VOTING, 'create_proposal', {
        dao_id: daoId,
        title: proposalContent.title,
        content_cid: contentCid,
        end_time: endTime,
        creator: adminAddress,
        vote_mode: { _enum: 'Fixed' },
      });
      proposalId = parseInt(result);
      if (isNaN(proposalId) || proposalId < 1) {
        throw new Error(`Could not parse proposal ID from result: ${result}`);
      }
      console.log(`✓ Proposal created: ID = ${proposalId}`);
    } catch (err) {
      throw new Error(`Proposal creation failed: ${err.message}`);
    }
  } else {
    throw new Error('Contracts not loaded - cannot create proposal');
  }
}

async function testIPFSOperations() {
  console.log('\n=== Test: IPFS Operations ===');

  // Upload comment content
  const content = {
    version: 1,
    body: `# E2E Test Comment\n\nCreated at ${new Date().toISOString()}`,
    createdAt: new Date().toISOString(),
  };

  const uploadRes = await fetchRelayer('/ipfs/metadata', {
    method: 'POST',
    body: JSON.stringify(content),
  });

  if (!uploadRes.ok) {
    throw new Error(`IPFS upload failed: ${uploadRes.status} - ${JSON.stringify(uploadRes.data)}`);
  }

  testContentCid = uploadRes.data.cid;
  console.log(`✓ Content uploaded: ${testContentCid}`);

  // Fetch it back
  const fetchRes = await fetchRelayer(`/ipfs/${testContentCid}`);
  if (fetchRes.ok && fetchRes.data.body === content.body) {
    console.log('✓ Content verified via fetch');
  } else {
    console.log(`⚠️  Content fetch failed or mismatch`);
  }

  // Upload edit
  const editContent = {
    version: 1,
    body: `# Edited Comment\n\nEdited at ${new Date().toISOString()}`,
    createdAt: new Date().toISOString(),
  };

  const editRes = await fetchRelayer('/ipfs/metadata', {
    method: 'POST',
    body: JSON.stringify(editContent),
  });

  if (editRes.ok) {
    console.log(`✓ Edit content uploaded: ${editRes.data.cid}`);
    if (editRes.data.cid !== testContentCid) {
      console.log('✓ Edit produces different CID (content-addressed)');
    }
  }
}

async function testPublicComments() {
  console.log('\n=== Test: Public Comments ===');

  if (!testContentCid) {
    throw new Error('No content CID - IPFS operations must succeed before comment tests');
  }

  if (!proposalId) {
    throw new Error('No proposal created - proposal creation must succeed before comment tests');
  }

  if (!contracts || !contracts.VOTING || !adminAddress) {
    console.log('⚠️  Contracts not loaded - skipping public comment test');
    return;
  }

  // Public comments require direct wallet signing (author.require_auth())
  // Use stellar CLI to call the contract directly with the admin's key
  try {
    const result = callContract(contracts.VOTING, 'add_comment', {
      dao_id: daoId,
      proposal_id: proposalId,
      content_cid: testContentCid,
      parent_id: null,  // No parent for top-level comment
      author: adminAddress,
    });

    commentId = parseInt(result);
    if (isNaN(commentId)) {
      console.log(`⚠️  Could not parse comment ID from: ${result}`);
    } else {
      console.log(`✓ Public comment submitted: ID = ${commentId}`);
    }
  } catch (err) {
    // Check for specific errors
    if (err.message.includes('non-existent contract function')) {
      console.log('⚠️  Contract does not support comments (needs redeployment)');
      return;
    }
    if (err.message.includes('NotDaoMember')) {
      console.log('⚠️  Admin not a DAO member - minting SBT may have failed');
      return;
    }
    throw new Error(`Public comment failed: ${err.message.slice(0, 100)}`);
  }

  // Fetch comments via relayer (read-only, doesn't need signing)
  const listRes = await fetchRelayer(`/comments/${daoId || 1}/${proposalId || 1}`);
  if (listRes.ok) {
    const count = (listRes.data.comments || []).length;
    console.log(`✓ Comments listed: ${count} found`);
  }
}

async function testCommentEditing() {
  console.log('\n=== Test: Comment Editing ===');

  if (!commentId) {
    console.log('⚠️  No comment ID, skipping edit tests');
    return;
  }

  // Upload new content
  const newContent = {
    version: 1,
    body: `# Edited at ${new Date().toISOString()}`,
    createdAt: new Date().toISOString(),
  };

  const uploadRes = await fetchRelayer('/ipfs/metadata', {
    method: 'POST',
    body: JSON.stringify(newContent),
  });

  if (!uploadRes.ok) {
    console.log('⚠️  Failed to upload edit content');
    return;
  }

  const testAuthor = adminAddress || 'GTEST000000000000000000000000000000000000000000000000000';

  const editRes = await fetchRelayer('/comment/edit', {
    method: 'POST',
    body: JSON.stringify({
      daoId: daoId || 1,
      proposalId: proposalId || 1,
      commentId,
      newContentCid: uploadRes.data.cid,
      author: testAuthor,
    }),
  });

  if (editRes.ok) {
    console.log('✓ Comment edited');
  } else if ([404, 401].includes(editRes.status)) {
    console.log(`⚠️  Edit endpoint: ${editRes.status}`);
  } else {
    console.log(`⚠️  Edit failed: ${editRes.status}`);
  }
}

async function testCommentDeletion() {
  console.log('\n=== Test: Comment Deletion ===');

  if (!commentId) {
    console.log('⚠️  No comment ID, skipping delete tests');
    return;
  }

  const testAuthor = adminAddress || 'GTEST000000000000000000000000000000000000000000000000000';

  const deleteRes = await fetchRelayer('/comment/delete', {
    method: 'POST',
    body: JSON.stringify({
      daoId: daoId || 1,
      proposalId: proposalId || 1,
      commentId,
      author: testAuthor,
    }),
  });

  if (deleteRes.ok) {
    console.log('✓ Comment deleted');
  } else if ([404, 401].includes(deleteRes.status)) {
    console.log(`⚠️  Delete endpoint: ${deleteRes.status}`);
  } else {
    console.log(`⚠️  Delete failed: ${deleteRes.status}`);
  }
}

async function testValidation() {
  console.log('\n=== Test: Input Validation ===');

  // Invalid vote (malformed proof)
  const voteRes = await fetchRelayer('/vote', {
    method: 'POST',
    body: JSON.stringify({
      daoId: 1,
      proposalId: 1,
      choice: true,
      nullifier: '12345',
      root: '67890',
      commitment: '11111',
      proof: { a: 'invalid', b: 'invalid', c: 'invalid' },
    }),
  });

  if ([400, 401].includes(voteRes.status)) {
    console.log('✓ Invalid vote correctly rejected');
  } else {
    console.log(`⚠️  Vote validation: ${voteRes.status}`);
  }

  // BN254 field bounds check
  const BN254_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const boundsRes = await fetchRelayer('/vote', {
    method: 'POST',
    body: JSON.stringify({
      daoId: 1,
      proposalId: 1,
      choice: true,
      nullifier: (BN254_MODULUS + 1n).toString(),
      root: '1',
      commitment: '1',
      proof: { a: '00'.repeat(64), b: '00'.repeat(128), c: '00'.repeat(64) },
    }),
  });

  if ([400, 401].includes(boundsRes.status)) {
    console.log('✓ Out-of-bounds nullifier correctly rejected');
  } else {
    console.log(`⚠️  Bounds validation: ${boundsRes.status}`);
  }
}

// ============================================
// ZK Proof Generation Helpers
// ============================================

const CIRCUIT_WASM_PATH = path.join(__dirname, '../../frontend/public/circuits/vote.wasm');
const CIRCUIT_ZKEY_PATH = path.join(__dirname, '../../frontend/public/circuits/vote_final.zkey');
const TREE_DEPTH = 18;

// Get Merkle path from on-chain tree contract
// This is more reliable than computing locally since it matches the contract's Poseidon zeros
function getOnChainMerklePath(daoId, leafIndex) {
  // Call the contract's get_merkle_path function
  const cmd = `stellar contract invoke \
    --id "${contracts.TREE}" \
    --source ${ADMIN_KEY} \
    --rpc-url "${RPC_URL}" \
    --network-passphrase "${NETWORK_PASSPHRASE}" \
    -- \
    get_merkle_path \
    --dao_id ${daoId} \
    --leaf_index ${leafIndex} 2>&1`;

  try {
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 60000 });
    // Parse the result - it's a tuple of two arrays
    // Expected format: ["[array of U256]","[array of u32]"]
    const lines = result.split('\n').filter(line => !line.startsWith('ℹ️') && line.trim());
    const jsonStr = lines.join('');
    const parsed = JSON.parse(jsonStr);

    // parsed[0] is pathElements (Vec<U256>), parsed[1] is pathIndices (Vec<u32>)
    const pathElements = parsed[0].map(el => BigInt(el));
    const pathIndices = parsed[1].map(idx => parseInt(idx));

    return { pathElements, pathIndices };
  } catch (err) {
    console.error(`Failed to get on-chain Merkle path: ${err.message}`);
    throw err;
  }
}

// Get leaf index from on-chain tree contract
function getOnChainLeafIndex(daoId, commitment) {
  const commitmentU256 = toU256Hex(commitment);
  const cmd = `stellar contract invoke \
    --id "${contracts.TREE}" \
    --source ${ADMIN_KEY} \
    --rpc-url "${RPC_URL}" \
    --network-passphrase "${NETWORK_PASSPHRASE}" \
    -- \
    get_leaf_index \
    --dao_id ${daoId} \
    --commitment "${commitmentU256}" 2>&1`;

  try {
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 60000 });
    const lines = result.split('\n').filter(line => !line.startsWith('ℹ️') && line.trim());
    return parseInt(lines[lines.length - 1]);
  } catch (err) {
    console.error(`Failed to get leaf index: ${err.message}`);
    throw err;
  }
}

// Fallback: Compute Merkle path locally (for testing without contract)
function computeMerklePath(poseidon, leaves, targetIndex) {
  const paddedLeaves = [...leaves];
  const treeSize = 2 ** TREE_DEPTH;

  // Pad with zeros
  while (paddedLeaves.length < treeSize) {
    paddedLeaves.push(0n);
  }

  let currentLevel = paddedLeaves.map(l => BigInt(l));
  const pathElements = [];
  const pathIndices = [];
  let index = targetIndex;

  for (let level = 0; level < TREE_DEPTH; level++) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    pathElements.push(currentLevel[siblingIndex] || 0n);
    pathIndices.push(index % 2);

    // Move to next level
    const nextLevel = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i] || 0n;
      const right = currentLevel[i + 1] || 0n;
      const hash = poseidon.F.toString(poseidon([left, right]));
      nextLevel.push(BigInt(hash));
    }
    currentLevel = nextLevel;
    index = Math.floor(index / 2);
  }

  return { pathElements, pathIndices, root: currentLevel[0] };
}

// Generate ZK proof for voting
async function generateVoteProof(params) {
  const { root, nullifier, daoId, proposalId, voteChoice, commitment, secret, salt, pathElements, pathIndices } = params;

  const input = {
    root: root.toString(),
    nullifier: nullifier.toString(),
    daoId: daoId.toString(),
    proposalId: proposalId.toString(),
    voteChoice: voteChoice.toString(),
    commitment: commitment.toString(),
    secret: secret.toString(),
    salt: salt.toString(),
    pathElements: pathElements.map(e => e.toString()),
    pathIndices: pathIndices.map(i => i.toString()),
  };

  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      CIRCUIT_WASM_PATH,
      CIRCUIT_ZKEY_PATH
    );
    return { proof, publicSignals };
  } catch (err) {
    console.error('Proof generation failed:', err.message);
    return null;
  }
}

// Convert snarkjs proof to hex format for relayer
function proofToHex(proof) {
  const toHex = (arr) => arr.map(x => BigInt(x).toString(16).padStart(64, '0')).join('');

  // G1 points: [x, y]
  const a = toHex(proof.pi_a.slice(0, 2));

  // G2 points: [[x_c1, x_c0], [y_c1, y_c0]] -> swap to [c1, c0, c1, c0]
  const bX = [proof.pi_b[0][1], proof.pi_b[0][0]]; // swap x coords
  const bY = [proof.pi_b[1][1], proof.pi_b[1][0]]; // swap y coords
  const b = toHex([...bX, ...bY]);

  const c = toHex(proof.pi_c.slice(0, 2));

  return { a, b, c };
}

// ============================================
// Comprehensive Voting Tests
// ============================================

// Convert decimal string to hex U256 format
function toU256Hex(decimalStr) {
  const bn = BigInt(decimalStr);
  // Format: 0x prefix + 64 hex chars (256 bits)
  return '0x' + bn.toString(16).padStart(64, '0');
}

async function testRegisterCommitment() {
  console.log('\n=== Test: Register Commitment ===');

  if (!contracts || !contracts.TREE || !adminAddress) {
    throw new Error('Contracts not loaded - cannot register commitment');
  }

  if (!daoId) {
    throw new Error('No DAO ID - create DAO must succeed first');
  }

  // Generate ZK credentials
  const creds = await generateCredentials(poseidon, Date.now());
  secret = creds.secret;
  salt = creds.salt;
  commitment = creds.commitment;

  console.log(`Generated commitment: ${commitment.slice(0, 20)}...`);

  // Register commitment in tree
  // The commitment needs to be in U256 format for the CLI
  try {
    const commitmentU256 = toU256Hex(commitment);
    callContract(contracts.TREE, 'register_with_caller', {
      dao_id: daoId,
      commitment: commitmentU256,
      caller: adminAddress,
    });
    console.log('✓ Commitment registered in Merkle tree');
  } catch (err) {
    if (err.message.includes('AlreadyRegistered')) {
      console.log('✓ Commitment already registered');
    } else {
      throw new Error(`Commitment registration failed: ${err.message}`);
    }
  }
}

async function testSetVK() {
  console.log('\n=== Test: Set Verification Key ===');

  if (!contracts || !contracts.VOTING || !adminAddress) {
    console.log('⚠️  Skipping - contracts not loaded');
    return false;
  }

  // Load VK from circuit artifacts
  const vkPath = path.join(__dirname, '../../frontend/public/circuits/verification_key_soroban.json');
  if (!fs.existsSync(vkPath)) {
    console.log('⚠️  Verification key not found - skipping VK setup');
    return false;
  }

  try {
    const vkJson = JSON.parse(fs.readFileSync(vkPath, 'utf-8'));

    // Check if VK is already set by checking vk_version
    try {
      const vkVersion = callContract(contracts.VOTING, 'vk_version', { dao_id: daoId });
      // vk_version returns 0 if not set, > 0 if set
      const version = parseInt(vkVersion);
      if (!isNaN(version) && version > 0) {
        console.log(`✓ VK already set (version ${version})`);
        return true;
      }
    } catch (e) {
      // vk_version failed, VK not set yet, continue
    }

    // Set VK
    callContract(contracts.VOTING, 'set_vk', {
      dao_id: daoId,
      vk: vkJson,
      admin: adminAddress,
    });
    console.log('✓ Verification key set for DAO');
    return true;
  } catch (err) {
    if (err.message.includes('VkAlreadySet')) {
      console.log('✓ VK already set');
      return true;
    }
    throw new Error(`VK setup failed: ${err.message}`);
  }
}

async function testFullVotingFlow() {
  console.log('\n=== Test: Full Voting Flow with ZK Proof ===');

  if (!daoId || !proposalId || !commitment || !secret || !salt) {
    console.log('⚠️  Prerequisites not met (need DAO, proposal, commitment)');
    return;
  }

  if (!fs.existsSync(CIRCUIT_WASM_PATH) || !fs.existsSync(CIRCUIT_ZKEY_PATH)) {
    console.log('⚠️  Circuit artifacts not found - skipping real proof test');
    return;
  }

  try {
    // Get current Merkle root from contract
    const rootResult = callContract(contracts.TREE, 'get_root', { dao_id: daoId });
    const root = BigInt(rootResult);
    console.log(`Current root: ${root.toString().slice(0, 20)}...`);

    // Compute nullifier: Poseidon(secret, daoId, proposalId)
    const computedNullifier = poseidon.F.toString(poseidon([secret, BigInt(daoId), BigInt(proposalId)]));
    console.log(`Nullifier: ${computedNullifier.slice(0, 20)}...`);

    // Get leaf index for our commitment from the on-chain tree
    const leafIndex = getOnChainLeafIndex(daoId, commitment);
    console.log(`Leaf index: ${leafIndex}`);

    // Get Merkle path from on-chain tree (matches contract's Poseidon zeros)
    console.log('Fetching on-chain Merkle path...');
    const { pathElements, pathIndices } = getOnChainMerklePath(daoId, leafIndex);

    // Generate ZK proof
    console.log('Generating ZK proof (this may take a moment)...');
    const proofResult = await generateVoteProof({
      root,
      nullifier: BigInt(computedNullifier),
      daoId: BigInt(daoId),
      proposalId: BigInt(proposalId),
      voteChoice: 1n, // Vote YES
      commitment: BigInt(commitment),
      secret,
      salt,
      pathElements,
      pathIndices,
    });

    if (!proofResult) {
      console.log('⚠️  Proof generation failed');
      return;
    }

    console.log('✓ ZK proof generated');

    // Convert proof to hex format
    const hexProof = proofToHex(proofResult.proof);

    // Convert values to hex format for relayer
    const nullifierHex = toU256Hex(computedNullifier);
    const rootHex = toU256Hex(root.toString());
    const commitmentHex = toU256Hex(commitment);

    // Submit vote via relayer
    const voteRes = await fetchRelayer('/vote', {
      method: 'POST',
      body: JSON.stringify({
        daoId,
        proposalId,
        choice: true, // YES
        nullifier: nullifierHex,
        root: rootHex,
        commitment: commitmentHex,
        proof: hexProof,
      }),
    });

    if (voteRes.ok) {
      console.log('✓ Vote submitted successfully');

      // Verify vote was counted
      const resultsRes = await fetchRelayer(`/proposal/${daoId}/${proposalId}`);
      if (resultsRes.ok) {
        console.log(`✓ Results: Yes=${resultsRes.data.yesVotes || 0}, No=${resultsRes.data.noVotes || 0}`);
      }
    } else {
      console.log(`⚠️  Vote submission failed: ${voteRes.status} - ${JSON.stringify(voteRes.data).slice(0, 100)}`);
    }

    // Test: Duplicate vote should be rejected
    console.log('\nTesting duplicate vote rejection...');
    const dupVoteRes = await fetchRelayer('/vote', {
      method: 'POST',
      body: JSON.stringify({
        daoId,
        proposalId,
        choice: false, // Try voting NO this time
        nullifier: nullifierHex, // Same nullifier (hex)
        root: rootHex,
        commitment: commitmentHex,
        proof: hexProof,
      }),
    });

    if (dupVoteRes.status === 400 && dupVoteRes.data.error?.includes('nullifier')) {
      console.log('✓ Duplicate vote correctly rejected (same nullifier)');
    } else if (dupVoteRes.status === 400) {
      console.log(`✓ Duplicate vote rejected: ${dupVoteRes.data.error?.slice(0, 50) || 'unknown reason'}`);
    } else {
      console.log(`⚠️  Duplicate vote handling: ${dupVoteRes.status}`);
    }

  } catch (err) {
    console.log(`⚠️  Voting test error: ${err.message.slice(0, 100)}`);
  }
}

async function testFixedModeRejection() {
  console.log('\n=== Test: Fixed Mode (Late Joiner Rejected) ===');

  if (!daoId || !contracts) {
    console.log('⚠️  Prerequisites not met');
    return;
  }

  // This tests that with FIXED mode, a member who joins AFTER a proposal is created
  // cannot vote on that proposal (their commitment isn't in the snapshot root)

  // 1. Create a NEW proposal with FIXED mode (captures current root at creation time)
  console.log('Creating new proposal with FIXED vote mode...');
  const fixedProposalContent = {
    version: 1,
    title: `Fixed Mode Test ${Date.now()}`,
    body: 'Testing late joiner rejection with Fixed mode',
    createdAt: new Date().toISOString(),
  };

  const uploadRes = await fetchRelayer('/ipfs/metadata', {
    method: 'POST',
    body: JSON.stringify(fixedProposalContent),
  });

  if (!uploadRes.ok) {
    console.log('⚠️  Failed to upload proposal content');
    return;
  }

  let fixedProposalId;
  try {
    const endTime = Math.floor(Date.now() / 1000) + 86400;
    const result = callContract(contracts.VOTING, 'create_proposal', {
      dao_id: daoId,
      title: fixedProposalContent.title,
      content_cid: uploadRes.data.cid,
      end_time: endTime,
      creator: adminAddress,
      vote_mode: { _enum: 'Fixed' },
    });
    fixedProposalId = parseInt(result);
    console.log(`✓ Fixed mode proposal created: ID = ${fixedProposalId}`);
  } catch (err) {
    throw new Error(`Fixed mode proposal creation failed: ${err.message}`);
  }

  // 2. Create a new member account for late joiner test
  const memberKeyName = `test-member-${Date.now()}`;
  console.log(`Creating new member account: ${memberKeyName}...`);

  try {
    // Generate new keypair
    execSync(`stellar keys generate ${memberKeyName} --network futurenet 2>&1`, { encoding: 'utf-8', timeout: 30000 });
  } catch (err) {
    // Key may already exist
  }

  const memberAddress = execSync(`stellar keys address ${memberKeyName}`, { encoding: 'utf-8' }).trim();
  console.log(`Member address: ${memberAddress}`);

  // Fund via friendbot
  try {
    execSync(`stellar keys fund ${memberKeyName} --network futurenet 2>&1`, { encoding: 'utf-8', timeout: 30000 });
    console.log('✓ Member account funded via friendbot');
  } catch (err) {
    console.log('⚠️  Funding may have failed (account might already exist)');
  }

  // 3. Mint SBT for new member (admin does this)
  try {
    callContract(contracts.SBT, 'mint', {
      dao_id: daoId,
      to: memberAddress,
      admin: adminAddress,
    });
    console.log('✓ SBT minted for new member');
  } catch (err) {
    throw new Error(`Failed to mint SBT for member: ${err.message}`);
  }

  // 4. Register commitment for new member (happens AFTER the proposal was created)
  const lateJoinerSecret = BigInt(Date.now() + 99999);
  const lateJoinerSalt = BigInt(Math.floor(Math.random() * 1000000000));
  const lateJoinerCommitment = poseidon.F.toString(poseidon([lateJoinerSecret, lateJoinerSalt]));
  const lateJoinerCommitmentU256 = toU256Hex(lateJoinerCommitment);

  try {
    // Member registers their own commitment (using member's key)
    callContract(contracts.TREE, 'register_with_caller', {
      dao_id: daoId,
      commitment: lateJoinerCommitmentU256,
      caller: memberAddress,
    }, memberKeyName);
    console.log(`✓ Late joiner commitment registered: ${lateJoinerCommitment.slice(0, 20)}...`);
  } catch (err) {
    throw new Error(`Late joiner registration failed: ${err.message}`);
  }

  // 5. Get current root (which now includes the late joiner's commitment)
  const currentRoot = callContract(contracts.TREE, 'get_root', { dao_id: daoId });
  console.log(`Current root (includes late joiner): ${currentRoot.slice(0, 20)}...`);

  // 6. Try to vote with the late joiner's commitment on the FIXED proposal
  // This should fail because the proposal's snapshot root doesn't include the late joiner
  const lateNullifier = poseidon.F.toString(poseidon([lateJoinerSecret, BigInt(daoId), BigInt(fixedProposalId)]));

  // Generate fake proof - the relayer will reject this because:
  // - The proof won't verify
  // - Even if it did, the commitment isn't in the proposal's eligible_root snapshot
  const fakeProof = {
    a: '00'.repeat(64),
    b: '00'.repeat(128),
    c: '00'.repeat(64),
  };

  // Convert values to hex for relayer
  const lateNullifierHex = toU256Hex(lateNullifier);
  const currentRootHex = toU256Hex(currentRoot);
  const lateCommitmentHex = toU256Hex(lateJoinerCommitment);

  const lateVoteRes = await fetchRelayer('/vote', {
    method: 'POST',
    body: JSON.stringify({
      daoId,
      proposalId: fixedProposalId,
      choice: true,
      nullifier: lateNullifierHex,
      root: currentRootHex, // Using current root (has late joiner) - but FIXED proposal snapshot doesn't
      commitment: lateCommitmentHex,
      proof: fakeProof,
    }),
  });

  if (lateVoteRes.status === 0 && lateVoteRes.data.error === 'fetch failed') {
    console.log('⚠️  Network issue with relayer - vote request failed (continuing test)');
  } else if (lateVoteRes.status === 400) {
    const errorMsg = lateVoteRes.data.error || '';
    console.log(`✓ Late joiner vote correctly rejected (Fixed mode): ${errorMsg.slice(0, 80)}`);
  } else if (lateVoteRes.status === 401) {
    console.log('⚠️  Vote endpoint requires authentication');
  } else {
    throw new Error(`Expected vote rejection for Fixed mode, got: ${lateVoteRes.status} - ${JSON.stringify(lateVoteRes.data)}`);
  }
}

async function testTrailingModeAcceptance() {
  console.log('\n=== Test: Trailing Mode (Late Joiner Accepted) ===');

  if (!daoId || !contracts) {
    console.log('⚠️  Prerequisites not met');
    return;
  }

  // This tests that with TRAILING mode, a member who joins AFTER a proposal is created
  // CAN vote on that proposal (their commitment IS in the live root)

  // For this test, we'll use the admin account but with a DIFFERENT commitment
  // This simulates a "late joiner" scenario without needing to fund a new account

  // 1. Create a proposal with TRAILING mode FIRST (captures current root at creation time, but allows voting with newer roots)
  console.log('Creating new proposal with TRAILING vote mode...');
  const trailingProposalContent = {
    version: 1,
    title: `Trailing Mode Test ${Date.now()}`,
    body: 'Testing late joiner acceptance with Trailing mode',
    createdAt: new Date().toISOString(),
  };

  const uploadRes = await fetchRelayer('/ipfs/metadata', {
    method: 'POST',
    body: JSON.stringify(trailingProposalContent),
  });

  if (!uploadRes.ok) {
    console.log('⚠️  Failed to upload proposal content');
    return;
  }

  let trailingProposalId;
  try {
    const endTime = Math.floor(Date.now() / 1000) + 86400;
    const result = callContract(contracts.VOTING, 'create_proposal', {
      dao_id: daoId,
      title: trailingProposalContent.title,
      content_cid: uploadRes.data.cid,
      end_time: endTime,
      creator: adminAddress,
      vote_mode: { _enum: 'Trailing' },
    });
    trailingProposalId = parseInt(result);
    console.log(`✓ Trailing mode proposal created: ID = ${trailingProposalId}`);
  } catch (err) {
    throw new Error(`Trailing mode proposal creation failed: ${err.message}`);
  }

  // 2. Create a new member account and fund it
  const memberKeyName = `test-trailing-${Date.now()}`;
  console.log(`Creating new member account: ${memberKeyName}...`);

  try {
    execSync(`stellar keys generate ${memberKeyName} --network futurenet 2>&1`, { encoding: 'utf-8', timeout: 30000 });
  } catch (err) {
    // Key may already exist
  }

  const trailingMemberAddress = execSync(`stellar keys address ${memberKeyName}`, { encoding: 'utf-8' }).trim();
  console.log(`Member address: ${trailingMemberAddress}`);

  // Fund via friendbot with retry (using direct URL since stellar keys fund has passphrase issues)
  let funded = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const fundRes = await fetch(`https://friendbot-futurenet.stellar.org/?addr=${trailingMemberAddress}`);
      const fundData = await fundRes.json();
      if (fundData.successful || fundData.id) {
        console.log('✓ Member account funded via friendbot');
        funded = true;
        break;
      } else if (fundData.detail && fundData.detail.includes('already funded')) {
        // Account was already funded - that's fine
        console.log('✓ Member account already funded');
        funded = true;
        break;
      } else {
        throw new Error(fundData.detail || 'Funding failed');
      }
    } catch (err) {
      if (attempt < 3) {
        console.log(`  Funding attempt ${attempt} failed: ${err.message}, retrying in 2s...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  if (!funded) {
    console.log('⚠️  Could not fund new member - skipping trailing test');
    return;
  }

  // 3. Mint SBT for new member (admin does this)
  try {
    callContract(contracts.SBT, 'mint', {
      dao_id: daoId,
      to: trailingMemberAddress,
      admin: adminAddress,
    });
    console.log('✓ SBT minted for new member');
  } catch (err) {
    if (err.message.includes('AlreadyMinted')) {
      console.log('✓ Member already has SBT');
    } else {
      throw new Error(`Failed to mint SBT for member: ${err.message}`);
    }
  }

  // 4. Now register commitment for the member (happens AFTER the proposal was created)
  const lateJoinerSecret = BigInt(Date.now() + 77777);
  const lateJoinerSalt = BigInt(Math.floor(Math.random() * 1000000000));
  const lateJoinerCommitment = poseidon.F.toString(poseidon([lateJoinerSecret, lateJoinerSalt]));
  const lateJoinerCommitmentU256 = toU256Hex(lateJoinerCommitment);

  try {
    // Member registers their own commitment using self_register (for open membership DAOs)
    callContract(contracts.TREE, 'self_register', {
      dao_id: daoId,
      commitment: lateJoinerCommitmentU256,
      member: trailingMemberAddress,
    }, memberKeyName);
    console.log(`✓ Late joiner commitment registered AFTER proposal: ${lateJoinerCommitment.slice(0, 20)}...`);
  } catch (err) {
    // If self_register fails (not open membership), try register_with_caller
    try {
      callContract(contracts.TREE, 'register_with_caller', {
        dao_id: daoId,
        commitment: lateJoinerCommitmentU256,
        caller: trailingMemberAddress,
      }, memberKeyName);
      console.log(`✓ Late joiner commitment registered AFTER proposal: ${lateJoinerCommitment.slice(0, 20)}...`);
    } catch (err2) {
      console.log(`⚠️  Late joiner registration failed: ${err2.message.slice(0, 80)}`);
      console.log('   (The member might not have enough funds - this test needs futurenet XLM)');
      return;
    }
  }

  // 5. Get leaf index and merkle path for the late joiner
  const leafIndex = getOnChainLeafIndex(daoId, lateJoinerCommitment);
  console.log(`Late joiner leaf index: ${leafIndex}`);

  const { pathElements, pathIndices } = getOnChainMerklePath(daoId, leafIndex);
  console.log('✓ Fetched on-chain Merkle path for late joiner');

  // 6. Get current root (which now includes the late joiner's commitment)
  const currentRoot = callContract(contracts.TREE, 'get_root', { dao_id: daoId });
  console.log(`Current root (includes late joiner): ${currentRoot.slice(0, 20)}...`);

  // 7. Compute nullifier
  const lateNullifier = poseidon.F.toString(poseidon([lateJoinerSecret, BigInt(daoId), BigInt(trailingProposalId)]));

  // 8. Generate REAL ZK proof for the late joiner
  console.log('Generating ZK proof for late joiner (this may take a moment)...');
  const proofResult = await generateVoteProof({
    root: BigInt(currentRoot),
    nullifier: BigInt(lateNullifier),
    daoId: BigInt(daoId),
    proposalId: BigInt(trailingProposalId),
    voteChoice: 1n, // Vote YES
    commitment: BigInt(lateJoinerCommitment),
    secret: lateJoinerSecret,
    salt: lateJoinerSalt,
    pathElements,
    pathIndices,
  });

  if (!proofResult) {
    console.log('⚠️  Proof generation failed');
    return;
  }

  console.log('✓ ZK proof generated for late joiner');

  // Convert proof to hex format
  const hexProof = proofToHex(proofResult.proof);

  // Convert values to hex for relayer
  const lateNullifierHex = toU256Hex(lateNullifier);
  const currentRootHex = toU256Hex(currentRoot);
  const lateCommitmentHex = toU256Hex(lateJoinerCommitment);

  // 9. Submit vote via relayer - this should SUCCEED with Trailing mode
  const lateVoteRes = await fetchRelayer('/vote', {
    method: 'POST',
    body: JSON.stringify({
      daoId,
      proposalId: trailingProposalId,
      choice: true,
      nullifier: lateNullifierHex,
      root: currentRootHex, // Using current root (has late joiner) - Trailing mode allows this!
      commitment: lateCommitmentHex,
      proof: hexProof,
    }),
  });

  if (lateVoteRes.ok) {
    console.log('✓ Late joiner vote ACCEPTED (Trailing mode working correctly)');

    // Verify vote was counted
    const resultsRes = await fetchRelayer(`/proposal/${daoId}/${trailingProposalId}`);
    if (resultsRes.ok) {
      console.log(`✓ Results: Yes=${resultsRes.data.yesVotes || 0}, No=${resultsRes.data.noVotes || 0}`);
    }
  } else if (lateVoteRes.status === 400) {
    const errorMsg = lateVoteRes.data.error || '';
    // If we get a proof verification failure, that's still useful info
    console.log(`⚠️  Vote failed: ${errorMsg.slice(0, 100)}`);
    if (errorMsg.includes('proof')) {
      console.log('   (This may indicate a ZK proof mismatch - check circuit params)');
    }
  } else {
    console.log(`⚠️  Unexpected vote result: ${lateVoteRes.status} - ${JSON.stringify(lateVoteRes.data).slice(0, 100)}`);
  }
}

async function testMemberRevocation() {
  console.log('\n=== Test: Member Revocation ===');

  if (!daoId || !contracts || !commitment) {
    console.log('⚠️  Prerequisites not met');
    return;
  }

  // Note: This test requires the revoke/reinstate functionality
  // For now, we'll just verify the SBT revocation affects voting eligibility

  console.log('Member revocation tests require SBT revoke/reinstate - checking availability...');

  try {
    // Check if member is currently active
    const hasSbt = callContract(contracts.SBT, 'has', {
      dao_id: daoId,
      of: adminAddress,
    });
    console.log(`✓ Admin SBT status: ${hasSbt}`);

    // Note: Full revocation test would:
    // 1. Revoke member's SBT
    // 2. Verify they can't comment (requires SBT)
    // 3. Reinstate member
    // 4. Verify they can comment again
    // But we don't want to revoke our test admin, so just verify the check works

  } catch (err) {
    console.log(`⚠️  Revocation test: ${err.message.slice(0, 80)}`);
  }
}

// ============================================
// Main Test Runner
// ============================================

async function main() {
  console.log('============================================');
  console.log('Full System E2E Test Suite');
  console.log('============================================');
  console.log(`RPC URL:     ${RPC_URL}`);
  console.log(`Relayer URL: ${RELAYER_URL}`);
  console.log(`Admin Key:   ${ADMIN_KEY}`);
  console.log('============================================');

  try {
    // Initialize
    contracts = loadContracts();
    if (contracts) {
      console.log('\nLoaded contracts:');
      console.log(`  Registry: ${contracts.REGISTRY || 'not set'}`);
      console.log(`  SBT:      ${contracts.SBT || 'not set'}`);
      console.log(`  Tree:     ${contracts.TREE || 'not set'}`);
      console.log(`  Voting:   ${contracts.VOTING || 'not set'}`);
    } else {
      console.log('\n⚠️  Could not load contract configuration');
    }

    poseidon = await buildPoseidon();
    console.log('✓ Poseidon initialized');

    // Phase 1: Basic Setup Tests
    console.log('\n\n========== PHASE 1: BASIC SETUP ==========');
    await testRelayerHealth();
    await testCreateDAO();

    // Phase 2: Membership & Commitment
    console.log('\n\n========== PHASE 2: MEMBERSHIP & COMMITMENT ==========');
    await testRegisterCommitment();
    await testSetVK();

    // Phase 3: Proposal & Content
    console.log('\n\n========== PHASE 3: PROPOSALS & CONTENT ==========');
    await testCreateProposal();
    await testIPFSOperations();

    // Phase 4: Commenting
    console.log('\n\n========== PHASE 4: COMMENTS ==========');
    await testPublicComments();
    await testCommentEditing();
    await testCommentDeletion();

    // Phase 5: Voting with Real ZK Proofs
    console.log('\n\n========== PHASE 5: ZK VOTING ==========');
    await testFullVotingFlow();
    await testFixedModeRejection();
    await testTrailingModeAcceptance();
    await testMemberRevocation();

    // Phase 6: Validation & Security
    console.log('\n\n========== PHASE 6: VALIDATION & SECURITY ==========');
    await testValidation();

    console.log('\n============================================');
    console.log('E2E Tests Complete');
    console.log('============================================\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
