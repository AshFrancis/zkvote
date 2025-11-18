# Test Coverage Plan

Comprehensive test gap analysis and implementation roadmap for DaoVote.

**Current Status**: 65 tests passing (unit + integration)
**Target**: Production-grade coverage with security edge cases

---

## 🔴 High Priority (Security-Critical)

### 1. Groth16 Verification Edge Cases

**VK Validation Tests** (`contracts/voting/src/test.rs`):
- [ ] Empty IC vector (should panic)
- [ ] IC length = 0 (should panic)
- [ ] IC length = 5 (should panic - need exactly 6)
- [ ] IC length = 7 (should panic - need exactly 6)
- [ ] IC length = 22 (should panic - exceeds MAX_IC_LENGTH)
- [ ] Malformed G1 points (wrong length: 63 bytes, 65 bytes)
- [ ] Malformed G2 points (wrong length: 127 bytes, 129 bytes)
- [ ] Off-curve G1 points (y² ≠ x³ + 3 mod p)
- [ ] Invalid subgroup G2 points (once G2 validation added)

**Proof Validation Tests** (`contracts/voting/src/test.rs`):
- [ ] Proof with all-zero components
- [ ] Proof.a wrong length (63 bytes, 65 bytes)
- [ ] Proof.b wrong length (127 bytes, 129 bytes)
- [ ] Proof.c wrong length (63 bytes, 65 bytes)
- [ ] Off-curve proof points
- [ ] Wrong public signal ordering (swap daoId/proposalId)
- [ ] Wrong public signal ordering (swap root/nullifier)
- [ ] Mismatched VK hash in proposal
- [ ] Mismatched root in proposal (not eligible_root)

**Real Pairing Test** (`tests/integration/`):
- [ ] End-to-end test with real Groth16 proof (no testutils bypass)
- [ ] Requires: compiled circuit, generated proof, VK
- [ ] Verifies actual BN254 pairing check works
- **Status**: Deferred until circuit compilation automated

---

## 🟡 Medium Priority (DoS Prevention)

### 2. Input Bounds & Size Limits

**Description Length Tests** (`contracts/voting/src/test.rs`):
- [x] Max valid length (1024 chars) - passes ✓
- [ ] Over limit (1025 chars) - should panic
- [ ] Extreme size (10KB) - should panic
- [ ] Empty description (0 chars) - currently allowed

**DAO Name Length Tests** (`contracts/dao-registry/src/test.rs`):
- [x] Max valid length (256 chars) - passes ✓
- [ ] Over limit (257 chars) - should panic
- [ ] Extreme size (5KB) - should panic

**VK IC Length Tests** (`contracts/voting/src/test.rs`):
- [x] Exactly 6 elements (valid) - passes ✓
- [ ] 5 elements - should panic
- [ ] 7 elements - should panic
- [ ] 21 elements (MAX_IC_LENGTH) - should panic (not vote circuit)
- [ ] 22 elements - should panic (exceeds MAX)

**Tree Depth Tests** (`contracts/membership-tree/src/test.rs`):
- [x] Depth 20 (max valid) - passes ✓
- [ ] Depth 0 - should panic
- [ ] Depth 21 - should panic
- [ ] Depth 32 - should panic
- [ ] Large filled tree (stress test gas/storage)

---

## 🟢 Low Priority (Correctness & Edge Cases)

### 3. Admin & VK Lifecycle

**VK Management Tests** (`contracts/voting/src/test.rs`):
- [x] Set VK as admin - passes ✓
- [ ] Set VK as non-admin - should panic
- [ ] Set VK twice (replacement)
- [ ] Set different VK per DAO
- [ ] Vote with old VK hash after VK change (should fail)
- [ ] Verify IC length validated at set_vk (not deferred to vote)

**Multi-Proposal VK Tests** (`tests/integration/`):
- [ ] Two proposals with same VK
- [ ] Two proposals with different VKs
- [ ] Vote on proposal A, VK changed, vote on proposal B
- [ ] Ensure proposal A still uses original VK snapshot

---

### 4. Merkle Tree & Poseidon

**Poseidon Parity Tests** (`contracts/membership-tree/src/test.rs`):
- [x] Basic Poseidon(1,2) KAT - passes ✓
- [ ] Poseidon(0,0) matches circomlib
- [ ] All 5 zero levels match circomlib
- [ ] Merkle root with 1 commitment matches circomlib
- [ ] Merkle root with 3 commitments matches circomlib
- **Note**: Full KAT via `scripts/e2e-poseidon-kat.sh` ✓

**Tree Edge Cases** (`contracts/membership-tree/src/test.rs`):
- [ ] Register commitment before init_tree - should panic
- [ ] Register commitment with tampered depth key
- [ ] Register same commitment twice (allowed for different members)
- [ ] Register commitment in DAO A, use in DAO B - should fail vote
- [ ] Zero leaf consistency across tree operations

---

### 5. Voting Lifecycle & Isolation

**Cross-DAO Isolation Tests** (`tests/integration/`):
- [ ] Same nullifier, different DAOs - should both succeed
- [ ] Same proposalId in different DAOs - isolated
- [ ] Vote in DAO A with DAO B commitment - should fail
- [ ] Nullifier formula: verify `Poseidon(secret, daoId, proposalId)` includes daoId

**Nullifier Replay Tests** (`contracts/voting/src/test.rs`):
- [x] Same nullifier, same proposal - should panic ✓
- [ ] Same nullifier, different proposals in same DAO - should succeed
- [ ] Same nullifier, different DAOs - should succeed
- [ ] Verify nullifier storage key: `(symbol, dao_id, proposal_id, nullifier)`

**Voting Window Tests** (`contracts/voting/src/test.rs`):
- [x] Vote before end_time - passes ✓
- [x] Vote after end_time - should panic ✓
- [ ] Create proposal with end_time in past - should panic
- [ ] Vote with future timestamp (if time-travel attack possible)

**Snapshot Eligibility Tests** (`tests/integration/`):
- [ ] Member joins after proposal creation - cannot vote (wrong root)
- [ ] Member leaves (SBT remains) - can still vote (commitment permanent)
- [ ] Root changes mid-vote - old votes still valid, new voters use old root

---

### 6. Backend & E2E

**Backend Input Validation** (`backend/src/test.js` - to be created):
- [ ] Missing VOTING_CONTRACT_ID - should exit
- [ ] Missing TREE_CONTRACT_ID - should exit
- [ ] Invalid contract ID format - should exit
- [ ] Malformed proof hex (odd length) - should reject
- [ ] Malformed proof hex (non-hex chars) - should reject
- [ ] Proof with all-zero components - should reject
- [ ] Public signal > BN254 field - should reject

**Proof Converter Tests** (`circuits/utils/test/` - to be created):
- [ ] Verify proof_to_soroban.js output correctness
- [ ] Public signal ordering: [0]=root, [1]=nullifier, [2]=daoId, [3]=proposalId, [4]=voteChoice
- [ ] Prevent signal mislabeling regression
- [ ] Byte order verification (big-endian)

**E2E Integration** (`scripts/e2e-zkproof-test.sh`):
- [x] Full deployment with constructors ✓
- [x] Automated VK loading ✓
- [x] Automated proof generation ✓
- [ ] Verify vote succeeds with real proof
- [ ] Verify vote fails with wrong root
- [ ] Verify vote fails with reused nullifier

---

### 7. Security-Specific Tests

**Point Validation Tests** (`contracts/voting/src/test.rs`):
- [x] G1 point validation: y² = x³ + 3 mod p (implemented) ✓
- [ ] Invalid G1 point in VK alpha - should panic
- [ ] Invalid G1 point in VK IC[0] - should panic
- [ ] Invalid G1 point in proof.a - should fail verification
- [ ] Invalid G1 point in proof.c - should fail verification
- [ ] G2 subgroup validation (deferred - requires cofactor check)

**Storage Exhaustion Tests** (`contracts/`):
- [x] Description length capped at 1024 ✓
- [x] DAO name capped at 256 ✓
- [ ] Verify contract size limits
- [ ] Stress test: 1000 members in tree (gas cost analysis)
- [ ] Stress test: 100 proposals per DAO

---

## Implementation Priority

### Phase 1: High-Priority Security (Now)
1. VK validation edge cases
2. Proof validation edge cases
3. Input bounds tests (oversized descriptions, names, VK)

### Phase 2: Medium-Priority DoS (Next)
4. Tree depth boundaries
5. IC length enforcement
6. Backend input validation

### Phase 3: Low-Priority Correctness (Later)
7. Cross-DAO isolation
8. Nullifier replay scenarios
9. Snapshot eligibility edge cases
10. Proof converter correctness

### Phase 4: E2E & Real Proofs (When Ready)
11. Real Groth16 proof test (no bypass)
12. Full e2e-zkproof-test.sh execution
13. Circuit integration tests

---

## Test Coverage Metrics

**Current Coverage**:
```
dao-registry:      8 tests  (basic functionality)
membership-sbt:   11 tests  (SBT mechanics)
membership-tree:  15 tests  (Merkle operations)
voting:           18 tests  (voting + Groth16 mock)
integration:      13 tests  (cross-contract flows)
---
Total:            65 tests
```

**Target Coverage** (with this plan):
```
dao-registry:     +5 tests  (DoS, admin edge cases)
membership-sbt:   +3 tests  (cross-DAO, replay)
membership-tree:  +8 tests  (Poseidon KAT, depth, init)
voting:          +25 tests  (VK/proof validation, nullifiers, isolation)
integration:      +5 tests  (snapshot, lifecycle)
backend:         +10 tests  (NEW - input validation, hex checks)
circuits:         +5 tests  (NEW - proof converter, ordering)
---
Target:          126 tests  (nearly 2x current coverage)
```

---

## Related Documents

- `SPEC_DRIFT.md` - All spec/code alignment issues (100% resolved)
- `README.md` - Updated with security considerations
- `audit.md` - Security audit findings (if exists)
- `contracts/*/src/test.rs` - Existing test suites
