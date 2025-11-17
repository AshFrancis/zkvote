#!/bin/bash
set -e

echo "=== DaoVote Circuit Compilation ==="

# Create build directory
mkdir -p build

# Step 1: Compile circuit
echo "1. Compiling circuit..."
circom vote.circom --r1cs --wasm --sym -o build -l node_modules

# Step 2: Download Powers of Tau (if not exists)
if [ ! -f "pot20_final.ptau" ]; then
    echo "2. Downloading Powers of Tau ceremony file..."
    # For tree depth 20, we need pot20 (2^20 constraints)
    wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_20.ptau -O pot20_final.ptau
else
    echo "2. Powers of Tau file already exists"
fi

# Step 3: Generate zkey
echo "3. Generating zkey (trusted setup)..."
snarkjs groth16 setup build/vote.r1cs pot20_final.ptau build/vote_0000.zkey

# Step 4: Contribute to ceremony (in production, multiple parties would do this)
echo "4. Contributing to ceremony..."
echo "DaoVote Phase 1 Contribution" | snarkjs zkey contribute build/vote_0000.zkey build/vote_final.zkey --name="DaoVote Phase 1" -v

# Step 5: Export verification key
echo "5. Exporting verification key..."
snarkjs zkey export verificationkey build/vote_final.zkey build/verification_key.json

# Step 6: Generate Solidity verifier (for reference)
echo "6. Generating Solidity verifier..."
snarkjs zkey export solidityverifier build/vote_final.zkey build/verifier.sol

echo ""
echo "=== Compilation Complete ==="
echo "Files generated:"
echo "  - build/vote.r1cs          (constraint system)"
echo "  - build/vote.sym           (symbol file)"
echo "  - build/vote_js/           (WASM prover)"
echo "  - build/vote_final.zkey    (proving key)"
echo "  - build/verification_key.json  (verification key for on-chain)"
echo ""
echo "Verification key needs to be converted to Soroban format for on-chain verification"
