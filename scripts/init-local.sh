#!/bin/bash
# Initialize DaoVote contracts on local P25 network
# Run after deploy-local.sh

set -e

echo "=== DaoVote Contract Initialization ==="

# Load contract IDs
if [ ! -f ".contract-ids.local" ]; then
    echo "Error: .contract-ids.local not found. Run deploy-local.sh first."
    exit 1
fi

source .contract-ids.local

# Configuration
NETWORK="${NETWORK:-local}"
SOURCE="${SOURCE:-mykey}"

echo "Network: $NETWORK"
echo "Source: $SOURCE"
echo ""
echo "Contract IDs:"
echo "  Registry: $REGISTRY_ID"
echo "  SBT: $SBT_ID"
echo "  Tree: $TREE_ID"
echo "  Voting: $VOTING_ID"
echo ""

# Note: With CAP-0058 constructors, initialization happens at deployment
# These contracts use __constructor which is called automatically during deploy
# However, the constructor requires the dependency contract address

# For CAP-0058, we need to redeploy with constructor args
# This script assumes contracts were deployed without constructor (will fail)
#
# TODO: Update stellar CLI to support constructor args during deploy
# For now, this is a placeholder showing the initialization flow

echo "Note: CAP-0058 constructors are called at deployment time."
echo "With current stellar CLI, you may need to:"
echo ""
echo "1. Deploy contracts with constructor args (when CLI supports it):"
echo "   stellar contract deploy --wasm <wasm> --arg registry=$REGISTRY_ID"
echo ""
echo "2. Or manually invoke constructors if they were deployed without args:"
echo "   (This won't work as constructors can only be called once)"
echo ""
echo "For testing purposes, use the integration test suite which properly"
echo "initializes contracts with constructor arguments."
echo ""
echo "=== Manual Initialization (if needed) ==="
echo ""
echo "# If your contracts have init() instead of __constructor():"
echo "stellar contract invoke --id $SBT_ID -- init --registry $REGISTRY_ID"
echo "stellar contract invoke --id $TREE_ID -- init --sbt_contract $SBT_ID"
echo "stellar contract invoke --id $VOTING_ID -- init --tree_contract $TREE_ID"

# Update backend .env
if [ -f "backend/.env.example" ]; then
    echo ""
    echo "=== Updating backend/.env ==="
    cat > backend/.env << EOF
SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc
NETWORK_PASSPHRASE=Standalone Network ; February 2017
RELAYER_SECRET_KEY=SCZANGBA5YHTNYVVV3C7CAZMTQDBJHJVHCPXPI7P6DZ7V6XBHB4LXBWO
VOTING_CONTRACT_ID=$VOTING_ID
TREE_CONTRACT_ID=$TREE_ID
PORT=3001
EOF
    echo "Backend .env created with contract IDs"
fi

echo ""
echo "=== Initialization Complete ==="
