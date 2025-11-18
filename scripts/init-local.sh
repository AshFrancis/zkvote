#!/bin/bash
# Configure DaoVote backend after deployment
# Run after deploy-local.sh

set -e

echo "=== DaoVote Backend Configuration ==="

# Load contract IDs
if [ ! -f ".contract-ids.local" ]; then
    echo "Error: .contract-ids.local not found. Run deploy-local.sh first."
    exit 1
fi

source .contract-ids.local

# Configuration
RELAYER_KEY="${RELAYER_KEY:-relayer}"

echo "Network: $NETWORK"
echo "Contract IDs:"
echo "  Registry: $REGISTRY_ID"
echo "  SBT: $SBT_ID"
echo "  Tree: $TREE_ID"
echo "  Voting: $VOTING_ID"
echo ""

# Generate or use existing relayer key
echo "=== Relayer Account Setup ==="
if stellar keys address "$RELAYER_KEY" &>/dev/null; then
    echo "Using existing relayer key: $RELAYER_KEY"
    RELAYER_ADDRESS=$(stellar keys address "$RELAYER_KEY")
else
    echo "Generating new relayer key: $RELAYER_KEY"
    stellar keys generate "$RELAYER_KEY" --no-fund
    RELAYER_ADDRESS=$(stellar keys address "$RELAYER_KEY")
    echo "Generated relayer address: $RELAYER_ADDRESS"
fi

# Fund relayer account if on local network
if [ "$NETWORK" == "local" ]; then
    echo "Funding relayer account on local network..."
    if stellar keys fund "$RELAYER_KEY" --network "$NETWORK" 2>&1 | grep -q "funded"; then
        echo "✓ Relayer account funded"
    else
        echo "Warning: Could not fund relayer account. Fund manually with:"
        echo "  stellar keys fund $RELAYER_KEY --network $NETWORK"
    fi
fi

# Get relayer secret key
RELAYER_SECRET=$(stellar keys show "$RELAYER_KEY")

# Determine RPC URL and passphrase based on network
if [ "$NETWORK" == "local" ]; then
    RPC_URL="http://localhost:8000/soroban/rpc"
    PASSPHRASE="Standalone Network ; February 2017"
else
    RPC_URL="https://rpc-futurenet.stellar.org:443"
    PASSPHRASE="Test SDF Future Network ; October 2022"
fi

# Create backend .env
echo ""
echo "=== Creating backend/.env ==="
cat > backend/.env << EOF
# DaoVote Relayer Configuration
# Generated: $(date)
# Network: $NETWORK

# Network Configuration
SOROBAN_RPC_URL=$RPC_URL
NETWORK_PASSPHRASE=$PASSPHRASE

# Relayer Account
# WARNING: Keep this secret secure! Never commit to version control.
RELAYER_SECRET_KEY=$RELAYER_SECRET

# Contract Addresses
VOTING_CONTRACT_ID=$VOTING_ID
TREE_CONTRACT_ID=$TREE_ID

# Server Configuration
PORT=3001
EOF

echo "✓ Backend configuration created at backend/.env"
echo ""
echo "⚠️  SECURITY WARNING:"
echo "  - backend/.env contains sensitive keys"
echo "  - Never commit this file to version control"
echo "  - backend/.env is in .gitignore"
echo ""
echo "=== Configuration Complete ==="
echo ""
echo "Relayer account: $RELAYER_ADDRESS"
echo "Voting contract: $VOTING_ID"
echo "Tree contract: $TREE_ID"
echo ""
echo "Next steps:"
echo "  1. cd backend && npm install"
echo "  2. npm run dev"
echo "  3. Test with: curl http://localhost:3001/health"
