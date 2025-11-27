# Test Coverage Plan

Comprehensive test gap analysis and implementation roadmap for DaoVote.

**Current Status**: Full suite green (`cargo test --workspace --locked`); real zk proof paths covered, negative proofs included.
**Target**: Production-grade coverage with remaining edge cases and load/budget checks

---

## 🔴 High Priority (Security-Critical)

### 1. Groth16 Verification Edge Cases

**VK Validation Tests** (`contracts/voting/src/test.rs`):
- [x] Empty/short/long IC vectors panic (0,5,7,22) ✓
- [x] MAX_IC_LENGTH enforced ✓
- [x] Malformed G1/G2 byte lengths rejected ✓
- [x] Off-curve G1/G2 proof points rejected via pairing ✓
- [ ] Invalid subgroup G2 points (pending cofactor check support)

**Proof Validation Tests** (`contracts/voting/src/test.rs`):
- [x] Proof with all-zero components fails ✓
- [x] Proof.a wrong length (63/65) ✓
- [x] Proof.b wrong length (127/129) ✓
- [x] Proof.c wrong length (63/65) ✓
- [x] Off-curve proof points fail ✓
- [x] Wrong public signal ordering (swap daoId/proposalId) ✓
- [x] Wrong public signal ordering (swap root/nullifier) ✓
- [x] Mismatched VK hash in proposal fails ✓
- [x] Mismatched root vs eligible_root fails ✓

**Real Pairing Tests** (`tests/integration/`):
- [x] End-to-end vote with real Groth16 proof ✓
- [x] Trailing-mode late joiner with real proof ✓
- [ ] Additional real-proof negatives (reused nullifier, wrong vk_hash) optional

---

## 🟡 Medium Priority (DoS Prevention)

### 2. Input Bounds & Size Limits

**Description Length Tests** (`contracts/voting/src/test.rs`):
- [x] Max valid length (1024 chars) ✓
- [x] Over limit (1025 chars) panics ✓
- [ ] Extreme size (10KB) - future stress
- [ ] Empty description (0 chars) - allowed (documented)

**DAO Name Length Tests** (`contracts/dao-registry/src/test.rs`):
- [x] Max valid length (256 chars) ✓
- [x] Over limit (257 chars) panics ✓
- [ ] Extreme size (5KB) - future stress

**VK IC Length Tests** (`contracts/voting/src/test.rs`):
- [x] Exactly 6 elements valid ✓
- [x] 5 elements panics ✓
- [x] 7 elements panics ✓
- [x] 21 elements panics ✓
- [x] 22 elements panics ✓
- [x] IC length mismatch caught at vote ✓ (`test_vote_with_vk_ic_length_mismatch_fails`)

**Tree Depth Tests** (`contracts/membership-tree/src/test.rs`):
- [x] Depth 20 (max valid) ✓
- [x] Depth 0 panics ✓
- [x] Depth 21 panics ✓
- [x] Depth 32 panics ✓
- [ ] Large filled tree (stress test gas/storage)

---

## 🟢 Low Priority (Correctness & Edge Cases)

### 3. Admin & VK Lifecycle

**VK Management Tests** (`contracts/voting/src/test.rs`):
- [x] Set VK as admin / non-admin guard ✓
- [x] Set VK twice bumps version, stores history ✓
- [x] Set different VK per DAO ✓
- [x] Vote with old VK hash after VK change fails ✓
- [x] IC length validated at set_vk ✓

**Multi-Proposal VK Tests** (`tests/integration/`):
- [x] Proposal pinning keeps VK snapshot under rotation ✓
- [ ] Extra scenarios (parallel proposals with different VKs) optional

---

### 4. Merkle Tree & Poseidon

**Poseidon Parity Tests** (`contracts/membership-tree/src/test.rs`):
- [x] Basic Poseidon KATs (single/multiple/zero) ✓
- [x] Merkle KATs via golden vectors ✓
- [ ] Additional small-vector KATs (optional)

**Tree Edge Cases** (`contracts/membership-tree/src/test.rs`):
- [x] Register commitment before init_tree panics ✓
- [x] Register commitment twice panics ✓
- [x] Cross-DAO misuse coverage (commitment from DAO A in DAO B) ✓
- [ ] Large-tree stress (capacity/gas) pending

---

### 5. Voting Lifecycle & Isolation

**Cross-DAO Isolation Tests** (`tests/integration/`):
- [x] Same nullifier, different DAOs succeed ✓
- [x] Same proposalId isolated per DAO ✓
- [x] Vote in DAO A with DAO B commitment should fail ✓ (unit coverage)
- [x] Nullifier formula includes daoId/proposalId (documented; storage keyed by dao/proposal) ✓

**Nullifier Replay Tests** (`contracts/voting/src/test.rs`):
- [x] Same nullifier, same proposal panics ✓
- [x] Same nullifier, different proposals in same DAO succeeds ✓
- [x] Same nullifier, different DAOs succeeds ✓
- [x] Storage key includes dao_id/proposal_id/nullifier ✓

**Voting Window Tests** (`contracts/voting/src/test.rs`):
- [x] Vote before end_time ✓
- [x] Vote after end_time panics ✓
- [x] Create proposal with past end_time panics ✓
- [ ] Vote with future timestamp (time-travel) not applicable in tests

**Snapshot Eligibility Tests** (`tests/integration/`):
- [ ] Member joins after proposal creation - cannot vote (wrong root)
- [ ] Member leaves (SBT remains) - can still vote (commitment permanent)
- [ ] Root changes mid-vote - old votes still valid, new voters use old root

**FSM Transition Tests** (`contracts/voting/src/test.rs`):
- [x] Close -> vote panics ✓
- [x] Archive -> vote panics ✓
- [x] Archive without close panics ✓
- [x] Close after archive panics ✓
- [x] Reopen (Closed/Archived -> Active) impossible (no path) ✓

---

### 6. Backend & E2E

**Backend Input Validation** (backend tests):
- [x] Missing/invalid env (VOTING_CONTRACT_ID/TREE_CONTRACT_ID) exits ✓
- [x] Invalid contract ID format exits ✓
- [x] Malformed proof hex rejected (odd length, non-hex) ✓
- [x] Proof with all-zero components rejected ✓
- [x] Public signal > BN254 field rejected ✓

**Proof Converter Tests** (`circuits/utils`):
- [x] Conversion script added; BE ordering documented ✓
- [x] Automated test for proof_to_soroban conversion/ordering/byte order ✓ (`circuits/utils/test/proof_converter.test.js`)

**E2E Integration**:
- [x] Full deployment + automated VK loading ✓
- [x] Real proof vote succeeds ✓
- [x] Wrong root fails ✓
- [x] Reused nullifier fails (real proof) ✓ (`test_real_proof_double_vote_rejected`)
- [x] Stress (large members/proposals) ignored test added ✓ (`tests/integration/tests/stress.rs`, run with --ignored)

---

### 7. Security-Specific Tests

**Point Validation Tests** (`contracts/voting/src/test.rs`):
- [x] Off-curve proof points rejected via pairing ✓
- [ ] Invalid G1 in VK alpha/IC panic (future negatives)
- [ ] G2 subgroup validation (deferred until cofactor check)

**Storage Exhaustion Tests** (`contracts/`):
- [x] Description length capped at 1024 ✓
- [x] DAO name capped at 256 ✓
- [ ] Contract size limits
- [ ] Stress test: 1000 members in tree (gas cost analysis)
- [ ] Stress test: 100 proposals per DAO

---

## Implementation Priority

### Phase 1: High-Priority Security (Now)
1. Subgroup G2 negative fixture (if host adds check)
2. Real-proof nullifier replay negative

### Phase 2: Medium-Priority DoS (Next)
3. Large-tree/proposal stress + budget sims
4. Backend input validation suite

### Phase 3: Low-Priority Correctness (Later)
5. Cross-DAO commitment misuse negative
6. Snapshot mid-vote root-change optional tests
7. Proof converter automated tests

---

## Test Coverage Metrics

**Current Coverage**: Full workspace test suite green (unit + integration, real proof paths). Exact counts fluctuate with new cases; coverage focus is on edge conditions rather than totals.

---

## Related Documents

- `SPEC_DRIFT.md` - All spec/code alignment issues (100% resolved)
- `README.md` - Updated with security considerations
- `audit.md` - Security audit findings (if exists)
- `contracts/*/src/test.rs` - Existing test suites
