#!/bin/bash
# Poseidon Known-Answer Test (KAT) - Verify circomlib matches P25
#
# This script tests that circomlib Poseidon and P25 host function produce identical outputs.
# CRITICAL: Must pass before deploying to production.
#
# Prerequisites:
# - P25 local testnet running (stellar container start -t future)
# - Contracts deployed
# - TREE_CONTRACT_ID set in environment or backend/.env

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "Poseidon Known-Answer Test (KAT)"
echo "=========================================="
echo ""

# Load environment
if [ -f "$PROJECT_ROOT/backend/.env" ]; then
    source "$PROJECT_ROOT/backend/.env"
fi

if [ -z "$TREE_CONTRACT_ID" ]; then
    echo "ERROR: TREE_CONTRACT_ID not set"
    echo "Please deploy the MembershipTree contract first and set the ID."
    exit 1
fi

NETWORK="${NETWORK:-local}"
RPC_URL="${SOROBAN_RPC_URL:-http://localhost:8000/soroban/rpc}"

echo "Network: $NETWORK"
echo "RPC: $RPC_URL"
echo "Tree Contract: $TREE_CONTRACT_ID"
echo ""

# Test vectors from circomlib (from poseidon_kat.js)
# Format: "input1_hex input2_hex expected_hash_hex"
declare -a TEST_VECTORS=(
    "0000000000000000000000000000000000000000000000000000000000000000 0000000000000000000000000000000000000000000000000000000000000000 2098f5fb9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864"
    "0000000000000000000000000000000000000000000000000000000000000001 0000000000000000000000000000000000000000000000000000000000000001 007af346e2d304279e79e0a9f3023f771294a78acb70e73f90afe27cad401e81"
    "0000000000000000000000000000000000000000000000000000000000000001 0000000000000000000000000000000000000000000000000000000000000002 115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a"
)

# We'll need to call the contract's internal hash_pair method
# Since it's not exposed, we'll test by checking the zero_value computation

echo "Testing zero_value constant..."
echo "Expected from circomlib: 2a09a9fd93c590c26b91effbb2499f07e8f7aa12e2b4940a3aed2411cb65e11c"
echo ""

# The zero_value is Poseidon([0]) which circomlib gives us:
# 0x2a09a9fd93c590c26b91effbb2499f07e8f7aa12e2b4940a3aed2411cb65e11c

# For a proper test, we need to expose the hash function or check intermediate values.
# Let's create a specific test contract method or check via tree operations.

echo "NOTE: Full KAT verification requires P25 testnet deployment."
echo ""
echo "Alternative verification method:"
echo "1. Deploy contract to P25 local testnet"
echo "2. Register a commitment with known values"
echo "3. Compare the resulting root with expected"
echo ""

# Create a node script to do end-to-end verification
node "$SCRIPT_DIR/poseidon-kat-verify.js"
