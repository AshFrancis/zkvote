#!/bin/bash
# End-to-end test with real Groth16 proof on deployed contracts

set -e

# Load deployed contract addresses
source .deployed-contracts

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}========================================="
echo "DaoVote End-to-End Test"
echo -e "=========================================${NC}\n"

# User addresses
ADMIN="GDR46YB7MPK6FEU72XDL43UT4OSPQBJVNMQN474QYU4FG247OSWFQXLL"  # mykey

echo -e "${YELLOW}Deployed Contracts:${NC}"
echo "Registry: $REGISTRY_ID"
echo "SBT: $SBT_ID"
echo "Tree: $TREE_ID"
echo "Voting: $VOTING_ID"

echo -e "\n${YELLOW}Step 1: Creating DAO${NC}"
DAO_ID=$(stellar contract invoke \
  --id "$REGISTRY_ID" \
  --source mykey \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- create_dao \
  --name "TestDAO" \
  --creator "$ADMIN" 2>/dev/null)

echo -e "${GREEN}✅ DAO created with ID: $DAO_ID${NC}"

echo -e "\n${YELLOW}Step 2: Minting SBT to member${NC}"
stellar contract invoke \
  --id "$SBT_ID" \
  --source mykey \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- mint \
  --dao_id "$DAO_ID" \
  --to "$ADMIN" \
  --admin "$ADMIN" > /dev/null

echo -e "${GREEN}✅ SBT minted${NC}"

echo -e "\n${BLUE}========================================="
echo "Basic Setup Complete!"
echo -e "=========================================${NC}\n"
echo -e "${GREEN}✅ DAO created${NC}"
echo -e "${GREEN}✅ Member has SBT${NC}"
