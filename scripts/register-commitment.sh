#!/bin/bash
# Register a commitment in the Merkle tree
# Usage: ./scripts/register-commitment.sh <DAO_ID> <SECRET> <SALT>

set -e

if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
  echo "Usage: $0 <DAO_ID> <SECRET> <SALT>"
  echo "Example: $0 1 12345 67890"
  exit 1
fi

DAO_ID=$1
SECRET=$2
SALT=$3
KEY_NAME=${KEY_NAME:-mykey}

echo "Computing commitment = Poseidon($SECRET, $SALT)..."

# We need to compute Poseidon hash. For now, let's use a Node.js script
cd circuits
node -e "
const { buildPoseidon } = require('circomlibjs');

(async () => {
  const poseidon = await buildPoseidon();
  const commitment = poseidon.F.toString(poseidon([BigInt('$SECRET'), BigInt('$SALT')]));
  console.log('Commitment:', commitment);

  // Also save to file for later use
  require('fs').writeFileSync('../.last-commitment', JSON.stringify({
    secret: '$SECRET',
    salt: '$SALT',
    commitment,
    daoId: '$DAO_ID'
  }));
})();
" > /tmp/commitment.txt

COMMITMENT=$(grep "Commitment:" /tmp/commitment.txt | cut -d' ' -f2)
cd ..

echo "Commitment: $COMMITMENT"
echo ""

# Load contract IDs
source .deployed-contracts

# Get user's address
USER_ADDRESS=$(stellar keys address "$KEY_NAME")

echo "Registering commitment for $USER_ADDRESS in DAO $DAO_ID..."

stellar contract invoke \
  --id "$TREE_ID" \
  --source "$KEY_NAME" \
  --rpc-url "http://localhost:8000/soroban/rpc" \
  --network-passphrase "Test SDF Future Network ; October 2022" \
  -- \
  register_with_caller \
  --dao_id "$DAO_ID" \
  --commitment "$COMMITMENT" \
  --caller "$USER_ADDRESS"

echo ""
echo "✓ Commitment registered successfully!"
echo "Secret: $SECRET"
echo "Salt: $SALT"
echo "Commitment: $COMMITMENT"
echo ""
echo "Save these values - you'll need them to vote!"
