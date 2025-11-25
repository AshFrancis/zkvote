#!/bin/bash
set -e

echo "=================================================="
echo "P25 Feature Check - Hosted Futurenet"
echo "=================================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Build the contract
echo "📦 Building contract..."
cd "$(dirname "$0")"
cargo build --target wasm32-unknown-unknown --release
echo -e "${GREEN}✓ Build successful${NC}"
echo ""

# Copy WASM to easier location
cp ../../target/wasm32-unknown-unknown/release/p25_feature_check.wasm ./p25_feature_check.wasm

# Check if stellar CLI is installed
if ! command -v stellar &> /dev/null; then
    echo -e "${RED}✗ stellar CLI not found${NC}"
    echo "Install with: cargo install --locked stellar-cli"
    exit 1
fi

echo "🌐 Deploying to Stellar Futurenet..."
echo "Network: https://horizon-futurenet.stellar.org"
echo ""

# Deploy contract
CONTRACT_ID=$(stellar contract deploy \
    --wasm p25_feature_check.wasm \
    --source-account default \
    --network futurenet 2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Deployment failed!${NC}"
    echo "Error: $CONTRACT_ID"
    echo ""
    echo "Possible reasons:"
    echo "  - Futurenet doesn't support P25 features yet"
    echo "  - Network connectivity issues"
    echo "  - Account funding issues (run: stellar keys fund default --network futurenet)"
    exit 1
fi

echo -e "${GREEN}✓ Deployed successfully${NC}"
echo "Contract ID: $CONTRACT_ID"
echo ""

# Test Poseidon hash
echo "🧪 Testing Poseidon hash..."
RESULT=$(stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source-account default \
    --network futurenet \
    -- \
    test_poseidon \
    --a '{"u256": 12345}' \
    --b '{"u256": 67890}' 2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Poseidon test failed!${NC}"
    echo "Error: $RESULT"
    echo ""
    echo "This means:"
    echo "  ❌ Hosted futurenet does NOT support Poseidon/BN254 yet"
    echo "  ⚠️  You must use local Docker container for development"
    exit 1
fi

echo -e "${GREEN}✓ Poseidon hash successful${NC}"
echo "Result: $RESULT"
echo ""

# Test BN254 availability
echo "🧪 Testing BN254 availability..."
RESULT=$(stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source-account default \
    --network futurenet \
    -- \
    test_bn254_available 2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ BN254 test failed!${NC}"
    echo "Error: $RESULT"
    exit 1
fi

echo -e "${GREEN}✓ BN254 available${NC}"
echo "Result: $RESULT"
echo ""

# Summary
echo "=================================================="
echo -e "${GREEN}✅ SUCCESS: P25 Features Available!${NC}"
echo "=================================================="
echo ""
echo "Results:"
echo "  ✓ Poseidon hashing works"
echo "  ✓ BN254 operations available"
echo "  ✓ Hosted futurenet supports P25 features"
echo ""
echo "This means you can deploy your DAO contracts to:"
echo "  - Hosted futurenet (https://horizon-futurenet.stellar.org)"
echo "  - Local Docker container"
echo ""
echo "Contract ID: $CONTRACT_ID"
echo ""
