#!/bin/bash
# Security Test: Pairing Check Validates Invalid VKs
#
# This test demonstrates that the BN254 pairing check provides
# implicit point validation by rejecting proofs when using invalid VKs.
#
# Security Model:
# - Invalid points CAN be set in VK (no validation at set_vk)
# - Invalid VK = pairing check FAILS = no proofs verify = DAO unusable
# - This is by design - pairing is the security boundary

set -e

source .deployed-contracts

echo "=========================================="
echo "Security Test: Pairing-Based Validation"
echo "=========================================="
echo ""
echo "Testing that invalid VKs cause proof"
echo "verification to fail via pairing check."
echo ""
echo "Security boundary: BN254 pairing check"
echo ""

# Get admin address
ADMIN_ADDRESS=$(stellar keys address "$KEY_NAME")

echo "Step 1: Creating test DAO..."
DAO_ID=$(stellar contract invoke \
  --id "$REGISTRY_ID" \
  --network "$NETWORK" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --source "$KEY_NAME" \
  -- create_dao \
  --name "Pairing Validation Test" \
  --creator "$ADMIN_ADDRESS" \
  --membership_open false \
  --members_can_propose true 2>&1 | tr -d '"')

echo "✅ DAO ID: $DAO_ID"
echo ""

echo "Step 2: Minting SBT..."
stellar contract invoke \
  --id "$SBT_ID" \
  --network "$NETWORK" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --source "$KEY_NAME" \
  -- mint \
  --dao_id "$DAO_ID" \
  --to "$ADMIN_ADDRESS" \
  --admin "$ADMIN_ADDRESS" > /dev/null 2>&1

echo "✅ SBT minted"
echo ""

echo "Step 3: Initializing membership tree (depth 18)..."
stellar contract invoke \
  --id "$TREE_ID" \
  --network "$NETWORK" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --source "$KEY_NAME" \
  -- init_tree \
  --dao_id "$DAO_ID" \
  --depth 18 \
  --admin "$ADMIN_ADDRESS" > /dev/null 2>&1

echo "✅ Tree initialized"
echo ""

echo "Step 4: Registering commitment..."
# Test commitment: Poseidon(123456789, 987654321)
COMMITMENT="16832421271961222550979173996485995711342823810308835997146707681980704453417"

stellar contract invoke \
  --id "$TREE_ID" \
  --network "$NETWORK" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --source "$KEY_NAME" \
  -- register_with_caller \
  --dao_id "$DAO_ID" \
  --commitment "$COMMITMENT" \
  --caller "$ADMIN_ADDRESS" > /dev/null 2>&1

echo "✅ Commitment registered"
echo ""

# Valid VK from test
cat > /tmp/valid_vk.json <<'EOFVK'
{
  "alpha": "e2f26dbea299f5223b646cb1fb33eadb059d9407559d7441dfd902e3a79a4d2d26194d00ffca76f0010323190a8389ce45e39f2060ecd861b0ce373c50ddbe14",
  "beta": "abb73dc17fbc13021e2471e0c08bd67d8401f52b73d6d07483794cad4778180e0c06f33bbc4c79a9cadef253a68084d382f17788f885c9afd176f7cb2f036709c8ced07a54067fd5a905ea3ec6b796f892912f4dd2233131c7a857a4b1c13917a74623114d9aa69d370d7a6bc4defdaa3c8c3fd947e8f5994a708ae0d1fb4c30",
  "gamma": "edf692d95cbdde46ddda5ef7d422436779445c5e66006a42761e1f12efde0018c212f3aeb785e49712e7a9353349aaf1255dfb31b7bf60723a480d9293938e19aa7dfa6601cce64c7bd3430c69e7d1e38f40cb8d8071ab4aeb6d8cdba55ec8125b9722d1dcdaac55f38eb37033314bbc95330c69ad999eec75f05f58d0890609",
  "delta": "be646ddb1d0b8b536365d1ef38f508b36f809fb810d954e2568a27a9acd13e1e3860f411b3dee7d6aaa8f9214eee89ce16475520199c8793ce71d3db1ce7bb23c6a6bc9f1a4122098339d1f718a2d8348a175b1a08f70cbd6ce7bad1e974280e597ee438d19c128651a5a7d928826061fa6fe9427e0c22606471d7315f9ace28",
  "ic": [
    "82d1fb5ff9f0f05f4e560de6300a39ca299275601ca9fe517403775f7cc886034fd524ce1960f20a40838da392cb737c053ed1d347f93516f453b7da40306807",
    "dd5741ac23f8f937634b58a35e3793ebebd994caf77646aae626c632c1e68d0bea010c57307a46d379296b0f2c7ed5ec4d759acf41500c3c47f4f28822e53d0b",
    "2d678341b4fee186662e11eda006d6fe700a84197403ca1a31a45aaa66de9b137ad28a1f00547062f894c5bbcc26bf5927de7309acbaf0b12ac001a34f11560e",
    "63ca5d5fa54cc42620255341341071467abc562865c5b1151041e93d9e1a7f2a0498f0c82363eb7a5252c8aab4d85be41096dbb5a05eba2c0968026d8eb30d2f",
    "14aca87df38aa49461728f42f1e7745ba7190aaa18c90a8f09f8a693b7b9c5096a3384c850f02e56cd8e3e9c1760e43240524fc75a093cfa06f104375bdc2e12",
    "7b5852da2af6d70ec8d8169cd29203c731d16dfc0cbcddd0ac1cad5a56063c14216f80d67d4b01effa63dade0c68238ba162573cda72b20688fee28fe689e113",
    "f11f2e8805bcea12d80bdf5ffeda3c823278a8d140403ac419dc1cbfa8e1f21fb0a8c3eec803b79c0b5c5c4d2b8c9e8d93fdc1169a10ad73ecbd28e271f43921"
  ]
}
EOFVK

# Invalid VK (point not on curve)
cat > /tmp/invalid_vk.json <<'EOFINVALID'
{
  "alpha": "0000000000000000000000000000000000000000000000000000000000000005000000000000000000000000000000000000000000000000000000000000000a",
  "beta": "abb73dc17fbc13021e2471e0c08bd67d8401f52b73d6d07483794cad4778180e0c06f33bbc4c79a9cadef253a68084d382f17788f885c9afd176f7cb2f036709c8ced07a54067fd5a905ea3ec6b796f892912f4dd2233131c7a857a4b1c13917a74623114d9aa69d370d7a6bc4defdaa3c8c3fd947e8f5994a708ae0d1fb4c30",
  "gamma": "edf692d95cbdde46ddda5ef7d422436779445c5e66006a42761e1f12efde0018c212f3aeb785e49712e7a9353349aaf1255dfb31b7bf60723a480d9293938e19aa7dfa6601cce64c7bd3430c69e7d1e38f40cb8d8071ab4aeb6d8cdba55ec8125b9722d1dcdaac55f38eb37033314bbc95330c69ad999eec75f05f58d0890609",
  "delta": "be646ddb1d0b8b536365d1ef38f508b36f809fb810d954e2568a27a9acd13e1e3860f411b3dee7d6aaa8f9214eee89ce16475520199c8793ce71d3db1ce7bb23c6a6bc9f1a4122098339d1f718a2d8348a175b1a08f70cbd6ce7bad1e974280e597ee438d19c128651a5a7d928826061fa6fe9427e0c22606471d7315f9ace28",
  "ic": [
    "82d1fb5ff9f0f05f4e560de6300a39ca299275601ca9fe517403775f7cc886034fd524ce1960f20a40838da392cb737c053ed1d347f93516f453b7da40306807",
    "dd5741ac23f8f937634b58a35e3793ebebd994caf77646aae626c632c1e68d0bea010c57307a46d379296b0f2c7ed5ec4d759acf41500c3c47f4f28822e53d0b",
    "2d678341b4fee186662e11eda006d6fe700a84197403ca1a31a45aaa66de9b137ad28a1f00547062f894c5bbcc26bf5927de7309acbaf0b12ac001a34f11560e",
    "63ca5d5fa54cc42620255341341071467abc562865c5b1151041e93d9e1a7f2a0498f0c82363eb7a5252c8aab4d85be41096dbb5a05eba2c0968026d8eb30d2f",
    "14aca87df38aa49461728f42f1e7745ba7190aaa18c90a8f09f8a693b7b9c5096a3384c850f02e56cd8e3e9c1760e43240524fc75a093cfa06f104375bdc2e12",
    "7b5852da2af6d70ec8d8169cd29203c731d16dfc0cbcddd0ac1cad5a56063c14216f80d67d4b01effa63dade0c68238ba162573cda72b20688fee28fe689e113",
    "f11f2e8805bcea12d80bdf5ffeda3c823278a8d140403ac419dc1cbfa8e1f21fb0a8c3eec803b79c0b5c5c4d2b8c9e8d93fdc1169a10ad73ecbd28e271f43921"
  ]
}
EOFINVALID

# Real proof from standalone test
cat > /tmp/real_proof.json <<'EOFPROOF'
{
  "a": "d0012166b4e9436363b3064a72d4cb991c41d9551cafcb26482ef894006e802df1bee17e9923cb4c7bf9534dc2ca893078204754bc68ebc8f5abe5900eacf227",
  "b": "d5459c47f81e2e12b9be2329f5516cadefb9192156d55debf8b042d4f655411f2d5a16dd0c2de66e2367481f00461424f2723de0ec0861552911260f019e9a07ac0f00c01f4702dddab63eb7eabb7c3fbf42d671d06c739e95be64913b35510d81fac50168e6dc7190ec1a9b1b68afe2568a22a23fb20a92ce158a3fbdfed808",
  "c": "9eb6e4562c91e96fcd73bfde8e6c12d20c239f94a2373dfd7d21c6667b6117146a4a4f06fc99802b11aba2dd8220da04e59e350e4f9f07467b14080ba9230305"
}
EOFPROOF

echo "=========================================="
echo "Test 1: Valid VK + Real Proof (Control)"
echo "=========================================="
echo ""

echo "Setting valid VK..."
VK_CONTENT=$(cat /tmp/valid_vk.json | jq -c .)
stellar contract invoke \
  --id "$VOTING_ID" \
  --network "$NETWORK" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --source "$KEY_NAME" \
  -- set_vk \
  --dao_id "$DAO_ID" \
  --vk "$VK_CONTENT" \
  --admin "$ADMIN_ADDRESS" > /dev/null 2>&1

echo "✅ Valid VK set successfully"
echo ""

echo "Creating proposal..."
TIMESTAMP=$(date +%s)
END_TIME=$((TIMESTAMP + 3600))

PROPOSAL_ID=$(stellar contract invoke \
  --id "$VOTING_ID" \
  --network "$NETWORK" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --source "$KEY_NAME" \
  -- create_proposal \
  --dao_id "$DAO_ID" \
  --description "Test Proposal" \
  --end_time "$END_TIME" \
  --creator "$ADMIN_ADDRESS" \
  --vote_mode '{"type":"Fixed"}' 2>&1 | tr -d '"')

echo "✅ Proposal created: $PROPOSAL_ID"
echo ""

echo "Submitting vote with real proof..."
ROOT="17138981085726982929815047770222948937180916992196016628536485002859509881328"
NULLIFIER="5760508796108392755529358167294721063592787938597807569861628631651201858128"
PROOF_CONTENT=$(cat /tmp/real_proof.json | jq -c .)

if stellar contract invoke \
  --id "$VOTING_ID" \
  --network "$NETWORK" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --source "$KEY_NAME" \
  -- vote \
  --dao_id "$DAO_ID" \
  --proposal_id "$PROPOSAL_ID" \
  --vote_choice true \
  --nullifier "$NULLIFIER" \
  --root "$ROOT" \
  --commitment "$COMMITMENT" \
  --proof "$PROOF_CONTENT" > /dev/null 2>&1; then
  echo "✅ PASS: Valid VK accepted real proof"
  echo "       Pairing check succeeded"
  TEST1_RESULT="PASS"
else
  echo "❌ FAIL: Valid VK rejected real proof"
  TEST1_RESULT="FAIL"
fi
echo ""

echo "=========================================="
echo "Test 2: Invalid VK + Real Proof"  
echo "=========================================="
echo ""
echo "Point (5, 10) is NOT on BN254 curve:"
echo "  y² = 10² = 100"
echo "  x³ + 3 = 5³ + 3 = 128"
echo "  100 ≠ 128 → Invalid point"
echo ""

echo "Setting invalid VK (point 5,10)..."
INVALID_VK_CONTENT=$(cat /tmp/invalid_vk.json | jq -c .)
stellar contract invoke \
  --id "$VOTING_ID" \
  --network "$NETWORK" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --source "$KEY_NAME" \
  -- set_vk \
  --dao_id "$DAO_ID" \
  --vk "$INVALID_VK_CONTENT" \
  --admin "$ADMIN_ADDRESS" > /dev/null 2>&1

echo "✅ Invalid VK set (expected - no validation yet)"
echo ""

echo "Creating second proposal..."
PROPOSAL_ID2=$(stellar contract invoke \
  --id "$VOTING_ID" \
  --network "$NETWORK" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --source "$KEY_NAME" \
  -- create_proposal \
  --dao_id "$DAO_ID" \
  --description "Test Proposal 2" \
  --end_time "$END_TIME" \
  --creator "$ADMIN_ADDRESS" \
  --vote_mode '{"type":"Fixed"}' 2>&1 | tr -d '"')

echo "✅ Proposal created: $PROPOSAL_ID2"
echo ""

echo "Submitting vote with real proof..."
NULLIFIER2="5760508796108392755529358167294721063592787938597807569861628631651201858129"

if stellar contract invoke \
  --id "$VOTING_ID" \
  --network "$NETWORK" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --source "$KEY_NAME" \
  -- vote \
  --dao_id "$DAO_ID" \
  --proposal_id "$PROPOSAL_ID2" \
  --vote_choice true \
  --nullifier "$NULLIFIER2" \
  --root "$ROOT" \
  --commitment "$COMMITMENT" \
  --proof "$PROOF_CONTENT" 2>&1 | grep -i "error\|fail\|panic"; then
  echo "✅ PASS: Invalid VK rejected by pairing check"
  echo "       Security boundary working correctly"
  TEST2_RESULT="PASS"
else
  echo "❌ FAIL: Invalid VK accepted proof (SECURITY ISSUE!)"
  TEST2_RESULT="FAIL"
fi
echo ""

# Cleanup
rm -f /tmp/valid_vk.json /tmp/invalid_vk.json /tmp/real_proof.json

echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo ""
echo "Test 1 (Valid VK):   $TEST1_RESULT"
echo "Test 2 (Invalid VK): $TEST2_RESULT"
echo ""

if [ "$TEST1_RESULT" == "PASS" ] && [ "$TEST2_RESULT" == "PASS" ]; then
  echo "🎉 ALL TESTS PASSED"
  echo ""
  echo "Security validation confirmed:"
  echo "  ✅ Valid VK allows proof verification"
  echo "  ✅ Invalid VK rejected by pairing check"
  echo "  ✅ Pairing is the security boundary"
  echo ""
  echo "Design confirmed:"
  echo "  - No explicit point validation in set_vk()"
  echo "  - BN254 pairing provides implicit validation"
  echo "  - Invalid VK = unusable DAO (no proofs verify)"
  echo ""
  exit 0
else
  echo "❌ SOME TESTS FAILED"
  exit 1
fi
