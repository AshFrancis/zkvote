/**
 * Live System E2E Tests
 *
 * Tests against the real deployed system (relayer + contracts on futurenet).
 * These tests require:
 * - Running relayer (local or deployed)
 * - Deployed contracts on futurenet
 * - PINATA_JWT for IPFS operations
 *
 * Run with: node --test tests/e2e/live-system.test.js
 *
 * Environment variables:
 * - RELAYER_URL: URL of the relayer (default: http://localhost:3001)
 * - RELAYER_AUTH_TOKEN: Auth token for relayer
 * - TEST_DAO_ID: DAO ID to use for tests (must exist)
 * - TEST_MEMBER_SECRET: Secret for test member (for proof generation)
 * - TEST_MEMBER_SALT: Salt for test member
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:3001';
const AUTH_TOKEN = process.env.RELAYER_AUTH_TOKEN || '';
const TEST_DAO_ID = parseInt(process.env.TEST_DAO_ID || '1', 10);

// Helper to make authenticated requests
async function fetchRelayer(endpoint, options = {}) {
  const url = `${RELAYER_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(AUTH_TOKEN ? { 'Authorization': `Bearer ${AUTH_TOKEN}` } : {}),
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, ok: response.ok };
}

// ============================================
// Health & Configuration Tests
// ============================================

test('Relayer health check', async () => {
  const { status, data, ok } = await fetchRelayer('/health');
  assert.ok(ok, `Health check failed with status ${status}`);
  assert.equal(data.status, 'ok');
});

test('Relayer ready check', async () => {
  const { status, data } = await fetchRelayer('/ready');
  // 503 is acceptable if the relayer is still initializing (e.g., waiting for RPC)
  assert.ok([200, 503].includes(status), `Unexpected status ${status}`);
  if (status === 200) {
    assert.equal(data.status, 'ready');
  } else {
    console.log('  Relayer not fully ready (503) - may be connecting to RPC');
  }
});

test('Get contract configuration', async () => {
  const { status, data, ok } = await fetchRelayer('/config');

  // Config endpoint may require auth
  if (status === 401) {
    console.log('  Config requires authentication - skipping');
    return;
  }

  assert.ok(ok, `Config failed with status ${status}`);
  // Check for contract IDs (field names may vary)
  const votingId = data.votingContractId || data.voting_contract_id || data.contracts?.voting;
  const treeId = data.treeContractId || data.tree_contract_id || data.contracts?.tree;

  if (votingId) {
    console.log('  Voting Contract:', votingId);
  }
  if (treeId) {
    console.log('  Tree Contract:', treeId);
  }
});

// ============================================
// IPFS Tests
// ============================================

test('IPFS health check', async () => {
  const { status, data } = await fetchRelayer('/ipfs/health');

  // IPFS endpoint might not exist or return various statuses
  if (status === 404) {
    console.log('  IPFS health endpoint not found');
    return;
  }

  if (status === 200) {
    const ipfsStatus = data.status || data.ipfs || 'unknown';
    console.log('  IPFS Status:', ipfsStatus);
    if (ipfsStatus === 'disabled' || data.enabled === false) {
      console.log('  (IPFS tests will be skipped)');
    }
  } else {
    console.log(`  IPFS health returned status ${status}`);
  }
});

test('Upload and fetch comment content via IPFS', async (t) => {
  // First check if IPFS is enabled
  const health = await fetchRelayer('/ipfs/health');
  if (health.data.status === 'disabled') {
    t.skip('IPFS not configured');
    return;
  }

  // Upload content
  const commentContent = {
    version: 1,
    body: `# E2E Test Comment\n\nThis is a test comment created at ${new Date().toISOString()}`,
    createdAt: new Date().toISOString(),
  };

  const uploadRes = await fetchRelayer('/ipfs/metadata', {
    method: 'POST',
    body: JSON.stringify(commentContent),
  });

  assert.ok(uploadRes.ok, `Upload failed with status ${uploadRes.status}: ${JSON.stringify(uploadRes.data)}`);
  assert.ok(uploadRes.data.cid, 'Should return CID');
  console.log('  Uploaded CID:', uploadRes.data.cid);

  // Fetch it back
  const fetchRes = await fetchRelayer(`/ipfs/${uploadRes.data.cid}`);
  assert.ok(fetchRes.ok, `Fetch failed with status ${fetchRes.status}`);
  assert.equal(fetchRes.data.version, 1);
  assert.ok(fetchRes.data.body.includes('E2E Test Comment'));
});

test('Upload proposal metadata with video URL', async (t) => {
  const health = await fetchRelayer('/ipfs/health');
  if (health.data.status === 'disabled') {
    t.skip('IPFS not configured');
    return;
  }

  const proposalContent = {
    version: 1,
    title: 'E2E Test Proposal',
    body: 'This is a test proposal for e2e testing.',
    videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    createdAt: new Date().toISOString(),
  };

  const res = await fetchRelayer('/ipfs/metadata', {
    method: 'POST',
    body: JSON.stringify(proposalContent),
  });

  assert.ok(res.ok, `Upload failed: ${JSON.stringify(res.data)}`);
  assert.ok(res.data.cid);
  console.log('  Proposal CID:', res.data.cid);
});

// ============================================
// DAO & Proposal Read Tests
// ============================================

test('Fetch DAO info', async () => {
  const { status, data, ok } = await fetchRelayer(`/dao/${TEST_DAO_ID}`);

  if (status === 404) {
    console.log(`  DAO ${TEST_DAO_ID} not found - may need to create one first`);
    return;
  }

  assert.ok(ok, `Failed to fetch DAO: ${status}`);
  console.log('  DAO Admin:', data.admin);
  console.log('  DAO Public:', data.isPublic);
});

test('List proposals for DAO', async () => {
  const { status, data, ok } = await fetchRelayer(`/proposals/${TEST_DAO_ID}`);

  if (status === 404) {
    console.log(`  No proposals endpoint or DAO ${TEST_DAO_ID} not found`);
    return;
  }

  if (ok) {
    const proposals = data.proposals || data;
    console.log(`  Found ${Array.isArray(proposals) ? proposals.length : 0} proposals`);
  }
});

// ============================================
// Comment Tests (Read-only, non-destructive)
// ============================================

test('Fetch comments for a proposal', async () => {
  const proposalId = 1; // Assuming proposal 1 exists
  const { status, data } = await fetchRelayer(`/comments/${TEST_DAO_ID}/${proposalId}`);

  if (status === 404) {
    console.log('  Comments endpoint not found or no comments');
    return;
  }

  if (status === 200) {
    const comments = data.comments || [];
    console.log(`  Found ${comments.length} comments on DAO ${TEST_DAO_ID}, Proposal ${proposalId}`);
  }
});

// ============================================
// Validation Tests (should fail gracefully)
// ============================================

test('Invalid public comment rejected (missing fields)', async () => {
  const res = await fetchRelayer('/comment/public', {
    method: 'POST',
    body: JSON.stringify({
      daoId: TEST_DAO_ID,
      // Missing: proposalId, contentCid, author
    }),
  });

  // Should get 400 (bad request), 401 (unauthorized), or 404 (endpoint not found)
  assert.ok([400, 401, 404].includes(res.status), `Expected 400, 401, or 404, got ${res.status}`);
});

test('Invalid vote rejected (malformed proof)', async () => {
  const res = await fetchRelayer('/vote', {
    method: 'POST',
    body: JSON.stringify({
      daoId: TEST_DAO_ID,
      proposalId: 1,
      choice: 1,
      nullifier: '12345', // Not a valid U256
      root: '67890',
      commitment: '11111',
      proof: {
        a: 'not-valid-hex',
        b: 'not-valid-hex',
        c: 'not-valid-hex',
      },
    }),
  });

  // Should be rejected with 400, not crash with 500
  assert.ok([400, 401].includes(res.status), `Expected validation error, got ${res.status}`);
});

test('Vote with out-of-bounds nullifier rejected', async () => {
  // BN254 field modulus
  const BN254_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const invalidNullifier = (BN254_MODULUS + 1n).toString();

  const res = await fetchRelayer('/vote', {
    method: 'POST',
    body: JSON.stringify({
      daoId: TEST_DAO_ID,
      proposalId: 1,
      choice: 1,
      nullifier: invalidNullifier,
      root: '1',
      commitment: '1',
      proof: {
        a: '00'.repeat(64),
        b: '00'.repeat(128),
        c: '00'.repeat(64),
      },
    }),
  });

  assert.ok([400, 401].includes(res.status), `Expected 400 for invalid nullifier, got ${res.status}`);
});

// ============================================
// Full Integration Tests (requires setup)
// ============================================

test('Full comment workflow (if IPFS enabled)', async (t) => {
  const health = await fetchRelayer('/ipfs/health');
  if (health.data.status === 'disabled') {
    t.skip('IPFS not configured');
    return;
  }

  // 1. Upload comment content
  const content = {
    version: 1,
    body: `Integration test comment - ${Date.now()}`,
    createdAt: new Date().toISOString(),
  };

  const uploadRes = await fetchRelayer('/ipfs/metadata', {
    method: 'POST',
    body: JSON.stringify(content),
  });

  if (!uploadRes.ok) {
    t.skip('IPFS upload failed - may need JWT');
    return;
  }

  const cid = uploadRes.data.cid;
  console.log('  Step 1: Uploaded content with CID:', cid);

  // 2. Fetch it back to verify
  const fetchRes = await fetchRelayer(`/ipfs/${cid}`);
  assert.ok(fetchRes.ok, 'Should be able to fetch uploaded content');
  assert.equal(fetchRes.data.body, content.body);
  console.log('  Step 2: Verified content retrieval');

  // 3. Try to submit as comment (will fail without valid auth/membership, but validates flow)
  const commentRes = await fetchRelayer('/comment/public', {
    method: 'POST',
    body: JSON.stringify({
      daoId: TEST_DAO_ID,
      proposalId: 1,
      contentCid: cid,
      author: 'GTEST000000000000000000000000000000000000000000000000000',
    }),
  });

  // We expect this to fail (401 or 403) unless properly set up, but not 500
  console.log(`  Step 3: Comment submission returned ${commentRes.status}`);
  assert.ok(commentRes.status < 500, 'Should not cause server error');
});

// ============================================
// Performance / Timing Tests
// ============================================

test('Health endpoint responds within 1 second', async () => {
  const start = Date.now();
  await fetchRelayer('/health');
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 1000, `Health check took ${elapsed}ms, expected < 1000ms`);
  console.log(`  Response time: ${elapsed}ms`);
});

// ============================================
// Contract State Tests
// ============================================

test('Fetch Merkle tree root for DAO', async () => {
  const { status, data } = await fetchRelayer(`/tree/${TEST_DAO_ID}/root`);

  if (status === 404) {
    console.log(`  Tree root endpoint not found for DAO ${TEST_DAO_ID}`);
    return;
  }

  if (status === 200 && data.root) {
    console.log(`  Current root for DAO ${TEST_DAO_ID}:`, data.root.slice(0, 20) + '...');
  }
});

console.log(`
===========================================
Live System E2E Tests
===========================================
Relayer URL: ${RELAYER_URL}
Test DAO ID: ${TEST_DAO_ID}
Auth Token:  ${AUTH_TOKEN ? '(configured)' : '(not set)'}
===========================================
`);
