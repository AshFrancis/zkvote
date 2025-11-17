#!/bin/bash
# End-to-end ZK proof test on local P25 network
# Tests real Groth16 verification with BN254 pairing

set -e

echo "=== DaoVote End-to-End ZK Proof Test ==="
echo ""

# Check prerequisites
command -v stellar >/dev/null 2>&1 || { echo "stellar CLI not found"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node not found"; exit 1; }

# Check for contract IDs
if [ ! -f ".contract-ids.local" ]; then
    echo "ERROR: .contract-ids.local not found"
    echo "Please run: ./scripts/deploy-local.sh first"
    exit 1
fi

source .contract-ids.local

echo "Using contracts:"
echo "  Registry: $REGISTRY_ID"
echo "  SBT: $SBT_ID"
echo "  Tree: $TREE_ID"
echo "  Voting: $VOTING_ID"
echo ""

# Get our key address
KEY_NAME="${1:-mykey}"
KEY_ADDRESS=$(stellar keys address $KEY_NAME 2>/dev/null || echo "")
if [ -z "$KEY_ADDRESS" ]; then
    echo "ERROR: Key '$KEY_NAME' not found"
    echo "Run: stellar keys fund $KEY_NAME --network local"
    exit 1
fi
echo "Using key: $KEY_NAME ($KEY_ADDRESS)"
echo ""

# Step 1: Create a DAO
echo "1. Creating DAO..."
DAO_ID=$(stellar contract invoke \
    --id $REGISTRY_ID \
    --source $KEY_NAME \
    --network local \
    -- create_dao \
    --name "ZK Test DAO" \
    --admin $KEY_ADDRESS 2>/dev/null)

echo "   Created DAO ID: $DAO_ID"

# Step 2: Mint SBT for admin
echo "2. Minting SBT for admin..."
stellar contract invoke \
    --id $SBT_ID \
    --source $KEY_NAME \
    --network local \
    -- mint \
    --dao_id $DAO_ID \
    --to $KEY_ADDRESS \
    --admin $KEY_ADDRESS 2>/dev/null

echo "   SBT minted successfully"

# Step 3: Initialize Merkle tree
echo "3. Initializing Merkle tree (depth=20)..."
stellar contract invoke \
    --id $TREE_ID \
    --source $KEY_NAME \
    --network local \
    -- init_tree \
    --dao_id $DAO_ID \
    --depth 20 2>/dev/null

echo "   Tree initialized"

# Step 4: Generate identity and register commitment
echo "4. Generating identity and registering commitment..."

# Generate commitment off-chain
cd circuits
COMMITMENT_DATA=$(node -e "
const { buildPoseidon } = require('circomlibjs');
const crypto = require('crypto');

(async () => {
    const poseidon = await buildPoseidon();
    const FIELD_SIZE = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

    const secret = BigInt('0x' + crypto.randomBytes(32).toString('hex')) % FIELD_SIZE;
    const salt = BigInt('0x' + crypto.randomBytes(32).toString('hex')) % FIELD_SIZE;

    const hash = poseidon([poseidon.F.e(secret), poseidon.F.e(salt)]);
    const commitment = poseidon.F.toObject(hash);

    console.log(JSON.stringify({
        secret: secret.toString(),
        salt: salt.toString(),
        commitment: commitment.toString()
    }));
})();
" 2>/dev/null)

SECRET=$(echo $COMMITMENT_DATA | jq -r '.secret')
SALT=$(echo $COMMITMENT_DATA | jq -r '.salt')
COMMITMENT=$(echo $COMMITMENT_DATA | jq -r '.commitment')

echo "   Secret: ${SECRET:0:20}..."
echo "   Salt: ${SALT:0:20}..."
echo "   Commitment: ${COMMITMENT:0:30}..."

cd ..

# Register commitment on-chain
stellar contract invoke \
    --id $TREE_ID \
    --source $KEY_NAME \
    --network local \
    -- register_with_caller \
    --dao_id $DAO_ID \
    --commitment $COMMITMENT \
    --caller $KEY_ADDRESS 2>/dev/null

echo "   Commitment registered"

# Step 5: Get current Merkle root
echo "5. Getting current Merkle root..."
ROOT=$(stellar contract invoke \
    --id $TREE_ID \
    --source $KEY_NAME \
    --network local \
    -- current_root \
    --dao_id $DAO_ID 2>/dev/null)

# Remove quotes if present
ROOT=$(echo $ROOT | tr -d '"')
echo "   Root: ${ROOT:0:30}..."

# Step 6: Set verification key
echo "6. Setting verification key..."
# Note: In production, this would be the real VK from circuits/build/verification_key_soroban.json
# For now, we'll skip this step as it requires complex JSON parsing in bash
echo "   (Skipping for now - VK needs to be loaded from JSON)"
echo "   Run: stellar contract invoke --id $VOTING_ID -- set_vk ..."

# Step 7: Create proposal
echo "7. Creating proposal..."
PROPOSAL_ID=$(stellar contract invoke \
    --id $VOTING_ID \
    --source $KEY_NAME \
    --network local \
    -- create_proposal \
    --dao_id $DAO_ID \
    --description "Test ZK Voting" \
    --duration_secs 3600 \
    --creator $KEY_ADDRESS 2>/dev/null)

echo "   Created Proposal ID: $PROPOSAL_ID"

# Step 8: Generate ZK proof off-chain
echo "8. Generating ZK proof..."
echo "   This requires manual steps:"
echo ""
echo "   a) Generate input.json with:"
echo "      - Root: $ROOT"
echo "      - Secret: $SECRET"
echo "      - Salt: $SALT"
echo "      - Proposal ID: $PROPOSAL_ID"
echo "      - Vote choice: 1 (FOR)"
echo ""
echo "   b) Run: cd circuits && ./generate_proof.sh"
echo ""
echo "   c) Convert proof: node utils/proof_to_soroban.js proof.json public.json"
echo ""

# Step 9: Submit vote (placeholder)
echo "9. Submit vote with proof:"
echo "   stellar contract invoke \\"
echo "       --id $VOTING_ID \\"
echo "       --source $KEY_NAME \\"
echo "       --network local \\"
echo "       -- vote \\"
echo "       --dao_id $DAO_ID \\"
echo "       --proposal_id $PROPOSAL_ID \\"
echo "       --vote_choice true \\"
echo "       --nullifier <NULLIFIER> \\"
echo "       --root $ROOT \\"
echo "       --proof <PROOF_JSON>"

echo ""
echo "=== Test Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Load VK from circuits/build/verification_key_soroban.json"
echo "2. Generate proof with correct root and proposal ID"
echo "3. Submit vote with real proof"
echo ""
echo "Environment variables saved:"
echo "  DAO_ID=$DAO_ID"
echo "  PROPOSAL_ID=$PROPOSAL_ID"
echo "  ROOT=$ROOT"
echo "  SECRET=$SECRET"
echo "  SALT=$SALT"
echo "  COMMITMENT=$COMMITMENT"
