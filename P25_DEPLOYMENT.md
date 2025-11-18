# P25 Network Deployment - Poseidon KAT Testing

**Date**: 2025-11-18
**Network**: P25 Local (Test SDF Future Network)
**Status**: ✅ Deployed, ⚠️ KAT Test In Progress

---

## Deployed Contracts

All contracts successfully deployed to P25 network with BN254 + Poseidon support:

```bash
# Network Configuration
RPC_URL=http://localhost:8000/soroban/rpc
NETWORK_PASSPHRASE="Test SDF Future Network ; October 2022"
KEY_NAME=mykey
KEY_ADDRESS=GDR46YB7MPK6FEU72XDL43UT4OSPQBJVNMQN474QYU4FG247OSWFQXLL

# Contract IDs
REGISTRY_ID=CDFIKYRXVILAOXU4W6HNTYQ3TKB4DUQVQPFOXFJCKY2G4SNPZWQVDSCG
SBT_ID=CDQOKHJAKPXNG6R7AYOJFLYPMKAK5NIQHK53BGUZYTSOJZL67ORPNXHM
TREE_ID=CALRLV6GEVP4MLYGET35XB7IXQ66IPKPQKT7VG34IN57RZWDK273BPOL
VOTING_ID=CDWSPDGPCZ7SKXL5PDGFO6JHKSSW4262KAB6IHQYWHDP2ZZVYEI74OCR
```

---

## Deployment Steps Completed

✅ **Step 1**: Account funded on P25 network  
✅ **Step 2**: Contracts built (`cargo build --target wasm32v1-none --release`)  
✅ **Step 3**: DAO Registry deployed (no constructor args)  
✅ **Step 4**: Membership SBT deployed with `--registry` constructor arg  
✅ **Step 5**: Membership Tree deployed with `--sbt_contract` constructor arg  
✅ **Step 6**: Voting contract deployed with `--tree_contract` constructor arg  

All contracts initialized via CAP-0058 `__constructor` pattern.

---

## Poseidon KAT Test - In Progress

**Objective**: Verify circomlib Poseidon matches P25 host function Poseidon

### Test Setup Completed

✅ **DAO Created**: ID 2 ("Poseidon KAT Test")  
✅ **Tree Initialized**: Depth 20  
✅ **SBT Minted**: For test user  

### Test Execution - Issue Encountered

**Known Answer Test Values** (from circomlib):
- Input: `Poseidon(12345, 67890)`
- Expected Commitment: `0x1914879b2a4e7f9555f3eb55837243cefb1366a692794a7e5b5b3181fb14b49b`
- Expected Root (after registration): `0x2d8b784789ca06c6bb30d7593b0774a6124aff26581f04b9125d1be25e46545d`

**Issue**: Budget limit exceeded when registering commitment via CLI:
```
❌ error: transaction simulation failed: HostError: Error(Budget, ExceededLimit)
```

### Possible Causes

1. **Computational Budget**: Poseidon hash computation might exceed default budget limits
2. **CLI Parameter Format**: U256 hex format accepted but execution failed
3. **Resource Limits**: P25 network resource limits may need adjustment

### Next Steps

**Option A - Increase Budget**:
```bash
# Try with increased resource limits (fee bump)
--fee 10000000
```

**Option B - Direct Contract Test**:
Write a test contract that:
1. Computes Poseidon hash on-chain
2. Returns the result
3. Compare with circomlib output

**Option C - Integration Test**:
Run KAT via integration test suite (native Soroban SDK, no CLI overhead)

---

## Point Validation Testing

Once KAT is resolved, test point validation:

**Test Plan**:
1. Create VK with off-curve G1 point in alpha
2. Attempt `set_vk` - should panic with "VK alpha point invalid"
3. Create proof with off-curve G1 point
4. Attempt vote - should fail verification

**Malformed Point Examples**:
```rust
// Off-curve G1 point (y² ≠ x³ + 3 mod p)
let invalid_g1 = BytesN::from_array(&env, &[
    0x00, ..., 0x63,  // x = 99
    0x00, ..., 0x63,  // y = 99 (doesn't satisfy curve)
]);
```

---

## Verification Checklist

- ✅ Contracts deployed to P25 network
- ✅ All constructors executed successfully
- ✅ Test DAO created and initialized
- ⚠️ **Poseidon KAT** - Budget issue, needs resolution
- ⏳ Point validation testing - pending KAT completion
- ⏳ Real Groth16 proof E2E - pending circuit automation

---

## Commands Reference

**Check Network Health**:
```bash
curl -s http://localhost:8000/health
```

**Invoke Contract** (with proper network params):
```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source mykey \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Test SDF Future Network ; October 2022" \
  -- function_name --arg value
```

**Get Tree Root**:
```bash
stellar contract invoke \
  --id $TREE_ID \
  --source mykey \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- current_root --dao_id 2
```

---

## Related Documents

- `TEST_PLAN.md` - Comprehensive test coverage plan
- `SECURITY_STATUS.md` - Security hardening status
- `scripts/e2e-poseidon-kat.sh` - Full KAT test script
