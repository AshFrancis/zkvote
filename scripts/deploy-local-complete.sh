#!/bin/bash
set -e

echo "=== Complete DaoVote Deployment Script ==="
echo "This script will:"
echo "1. Build all contracts"
echo "2. Deploy all contracts to local futurenet"
echo "3. Generate and build TypeScript bindings"
echo "4. Update frontend and backend configuration"
echo ""

# Configuration
# NOTE: We deploy to HOSTED FUTURENET, not local futurenet
KEY_NAME="${KEY_NAME:-mykey}"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

step() {
  echo -e "${BLUE}==>${NC} $1"
}

success() {
  echo -e "${GREEN}✓${NC} $1"
}

warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

error() {
  echo -e "${RED}✗${NC} $1"
}

# Step 0: Cleanup - Stop services and clear databases
step "Stopping existing services and clearing databases..."

# Kill any running relayer processes
RELAYER_PIDS=$(pgrep -f "node.*relayer.js" || true)
if [ -n "$RELAYER_PIDS" ]; then
  echo "Stopping relayer processes: $RELAYER_PIDS"
  kill $RELAYER_PIDS 2>/dev/null || true
  sleep 2
fi

# Kill any running frontend dev server
VITE_PIDS=$(pgrep -f "vite" || true)
if [ -n "$VITE_PIDS" ]; then
  echo "Stopping frontend dev server: $VITE_PIDS"
  kill $VITE_PIDS 2>/dev/null || true
  sleep 1
fi

# Clear all backend databases
if [ -d "backend/data" ]; then
  echo "Clearing backend databases..."
  rm -f backend/data/*.db 2>/dev/null || true
  rm -f backend/data/*.json 2>/dev/null || true
fi

# Clear frontend cache
if [ -d "frontend/node_modules/.vite" ]; then
  echo "Clearing frontend Vite cache..."
  rm -rf frontend/node_modules/.vite
fi

success "Cleanup complete"

RPC_URL="${RPC_URL:-https://rpc-futurenet.stellar.org}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Future Network ; October 2022}"

# Step 1: Build contracts
step "Building all contracts..."
cargo build --target wasm32v1-none --release
success "Contracts built successfully"

# Step 2: Deploy contracts
step "Deploying contracts to local futurenet..."

# Deploy DAO Registry
echo "Deploying DAO Registry..."
REGISTRY_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/dao_registry.wasm \
  --source $KEY_NAME \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" 2>&1 | tail -1)
success "DAO Registry deployed: $REGISTRY_ID"

# Deploy Membership SBT
echo "Deploying Membership SBT..."
SBT_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/membership_sbt.wasm \
  --source $KEY_NAME \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  --registry "$REGISTRY_ID" 2>&1 | grep -E '^C[A-Z0-9]{55}$' | tail -1)
success "Membership SBT deployed: $SBT_ID"

# Deploy Membership Tree
echo "Deploying Membership Tree..."
TREE_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/membership_tree.wasm \
  --source $KEY_NAME \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  --sbt_contract "$SBT_ID" 2>&1 | grep -E '^C[A-Z0-9]{55}$' | tail -1)
success "Membership Tree deployed: $TREE_ID"

# Deploy Voting
echo "Deploying Voting..."
VOTING_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/voting.wasm \
  --source $KEY_NAME \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  --tree_contract "$TREE_ID" 2>&1 | grep -E '^C[A-Z0-9]{55}$' | tail -1)
success "Voting deployed: $VOTING_ID"

# Deploy Comments
echo "Deploying Comments..."
COMMENTS_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/comments.wasm \
  --source $KEY_NAME \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  --voting_contract "$VOTING_ID" \
  --tree_contract "$TREE_ID" 2>&1 | grep -E '^C[A-Z0-9]{55}$' | tail -1)
success "Comments deployed: $COMMENTS_ID"

# Verify all contracts deployed
if [ -z "$TREE_ID" ] || [ -z "$VOTING_ID" ] || [ -z "$COMMENTS_ID" ]; then
  warn "Failed to deploy all contracts. Retrying problematic deployments..."

  if [ -z "$TREE_ID" ]; then
    echo "Retrying Membership Tree deployment..."
    TREE_ID=$(stellar contract deploy \
      --wasm target/wasm32v1-none/release/membership_tree.wasm \
      --source $KEY_NAME \
      --rpc-url "$RPC_URL" \
      --network-passphrase "$NETWORK_PASSPHRASE" \
      -- \
      --sbt_contract "$SBT_ID" 2>&1 | grep '^C' | grep -v 'ℹ️' | tail -1)
  fi

  if [ -z "$VOTING_ID" ]; then
    echo "Retrying Voting deployment..."
    VOTING_ID=$(stellar contract deploy \
      --wasm target/wasm32v1-none/release/voting.wasm \
      --source $KEY_NAME \
      --rpc-url "$RPC_URL" \
      --network-passphrase "$NETWORK_PASSPHRASE" \
      -- \
      --tree_contract "$TREE_ID" 2>&1 | grep '^C' | grep -v 'ℹ️' | tail -1)
  fi

  if [ -z "$COMMENTS_ID" ]; then
    echo "Retrying Comments deployment..."
    COMMENTS_ID=$(stellar contract deploy \
      --wasm target/wasm32v1-none/release/comments.wasm \
      --source $KEY_NAME \
      --rpc-url "$RPC_URL" \
      --network-passphrase "$NETWORK_PASSPHRASE" \
      -- \
      --voting_contract "$VOTING_ID" \
      --tree_contract "$TREE_ID" 2>&1 | grep '^C' | grep -v 'ℹ️' | tail -1)
  fi
fi

# Step 3: Generate TypeScript bindings
step "Generating TypeScript bindings..."
rm -rf frontend/src/contracts
mkdir -p frontend/src/contracts

echo "Generating DAO Registry bindings..."
stellar contract bindings typescript \
  --contract-id "$REGISTRY_ID" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --output-dir frontend/src/contracts/dao-registry \
  --overwrite
success "DAO Registry bindings generated"

echo "Generating Membership SBT bindings..."
stellar contract bindings typescript \
  --contract-id "$SBT_ID" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --output-dir frontend/src/contracts/membership-sbt \
  --overwrite
success "Membership SBT bindings generated"

echo "Generating Membership Tree bindings..."
stellar contract bindings typescript \
  --contract-id "$TREE_ID" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --output-dir frontend/src/contracts/membership-tree \
  --overwrite
success "Membership Tree bindings generated"

echo "Generating Voting bindings..."
stellar contract bindings typescript \
  --contract-id "$VOTING_ID" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --output-dir frontend/src/contracts/voting \
  --overwrite
success "Voting bindings generated"

echo "Generating Comments bindings..."
stellar contract bindings typescript \
  --contract-id "$COMMENTS_ID" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --output-dir frontend/src/contracts/comments \
  --overwrite
success "Comments bindings generated"

# Step 3.5: Build bindings
step "Building TypeScript bindings..."
echo "Building DAO Registry bindings..."
(cd frontend/src/contracts/dao-registry && npm install --silent && npm run build) > /dev/null 2>&1
success "DAO Registry bindings built"

echo "Building Membership SBT bindings..."
(cd frontend/src/contracts/membership-sbt && npm install --silent && npm run build) > /dev/null 2>&1
success "Membership SBT bindings built"

echo "Building Membership Tree bindings..."
(cd frontend/src/contracts/membership-tree && npm install --silent && npm run build) > /dev/null 2>&1
success "Membership Tree bindings built"

echo "Building Voting bindings..."
(cd frontend/src/contracts/voting && npm install --silent && npm run build) > /dev/null 2>&1
success "Voting bindings built"

echo "Building Comments bindings..."
(cd frontend/src/contracts/comments && npm install --silent && npm run build) > /dev/null 2>&1
success "Comments bindings built"

# Step 3.6: Create Public DAO (always DAO #1) with verification and retries
step "Creating Public DAO..."
ADMIN_ADDRESS=$(stellar keys address "$KEY_NAME")

# Helper function to verify DAO exists by querying get_dao_count
verify_dao_count() {
  local expected=$1
  local count_output
  count_output=$(stellar contract invoke \
    --id "$REGISTRY_ID" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --source "$KEY_NAME" \
    -- get_dao_count 2>&1)
  # Extract just the number from output
  local count
  count=$(echo "$count_output" | grep -oE '^[0-9]+$' | head -1)
  [ "$count" = "$expected" ]
}

# Helper function to verify tree is initialized
verify_tree_initialized() {
  local dao_id=$1
  local root_output
  root_output=$(stellar contract invoke \
    --id "$TREE_ID" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --source "$KEY_NAME" \
    -- get_root \
    --dao_id "$dao_id" 2>&1)
  # If we get a hex string back (not an error), tree is initialized
  echo "$root_output" | grep -qE '^[0-9]+$|^0x[a-fA-F0-9]+$'
}

# Helper function to verify VK is set
verify_vk_set() {
  local dao_id=$1
  local vk_output
  vk_output=$(stellar contract invoke \
    --id "$VOTING_ID" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --source "$KEY_NAME" \
    -- get_vk_version \
    --dao_id "$dao_id" 2>&1)
  local version
  version=$(echo "$vk_output" | grep -oE '^[0-9]+$' | head -1)
  [ -n "$version" ] && [ "$version" -gt 0 ]
}

# Create DAO with retries
MAX_RETRIES=3
DAO_CREATED=false
DAO_ID=""

for i in $(seq 1 $MAX_RETRIES); do
  echo "Creating Public Votes DAO (attempt $i/$MAX_RETRIES)..."
  CREATE_OUTPUT=$(stellar contract invoke \
    --id "$REGISTRY_ID" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --source "$KEY_NAME" \
    -- create_dao \
    --name "Public Votes" \
    --creator "$ADMIN_ADDRESS" \
    --membership_open true \
    --members_can_propose true 2>&1)

  # Check for errors in output
  if echo "$CREATE_OUTPUT" | grep -qi "error\|failed\|panic"; then
    warn "DAO creation returned error: $CREATE_OUTPUT"
    sleep 2
    continue
  fi

  # Extract DAO ID from output
  DAO_ID=$(echo "$CREATE_OUTPUT" | grep -oE '^[0-9]+$' | head -1)
  if [ -z "$DAO_ID" ]; then
    DAO_ID=$(echo "$CREATE_OUTPUT" | grep -oE '"[0-9]+"' | tr -d '"' | head -1)
  fi

  # Verify by querying dao count
  sleep 2  # Wait for transaction to finalize
  if verify_dao_count "1"; then
    DAO_ID="1"
    DAO_CREATED=true
    break
  else
    warn "DAO count verification failed, retrying..."
  fi
done

if [ "$DAO_CREATED" = false ]; then
  error "Failed to create Public DAO after $MAX_RETRIES attempts"
  error "Please check the contract deployment and try again"
  exit 1
fi

success "Public DAO created and verified (ID: $DAO_ID)"

# Initialize tree with retries
TREE_INIT=false
for i in $(seq 1 $MAX_RETRIES); do
  echo "Initializing merkle tree (attempt $i/$MAX_RETRIES)..."
  TREE_OUTPUT=$(stellar contract invoke \
    --id "$TREE_ID" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --source "$KEY_NAME" \
    -- init_tree_from_registry \
    --dao_id "$DAO_ID" \
    --depth 18 2>&1)

  # Check for "already initialized" which is OK
  if echo "$TREE_OUTPUT" | grep -qi "already initialized\|TreeAlreadyInit"; then
    success "Merkle tree already initialized"
    TREE_INIT=true
    break
  fi

  # Check for errors
  if echo "$TREE_OUTPUT" | grep -qi "error\|failed\|panic"; then
    warn "Tree init returned: $TREE_OUTPUT"
    sleep 2
    continue
  fi

  # Verify tree is initialized
  sleep 2
  if verify_tree_initialized "$DAO_ID"; then
    TREE_INIT=true
    break
  else
    warn "Tree verification failed, retrying..."
  fi
done

if [ "$TREE_INIT" = false ]; then
  error "Failed to initialize merkle tree after $MAX_RETRIES attempts"
  exit 1
fi

success "Merkle tree initialized (depth 18, capacity 262,144)"

# Set verification key with retries
VK_FILE="frontend/src/lib/verification_key_soroban.json"
if [ ! -f "$VK_FILE" ]; then
  warn "Verification key file not found at $VK_FILE"
  warn "You'll need to set it manually through the frontend UI"
else
  VK_JSON=$(cat "$VK_FILE")
  VK_SET=false

  for i in $(seq 1 $MAX_RETRIES); do
    echo "Setting verification key (attempt $i/$MAX_RETRIES)..."
    VK_OUTPUT=$(stellar contract invoke \
      --id "$VOTING_ID" \
      --rpc-url "$RPC_URL" \
      --network-passphrase "$NETWORK_PASSPHRASE" \
      --source "$KEY_NAME" \
      -- set_vk \
      --dao_id "$DAO_ID" \
      --vk "$VK_JSON" \
      --admin "$ADMIN_ADDRESS" 2>&1)

    # Check for errors
    if echo "$VK_OUTPUT" | grep -qi "error\|failed\|panic"; then
      warn "VK set returned: $VK_OUTPUT"
      sleep 2
      continue
    fi

    # Verify VK is set
    sleep 2
    if verify_vk_set "$DAO_ID"; then
      VK_SET=true
      break
    else
      warn "VK verification failed, retrying..."
    fi
  done

  if [ "$VK_SET" = false ]; then
    error "Failed to set verification key after $MAX_RETRIES attempts"
    exit 1
  fi

  success "Verification key set for Public DAO"
fi

# Step 4: Update frontend configuration
step "Updating frontend configuration..."
cat > frontend/src/config/contracts.ts << EOF
// Deployed contract addresses and network configuration
// Auto-generated by scripts/deploy-local-complete.sh on $(date)

export const CONTRACTS = {
  REGISTRY_ID: "$REGISTRY_ID",
  SBT_ID: "$SBT_ID",
  TREE_ID: "$TREE_ID",
  VOTING_ID: "$VOTING_ID",
  COMMENTS_ID: "$COMMENTS_ID",
} as const;

export const NETWORK_CONFIG = {
  rpcUrl: "$RPC_URL",
  networkPassphrase: "$NETWORK_PASSPHRASE",
  networkName: "futurenet-local",
} as const;

// Contract method names for type safety
export const CONTRACT_METHODS = {
  REGISTRY: {
    CREATE_DAO: "create_dao",
    GET_DAO: "get_dao",
    CREATE_AND_INIT_DAO: "create_and_init_dao",
    CREATE_AND_INIT_DAO_NO_REG: "create_and_init_dao_no_reg",
  },
  SBT: {
    MINT: "mint",
    MINT_FROM_REGISTRY: "mint_from_registry",
    HAS: "has",
  },
  TREE: {
    INIT_TREE: "init_tree",
    REGISTER_WITH_CALLER: "register_with_caller",
    GET_ROOT: "get_root",
  },
  VOTING: {
    SET_VK: "set_vk",
    CREATE_PROPOSAL: "create_proposal",
    VOTE: "vote",
    GET_PROPOSAL: "get_proposal",
    GET_RESULTS: "get_results",
  },
} as const;
EOF
success "Frontend configuration updated"

# Step 5: Update backend .env file
step "Updating backend configuration..."

# Preserve existing values from backend/.env if they exist
if [ -f "backend/.env" ]; then
  EXISTING_RELAYER_SECRET=$(grep '^RELAYER_SECRET_KEY=' backend/.env | cut -d'=' -f2-)
  EXISTING_PINATA_JWT=$(grep '^PINATA_JWT=' backend/.env | cut -d'=' -f2-)
  EXISTING_PINATA_GATEWAY=$(grep '^PINATA_GATEWAY=' backend/.env | cut -d'=' -f2-)
  EXISTING_CORS=$(grep '^CORS_ORIGIN=' backend/.env | cut -d'=' -f2-)
fi

# Use existing values or defaults
RELAYER_SECRET="${EXISTING_RELAYER_SECRET:-${RELAYER_SECRET_KEY:-REPLACE_ME_RELAYER_SECRET}}"
CORS_ORIGINS="${EXISTING_CORS:-http://localhost:5173,http://localhost:5174}"

cat > backend/.env << EOF
# DaoVote Relayer Configuration
# Auto-generated by scripts/deploy-local-complete.sh on $(date)

# Network Configuration
SOROBAN_RPC_URL=$RPC_URL
NETWORK_PASSPHRASE=$NETWORK_PASSPHRASE

# Relayer Account
RELAYER_SECRET_KEY=$RELAYER_SECRET

# Contract Addresses
VOTING_CONTRACT_ID=$VOTING_ID
TREE_CONTRACT_ID=$TREE_ID
COMMENTS_CONTRACT_ID=$COMMENTS_ID

# Server Configuration
PORT=3001

# CORS Configuration
CORS_ORIGIN=$CORS_ORIGINS
EOF

# Append Pinata config if it existed
if [ -n "$EXISTING_PINATA_JWT" ]; then
  cat >> backend/.env << EOF

# Pinata IPFS Configuration
PINATA_JWT=$EXISTING_PINATA_JWT
EOF
fi

if [ -n "$EXISTING_PINATA_GATEWAY" ]; then
  cat >> backend/.env << EOF
PINATA_GATEWAY=$EXISTING_PINATA_GATEWAY
EOF
fi

success "Backend configuration updated"

# Step 6: Restart relayer if running
step "Restarting relayer (if running)..."
# Find and kill any running relayer processes
RELAYER_PIDS=$(pgrep -f "node src/relayer.js" || true)
if [ -n "$RELAYER_PIDS" ]; then
  echo "Stopping existing relayer processes: $RELAYER_PIDS"
  kill $RELAYER_PIDS 2>/dev/null || true
  sleep 1
  success "Relayer stopped"
else
  echo "No running relayer found"
fi

# Summary
echo ""
echo -e "${GREEN}=== Deployment Complete! ===${NC}"
echo ""
echo "Contract Addresses:"
echo "  DAO Registry:    $REGISTRY_ID"
echo "  Membership SBT:  $SBT_ID"
echo "  Membership Tree: $TREE_ID"
echo "  Voting:          $VOTING_ID"
echo "  Comments:        $COMMENTS_ID"
echo ""
echo "Next steps:"
echo "  1. Start the relayer: cd backend && npm run relayer"
echo "  2. Start the frontend: cd frontend && npm run dev"
echo ""
