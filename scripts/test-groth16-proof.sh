#!/bin/bash
# Test real Groth16 proof verification on deployed contracts
set -e

source .deployed-contracts

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ADMIN="GDR46YB7MPK6FEU72XDL43UT4OSPQBJVNMQN474QYU4FG247OSWFQXLL"

echo -e "${BLUE}========================================="
echo "Testing Real Groth16 Proof Verification"
echo -e "=========================================${NC}\n"

# Public signals from circuits/public_real_test.json
ROOT="4766670850124598046773375342335481162158671707879748223301145943845222824615"
NULLIFIER="5760508796108392755529358167294721063592787938597807569861628631651201858128"
VOTE_CHOICE="1"
PROPOSAL_ID="1"

# Commitment = poseidon(secret, nullifier) = poseidon(123456789, 5760508796108392755529358167294721063592787938597807569861628631651201858128)
COMMITMENT="12372663415489400590251136925050654018390485454339988103305221475503659003634"

echo -e "${YELLOW}Step 0: Creating DAO${NC}"
CREATED_DAO_ID=$(stellar contract invoke \
  --id "$REGISTRY_ID" \
  --source mykey \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- create_dao \
  --name "ProofTestDAO" \
  --creator "$ADMIN" 2>/dev/null)

DAO_ID="$CREATED_DAO_ID"
echo -e "${GREEN}✅ DAO created with ID: $DAO_ID${NC}"

echo -e "\n${YELLOW}Step 1: Minting SBT to member${NC}"
stellar contract invoke \
  --id "$SBT_ID" \
  --source mykey \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- mint \
  --dao_id "$DAO_ID" \
  --to "$ADMIN" \
  --admin "$ADMIN" 2>/dev/null

echo -e "${GREEN}✅ SBT minted${NC}"

echo -e "\n${YELLOW}Step 2: Initializing tree for DAO${NC}"
stellar contract invoke \
  --id "$TREE_ID" \
  --source mykey \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- init_tree \
  --dao_id "$DAO_ID" \
  --depth "20" \
  --admin "$ADMIN" 2>/dev/null

echo -e "${GREEN}✅ Tree initialized${NC}"

echo -e "\n${YELLOW}Step 3: Adding commitment to tree${NC}"
stellar contract invoke \
  --id "$TREE_ID" \
  --source mykey \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- register_with_caller \
  --dao_id "$DAO_ID" \
  --commitment "$COMMITMENT" \
  --caller "$ADMIN" 2>/dev/null

echo -e "${GREEN}✅ Commitment added${NC}"

echo -e "\n${YELLOW}Step 4: Getting Merkle root${NC}"
ACTUAL_ROOT=$(stellar contract invoke \
  --id "$TREE_ID" \
  --source mykey \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- get_root \
  --dao_id "$DAO_ID" 2>/dev/null)

echo -e "${GREEN}Expected root: $ROOT${NC}"
echo -e "${GREEN}Actual root:   $ACTUAL_ROOT${NC}"

if [ "$ACTUAL_ROOT" = "$ROOT" ]; then
    echo -e "${GREEN}✅ Roots match!${NC}"
else
    echo -e "${RED}❌ Root mismatch!${NC}"
    exit 1
fi

echo -e "\n${YELLOW}Step 5: Setting verification key${NC}"
# VK from circuits/vkey_soroban_real_test.json
stellar contract invoke \
  --id "$VOTING_ID" \
  --source mykey \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- set_vk \
  --dao_id "$DAO_ID" \
  --alpha "2d4d9aa7e302d9df41749d5507949d05dbea33fbb16c643b22f599a2be6df2e214bedd503c37ceb061d8ec60209fe345ce89830a19230301f076caff004d1926" \
  --beta "0967032fcbf776d1afc985f88877f182d38480a653f2decaa9794cbc3bf3060c0e187847ad4c798374d0d6732bf501847dd68bc0e071241e0213bc7fc13db7ab304cfbd1e08a704a99f5e847d93f8c3caafddec46b7a0d379da69a4d112346a71739c1b1a457a8c7313123d24d2f9192f896b7c63eea05a9d57f06547ad0cec8" \
  --gamma "198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa" \
  --delta "22a68a3c5277c673e7ee01384e3c703cb5ccf516b3ac1b0bf4f9ab9c59499e9f204752a30f1c3f6bce47756febf26768fb875ad58dfd21bb1da9b68458ec390f2b89bc51d63dea12f866c42089d838a51aef4ada201c2dbe983c741505aa81fe25656dca10ae895c277080589dc24f8b857a74d168b977062289792f396e1f2d" \
  --ic_0 "01bf8b387c2ee3d5a3fb7959683512f7e913428298d1f0455568adc3de3006ef1c980777bc734c89d9c0a3be0ebbd776ce78a81718d0b9583594bef09f499348" \
  --ic_1 "190d1a975a41d49d6261e33600b8b5332a5a51f36fe7b4f1f68a3b104be8bd3c1053c2596037846837d88626e9fc3993ba0695e129f0f2e8df23613bba9eccb6" \
  --ic_2 "1ae0ae29ec2234a2c3e891477ea6f073f820a8e0a8a454a8dcecbf585c0a32831524bf327e7a9a55d208a87bde6bf24f0cd8335d0a782d46e8254fd955f7aea1" \
  --ic_3 "2b73046cccc217d07924716b94daec95816538302ec569967f63b18e531c114602efad1e9e852d8d4c315b802918279ef734c3c4444373e80c6c6dfad43d0f3b" \
  --ic_4 "1b359111761279abd683c4b28a4807246d002d80c5a20bb912f8b35e43a4a20d047c7d02d625c3b53270e59be1075ac36503bd44e9f072195e69dce963c2f84c" \
  --ic_5 "2de7d72a39a33a4524809514a0e10fc54477313c9ed33b5d465448caa2e013230428dae7da854ffe1fa68cbf357a9c208e74182f687bdf7a836bc6ae47bd6b8f" 2>/dev/null

echo -e "${GREEN}✅ Verification key set${NC}"

echo -e "\n${YELLOW}Step 6: Creating proposal${NC}"
stellar contract invoke \
  --id "$VOTING_ID" \
  --source mykey \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- create_proposal \
  --dao_id "$DAO_ID" \
  --description "Test proposal for proof verification" 2>/dev/null

echo -e "${GREEN}✅ Proposal created (ID: $PROPOSAL_ID)${NC}"

echo -e "\n${YELLOW}Step 7: Submitting real Groth16 proof${NC}"
# Proof from circuits/proof_real_test_soroban_le.json
stellar contract invoke \
  --id "$VOTING_ID" \
  --source mykey \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- vote \
  --dao_id "$DAO_ID" \
  --proposal_id "$PROPOSAL_ID" \
  --vote_choice "true" \
  --nullifier_hash "$NULLIFIER" \
  --proof_a "54f558fca3ae990d199f05f1351f7909fa4a5540936d705a6c153628fe5ab6110c12c592108e4c4d5eac2c33eddd9d3d5c568647abe791136d19f33ca3669620" \
  --proof_b "f59ab459228fa9f302e67621923bcb6bf2f5d4615def50c4b45b9c1e46c9b814f9f5e66cf599e13630ab3b7ddbdae67082f771cd5cc4bd13d0abcbcc65a02a0bc77bf2141857569cfac2acea49cfa9309954ba844018fdb3b8bf636bb8f7ea29cf2ddc1a07d0a5aa0b994aa0f3a7cfbc2fedd59ea783416758eadab66c473c1d" \
  --proof_c "a46962366b50a0c9a27e69511ae2d183bb462f43dd213ca32c8e74a86f1a3903ee2656a4bf4943f3c2efcf7b0c431aeffb80362fd7f48e33974a1b8ee5564b17" \
  --merkle_root "$ROOT"

echo -e "\n${GREEN}========================================="
echo "✅ PROOF VERIFIED SUCCESSFULLY!"
echo -e "=========================================${NC}"
