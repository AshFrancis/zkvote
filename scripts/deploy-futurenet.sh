#!/bin/bash
# Deploy DaoVote contracts to local futurenet
#
# Prerequisites:
# - stellar container start -t future (already running)
# - stellar keys generate mykey (already exists)
# - All contracts built and optimized

set -e  # Exit on error

# Configuration
KEY_NAME="mykey"
RPC_URL="http://localhost:8000/soroban/rpc"
NETWORK_PASSPHRASE="Test SDF Future Network ; October 2022"
NETWORK="futurenet-local"

# Colors for output
GREEN='\033[0.32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================"
echo "DaoVote Futurenet Deployment"
echo -e "======================================${NC}\n"

# Configure network if not already configured
if ! stellar network ls 2>/dev/null | grep -q "^$NETWORK "; then
    echo -e "${YELLOW}Configuring network $NETWORK...${NC}"
    stellar network add \
        --rpc-url "$RPC_URL" \
        --network-passphrase "$NETWORK_PASSPHRASE" \
        "$NETWORK"
fi

# Fund account if needed
echo -e "${YELLOW}Funding account...${NC}"
stellar keys address "$KEY_NAME" | xargs -I {} stellar keys fund {} --network "$NETWORK" 2>/dev/null || true

# Deploy contracts
echo -e "\n${BLUE}Step 1: Deploying DAO Registry...${NC}"
REGISTRY_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/dao_registry.wasm \
  --source "$KEY_NAME" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" 2>&1 | tail -1)

echo -e "${GREEN}✅ DAO Registry deployed: $REGISTRY_ID${NC}"

echo -e "\n${BLUE}Step 2: Deploying Membership SBT...${NC}"
SBT_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/membership_sbt.wasm \
  --source "$KEY_NAME" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- --registry "$REGISTRY_ID" 2>&1 | tail -1)

echo -e "${GREEN}✅ Membership SBT deployed: $SBT_ID${NC}"

echo -e "\n${BLUE}Step 3: Deploying Membership Tree...${NC}"
TREE_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/membership_tree.wasm \
  --source "$KEY_NAME" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- --sbt_contract "$SBT_ID" 2>&1 | tail -1)

echo -e "${GREEN}✅ Membership Tree deployed: $TREE_ID${NC}"

echo -e "\n${BLUE}Step 4: Deploying Voting Contract...${NC}"
VOTING_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/voting.wasm \
  --source "$KEY_NAME" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- --tree_contract "$TREE_ID" 2>&1 | tail -1)

echo -e "${GREEN}✅ Voting deployed: $VOTING_ID${NC}"

# Save contract addresses to file
echo -e "\n${BLUE}Saving contract addresses...${NC}"
cat > .deployed-contracts << EOF
# DaoVote Contract Addresses (Futurenet Local)
# Deployed: $(date)

export REGISTRY_ID="$REGISTRY_ID"
export SBT_ID="$SBT_ID"
export TREE_ID="$TREE_ID"
export VOTING_ID="$VOTING_ID"

export KEY_NAME="$KEY_NAME"
export RPC_URL="$RPC_URL"
export NETWORK_PASSPHRASE="$NETWORK_PASSPHRASE"
export NETWORK="$NETWORK"

# Usage: source .deployed-contracts
EOF

echo -e "${GREEN}✅ Contract addresses saved to .deployed-contracts${NC}"

# Print summary
echo -e "\n${BLUE}======================================"
echo "Deployment Complete!"
echo -e "======================================${NC}\n"

echo "Contract Addresses:"
echo "  DAO Registry:     $REGISTRY_ID"
echo "  Membership SBT:   $SBT_ID"
echo "  Membership Tree:  $TREE_ID"
echo "  Voting:           $VOTING_ID"

echo -e "\n${YELLOW}To use these contracts:${NC}"
echo "  source .deployed-contracts"

echo -e "\n${GREEN}✅ Ready for testing!${NC}"
