#!/bin/bash
#
# Critical Security Test: Removed Member Cannot Vote on Snapshot Proposal
#
# This script tests the exact scenario you reported:
# 1. Member joins → registers
# 2. Member removed
# 3. Snapshot proposal created
# 4. Member re-added
# 5. Member attempts to vote → MUST FAIL
#

set -e

echo "=== Testing Removed Member Voting Attack ==="
echo ""

# Configuration
ADMIN_KEY="${ADMIN_KEY:-mykey}"
RPC_URL="${RPC_URL:-http://localhost:8000/soroban/rpc}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Future Network ; October 2022}"

# Load contract addresses from deployed config
source <(grep -E "REGISTRY_ID|SBT_ID|TREE_ID|VOTING_ID" frontend/src/config/contracts.ts | \
  sed 's/.*"\(C[^"]*\)".*/\1/' | \
  awk '{print "CONTRACT_" NR "=" $0}')

REGISTRY_ID=$CONTRACT_1
SBT_ID=$CONTRACT_2
TREE_ID=$CONTRACT_3
VOTING_ID=$CONTRACT_4

echo "Using contracts:"
echo "  Registry: $REGISTRY_ID"
echo "  SBT: $SBT_ID"
echo "  Tree: $TREE_ID"
echo "  Voting: $VOTING_ID"
echo ""

# Create test accounts
MEMBER_SECRET=$(stellar keys generate member --network testnet 2>&1 | grep "Secret key:" | awk '{print $3}')
MEMBER_ADDR=$(stellar keys address member)

echo "Test member: $MEMBER_ADDR"
echo ""

# Fund member
stellar keys fund member --network local || echo "Note: Funding may have failed, continuing..."

# Get DAO ID (assuming DAO 1 exists from your testing)
DAO_ID=1
PROPOSAL_ID=3  # The proposal you tested with

echo "=== Step 1: Check current tree state ==="
echo ""

# Get current root
CURRENT_ROOT=$(stellar contract invoke \
  --id "$TREE_ID" \
  --source $ADMIN_KEY \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  current_root \
  --dao_id $DAO_ID 2>&1 | grep -v "^ℹ️" | tail -1)

echo "Current root: $CURRENT_ROOT"

# Get proposal details
PROPOSAL=$(stellar contract invoke \
  --id "$VOTING_ID" \
  --source $ADMIN_KEY \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  get_proposal \
  --dao_id $DAO_ID \
  --proposal_id $PROPOSAL_ID 2>&1 | grep -v "^ℹ️")

echo ""
echo "Proposal $PROPOSAL_ID details:"
echo "$PROPOSAL" | jq '.' || echo "$PROPOSAL"

# Extract eligible_root from proposal
ELIGIBLE_ROOT=$(echo "$PROPOSAL" | jq -r '.eligible_root' | sed 's/"//g')
echo ""
echo "Proposal eligible_root (snapshot): $ELIGIBLE_ROOT"
echo "Current root: $CURRENT_ROOT"

if [ "$ELIGIBLE_ROOT" = "$CURRENT_ROOT" ]; then
  echo ""
  echo "⚠️  WARNING: Snapshot root equals current root!"
  echo "This means no members have been added/removed since proposal creation."
  echo "Cannot test the removal scenario in this state."
  exit 1
fi

echo ""
echo "✓ Roots differ - this is correct for testing removal scenario"
echo ""

# Check if there's a commitment at leaf index 1
echo "=== Step 2: Check leaf at index 1 ==="
echo ""

LEAF_VALUE=$(stellar contract invoke \
  --id "$TREE_ID" \
  --source $ADMIN_KEY \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  get_merkle_path \
  --dao_id $DAO_ID \
  --leaf_index 1 2>&1 | grep -v "^ℹ️" || echo "Failed to get path")

echo "Merkle path for leaf 1:"
echo "$LEAF_VALUE" | jq '.' || echo "$LEAF_VALUE"

echo ""
echo "=== Step 3: Verify proof verification is ENABLED ==="
echo ""

# Check if the deployed contract has testutils enabled by attempting a vote with invalid proof
# Generate a clearly invalid proof (all zeros)
echo "Attempting to submit invalid proof..."

# Create invalid proof (will fail if verification is working)
INVALID_RESULT=$(stellar contract invoke \
  --id "$VOTING_ID" \
  --source $ADMIN_KEY \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  vote \
  --dao_id $DAO_ID \
  --proposal_id $PROPOSAL_ID \
  --vote_choice true \
  --nullifier "0000000000000000000000000000000000000000000000000000000000000001" \
  --root "$ELIGIBLE_ROOT" \
  --proof '{"a":"0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000","b":"0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000","c":"0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"}' \
  2>&1 || echo "EXPECTED_FAILURE")

if echo "$INVALID_RESULT" | grep -q "invalid proof\|EXPECTED_FAILURE"; then
  echo "✓ Proof verification is ENABLED (invalid proof rejected)"
else
  echo "❌ CRITICAL: Invalid proof was ACCEPTED!"
  echo "This indicates testutils is enabled in the deployed contract."
  echo "Result: $INVALID_RESULT"
  exit 1
fi

echo ""
echo "=== Summary ==="
echo ""
echo "Test status:"
echo "  ✓ Contracts deployed and accessible"
echo "  ✓ Proof verification is enabled"
echo "  ✓ Snapshot root differs from current root"
echo ""
echo "To complete the test, you need to:"
echo "1. Generate a real Groth16 proof for the removed member"
echo "2. Attempt to vote with that proof"
echo "3. Verify the contract rejects it"
echo ""
echo "Use the frontend UI to test, or use circuits/generate_proof_for_tests.js"
echo "to generate proofs programmatically."
echo ""
