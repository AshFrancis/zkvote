#!/bin/bash
# Deploy DaoVote contracts to local P25 network with constructor arguments
# Prerequisites: stellar container start -t future

set -e

echo "=== DaoVote Local Deployment ==="

# Check if stellar CLI is available
if ! command -v stellar &> /dev/null; then
    echo "Error: stellar CLI not found. Install with: cargo install stellar-cli"
    exit 1
fi

# Configuration
NETWORK="${NETWORK:-local}"
SOURCE="${SOURCE:-mykey}"
WASM_DIR="${WASM_DIR:-target/wasm32v1-none/release}"

echo "Network: $NETWORK"
echo "Source: $SOURCE"
echo "WASM Dir: $WASM_DIR"
echo ""

# Check WASM files exist
if [ ! -f "$WASM_DIR/dao_registry.wasm" ]; then
    echo "Error: WASM files not found. Build first with:"
    echo "  cargo build --target wasm32v1-none --release"
    exit 1
fi

# Deploy contracts in dependency order with constructor arguments
# Contracts use CAP-0058 constructors (__constructor) called automatically at deploy

echo "1. Deploying DAORegistry (no constructor)..."
REGISTRY_ID=$(stellar contract deploy \
    --wasm "$WASM_DIR/dao_registry.wasm" \
    --source "$SOURCE" \
    --network "$NETWORK" 2>&1 | tail -1)
echo "   ✓ Registry: $REGISTRY_ID"

echo ""
echo "2. Deploying MembershipSBT (constructor: registry)..."
SBT_ID=$(stellar contract deploy \
    --wasm "$WASM_DIR/membership_sbt.wasm" \
    --source "$SOURCE" \
    --network "$NETWORK" \
    -- --registry "$REGISTRY_ID" 2>&1 | tail -1)
echo "   ✓ SBT: $SBT_ID"

echo ""
echo "3. Deploying MembershipTree (constructor: sbt_contract)..."
TREE_ID=$(stellar contract deploy \
    --wasm "$WASM_DIR/membership_tree.wasm" \
    --source "$SOURCE" \
    --network "$NETWORK" \
    -- --sbt_contract "$SBT_ID" 2>&1 | tail -1)
echo "   ✓ Tree: $TREE_ID"

echo ""
echo "4. Deploying Voting (constructor: tree_contract)..."
VOTING_ID=$(stellar contract deploy \
    --wasm "$WASM_DIR/voting.wasm" \
    --source "$SOURCE" \
    --network "$NETWORK" \
    -- --tree_contract "$TREE_ID" 2>&1 | tail -1)
echo "   ✓ Voting: $VOTING_ID"

# Save contract IDs
cat > .contract-ids.local << EOF
# DaoVote Contract IDs (local network)
# Generated: $(date)
NETWORK=$NETWORK
REGISTRY_ID=$REGISTRY_ID
SBT_ID=$SBT_ID
TREE_ID=$TREE_ID
VOTING_ID=$VOTING_ID
EOF

echo ""
echo "=== Deployment Complete ==="
echo "Contract IDs saved to .contract-ids.local"
echo ""
echo "All contracts deployed with constructor arguments:"
echo "  - Registry: $REGISTRY_ID (no constructor)"
echo "  - SBT: $SBT_ID (registry=$REGISTRY_ID)"
echo "  - Tree: $TREE_ID (sbt_contract=$SBT_ID)"
echo "  - Voting: $VOTING_ID (tree_contract=$TREE_ID)"
echo ""
echo "Next: Configure backend with ./scripts/init-local.sh"
