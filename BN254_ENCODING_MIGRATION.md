# BN254 Encoding Migration Plan

**Status:** ✅ COMPLETED
**Date:** 2025-11-25
**PR Reference:** https://github.com/stellar/rs-soroban-env/pull/1614

## Executive Summary

Stellar's rs-soroban-env PR #1614 (merged 2025-11-25) introduced a **breaking change** to BN254 point serialization. Our codebase has been updated from **little-endian** encoding to **big-endian** encoding to align with CAP-74 and EVM precompile specifications (EIP-196, EIP-197).

**Migration Status:** ✅ COMPLETE
- SDK updated to commit `b122dc6cf1ac96c851efc252b370e5384cd973df`
- All encoding functions updated to use big-endian
- 107 tests passing, 7 ignored (unrelated issues)
- Real Groth16 proof verification working with BE encoding

### Critical Dependencies

**⚠️ BOTH must be updated together:**

1. **SDK Version (Cargo.toml)** - Compile-time: Generates BE-encoded points
2. **Docker Container (stellar-cli)** - Runtime: Expects BE-encoded points

**If there's a version mismatch:** Proofs will fail verification even if correctly generated!

The encoding happens at **runtime** when host functions in the Docker container process BN254 points. Updating only the SDK without updating the Docker container will cause all proofs to fail.

---

## The Problem

### Current Implementation (Little-Endian)

From `CLAUDE.md:155-182`:

```
The host function expects LITTLE-ENDIAN bytes, not big-endian!

G1 Point Encoding (64 bytes):
- Format: le_bytes(X) || le_bytes(Y)

G2 Point Encoding (128 bytes):
- Format: le_bytes(X_im) || le_bytes(X_re) || le_bytes(Y_im) || le_bytes(Y_re)
- snarkjs outputs [[c0, c1], [c0, c1]] where c0=real, c1=imaginary
- Must swap to [c1, c0, c1, c0] (imaginary first) AND reverse each 32-byte limb
```

### New Standard (Big-Endian)

Per PR #1614:

```
All field elements now use BIG-ENDIAN encoding

G1 Point Encoding (64 bytes):
- Format: be_bytes(X) || be_bytes(Y)

G2 Point Encoding (128 bytes):
- Format: be_bytes(X_c1) || be_bytes(X_c0) || be_bytes(Y_c1) || be_bytes(Y_c0)
- Extension field ordering: imaginary (c1) then real (c0)
- Flag bits must be unset
- Point-at-infinity: zero bytes
```

### Key Changes

1. **Endianness:** All 32-byte field elements change from LE to BE
2. **G2 Field Ordering:** Remains `[c1, c0, c1, c0]` but each component is now BE instead of LE
3. **Flag Bits:** Must be explicitly unset (bits 0 and 1)
4. **Point-at-Infinity:** Represented as zero bytes (no special flag)

---

## Impact Analysis

### Files Requiring Changes

#### 1. Frontend - Verification Key
- **File:** `frontend/src/lib/verification_key_soroban_le.json`
- **Action:** Regenerate with BE encoding, rename to `verification_key_soroban_be.json`
- **Impact:** HIGH - Breaks all proof verification if not updated

#### 2. Frontend - Proof Encoding
- **File:** `frontend/src/lib/zk.ts` (ZK proof generation)
- **Action:** Update snarkjs output conversion from LE to BE
- **Impact:** HIGH - All votes will fail verification

#### 3. Test Mock Verification Keys
- **Files:**
  - `tests/integration/tests/*.rs` (all integration tests)
  - `contracts/voting/src/lib.rs` (unit tests with mock VKs)
- **Action:** Update all mock BN254 points from LE to BE
- **Impact:** MEDIUM - Tests fail but no production impact

#### 4. Documentation
- **Files:**
  - `CLAUDE.md` (lines 155-182: BN254 encoding section)
  - `spec.md` (if mentions encoding details)
  - Code comments referencing LE encoding
- **Action:** Update all references to reflect BE encoding
- **Impact:** LOW - Documentation only

#### 5. Cargo Dependencies
- **File:** `Cargo.toml`
- **Action:** Update `soroban-sdk` to latest commit with PR #1614
- **Impact:** HIGH - Triggers the breaking change

### Testing Requirements

All tests must pass after migration:

1. **Unit Tests:** 52 tests across all contracts
   - DAORegistry: 8 tests
   - MembershipSBT: 11 tests
   - MembershipTree: 14 tests
   - Voting: 13 tests (includes mock VK tests)
   - Integration: 12 tests

2. **Poseidon KAT Tests:** 3 tests
   - Verify Poseidon hash compatibility (should be unaffected)

3. **Proposal Deadline Tests:** 3 tests
   - Verify proposal deadline logic (should be unaffected)

4. **End-to-End Integration:**
   - Deploy contracts to local futurenet
   - Register membership with real Groth16 proof
   - Submit vote with real Groth16 proof
   - Verify vote tallying

---

## Migration Plan

### Phase 1: Preparation (Pre-Migration)

**Goal:** Establish baseline and prepare tooling

1. **Baseline Test Run**
   ```bash
   cargo test --workspace
   ```
   - Verify all 58 tests pass on current SDK
   - Document any existing failures

2. **Create Encoding Conversion Utilities**
   - Script to convert LE → BE for field elements
   - Script to regenerate VK from snarkjs with BE encoding
   - Validation script to verify encoding correctness

3. **Backup Current State**
   - Commit all current changes
   - Tag current commit as `pre-bn254-migration`
   - Backup `verification_key_soroban_le.json`

### Phase 2: SDK Update

**Goal:** Update to latest SDK with PR #1614

1. **Update Cargo.toml**
   ```toml
   [workspace.dependencies]
   # Update to latest commit with PR #1614 (or released version)
   soroban-sdk = { git = "https://github.com/stellar/rs-soroban-sdk", rev = "<LATEST_COMMIT>" }
   ```

2. **Clean Build**
   ```bash
   cargo clean
   cargo build --target wasm32v1-none --release
   ```

3. **Expected Result:** Build succeeds, but tests will fail due to encoding mismatch

### Phase 3: Test Migration

**Goal:** Update all mock VKs in tests to use BE encoding

#### 3.1 Update Integration Test Mock VKs

For each test file in `tests/integration/tests/`:

**Example from `proposal_deadline.rs:82-104`:**

```rust
// OLD (LE encoding):
let mock_alpha = soroban_sdk::BytesN::from_array(&env, &[0u8; 64]);

// NEW (BE encoding):
// Generate proper BE-encoded mock points or use test-mode bypass
let mock_alpha = soroban_sdk::BytesN::from_array(&env, &[0u8; 64]);
```

**Note:** For test mode, we can continue using all-zeros since we skip actual pairing checks via `#[cfg(test)]`.

**Action Items:**
- `tests/integration/tests/proposal_deadline.rs` (3 tests)
- `tests/integration/tests/poseidon_kat.rs` (3 tests - should be unaffected)
- `tests/integration/tests/full_voting_flow.rs` (if exists)
- Any other integration tests with mock VKs

#### 3.2 Update Voting Contract Unit Tests

**File:** `contracts/voting/src/lib.rs`

Update any unit tests that create mock verification keys for testing.

#### 3.3 Test Run After Mock Updates

```bash
cargo test --workspace
```

**Expected Result:** All tests pass (mock VKs are mostly bypassed in test mode)

### Phase 4: Frontend Migration

**Goal:** Update frontend to generate BE-encoded VKs and proofs

#### 4.1 Create BE Encoding Utility

**New file:** `frontend/src/lib/bn254_encoding.ts`

```typescript
/**
 * Convert snarkjs field element to BIG-ENDIAN hex for Soroban
 * (Per rs-soroban-env PR #1614)
 */
export const toHexBE = (value: string): string => {
  const bigInt = BigInt(value);
  // Already in big-endian - just pad to 64 chars (32 bytes)
  return bigInt.toString(16).padStart(64, "0");
};

/**
 * Encode G1 point (64 bytes) in big-endian
 * Format: be_bytes(X) || be_bytes(Y)
 */
export const encodeG1 = (point: [string, string]): string => {
  const [x, y] = point;
  return toHexBE(x) + toHexBE(y);
};

/**
 * Encode G2 point (128 bytes) in big-endian
 * Format: be_bytes(X_c1) || be_bytes(X_c0) || be_bytes(Y_c1) || be_bytes(Y_c0)
 *
 * snarkjs outputs: [[X_c0, X_c1], [Y_c0, Y_c1]]
 * We need: [X_c1, X_c0, Y_c1, Y_c0] in big-endian
 */
export const encodeG2 = (point: [[string, string], [string, string]]): string => {
  const [[x_c0, x_c1], [y_c0, y_c1]] = point;
  // Reorder: imaginary (c1) then real (c0)
  return toHexBE(x_c1) + toHexBE(x_c0) + toHexBE(y_c1) + toHexBE(y_c0);
};
```

#### 4.2 Regenerate Verification Key

```bash
cd circuits
# Generate VK from snarkjs
npx snarkjs zkey export verificationkey build/vote_final.zkey build/verification_key.json

# Convert to Soroban format with BE encoding
node utils/vkey_to_soroban_be.js
```

**Update script:** `circuits/utils/vkey_to_soroban_be.js`
- Use new BE encoding functions
- Output to `frontend/src/lib/verification_key_soroban_be.json`

#### 4.3 Update Frontend Imports

**File:** `frontend/src/components/VoteModal.tsx` (or wherever VK is imported)

```typescript
// OLD:
import vk from "../lib/verification_key_soroban_le.json";

// NEW:
import vk from "../lib/verification_key_soroban_be.json";
```

#### 4.4 Update Proof Encoding

**File:** `frontend/src/lib/zk.ts` (or proof generation logic)

Update any proof serialization to use BE encoding:

```typescript
import { encodeG1, encodeG2, toHexBE } from "./bn254_encoding";

// When submitting proof to contract:
const proof = {
  pi_a: encodeG1([proof.pi_a[0], proof.pi_a[1]]),
  pi_b: encodeG2(proof.pi_b),
  pi_c: encodeG1([proof.pi_c[0], proof.pi_c[1]]),
};
```

### Phase 5: Documentation Updates

**Goal:** Update all documentation to reflect BE encoding

#### 5.1 Update CLAUDE.md

**File:** `CLAUDE.md` (lines 155-182)

```markdown
### CRITICAL: BN254 Byte Encoding for Groth16 Proofs

**The host function expects BIG-ENDIAN bytes (per CAP-74 and EVM specs)**

snarkjs outputs big-endian field elements, which now align with Soroban's encoding.

**Encoding Format:**
```typescript
// Field elements are already in big-endian - no conversion needed
const toHexBE = (value: string): string => {
  return BigInt(value).toString(16).padStart(64, "0");
};
```

**G1 Point Encoding (64 bytes):**
- Format: `be_bytes(X) || be_bytes(Y)`
- Each coordinate: 32 bytes, big-endian

**G2 Point Encoding (128 bytes):**
- Format: `be_bytes(X_c1) || be_bytes(X_c0) || be_bytes(Y_c1) || be_bytes(Y_c0)`
- snarkjs outputs `[[c0, c1], [c0, c1]]` where c0=real, c1=imaginary
- Reorder to `[c1, c0, c1, c0]` (imaginary first) in big-endian

**Key Changes (PR #1614):**
- All field elements use big-endian encoding (matches EVM/CAP-74)
- Flag bits must be unset
- Point-at-infinity represented as zero bytes
- Extension field ordering: c1 (imaginary) then c0 (real)
```

#### 5.2 Update spec.md

Search for any references to "little-endian" or "LE encoding" and update to "big-endian" / "BE encoding".

#### 5.3 Update Code Comments

Search codebase for comments mentioning:
- "little-endian"
- "LE bytes"
- "reverse bytes"
- Old encoding assumptions

### Phase 6: Integration Testing

**Goal:** Verify end-to-end functionality with real proofs

#### 6.1 Local Futurenet Update (CRITICAL!)

**⚠️ IMPORTANT:** The Docker container must be updated to match the SDK version!

PR #1614 changes the **host environment** (rs-soroban-env) that runs inside the Docker container. The encoding happens at runtime when the host functions process BN254 points.

**What needs to match:**
- **SDK (compile-time):** Our code generates BE-encoded points
- **Environment (runtime):** Docker container expects BE-encoded points

**If there's a mismatch:** Proofs will fail verification even if correctly generated!

```bash
# Stop current futurenet
stellar container stop

# Update stellar CLI to latest version with PR #1614 support
# Check current version:
stellar --version

# Update if needed (example commands - check stellar docs):
# brew upgrade stellar-cli  # macOS
# cargo install --locked stellar-cli --force  # or from source

# Remove old container image to force pull of latest
docker rmi $(docker images | grep soroban-preview | awk '{print $3}')

# Start new futurenet with updated P25 support
stellar container start -t future
```

**Verify container includes PR #1614:**

```bash
# Check container logs for version info
docker logs stellar 2>&1 | grep -i version

# Or check if BN254 encoding works correctly by testing with a known proof
# (we'll do this in the end-to-end test)
```

**Rollback if container too old:**
If the latest container doesn't include PR #1614 yet:
1. Stay on old SDK (revert Cargo.toml)
2. Document in migration plan
3. Wait for updated container release
4. Monitor stellar-cli releases and Docker image updates

#### 6.2 Deploy Updated Contracts

```bash
# Build with new SDK
cargo build --target wasm32v1-none --release

# Deploy contracts
./scripts/deploy-local-complete.sh

# Verify deployment
stellar contract invoke --id <CONTRACT_ID> --network local ...
```

#### 6.3 End-to-End Test

**Test Flow:**
1. Create DAO via frontend
2. Register member with identity commitment
3. Create proposal
4. Generate ZK proof for vote (with BE encoding)
5. Submit vote via relayer
6. Verify vote accepted and tallied correctly

**Success Criteria:**
- Proof verification succeeds on-chain
- Vote is tallied correctly
- No encoding-related errors

#### 6.4 Run All Tests

```bash
# Unit and integration tests
cargo test --workspace

# Specific test suites
cargo test -p voting
cargo test -p daovote-integration-tests
```

**Expected:** All 58 tests pass

### Phase 7: Validation & Rollback Plan

#### 7.1 Validation Checklist

- [ ] All 58 Rust tests pass
- [ ] Frontend can generate proofs with BE encoding
- [ ] Proofs verify correctly on-chain
- [ ] End-to-end vote flow works
- [ ] Documentation updated
- [ ] No encoding-related errors in logs

#### 7.2 Rollback Plan

If migration fails:

```bash
# Revert to pre-migration commit
git reset --hard pre-bn254-migration

# Restore Cargo.lock
git checkout HEAD -- Cargo.lock

# Clean and rebuild
cargo clean
cargo build --target wasm32v1-none --release

# Verify tests pass
cargo test --workspace
```

**Rollback triggers:**
- Tests fail after multiple fix attempts
- Proof verification consistently fails on-chain
- Critical bugs discovered in new SDK
- Timeline constraints

---

## Risk Assessment

### High Risk

1. **Docker Container Version Mismatch** ⚠️ NEW!
   - **Risk:** Updated SDK (BE encoding) but old Docker container (LE encoding)
   - **Impact:** All proofs fail verification despite being correctly generated
   - **Mitigation:** Update stellar-cli AND Docker image together, verify versions match
   - **Detection:** Check Docker container logs for rs-soroban-env version
   - **Fallback:** Revert SDK to old version OR update container

2. **Proof Verification Failure**
   - **Risk:** BE-encoded proofs fail verification on-chain
   - **Mitigation:** Thorough testing with real proofs before production
   - **Fallback:** Stay on old SDK until issue resolved

3. **Frontend-Backend Mismatch**
   - **Risk:** Frontend generates LE proofs, backend expects BE
   - **Mitigation:** Update and test both together, never separately
   - **Fallback:** Rollback both to LE encoding

### Medium Risk

1. **Test Failures**
   - **Risk:** Mock VKs incorrectly updated
   - **Mitigation:** Tests mostly bypass pairing in test mode
   - **Fallback:** Revert test changes, use test-mode bypass

2. **Documentation Drift**
   - **Risk:** Docs not fully updated, causing confusion
   - **Mitigation:** Comprehensive search and update
   - **Fallback:** Reference this migration doc

### Low Risk

1. **Poseidon Hash Compatibility**
   - **Risk:** Poseidon hash affected by encoding change
   - **Mitigation:** Poseidon uses U256 internally, unaffected by serialization
   - **Fallback:** None needed (not affected)

---

## Timeline Estimate

**Total:** ~4-6 hours

- **Phase 1 (Preparation):** 30 minutes
- **Phase 2 (SDK Update):** 15 minutes
- **Phase 3 (Test Migration):** 1 hour
- **Phase 4 (Frontend Migration):** 2 hours
- **Phase 5 (Documentation):** 30 minutes
- **Phase 6 (Integration Testing):** 1-2 hours
- **Phase 7 (Validation):** 30 minutes

---

## Success Criteria

Migration is considered successful when:

1. ✅ All 58 Rust tests pass
2. ✅ Frontend generates BE-encoded proofs
3. ✅ Proofs verify on-chain with new SDK
4. ✅ End-to-end vote flow completes successfully
5. ✅ Documentation fully updated
6. ✅ No encoding-related errors or warnings

---

## Post-Migration Actions

After successful migration:

1. **Commit Changes**
   ```bash
   git add .
   git commit -m "feat: migrate to big-endian BN254 encoding (PR #1614)"
   ```

2. **Tag Release**
   ```bash
   git tag -a bn254-be-migration -m "BN254 encoding migrated to big-endian"
   ```

3. **Update SECURITY_STATUS.md**
   - Note encoding change
   - Update validation status

4. **Archive Old Files**
   - Move `verification_key_soroban_le.json` to `archive/`
   - Keep for reference but don't use

5. **Update README.md**
   - Add note about encoding standard
   - Reference this migration doc

---

## References

- **PR #1614:** https://github.com/stellar/rs-soroban-env/pull/1614
- **CAP-74:** Stellar cryptographic operations specification
- **EIP-196:** EVM bn256 addition precompile
- **EIP-197:** EVM bn256 pairing precompile
- **Current SDK:** `eb829477e1bcd6305048d6715233598783d8b915`

---

## Appendix: Quick Reference

### LE to BE Conversion

```typescript
// OLD (Little-Endian):
const toHexLE = (value: string): string => {
  const bigInt = BigInt(value);
  const hexBE = bigInt.toString(16).padStart(64, "0");
  // Reverse bytes: "abcd...wxyz" -> "zyxw...dcba"
  const hexLE = hexBE.match(/.{2}/g)!.reverse().join("");
  return hexLE;
};

// NEW (Big-Endian):
const toHexBE = (value: string): string => {
  const bigInt = BigInt(value);
  // No reversal needed - keep big-endian
  return bigInt.toString(16).padStart(64, "0");
};
```

### G2 Point Encoding

```typescript
// OLD (LE with field reversal):
// le_bytes(X_im) || le_bytes(X_re) || le_bytes(Y_im) || le_bytes(Y_re)

// NEW (BE with same field order):
// be_bytes(X_im) || be_bytes(X_re) || be_bytes(Y_im) || be_bytes(Y_re)
// Or equivalently: be_bytes(X_c1) || be_bytes(X_c0) || be_bytes(Y_c1) || be_bytes(Y_c0)
```

---

**Document Status:** DRAFT - Awaiting Review
**Next Step:** Review and approve migration plan before execution
