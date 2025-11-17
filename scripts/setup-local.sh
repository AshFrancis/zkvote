#!/bin/bash
# Complete local P25 setup for DaoVote
# Start container, fund account, build contracts

set -e

echo "=== DaoVote Local Setup ==="

# Check prerequisites
if ! command -v stellar &> /dev/null; then
    echo "Error: stellar CLI not found"
    echo "Install with: cargo install stellar-cli"
    exit 1
fi

if ! command -v cargo &> /dev/null; then
    echo "Error: cargo not found"
    echo "Install from: https://rustup.rs/"
    exit 1
fi

# Step 1: Start local network
echo "1. Starting local P25 network..."
stellar container start -t future || {
    echo "   Container may already be running, continuing..."
}

# Wait for network
echo "   Waiting for network to be ready..."
sleep 3

# Step 2: Create and fund account
echo "2. Setting up account..."
if ! stellar keys address mykey &> /dev/null; then
    echo "   Creating mykey..."
    stellar keys generate mykey --network local
fi

echo "   Funding mykey..."
stellar keys fund mykey --network local || {
    echo "   Account may already be funded, continuing..."
}

MYKEY_ADDRESS=$(stellar keys address mykey)
echo "   Address: $MYKEY_ADDRESS"

# Step 3: Build contracts
echo "3. Building contracts..."
cargo build --target wasm32v1-none --release

# Step 4: Run tests
echo "4. Running tests..."
cargo test --workspace

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Deploy contracts: ./scripts/deploy-local.sh"
echo "  2. Initialize: ./scripts/init-local.sh"
echo "  3. Start relayer: cd backend && npm run relayer"
