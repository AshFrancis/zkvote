# P25 Feature Check - Hosted Futurenet Test

This minimal contract tests whether the **hosted** Stellar futurenet supports Protocol 25 features:
- Poseidon hashing (BN254 field)
- BN254 curve operations

## Why This Matters

PR #1614 changes BN254 encoding. Before migrating our contracts, we need to know:
1. Does hosted futurenet have P25 features at all?
2. If yes, does it have PR #1614 (BE encoding)?

## Quick Test

```bash
cd tests/p25-feature-check

# Ensure you have stellar CLI installed
stellar --version

# Fund your account (first time only)
stellar keys fund default --network futurenet

# Run the test
bash test-futurenet.sh
```

## Expected Outcomes

### ✅ Success (P25 Available)
```
✅ SUCCESS: P25 Features Available!
  ✓ Poseidon hashing works
  ✓ BN254 operations available
```

**Means:** You can deploy to hosted futurenet!

### ❌ Failure (P25 Not Available)
```
✗ Poseidon test failed!
❌ Hosted futurenet does NOT support Poseidon/BN254 yet
⚠️  You must use local Docker container for development
```

**Means:** Only local Docker container supports P25 features.

## What This Tells Us

| Result | Implication |
|--------|-------------|
| **Success** | Hosted futurenet has P25. Need to check encoding version. |
| **Failure** | Must use local Docker for all P25 development. |

## Next Steps After Testing

### If Success:
1. Check if PR #1614 is included (encoding version)
2. Test with a small DAO contract using BE encoding
3. Consider migrating to hosted futurenet

### If Failure:
1. Continue using local Docker (`stellar container start -t future`)
2. Update migration plan to note hosted futurenet unavailable
3. Monitor Stellar releases for P25 deployment to hosted futurenet

## Files

- `src/lib.rs` - Minimal P25 test contract
- `test-futurenet.sh` - Automated deployment and test script
- `Cargo.toml` - Build configuration

## Manual Testing

If the script fails, you can test manually:

```bash
# Build
cargo build --target wasm32-unknown-unknown --release

# Deploy
stellar contract deploy \
  --wasm ../../target/wasm32-unknown-unknown/release/p25_feature_check.wasm \
  --source-account default \
  --network futurenet

# Test Poseidon (replace CONTRACT_ID)
stellar contract invoke \
  --id CONTRACT_ID \
  --source-account default \
  --network futurenet \
  -- \
  test_poseidon \
  --a '{"u256": 12345}' \
  --b '{"u256": 67890}'
```

## Impact on Migration Plan

**If hosted futurenet works:**
- Add option to deploy there instead of just local Docker
- Still need to verify encoding version matches

**If hosted futurenet doesn't work:**
- Update `BN254_ENCODING_MIGRATION.md` to note this
- Emphasize local Docker requirement
- Document when to retry (after Stellar P25 announcement)
