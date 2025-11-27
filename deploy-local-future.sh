#!/bin/bash
set -e

RPC="${STELLAR_RPC_URL:-http://localhost:8000/soroban/rpc}"
PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Standalone Network ; February 2017}"
SOURCE="${SOURCE:-mykey}"

echo "=== Deploying to local quickstart:future (Protocol 25) ==="

# Deploy DAORegistry
echo "Deploying DAORegistry..."
REGISTRY_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/dao_registry.wasm \
  --source $SOURCE \
  --rpc-url "$RPC" \
  --network-passphrase "$PASSPHRASE" 2>&1 | tail -1)
echo "REGISTRY_ID=$REGISTRY_ID"

# Deploy MembershipSBT with registry as constructor arg
echo "Deploying MembershipSBT..."
SBT_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/membership_sbt.wasm \
  --source $SOURCE \
  --rpc-url "$RPC" \
  --network-passphrase "$PASSPHRASE" \
  -- --registry "$REGISTRY_ID" 2>&1 | tail -1)
echo "SBT_ID=$SBT_ID"

# Deploy MembershipTree with registry as constructor arg
echo "Deploying MembershipTree..."
TREE_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/membership_tree.wasm \
  --source $SOURCE \
  --rpc-url "$RPC" \
  --network-passphrase "$PASSPHRASE" \
  -- --registry "$REGISTRY_ID" 2>&1 | tail -1)
echo "TREE_ID=$TREE_ID"

# Deploy Voting with registry and tree as constructor args
echo "Deploying Voting..."
VOTING_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/voting.wasm \
  --source $SOURCE \
  --rpc-url "$RPC" \
  --network-passphrase "$PASSPHRASE" \
  -- --registry "$REGISTRY_ID" --tree "$TREE_ID" 2>&1 | tail -1)
echo "VOTING_ID=$VOTING_ID"

# Write contract IDs to file
cat > .contract-ids.local << IDSEOF
REGISTRY_ID="$REGISTRY_ID"
SBT_ID="$SBT_ID"
TREE_ID="$TREE_ID"
VOTING_ID="$VOTING_ID"
RPC_URL="$RPC"
PASSPHRASE="$PASSPHRASE"
IDSEOF

echo ""
echo "=== Deployment complete ==="
cat .contract-ids.local
