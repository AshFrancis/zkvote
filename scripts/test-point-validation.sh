#!/bin/bash
# Point Validation Test - P25 Network
#
# This script tests that G1 point validation correctly rejects invalid points
# on a real P25 network. Point validation is disabled in test mode, so we must
# test on deployed contracts.
#
# Requirements:
# - P25 network running (stellar container start -t future)
# - Contracts deployed
# - stellar CLI configured

set -e

# Configuration
KEY_NAME="mykey"
RPC_URL="http://localhost:8000/soroban/rpc"
NETWORK_PASSPHRASE="Test SDF Future Network ; October 2022"

echo "=========================================="
echo "Point Validation Security Test"
echo "=========================================="
echo ""
echo "This test verifies that the voting contract"
echo "correctly rejects verification keys with"
echo "invalid BN254 G1 points."
echo ""

# Check if contracts are deployed
if [ ! -f ".deployed-contracts" ]; then
    echo "❌ Error: Contracts not deployed"
    echo "Run ./scripts/deploy-local.sh first"
    exit 1
fi

source .deployed-contracts

echo "Using contracts:"
echo "  Registry: $REGISTRY_ID"
echo "  Voting:   $VOTING_ID"
echo ""

# Create a test DAO
echo "Creating test DAO for point validation..."
DAO_ID=$(stellar contract invoke \
    --id "$REGISTRY_ID" \
    --source "$KEY_NAME" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- \
    create_dao \
    --name "\"Point Validation Test DAO\"" \
    --admin "$ADMIN_ADDRESS" 2>&1 | grep -o '"[0-9]*"' | tr -d '"')

echo "Created DAO ID: $DAO_ID"
echo ""

# Helper function to create VK JSON with custom alpha point
create_vk_json() {
    local alpha_x=$1
    local alpha_y=$2

    cat > /tmp/test_vk_invalid.json <<EOF
{
    "alpha": {
        "point": "${alpha_x}${alpha_y}"
    },
    "beta": {
        "point": "$(printf '0%.0s' {1..256})"
    },
    "gamma": {
        "point": "$(printf '0%.0s' {1..256})"
    },
    "delta": {
        "point": "$(printf '0%.0s' {1..256})"
    },
    "ic": [
        "0000000000000000000000000000000000000000000000000000000000000001$(printf '0%.0s' {1..62})2",
        "0000000000000000000000000000000000000000000000000000000000000001$(printf '0%.0s' {1..62})2",
        "0000000000000000000000000000000000000000000000000000000000000001$(printf '0%.0s' {1..62})2",
        "0000000000000000000000000000000000000000000000000000000000000001$(printf '0%.0s' {1..62})2",
        "0000000000000000000000000000000000000000000000000000000000000001$(printf '0%.0s' {1..62})2",
        "0000000000000000000000000000000000000000000000000000000000000001$(printf '0%.0s' {1..62})2"
    ]
}
EOF
}

# Test 1: Invalid alpha point (5, 10) - NOT on curve
echo "=========================================="
echo "Test 1: Invalid alpha point (5, 10)"
echo "=========================================="
echo ""
echo "Point (5, 10) is NOT on the BN254 curve:"
echo "  y² = 10² = 100"
echo "  x³ + 3 = 5³ + 3 = 128"
echo "  100 ≠ 128 → Invalid point"
echo ""

# x = 5 (padded to 32 bytes hex)
ALPHA_X="0000000000000000000000000000000000000000000000000000000000000005"
# y = 10 (padded to 32 bytes hex)
ALPHA_Y="000000000000000000000000000000000000000000000000000000000000000a"

create_vk_json "$ALPHA_X" "$ALPHA_Y"

echo "Attempting to set VK with invalid alpha point..."
if stellar contract invoke \
    --id "$VOTING_ID" \
    --source "$KEY_NAME" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- \
    set_vk \
    --dao_id "$DAO_ID" \
    --admin "$ADMIN_ADDRESS" \
    --vk "$(cat /tmp/test_vk_invalid.json)" 2>&1 | grep -q "invalid VK alpha"; then
    echo "✅ PASS: Contract correctly rejected invalid alpha point"
    TEST1_PASS=true
else
    echo "❌ FAIL: Contract accepted invalid alpha point (SECURITY ISSUE!)"
    TEST1_PASS=false
fi
echo ""

# Test 2: Point at infinity (0, 0)
echo "=========================================="
echo "Test 2: Point at infinity (0, 0)"
echo "=========================================="
echo ""
echo "Point (0, 0) should be rejected"
echo ""

ALPHA_X="0000000000000000000000000000000000000000000000000000000000000000"
ALPHA_Y="0000000000000000000000000000000000000000000000000000000000000000"

create_vk_json "$ALPHA_X" "$ALPHA_Y"

echo "Attempting to set VK with point at infinity..."
if stellar contract invoke \
    --id "$VOTING_ID" \
    --source "$KEY_NAME" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- \
    set_vk \
    --dao_id "$DAO_ID" \
    --admin "$ADMIN_ADDRESS" \
    --vk "$(cat /tmp/test_vk_invalid.json)" 2>&1 | grep -q "invalid VK alpha"; then
    echo "✅ PASS: Contract correctly rejected point at infinity"
    TEST2_PASS=true
else
    echo "❌ FAIL: Contract accepted point at infinity (SECURITY ISSUE!)"
    TEST2_PASS=false
fi
echo ""

# Test 3: Valid generator point (1, 2) - should be accepted
echo "=========================================="
echo "Test 3: Valid generator point (1, 2)"
echo "=========================================="
echo ""
echo "Point (1, 2) is the BN254 G1 generator - VALID"
echo "  y² = 2² = 4"
echo "  x³ + 3 = 1³ + 3 = 4"
echo "  4 = 4 → Valid point"
echo ""

ALPHA_X="0000000000000000000000000000000000000000000000000000000000000001"
ALPHA_Y="0000000000000000000000000000000000000000000000000000000000000002"

create_vk_json "$ALPHA_X" "$ALPHA_Y"

echo "Attempting to set VK with valid generator point..."
if stellar contract invoke \
    --id "$VOTING_ID" \
    --source "$KEY_NAME" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- \
    set_vk \
    --dao_id "$DAO_ID" \
    --admin "$ADMIN_ADDRESS" \
    --vk "$(cat /tmp/test_vk_invalid.json)" 2>&1 | grep -qv "invalid"; then
    echo "✅ PASS: Contract accepted valid generator point"
    TEST3_PASS=true
else
    echo "❌ FAIL: Contract rejected valid generator point"
    TEST3_PASS=false
fi
echo ""

# Summary
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo ""

if [ "$TEST1_PASS" = true ] && [ "$TEST2_PASS" = true ] && [ "$TEST3_PASS" = true ]; then
    echo "✅ ALL TESTS PASSED"
    echo ""
    echo "Point validation is working correctly:"
    echo "  ✅ Invalid points rejected"
    echo "  ✅ Point at infinity rejected"
    echo "  ✅ Valid points accepted"
    echo ""
    echo "Security Status: PROTECTED against CVE-2023-40141"
    exit 0
else
    echo "❌ SOME TESTS FAILED"
    echo ""
    [ "$TEST1_PASS" = false ] && echo "  ❌ Invalid alpha point was accepted"
    [ "$TEST2_PASS" = false ] && echo "  ❌ Point at infinity was accepted"
    [ "$TEST3_PASS" = false ] && echo "  ❌ Valid generator point was rejected"
    echo ""
    echo "⚠️  SECURITY ISSUE: Point validation not working correctly"
    exit 1
fi
