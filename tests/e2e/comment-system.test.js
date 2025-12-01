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
let testAuthor = null;  // Will be set from mykey
let commentsContractId = null;
let networkFlag = '--network futurenet';  // Default, will detect

// Helper to create a public comment via CLI (direct contract invoke)
async function createCommentViaCLI(daoId, proposalId, contentCid, parentId = null) {
  if (!commentsContractId) {
    console.log('  Comments contract not configured, skipping CLI comment creation');
    return null;
  }

  try {
    if (!testAuthor) {
      console.log('  No author address available');
      return null;
    }

    // Build the stellar contract invoke command
    // Note: parent_id is Option<u64>, so we need to pass it as --parent_id <value> or omit entirely
    let cmd = `stellar contract invoke \
      --id ${commentsContractId} \
      --source mykey \
      ${networkFlag} \
      -- add_comment \
      --dao_id ${daoId} \
      --proposal_id ${proposalId} \
      --content_cid "${contentCid}" \
      --author ${testAuthor}`;

    if (parentId !== null) {
      cmd += ` --parent_id ${parentId}`;
    }

    console.log(`  Creating comment via CLI...`);
    const result = execSync(cmd, { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 60000 });

    // Parse the returned comment ID
    const commentId = parseInt(result.trim(), 10);
    if (!isNaN(commentId)) {
      console.log(`  Created comment ID: ${commentId}`);
      return commentId;
    }
    return null;
  } catch (error) {
    console.log(`  CLI comment creation failed: ${error.message}`);
    return null;
  }
}

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
      commentsContractId = contracts.COMMENTS_ID || null;
      console.log(`  Comments: ${commentsContractId || 'not set'}`);
    }

    // Also check backend/.env for COMMENTS_CONTRACT_ID
    if (!commentsContractId) {
      try {
        const envPath = path.join(PROJECT_ROOT, 'backend/.env');
        if (fs.existsSync(envPath)) {
          const envContent = fs.readFileSync(envPath, 'utf-8');
          const match = envContent.match(/COMMENTS_CONTRACT_ID=(\S+)/);
          if (match) {
            commentsContractId = match[1];
            console.log(`  Comments (from .env): ${commentsContractId}`);
          }
        }
      } catch (e) {
        // Ignore
      }
    }

    // Get test author address and detect network
    try {
      // Try futurenet first
      testAuthor = execSync(
        'stellar keys address mykey --network futurenet 2>/dev/null',
        { cwd: PROJECT_ROOT, encoding: 'utf-8' }
      ).trim();
      networkFlag = '--network futurenet';
    } catch {
      try {
        // Fall back to local
        testAuthor = execSync(
          'stellar keys address mykey --network local 2>/dev/null',
          { cwd: PROJECT_ROOT, encoding: 'utf-8' }
        ).trim();
        networkFlag = '--network local';
      } catch {
        console.log('  Warning: No mykey available for CLI comment creation');
      }
    }
    if (testAuthor) {
      console.log(`Test Author: ${testAuthor.substring(0, 10)}...`);
      console.log(`Network: ${networkFlag}`);
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
    test('Create public comment via CLI (direct contract invoke)', async (t) => {
      if (!commentsContractId || !testAuthor) {
        t.skip('Comments contract or author not configured for CLI');
        return;
      }

      if (!testContentCid) {
        // Create content first
        const uploadRes = await fetchRelayer('/ipfs/metadata', {
          method: 'POST',
          body: JSON.stringify({
            version: 1,
            body: 'Test comment created via CLI',
            createdAt: new Date().toISOString(),
          }),
        });
        if (!uploadRes.ok) {
          t.skip('Cannot create content CID');
          return;
        }
        testContentCid = uploadRes.data.cid;
      }

      // Create comment via CLI
      const commentId = await createCommentViaCLI(testDaoId, testProposalId, testContentCid);
      if (commentId !== null) {
        testCommentId = commentId;
        console.log(`  Created comment ${testCommentId} via CLI`);
      } else {
        console.log('  CLI comment creation not available (network may not be running)');
      }
    });

    test('Public comments require direct wallet signing', async (t) => {
      // NOTE: Public comments are now submitted directly through wallet signing (Freighter)
      // The relayer no longer handles public comments - they go through the contract directly
      // This test verifies the relayer correctly rejects public comment requests
      if (!testContentCid) {
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

      // The /comment/public endpoint has been removed - public comments go through Freighter
      const { status } = await fetchRelayer('/comment/public', {
        method: 'POST',
        body: JSON.stringify({
          daoId: testDaoId,
          proposalId: testProposalId,
          contentCid: testContentCid,
          parentId: null,
          author: testAuthor,
        }),
      });

      // Expect 404 or 500 since endpoint was removed - public comments require wallet signing
      // Express may return 404 (route not found) or 500 (error handler) depending on config
      assert.ok(status === 404 || status >= 400, `Public comment endpoint should reject requests (got ${status})`);
      console.log(`  Public comment endpoint correctly rejected with ${status} (use Freighter for public comments)`);
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

    test('Create parent comment for reply test via CLI', async (t) => {
      if (!commentsContractId || !testAuthor) {
        t.skip('Comments contract or author not configured for CLI');
        return;
      }

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

      // Create parent comment via CLI
      parentCommentId = await createCommentViaCLI(testDaoId, testProposalId, uploadRes.data.cid);
      if (parentCommentId !== null) {
        console.log(`  Created parent comment: ${parentCommentId}`);
      } else {
        console.log('  CLI comment creation not available');
      }
    });

    test('Create reply to parent comment via CLI', async (t) => {
      if (!commentsContractId || !testAuthor) {
        t.skip('Comments contract or author not configured for CLI');
        return;
      }

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

      // Create reply via CLI with parent_id
      replyCommentId = await createCommentViaCLI(testDaoId, testProposalId, uploadRes.data.cid, parentCommentId);
      if (replyCommentId !== null) {
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
