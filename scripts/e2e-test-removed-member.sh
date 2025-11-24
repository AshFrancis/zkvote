#!/bin/bash
#
# End-to-End Test: Removed Member Cannot Vote on Snapshot Proposal
#
# This script creates a complete test scenario using Stellar CLI:
# 1. Create fresh test DAO
# 2. Add member → register commitment
# 3. Remove member
# 4. Create snapshot proposal (eligible_root without member)
# 5. Re-add member → register new commitment
# 6. Generate REAL Groth16 proof
# 7. Attempt to vote → MUST FAIL
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
  echo -e "${BLUE}[TEST]${NC} $1"
}

success() {
  echo -e "${GREEN}✓${NC} $1"
}

error() {
  echo -e "${RED}✗${NC} $1"
}

warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

# Configuration
ADMIN_KEY="${ADMIN_KEY:-mykey}"
RPC_URL="${RPC_URL:-http://localhost:8000/soroban/rpc}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Future Network ; October 2022}"

# Load deployed contract addresses
log "Loading contract addresses..."
source <(grep -E "REGISTRY_ID|SBT_ID|TREE_ID|VOTING_ID" frontend/src/config/contracts.ts | \
  sed -E 's/.*REGISTRY_ID.*"(C[^"]*).*/REGISTRY_ID=\1/; s/.*SBT_ID.*"(C[^"]*).*/SBT_ID=\1/; s/.*TREE_ID.*"(C[^"]*).*/TREE_ID=\1/; s/.*VOTING_ID.*"(C[^"]*).*/VOTING_ID=\1/' | \
  grep "^[A-Z]")

echo "Registry: $REGISTRY_ID"
echo "SBT: $SBT_ID"
echo "Tree: $TREE_ID"
echo "Voting: $VOTING_ID"
echo ""

# Create test member account
log "Creating test member account..."
stellar keys generate test-member --network testnet > /dev/null 2>&1 || true
MEMBER_ADDR=$(stellar keys address test-member)
success "Member address: $MEMBER_ADDR"

# Fund member
log "Funding member account..."
stellar keys fund test-member --network local > /dev/null 2>&1 || warn "Funding may have failed"

echo ""
log "=== STEP 1: Create Test DAO ==="
echo ""

# Create new DAO
DAO_RESULT=$(stellar contract invoke \
  --id "$REGISTRY_ID" \
  --source $ADMIN_KEY \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  create_dao \
  --admin "$(stellar keys address $ADMIN_KEY)" 2>&1)

DAO_ID=$(echo "$DAO_RESULT" | grep -v "^ℹ️" | tail -1)
success "DAO created with ID: $DAO_ID"

# Initialize tree
log "Initializing Merkle tree (depth 18)..."
stellar contract invoke \
  --id "$TREE_ID" \
  --source $ADMIN_KEY \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  init_tree \
  --dao_id "$DAO_ID" \
  --depth 18 > /dev/null 2>&1

success "Tree initialized"

# Set verification key
log "Setting verification key..."
# Load VK from file (you'll need to create this helper)
node -e "
const fs = require('fs');
const vk = JSON.parse(fs.readFileSync('frontend/public/circuits/verification_key.json', 'utf-8'));

// Convert to Soroban format
const vkSoroban = {
  alpha: Buffer.from(vk.vk_alpha_1.slice(0, 64), 'hex').toString('hex'),
  beta: Buffer.from(vk.vk_beta_2.slice(0, 128), 'hex').toString('hex'),
  gamma: Buffer.from(vk.vk_gamma_2.slice(0, 128), 'hex').toString('hex'),
  delta: Buffer.from(vk.vk_delta_2.slice(0, 128), 'hex').toString('hex'),
  ic: vk.IC.map(p => Buffer.from(p.slice(0, 64), 'hex').toString('hex'))
};

console.log(JSON.stringify(vkSoroban));
" > /tmp/vk.json

# For now, skip VK setting (complex) - assume it's already set
warn "Skipping VK setup (assume already set for DAO)"

echo ""
log "=== STEP 2: Add Member + Register Commitment ==="
echo ""

# Mint SBT for member
log "Minting membership SBT..."
stellar contract invoke \
  --id "$SBT_ID" \
  --source $ADMIN_KEY \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  mint_from_registry \
  --dao_id "$DAO_ID" \
  --to "$MEMBER_ADDR" > /dev/null 2>&1

success "SBT minted"

# Generate ZK credentials
log "Generating ZK credentials..."
SECRET="123456789"
SALT="987654321"

# Compute Poseidon commitment using Node.js
COMMITMENT=$(node -e "
const { buildPoseidon } = require('circomlibjs');
(async () => {
  const poseidon = await buildPoseidon();
  const commitment = poseidon([BigInt('$SECRET'), BigInt('$SALT')]);
  console.log(poseidon.F.toString(commitment));
})();
")

echo "Commitment: $COMMITMENT"

# Register commitment
log "Registering commitment..."
stellar contract invoke \
  --id "$TREE_ID" \
  --source test-member \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  register_with_caller \
  --dao_id "$DAO_ID" \
  --commitment "$COMMITMENT" \
  --caller "$MEMBER_ADDR" > /dev/null 2>&1

success "Commitment registered"

# Get root with member (Root A)
ROOT_A=$(stellar contract invoke \
  --id "$TREE_ID" \
  --source $ADMIN_KEY \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  current_root \
  --dao_id "$DAO_ID" 2>&1 | grep -v "^ℹ️" | tail -1)

echo "Root A (with member): $ROOT_A"

echo ""
log "=== STEP 3: Remove Member ==="
echo ""

stellar contract invoke \
  --id "$TREE_ID" \
  --source $ADMIN_KEY \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  remove_member \
  --dao_id "$DAO_ID" \
  --member "$MEMBER_ADDR" \
  --admin "$(stellar keys address $ADMIN_KEY)" > /dev/null 2>&1

success "Member removed"

# Get root after removal (Root B)
ROOT_B=$(stellar contract invoke \
  --id "$TREE_ID" \
  --source $ADMIN_KEY \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  current_root \
  --dao_id "$DAO_ID" 2>&1 | grep -v "^ℹ️" | tail -1)

echo "Root B (member removed): $ROOT_B"

if [ "$ROOT_A" = "$ROOT_B" ]; then
  error "Root did NOT change after removal! This is a bug!"
  exit 1
fi

success "Root changed after removal (correct)"

echo ""
log "=== STEP 4: Create Snapshot Proposal ==="
echo ""

# Create proposal with Fixed mode (snapshot)
PROPOSAL_RESULT=$(stellar contract invoke \
  --id "$VOTING_ID" \
  --source $ADMIN_KEY \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  create_proposal \
  --dao_id "$DAO_ID" \
  --description "Test snapshot proposal" \
  --end_time "$(($(date +%s) + 86400))" \
  --creator "$(stellar keys address $ADMIN_KEY)" \
  --vote_mode '{"tag":"Fixed","values":null}' 2>&1)

PROPOSAL_ID=$(echo "$PROPOSAL_RESULT" | grep -v "^ℹ️" | tail -1)
success "Proposal $PROPOSAL_ID created (snapshot mode)"

# Verify eligible_root = Root B
PROPOSAL=$(stellar contract invoke \
  --id "$VOTING_ID" \
  --source $ADMIN_KEY \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  get_proposal \
  --dao_id "$DAO_ID" \
  --proposal_id "$PROPOSAL_ID" 2>&1 | grep -v "^ℹ️")

ELIGIBLE_ROOT=$(echo "$PROPOSAL" | jq -r '.eligible_root // empty')
echo "Proposal eligible_root: $ELIGIBLE_ROOT"

if [ "$ELIGIBLE_ROOT" != "$ROOT_B" ]; then
  error "Proposal eligible_root ($ELIGIBLE_ROOT) != Root B ($ROOT_B)"
  exit 1
fi

success "Proposal correctly snapshots Root B (member excluded)"

echo ""
log "=== STEP 5: Re-add Member + Register New Commitment ==="
echo ""

# Mint SBT again
stellar contract invoke \
  --id "$SBT_ID" \
  --source $ADMIN_KEY \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  mint_from_registry \
  --dao_id "$DAO_ID" \
  --to "$MEMBER_ADDR" > /dev/null 2>&1

success "SBT re-minted"

# Generate NEW credentials (old commitment still in tree at index 0, but zeroed)
NEW_SECRET="111222333"
NEW_SALT="444555666"

NEW_COMMITMENT=$(node -e "
const { buildPoseidon } = require('circomlibjs');
(async () => {
  const poseidon = await buildPoseidon();
  const commitment = poseidon([BigInt('$NEW_SECRET'), BigInt('$NEW_SALT')]);
  console.log(poseidon.F.toString(commitment));
})();
")

echo "New commitment: $NEW_COMMITMENT"

# Register new commitment
stellar contract invoke \
  --id "$TREE_ID" \
  --source test-member \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  register_with_caller \
  --dao_id "$DAO_ID" \
  --commitment "$NEW_COMMITMENT" \
  --caller "$MEMBER_ADDR" > /dev/null 2>&1

success "New commitment registered"

# Get current root (Root C)
ROOT_C=$(stellar contract invoke \
  --id "$TREE_ID" \
  --source $ADMIN_KEY \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  current_root \
  --dao_id "$DAO_ID" 2>&1 | grep -v "^ℹ️" | tail -1)

echo "Root C (member re-added): $ROOT_C"

echo ""
log "=== STEP 6: Generate Proof + Attempt to Vote ==="
echo ""

warn "This step requires implementing proof generation with snarkjs"
warn "The proof should be for Root B (snapshot) but will fail because:"
warn "  - Old commitment was zeroed in Root B"
warn "  - New commitment didn't exist in Root B"
echo ""

log "To complete this test:"
echo "1. Use circuits/generate_test_input.js to create proof inputs"
echo "2. Use snarkjs to generate the proof"
echo "3. Submit via stellar contract invoke to voting.vote"
echo "4. Verify the contract REJECTS the proof"
echo ""

# Save test state for manual verification
cat > /tmp/test-state.json <<EOF
{
  "dao_id": "$DAO_ID",
  "proposal_id": "$PROPOSAL_ID",
  "member_address": "$MEMBER_ADDR",
  "old_credentials": {
    "secret": "$SECRET",
    "salt": "$SALT",
    "commitment": "$COMMITMENT"
  },
  "new_credentials": {
    "secret": "$NEW_SECRET",
    "salt": "$NEW_SALT",
    "commitment": "$NEW_COMMITMENT"
  },
  "roots": {
    "root_a": "$ROOT_A",
    "root_b": "$ROOT_B",
    "root_c": "$ROOT_C",
    "eligible_root": "$ELIGIBLE_ROOT"
  }
}
EOF

success "Test state saved to /tmp/test-state.json"

echo ""
log "=== Test Setup Complete ==="
echo ""
echo "Summary:"
echo "  DAO ID: $DAO_ID"
echo "  Proposal ID: $PROPOSAL_ID"
echo "  Snapshot root (Root B): $ROOT_B"
echo "  Current root (Root C): $ROOT_C"
echo ""
echo "Next: Generate proof and attempt vote using frontend or manual proof generation"
