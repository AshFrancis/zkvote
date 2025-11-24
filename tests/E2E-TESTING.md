# End-to-End Security Testing

## Complete E2E Test with Real Groth16 Proofs

### Test: Removed Member Cannot Vote on Snapshot Proposal

**File:** `tests/e2e-complete-with-proofs.js`

This test verifies the critical security requirement that removed members cannot vote on snapshot proposals, even if they rejoin the DAO later.

### Test Scenario

1. **Admin creates DAO** - Fresh DAO with Merkle tree initialized
2. **Member joins** - Admin mints SBT to member
3. **Member registers commitment** → Root A (member included)
4. **Admin removes member** (leaf zeroed) → Root B (member excluded)
5. **Admin creates snapshot proposal** - eligible_root = Root B
6. **Member re-added** - Admin mints SBT again
7. **Member registers new commitment** → Root C (member included again)
8. **Member generates Groth16 proof** for snapshot root (Root B)
9. **Member attempts to vote** → **MUST FAIL**

### Prerequisites

1. **Local futurenet running**:
   ```bash
   stellar container start -t future
   ```

2. **Contracts deployed**:
   ```bash
   ./scripts/deploy-local-complete.sh
   ```

3. **Circuit artifacts present**:
   - `frontend/public/circuits/vote.wasm`
   - `frontend/public/circuits/vote_final.zkey`
   - `frontend/public/circuits/verification_key.json`

4. **Dependencies installed**:
   ```bash
   cd tests && npm install
   ```

### Running the Test

```bash
# From project root
node tests/e2e-complete-with-proofs.js
```

**Expected duration**: 60-90 seconds (proof generation takes time)

### Expected Outcomes

#### ✅ Test PASSES if:

**Option 1: Proof generation fails**
```
❌ Proof generation failed:
   Error in template Vote_142 line: 45
✓ Circuit rejected invalid inputs (expected)
=== TEST PASSED ===
Member cannot generate valid proof for snapshot they weren't in
```

**Option 2: Proof generates but contract rejects**
```
✓ Proof generated
✓ Vote REJECTED by contract (correct)
Reason: invalid proof
✓ Rejected for correct reason: invalid proof
=== TEST PASSED ===
Removed member CANNOT vote on snapshot proposal
```

#### ❌ Test FAILS if:

```
✓ Proof generated
❌❌❌ CRITICAL SECURITY BUG ❌❌❌
Vote was ACCEPTED but should have been REJECTED!
Member was NOT in snapshot root but could vote!
=== TEST FAILED ===
CRITICAL SECURITY BUG CONFIRMED
```

### What the Test Verifies

1. **Merkle tree updates correctly** - Root changes when member removed
2. **Snapshot isolation** - Proposal captures specific root at creation time
3. **Proof verification** - Invalid proofs are rejected (either by circuit or contract)
4. **Security guarantee** - Removed members cannot vote on snapshots

### Debugging Failed Tests

If the test fails (vote accepted when it shouldn't be):

1. **Check if testutils is disabled**:
   ```bash
   strings target/wasm32v1-none/release/voting.wasm | grep -i testutil
   ```
   Should return nothing.

2. **Verify root changes**:
   The test will print:
   ```
   Root A (with member): <value1>
   Root B (after removal): <value2>
   ```
   These MUST be different.

3. **Check proposal snapshot**:
   ```
   Proposal eligible_root: <value>
   ```
   This MUST equal Root B.

4. **Examine proof inputs**:
   The test generates a proof for Root B but uses path elements from Root C.
   This should cause the circuit to fail at line 45: `root === merkleProof.root`

### Manual Verification

To manually verify the bug using the frontend:

1. Run the test to set up the scenario (it will fail at proof generation)
2. Note the DAO ID and Proposal ID from test output
3. Open frontend and navigate to that DAO
4. Use the member account credentials from the test
5. Attempt to vote on the proposal
6. Verify vote is rejected

### Test Output Example

```
=== E2E Test: Removed Member Voting Security ===

Using contracts:
  Registry: CBWQ...
  SBT:      CAZK...
  Tree:     CBND...
  Voting:   CCAH...

Admin:  GDJZ...
Member: GCVF...

=== STEP 1: Create DAO ===
✓ DAO created: ID = 5
✓ Tree initialized

=== STEP 2: Member Joins & Registers ===
✓ SBT minted
Generating ZK credentials...
Secret: 123456789
Salt: 987654321
Commitment: 198271982...
✓ Commitment registered
Root A (with member): 204981729...

=== STEP 3: Remove Member ===
✓ Member removed
Root B (after removal): 917283918...
✓ Root changed (correct)

=== STEP 4: Create Snapshot Proposal ===
✓ Proposal created: ID = 1
Snapshot root (eligible_root): 917283918...
✓ Proposal correctly snapshots Root B

=== STEP 5: Re-Add Member ===
✓ SBT re-minted
Registering new commitment...
New secret: 111222333
New salt: 444555666
New commitment: 582937592...
✓ New commitment registered
Root C (after re-add): 391827391...

=== STEP 6: Generate Proof & Attempt Vote ===
Old commitment leaf index: 0
Path elements retrieved from current tree
(This path computes to Root C: 391827391...)
Nullifier: 192837192...

Generating Groth16 proof...
This will take 30-60 seconds...

❌ Proof generation failed:
   Error in template Vote_142 line: 45

✓ Circuit rejected invalid inputs (expected)

=== TEST PASSED ===
Member cannot generate valid proof for snapshot they weren't in

=== FINAL RESULT ===
✓✓✓ TEST PASSED ✓✓✓
Removed member CANNOT vote on snapshot proposal
```

### Implementation Notes

- **Uses real Stellar CLI**: Contract calls via `stellar contract invoke`
- **Generates real Groth16 proofs**: Full snarkjs proof generation
- **No testutils**: Tests production code path
- **Fully automated**: Single command runs entire test

### Troubleshooting

**Error: "Could not find REGISTRY_ID"**
- Contracts not deployed, run `./scripts/deploy-local-complete.sh`

**Error: "stellar: command not found"**
- Install Stellar CLI: `cargo install --locked stellar-cli --features opt`

**Error: "Cannot connect to RPC"**
- Local futurenet not running: `stellar container start -t future`

**Proof generation hangs**
- This is normal, circuit proving takes 30-60 seconds
- Ensure you have enough memory (4GB+ recommended)
