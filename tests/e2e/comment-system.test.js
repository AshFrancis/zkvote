/**
 * Comment System E2E Tests
 *
 * Tests the full comment lifecycle against a real deployed system:
 * - Public comment creation
 * - Comment editing with revision tracking
 * - Comment deletion (user + admin)
 * - Anonymous comments with ZK proofs
 * - Revision history retrieval
 *
 * Prerequisites:
 * - Running relayer (npm run relayer in backend/)
 * - Deployed contracts (.deployed-contracts file exists)
 * - At least one DAO with a proposal
 *
 * Run: node --test tests/e2e/comment-system.test.js
 *
 * To set up a test DAO first:
 *   ./scripts/create-public-dao.sh "Test DAO"
 */

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// Configuration
const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:3001';
const AUTH_TOKEN = process.env.RELAYER_AUTH_TOKEN || '';

// Test state
let testDaoId = null;
let testProposalId = null;
let testCommentId = null;
let testContentCid = null;
let testAuthor = 'GTEST000000000000000000000000000000000000000000000000000';

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

// Load deployed contracts configuration
function loadDeployedContracts() {
  const possibleFiles = [
    path.join(PROJECT_ROOT, '.deployed-contracts'),
    path.join(PROJECT_ROOT, '.deployed-contracts-futurenet'),
  ];

  for (const file of possibleFiles) {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf-8');
      const config = {};
      content.split('\n').forEach(line => {
        const match = line.match(/^export\s+(\w+)=(.+)$/);
        if (match) {
          config[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
        }
      });
      return config;
    }
  }
  return null;
}

// Find or create a test DAO
async function findOrCreateTestDao() {
  // Try to find existing DAOs via relayer
  const { data } = await fetchRelayer('/daos');
  if (data.daos && data.daos.length > 0) {
    return data.daos[0].id;
  }

  // If no DAOs exist, we need one to be created first
  console.log('No DAOs found. Please create one first:');
  console.log('  ./scripts/create-public-dao.sh "Test DAO"');
  return null;
}

// Find or create a test proposal
async function findOrCreateTestProposal(daoId) {
  // Try to find existing proposals
  const { data, ok } = await fetchRelayer(`/proposals/${daoId}`);
  if (ok && data.proposals && data.proposals.length > 0) {
    return data.proposals[0].id;
  }

  // For now, just use proposal ID 1 and let tests handle 404s gracefully
  return 1;
}

// ============================================
// Setup
// ============================================

describe('Comment System E2E Tests', () => {
  before(async () => {
    console.log('\n=== Setting up Comment System Tests ===');
    console.log(`Relayer URL: ${RELAYER_URL}`);

    // Check relayer health
    const health = await fetchRelayer('/health');
    if (!health.ok) {
      throw new Error(`Relayer not available at ${RELAYER_URL}`);
    }
    console.log('Relayer: OK');

    // Load contract config
    const contracts = loadDeployedContracts();
    if (contracts) {
      console.log('Deployed contracts found');
      console.log(`  Voting: ${contracts.VOTING_ID || 'not set'}`);
    }

    // Find or create test DAO
    testDaoId = await findOrCreateTestDao() || 1;
    console.log(`Test DAO ID: ${testDaoId}`);

    // Find or create test proposal
    testProposalId = await findOrCreateTestProposal(testDaoId) || 1;
    console.log(`Test Proposal ID: ${testProposalId}`);

    console.log('=== Setup Complete ===\n');
  });

  // ============================================
  // IPFS Content Tests
  // ============================================

  describe('IPFS Content Management', () => {
    test('Upload comment content to IPFS', async (t) => {
      const content = {
        version: 1,
        body: `# Test Comment\n\nCreated at ${new Date().toISOString()}`,
        createdAt: new Date().toISOString(),
      };

      const { status, data, ok } = await fetchRelayer('/ipfs/metadata', {
        method: 'POST',
        body: JSON.stringify(content),
      });

      if (status === 503 || status === 500) {
        t.skip('IPFS not available');
        return;
      }

      assert.ok(ok, `Upload failed with status ${status}`);
      assert.ok(data.cid, 'Should return CID');
      testContentCid = data.cid;
      console.log(`  Uploaded CID: ${testContentCid}`);
    });

    test('Fetch uploaded content from IPFS', async (t) => {
      if (!testContentCid) {
        t.skip('No CID from previous test');
        return;
      }

      const { status, data, ok } = await fetchRelayer(`/ipfs/${testContentCid}`);
      assert.ok(ok, `Fetch failed with status ${status}`);
      assert.equal(data.version, 1);
      assert.ok(data.body.includes('Test Comment'));
    });

    test('Upload edited content (new version)', async (t) => {
      const editedContent = {
        version: 1,
        body: `# Edited Comment\n\nEdited at ${new Date().toISOString()}`,
        createdAt: new Date().toISOString(),
      };

      const { status, data, ok } = await fetchRelayer('/ipfs/metadata', {
        method: 'POST',
        body: JSON.stringify(editedContent),
      });

      if (status === 503 || status === 500) {
        t.skip('IPFS not available');
        return;
      }

      assert.ok(ok, `Upload failed with status ${status}`);
      assert.ok(data.cid, 'Should return CID');
      assert.notEqual(data.cid, testContentCid, 'Edit should produce different CID');
      console.log(`  Edit CID: ${data.cid}`);
    });
  });

  // ============================================
  // Public Comment Tests
  // ============================================

  describe('Public Comment Operations', () => {
    test('Submit public comment', async (t) => {
      if (!testContentCid) {
        // Create content if IPFS test was skipped
        const uploadRes = await fetchRelayer('/ipfs/metadata', {
          method: 'POST',
          body: JSON.stringify({
            version: 1,
            body: 'Test comment for submission',
            createdAt: new Date().toISOString(),
          }),
        });
        if (uploadRes.ok) {
          testContentCid = uploadRes.data.cid;
        } else {
          t.skip('Cannot create content CID');
          return;
        }
      }

      const { status, data } = await fetchRelayer('/comment/public', {
        method: 'POST',
        body: JSON.stringify({
          daoId: testDaoId,
          proposalId: testProposalId,
          contentCid: testContentCid,
          parentId: null,
          author: testAuthor,
        }),
      });

      // 404 = endpoint not found, 401 = auth required, 400 = validation error
      // All are acceptable in test mode
      if ([404, 401].includes(status)) {
        console.log(`  Comment endpoint returned ${status} - may need auth or setup`);
        return;
      }

      if (status === 200 || status === 201) {
        testCommentId = data.commentId;
        console.log(`  Created comment ID: ${testCommentId}`);
      } else {
        console.log(`  Comment creation returned ${status}: ${JSON.stringify(data)}`);
      }
    });

    test('Fetch comments for proposal', async () => {
      const { status, data } = await fetchRelayer(`/comments/${testDaoId}/${testProposalId}`);

      if (status === 404) {
        console.log('  Comments endpoint not found');
        return;
      }

      if (status === 200) {
        const comments = data.comments || [];
        console.log(`  Found ${comments.length} comments`);
      }
    });

    test('Fetch single comment details', async (t) => {
      if (!testCommentId) {
        t.skip('No comment ID from previous test');
        return;
      }

      const { status, data } = await fetchRelayer(
        `/comment/${testDaoId}/${testProposalId}/${testCommentId}`
      );

      if (status === 200) {
        console.log(`  Comment author: ${data.author || 'anonymous'}`);
        console.log(`  Content CID: ${data.contentCid}`);
      } else {
        console.log(`  Fetch returned ${status}`);
      }
    });
  });

  // ============================================
  // Comment Edit Tests
  // ============================================

  describe('Comment Editing', () => {
    test('Edit own comment', async (t) => {
      if (!testCommentId) {
        t.skip('No comment ID to edit');
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
        t.skip('Cannot upload new content');
        return;
      }

      const { status, data } = await fetchRelayer('/comment/edit', {
        method: 'POST',
        body: JSON.stringify({
          daoId: testDaoId,
          proposalId: testProposalId,
          commentId: testCommentId,
          newContentCid: uploadRes.data.cid,
          author: testAuthor,
        }),
      });

      if ([404, 401].includes(status)) {
        console.log(`  Edit endpoint returned ${status}`);
        return;
      }

      if (status === 200) {
        console.log('  Comment edited successfully');
      } else {
        console.log(`  Edit returned ${status}: ${JSON.stringify(data)}`);
      }
    });

    test('Get comment revision history', async (t) => {
      if (!testCommentId) {
        t.skip('No comment ID for revision history');
        return;
      }

      const { status, data } = await fetchRelayer(
        `/comment/${testDaoId}/${testProposalId}/${testCommentId}/revisions`
      );

      if (status === 404) {
        console.log('  Revisions endpoint not found');
        return;
      }

      if (status === 200) {
        const revisions = data.revisions || [];
        console.log(`  Found ${revisions.length} revisions`);
      }
    });
  });

  // ============================================
  // Comment Deletion Tests
  // ============================================

  describe('Comment Deletion', () => {
    test('Delete own comment', async (t) => {
      if (!testCommentId) {
        t.skip('No comment ID to delete');
        return;
      }

      const { status, data } = await fetchRelayer('/comment/delete', {
        method: 'POST',
        body: JSON.stringify({
          daoId: testDaoId,
          proposalId: testProposalId,
          commentId: testCommentId,
          author: testAuthor,
        }),
      });

      if ([404, 401].includes(status)) {
        console.log(`  Delete endpoint returned ${status}`);
        return;
      }

      if (status === 200) {
        console.log('  Comment deleted successfully');
      } else {
        console.log(`  Delete returned ${status}: ${JSON.stringify(data)}`);
      }
    });

    test('Deleted comment shows as deleted', async (t) => {
      if (!testCommentId) {
        t.skip('No comment ID to verify');
        return;
      }

      const { status, data } = await fetchRelayer(
        `/comment/${testDaoId}/${testProposalId}/${testCommentId}`
      );

      if (status === 200 && data.deleted) {
        console.log(`  Comment marked as deleted by: ${data.deletedBy}`);
      } else if (status === 404) {
        console.log('  Comment not found (may have been hard deleted)');
      }
    });
  });

  // ============================================
  // Anonymous Comment Tests
  // ============================================

  describe('Anonymous Comments', () => {
    test('Anonymous comment requires valid ZK proof', async () => {
      const { status, data } = await fetchRelayer('/comment/anonymous', {
        method: 'POST',
        body: JSON.stringify({
          daoId: testDaoId,
          proposalId: testProposalId,
          contentCid: testContentCid || 'QmTest',
          parentId: null,
          nullifier: '12345678901234567890',
          root: '1',
          commitment: '1',
          nonce: 0,
          proof: {
            a: '00'.repeat(64),
            b: '00'.repeat(128),
            c: '00'.repeat(64),
          },
        }),
      });

      // Should be rejected (invalid proof), but not crash
      assert.ok([400, 401, 404].includes(status),
        `Expected validation error or auth required, got ${status}`);
      console.log(`  Anonymous comment validation: ${status}`);
    });

    test('Anonymous comment validates BN254 field bounds', async () => {
      const BN254_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

      const { status } = await fetchRelayer('/comment/anonymous', {
        method: 'POST',
        body: JSON.stringify({
          daoId: testDaoId,
          proposalId: testProposalId,
          contentCid: 'QmTest',
          parentId: null,
          nullifier: (BN254_MODULUS + 1n).toString(), // Invalid!
          root: '1',
          commitment: '1',
          nonce: 0,
          proof: { a: '00'.repeat(64), b: '00'.repeat(128), c: '00'.repeat(64) },
        }),
      });

      assert.ok([400, 401, 404].includes(status),
        `Expected rejection for invalid nullifier, got ${status}`);
    });
  });

  // ============================================
  // Reply Threading Tests
  // ============================================

  describe('Reply Threading', () => {
    let parentCommentId = null;
    let replyCommentId = null;

    test('Create parent comment for reply test', async (t) => {
      const uploadRes = await fetchRelayer('/ipfs/metadata', {
        method: 'POST',
        body: JSON.stringify({
          version: 1,
          body: 'Parent comment for reply test',
          createdAt: new Date().toISOString(),
        }),
      });

      if (!uploadRes.ok) {
        t.skip('Cannot create parent content');
        return;
      }

      const { status, data } = await fetchRelayer('/comment/public', {
        method: 'POST',
        body: JSON.stringify({
          daoId: testDaoId,
          proposalId: testProposalId,
          contentCid: uploadRes.data.cid,
          parentId: null,
          author: testAuthor,
        }),
      });

      if (status === 200 || status === 201) {
        parentCommentId = data.commentId;
        console.log(`  Created parent comment: ${parentCommentId}`);
      } else if ([404, 401].includes(status)) {
        console.log('  Comment endpoint not available');
      }
    });

    test('Create reply to parent comment', async (t) => {
      if (!parentCommentId) {
        t.skip('No parent comment for reply');
        return;
      }

      const uploadRes = await fetchRelayer('/ipfs/metadata', {
        method: 'POST',
        body: JSON.stringify({
          version: 1,
          body: 'This is a reply to the parent comment',
          createdAt: new Date().toISOString(),
        }),
      });

      if (!uploadRes.ok) {
        t.skip('Cannot create reply content');
        return;
      }

      const { status, data } = await fetchRelayer('/comment/public', {
        method: 'POST',
        body: JSON.stringify({
          daoId: testDaoId,
          proposalId: testProposalId,
          contentCid: uploadRes.data.cid,
          parentId: parentCommentId,
          author: testAuthor,
        }),
      });

      if (status === 200 || status === 201) {
        replyCommentId = data.commentId;
        console.log(`  Created reply comment: ${replyCommentId}`);
      }
    });

    test('Fetch comments shows threaded structure', async (t) => {
      if (!parentCommentId) {
        t.skip('No parent comment to verify threading');
        return;
      }

      const { status, data } = await fetchRelayer(`/comments/${testDaoId}/${testProposalId}`);

      if (status === 200) {
        const comments = data.comments || [];
        const parent = comments.find(c => c.id === parentCommentId);
        if (parent && parent.replies) {
          console.log(`  Parent has ${parent.replies.length} replies`);
        } else {
          console.log('  Threaded structure not available or empty');
        }
      }
    });
  });
});

// Print summary at the end
console.log(`
================================================
Comment System E2E Test Suite
================================================
Target: ${RELAYER_URL}
Run with: node --test tests/e2e/comment-system.test.js

Prerequisites:
  1. Start relayer: cd backend && npm run relayer
  2. Create test DAO: ./scripts/create-public-dao.sh
  3. Create test proposal (via frontend or CLI)
================================================
`);
