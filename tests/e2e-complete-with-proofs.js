#!/usr/bin/env node
/**
 * COMPLETE End-to-End Security Test
 * Tests that removed members cannot vote on snapshot proposals
 * Uses REAL Groth16 proofs - no testutils
 */

const { buildPoseidon } = require('circomlibjs');
const snarkjs = require('snarkjs');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const RPC_URL = process.env.RPC_URL || 'http://localhost:8000/soroban/rpc';
const NETWORK_PASSPHRASE = 'Test SDF Future Network ; October 2022';
const ADMIN_KEY = process.env.ADMIN_KEY || 'mykey';

// Load contract IDs
const loadContracts = () => {
  const configPath = path.join(__dirname, '../frontend/src/config/contracts.ts');
  const content = fs.readFileSync(configPath, 'utf-8');

  const extract = (key) => {
    const match = content.match(new RegExp(`${key}:\\s*"([^"]+)"`));
    if (!match) throw new Error(`Could not find ${key}`);
    return match[1];
  };

  return {
    REGISTRY: extract('REGISTRY_ID'),
    SBT: extract('SBT_ID'),
    TREE: extract('TREE_ID'),
    VOTING: extract('VOTING_ID'),
  };
};

const CONTRACTS = loadContracts();

// Helper: Call contract via Stellar CLI
const callContract = (contractId, method, args = {}, source = ADMIN_KEY) => {
  const argsList = Object.entries(args)
    .map(([key, value]) => {
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
    const result = execSync(cmd, { encoding: 'utf-8' });
    // Filter out info messages, keep only the result
    const lines = result.split('\n').filter(line => !line.startsWith('ℹ️'));
    return lines[lines.length - 2] || lines[lines.length - 1]; // Get last non-empty line
  } catch (error) {
    throw new Error(`Contract call failed: ${error.message}\n${error.stdout || error.stderr}`);
  }
};

// Helper: Get address for a key
const getAddress = (keyName) => {
  const result = execSync(`stellar keys address ${keyName}`, { encoding: 'utf-8' });
  return result.trim();
};

// Test state
let poseidon;
let daoId;
let memberKeyName = 'test-member-e2e';
let memberAddress;
let adminAddress;

let secret1, salt1, commitment1;
let secret2, salt2, commitment2;
let rootA, rootB, rootC;
let proposalId;

async function setup() {
  console.log('\n=== E2E Test: Removed Member Voting Security ===\n');
  console.log('Using contracts:');
  console.log(`  Registry: ${CONTRACTS.REGISTRY}`);
  console.log(`  SBT:      ${CONTRACTS.SBT}`);
  console.log(`  Tree:     ${CONTRACTS.TREE}`);
  console.log(`  Voting:   ${CONTRACTS.VOTING}\n`);

  // Initialize Poseidon
  poseidon = await buildPoseidon();

  // Create test member key
  try {
    execSync(`stellar keys generate ${memberKeyName} --network testnet 2>&1`, { stdio: 'ignore' });
  } catch (e) {
    // Key might already exist
  }

  memberAddress = getAddress(memberKeyName);
  adminAddress = getAddress(ADMIN_KEY);

  console.log(`Admin:  ${adminAddress}`);
  console.log(`Member: ${memberAddress}\n`);

  // Fund member
  try {
    const fundResult = execSync(`stellar keys fund ${memberKeyName} --network local 2>&1`, { encoding: 'utf-8' });
    console.log('✓ Member funded\n');
  } catch (e) {
    console.log('⚠️  Could not fund member (may already be funded)');
    console.log(`   Error: ${e.message}\n`);
  }
}

async function step1_createDAO() {
  console.log('=== STEP 1: Create DAO ===\n');

  const result = callContract(CONTRACTS.REGISTRY, 'create_dao', {
    name: 'Test DAO for E2E Security Test',
    creator: adminAddress,
    membership_open: true,
  });

  daoId = parseInt(result);
  console.log(`✓ DAO created: ID = ${daoId}\n`);

  // Initialize tree
  console.log('Initializing Merkle tree (depth 18)...');
  callContract(CONTRACTS.TREE, 'init_tree', {
    dao_id: daoId,
    depth: 18,
    admin: adminAddress,
  });

  console.log('✓ Tree initialized\n');

  // Set VK (skip if already set for this DAO)
  console.log('⚠️  Skipping VK setup (assume already configured)\n');
}

async function step2_memberJoinsAndRegisters() {
  console.log('=== STEP 2: Member Joins & Registers ===\n');

  // Mint SBT
  console.log('Minting SBT to member...');
  callContract(CONTRACTS.SBT, 'mint_from_registry', {
    dao_id: daoId,
    to: memberAddress,
  });
  console.log('✓ SBT minted\n');

  // Generate credentials
  console.log('Generating ZK credentials...');
  secret1 = 123456789n;
  salt1 = 987654321n;

  const commitmentField = poseidon([secret1, salt1]);
  commitment1 = poseidon.F.toString(commitmentField);

  console.log(`Secret: ${secret1}`);
  console.log(`Salt: ${salt1}`);
  console.log(`Commitment: ${commitment1}\n`);

  // Register
  console.log('Registering commitment...');
  callContract(CONTRACTS.TREE, 'register_with_caller', {
    dao_id: daoId,
    commitment: commitment1,
    caller: memberAddress,
  }, memberKeyName);

  console.log('✓ Commitment registered\n');

  // Get root A
  rootA = callContract(CONTRACTS.TREE, 'current_root', { dao_id: daoId });
  console.log(`Root A (with member): ${rootA}\n`);
}

async function step3_removeMember() {
  console.log('=== STEP 3: Remove Member ===\n');

  callContract(CONTRACTS.TREE, 'remove_member', {
    dao_id: daoId,
    member: memberAddress,
    admin: adminAddress,
  });

  console.log('✓ Member removed\n');

  // Get root B
  rootB = callContract(CONTRACTS.TREE, 'current_root', { dao_id: daoId });
  console.log(`Root B (after removal): ${rootB}\n`);

  if (rootA === rootB) {
    throw new Error('❌ CRITICAL: Root did NOT change after removal!');
  }

  console.log('✓ Root changed (correct)\n');
}

async function step4_createSnapshotProposal() {
  console.log('=== STEP 4: Create Snapshot Proposal ===\n');

  const endTime = Math.floor(Date.now() / 1000) + 86400;

  const result = callContract(CONTRACTS.VOTING, 'create_proposal', {
    dao_id: daoId,
    description: 'Test snapshot proposal - member was removed',
    end_time: endTime,
    creator: adminAddress,
    vote_mode: '{"tag":"Fixed","values":null}',
  });

  proposalId = parseInt(result);
  console.log(`✓ Proposal created: ID = ${proposalId}`);
  console.log(`Snapshot root (eligible_root): ${rootB}\n`);

  // Verify snapshot
  const proposal = JSON.parse(callContract(CONTRACTS.VOTING, 'get_proposal', {
    dao_id: daoId,
    proposal_id: proposalId,
  }));

  console.log(`Proposal eligible_root: ${proposal.eligible_root}`);

  if (proposal.eligible_root !== rootB) {
    throw new Error(`Proposal snapshot mismatch: ${proposal.eligible_root} !== ${rootB}`);
  }

  console.log('✓ Proposal correctly snapshots Root B\n');
}

async function step5_memberReAdded() {
  console.log('=== STEP 5: Re-Add Member ===\n');

  // Mint SBT again
  console.log('Minting SBT to member (again)...');
  callContract(CONTRACTS.SBT, 'mint_from_registry', {
    dao_id: daoId,
    to: memberAddress,
  });
  console.log('✓ SBT re-minted\n');

  // Try to register with new credentials
  console.log('Registering new commitment...');
  secret2 = 111222333n;
  salt2 = 444555666n;

  const commitmentField = poseidon([secret2, salt2]);
  commitment2 = poseidon.F.toString(commitmentField);

  console.log(`New secret: ${secret2}`);
  console.log(`New salt: ${salt2}`);
  console.log(`New commitment: ${commitment2}\n`);

  try {
    callContract(CONTRACTS.TREE, 'register_with_caller', {
      dao_id: daoId,
      commitment: commitment2,
      caller: memberAddress,
    }, memberKeyName);

    console.log('✓ New commitment registered\n');

    rootC = callContract(CONTRACTS.TREE, 'current_root', { dao_id: daoId });
    console.log(`Root C (after re-add): ${rootC}\n`);
  } catch (error) {
    console.log('⚠️  Registration failed:');
    console.log(`   ${error.message}\n`);
    throw error;
  }
}

async function step6_generateProofAndVote() {
  console.log('=== STEP 6: Generate Proof & Attempt Vote ===\n');

  // Get leaf index for old commitment
  const leafIndex = parseInt(callContract(CONTRACTS.TREE, 'get_leaf_index', {
    dao_id: daoId,
    commitment: commitment1,
  }));

  console.log(`Old commitment leaf index: ${leafIndex}\n`);

  // Get Merkle path from CURRENT tree
  const pathResult = JSON.parse(callContract(CONTRACTS.TREE, 'get_merkle_path', {
    dao_id: daoId,
    leaf_index: leafIndex,
  }));

  const pathElements = pathResult[0].map(String);
  const pathIndices = pathResult[1];

  console.log('Path elements retrieved from current tree');
  console.log(`(This path computes to Root C: ${rootC})\n`);

  // Compute nullifier
  const nullifierField = poseidon([secret1, BigInt(daoId), BigInt(proposalId)]);
  const nullifier = poseidon.F.toString(nullifierField);

  console.log(`Nullifier: ${nullifier}\n`);

  // Prepare circuit input
  // CRITICAL: We're using Root B (snapshot) but path from current tree
  const input = {
    root: rootB.toString(),
    nullifier: nullifier.toString(),
    daoId: daoId.toString(),
    proposalId: proposalId.toString(),
    voteChoice: '1',
    secret: secret1.toString(),
    salt: salt1.toString(),
    pathElements,
    pathIndices,
  };

  console.log('Generating Groth16 proof...');
  console.log('This will take 30-60 seconds...\n');

  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      path.join(__dirname, '../frontend/public/circuits/vote.wasm'),
      path.join(__dirname, '../frontend/public/circuits/vote_final.zkey')
    );

    console.log('✓ Proof generated');
    console.log(`Public signals: [${publicSignals.join(', ')}]\n`);

    // Verify locally
    const vkPath = path.join(__dirname, '../frontend/public/circuits/verification_key.json');
    const vk = JSON.parse(fs.readFileSync(vkPath, 'utf-8'));

    const isValid = await snarkjs.groth16.verify(vk, publicSignals, proof);

    console.log(`Local verification: ${isValid ? '✓ VALID' : '❌ INVALID'}\n`);

    if (!isValid) {
      console.log('✓ Proof is locally invalid (expected - path doesn\'t match root)\n');
      console.log('=== TEST PASSED ===');
      console.log('Circuit correctly rejects invalid membership proof\n');
      return true;
    }

    // Format proof for Soroban
    const proofSoroban = formatProof(proof);

    // Attempt to submit vote
    console.log('=== STEP 7: Submit Vote to Contract ===\n');
    console.log('Attempting to vote...\n');

    try {
      // Convert nullifier to hex
      const nullifierHex = BigInt(nullifier).toString(16).padStart(64, '0');
      const rootHex = BigInt(rootB).toString(16).padStart(64, '0');

      callContract(CONTRACTS.VOTING, 'vote', {
        dao_id: daoId,
        proposal_id: proposalId,
        vote_choice: 'true',
        nullifier: nullifierHex,
        root: rootHex,
        proof: `{"a":"${proofSoroban.a}","b":"${proofSoroban.b}","c":"${proofSoroban.c}"}`,
      }, memberKeyName);

      // If we reach here, vote was accepted
      console.log('❌❌❌ CRITICAL SECURITY BUG ❌❌❌');
      console.log('Vote was ACCEPTED but should have been REJECTED!\n');
      console.log('Member was NOT in snapshot root but could vote!\n');

      return false;
    } catch (error) {
      console.log('✓ Vote REJECTED by contract (correct)\n');
      console.log(`Reason: ${error.message.split('\n')[0]}\n`);

      if (error.message.includes('invalid proof')) {
        console.log('✓ Rejected for correct reason: invalid proof\n');
        return true;
      } else {
        console.log('⚠️  Rejected but for unexpected reason\n');
        return false;
      }
    }
  } catch (error) {
    console.log('❌ Proof generation failed:\n');
    console.log(`   ${error.message}\n`);

    if (error.message.includes('Error in template')) {
      console.log('✓ Circuit rejected invalid inputs (expected)\n');
      console.log('=== TEST PASSED ===');
      console.log('Member cannot generate valid proof for snapshot they weren\'t in\n');
      return true;
    }

    throw error;
  }
}

function formatProof(proof) {
  const toHex = (arr) => {
    return arr.map(x => BigInt(x).toString(16).padStart(64, '0')).join('');
  };

  return {
    a: toHex(proof.pi_a.slice(0, 2)),
    b: toHex([proof.pi_b[0][1], proof.pi_b[0][0], proof.pi_b[1][1], proof.pi_b[1][0]]),
    c: toHex(proof.pi_c.slice(0, 2)),
  };
}

// Main
async function main() {
  try {
    await setup();
    await step1_createDAO();
    await step2_memberJoinsAndRegisters();
    await step3_removeMember();
    await step4_createSnapshotProposal();
    await step5_memberReAdded();

    const passed = await step6_generateProofAndVote();

    console.log('\n=== FINAL RESULT ===\n');

    if (passed) {
      console.log('✓✓✓ TEST PASSED ✓✓✓');
      console.log('Removed member CANNOT vote on snapshot proposal\n');
      process.exit(0);
    } else {
      console.log('❌❌❌ TEST FAILED ❌❌❌');
      console.log('CRITICAL SECURITY BUG CONFIRMED\n');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Test failed:');
    console.error(error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
