# Spec/Code Drift Analysis

This document tracks discrepancies between the specification (README, docs) and the actual implementation. Issues are categorized by severity.

Last updated: 2025-11-18

---

## 🔴 Critical (Security/DoS Risks)

### 1. No size limits on string/payload inputs
**Location**: Multiple contracts
**Risk**: DoS attacks via large payloads

**Issues**:
- `Voting::create_proposal` - no limit on `description` string length
- `Voting::set_vk` - no limit on VK byte payloads beyond IC length (<=21)
- `DAORegistry::create_dao` - no limit on `name` string length

**Impact**: Attackers can cause storage exhaustion or high transaction costs

**Recommendation**: Add explicit size constraints:
```rust
// Example for descriptions
const MAX_DESCRIPTION_LEN: u32 = 1024;
require!(description.len() <= MAX_DESCRIPTION_LEN, "description too long");

// Example for VK IC
const MAX_VK_IC_LEN: u32 = 21;
require!(vk.ic.len() <= MAX_VK_IC_LEN, "VK IC too large");
```

**Status**: ⚠️ Needs fixing before mainnet

---

### 2. `set_vk` validation incomplete
**Location**: `contracts/voting/src/lib.rs:100`

**Issue**: Only checks `ic.len() <= 21` and non-empty, doesn't enforce relationship between IC length and number of public signals.

**Current code**:
```rust
require!(!vk.ic.len().is_zero(), "VK IC cannot be empty");
require!(vk.ic.len() <= 21, "VK IC too large");
```

**Spec expectation**: IC should have exactly `num_public_signals + 1` points

**Impact**: Mismatched VK can cause verification failures at vote time instead of setup time

**Recommendation**:
```rust
// Vote circuit has 5 public signals: root, nullifier, daoId, proposalId, voteChoice
const EXPECTED_IC_LEN: u32 = 6; // num_public_signals + 1
require!(vk.ic.len() == EXPECTED_IC_LEN, "VK IC length mismatch");
```

**Status**: ⚠️ Add validation before mainnet

---

### 3. Backend hex string validation gaps
**Location**: `backend/src/relayer.js`

**Issues**:
- No even-length check for hex strings
- Assumes correct byte order from circuit output
- No validation of BN254 field membership for public signals

**Current code**: Only checks max length, not validity
```javascript
function hexToBytes(hex, expectedLength) {
  // Missing: even-length check, field validation
  if (hex.length > expectedLength * 2) {
    throw new Error(`Hex too long: ${hex.length}, max ${expectedLength * 2}`);
  }
  // ...
}
```

**Recommendation**:
```javascript
function hexToBytes(hex, expectedLength) {
  // Validate hex string
  if (hex.length % 2 !== 0) {
    throw new Error('Hex string must have even length');
  }
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('Invalid hex string');
  }
  // ... rest of validation
}
```

**Status**: ⚠️ Add validation

---

## 🟡 Medium (Spec Inconsistencies - Need Clarification)

### 4. DAORegistry permissionless creation
**Location**: `contracts/dao-registry/src/lib.rs:18`

**Spec**: README states "permissionless DAO creation (anyone can create)"

**Code**: Requires admin authentication:
```rust
pub fn create_dao(env: Env, name: String, admin: Address) -> u64 {
    admin.require_auth(); // ← Contradicts "permissionless"
    // ...
}
```

**Question**: Should DAO creation be truly permissionless, or should only the admin initialization require auth?

**Options**:
1. **Remove auth check**: Allow anyone to create DAOs (matches spec)
2. **Update spec**: Document that admin must authorize their own DAO creation
3. **Separate functions**: `create_dao()` permissionless, `set_admin()` requires auth

**Status**: ⚠️ Clarify intended behavior

---

### 5. Tree depth discrepancy
**Location**: `contracts/membership-tree/src/lib.rs`

**Spec**: README emphasizes depth 20 (supports ~1M members) or 24

**Code**: Caps at depth 32:
```rust
require!(depth <= 32, "depth too large");
```

**Gap**: Why allow depths 25-32 if spec recommends 20-24?

**Considerations**:
- Depth 32 = 4B leaves (impractical gas costs for proof verification)
- Merkle proof size scales linearly with depth (32 hashes vs 20)
- Higher depths = higher circuit constraints

**Recommendation**: Either:
1. Enforce stricter limit matching spec (e.g., `depth <= 24`)
2. Update spec to document support for depths up to 32 with performance warnings

**Status**: 📝 Clarify intended max depth

---

### 6. Voting root verification strictness
**Location**: `contracts/voting/src/lib.rs:vote()`

**Spec**: Mentions `root_ok` to accept "any recent root" (allows late members to vote)

**Code**: Enforces strict equality to snapshot at proposal creation:
```rust
// Snapshotted at proposal creation:
let eligible_root: U256 = env.storage().persistent().get(&root_key).unwrap();

// Later in vote():
require!(root == eligible_root, "root mismatch");
```

**Impact**:
- ✅ **Stricter** = prevents late-joining members from voting (clearer rules)
- ❌ **Less flexible** = members who join after proposal creation cannot vote

**Trade-offs**:
- Current (strict): Clear eligibility snapshot, prevents governance attacks
- Spec (flexible): More inclusive, but complex root history tracking needed

**Recommendation**: Keep current strict behavior, update spec to reflect snapshot-based eligibility

**Status**: 📝 Update spec to match implementation

---

### 7. `sbt_contr` storage
**Location**: `contracts/voting/src/lib.rs`

**Spec**: Lists `sbt_contr` as stored in voting contract

**Code**: Does NOT store SBT address, derives it via tree each call:
```rust
// Not stored in voting contract
let sbt_contract: Address = env.invoke_contract(
    &tree_contract,
    &symbol_short!("sbt_contr"),
    soroban_sdk::vec![&env],
);
```

**Impact**: Extra cross-contract call on every operation vs direct storage

**Trade-offs**:
- Current (derive): Always uses correct SBT even if tree is upgraded
- Spec (store): Faster, fewer cross-contract calls

**Recommendation**: Document that SBT address is derived, not stored (matches current code)

**Status**: 📝 Update spec

---

## 🟢 Low (Documentation Drift)

### 8. Voting start time
**Location**: `contracts/voting/src/lib.rs:vote()`

**Code**: Voting starts immediately upon proposal creation (no `start_time` field)

**Spec**: Matches README flow ("create proposal → vote → tally")

**Issue**: No way to schedule delayed voting start

**Impact**: Minor - can work around by creating proposals at desired start time

**Status**: ✅ Code matches spec, no action needed

---

### 9. Voting data model fields
**Location**: `contracts/voting/src/lib.rs:Proposal`

**Spec**: Lists minimal `Proposal {description, end_time, yes/no}`

**Code**: Includes additional fields:
```rust
pub struct Proposal {
    pub created_by: Address,
    pub description: String,
    pub end_time: u64,
    pub yes_votes: u64,
    pub no_votes: u64,
    pub vk_hash: BytesN<32>,      // ← Not in spec
    pub eligible_root: U256,      // ← Not in spec
}
```

**Impact**: None - additional fields support audit trail and security

**Status**: 📝 Update spec to document full data model

---

### 10. Nullifier scoping
**Location**: `contracts/voting/src/lib.rs`

**Spec**: "stores nullifiers per epoch"

**Code**: Scopes nullifiers per `(dao_id, proposal_id)` pair:
```rust
let nullifier_key = (symbol_short!("null"), dao_id, proposal_id, nullifier);
```

**Impact**: None - code is more precise (matches circuit's nullifier formula)

**Circuit formula**:
```javascript
nullifier = Poseidon(secret, daoId, proposalId)
```

**Status**: ✅ Code is correct, spec terminology could be clearer

---

### 11. MembershipSBT initialization
**Location**: `contracts/membership-sbt/src/lib.rs`

**Spec**: Shows `init` function

**Code**: Uses CAP-0058 `__constructor`:
```rust
#[contractimpl]
impl MembershipSBT {
    pub fn __constructor(env: Env, registry: Address) {
        // No reinit guard needed - constructor only called once at deploy
    }
}
```

**Impact**: None - constructor pattern is more modern and secure

**Status**: 📝 Update spec to show constructor pattern

---

### 12. MembershipTree admin check
**Location**: `contracts/membership-tree/src/lib.rs:init_tree()`

**Spec**: No explicit admin check documented

**Code**: Requires admin auth via SBT→registry chain:
```rust
pub fn init_tree(env: Env, dao_id: u64, depth: u32, admin: Address) {
    admin.require_auth();

    // Verify admin via: tree -> sbt -> registry
    let sbt_contract: Address = env.storage().instance().get(&SBT_CONTRACT).unwrap();
    let registry_addr: Address = env.invoke_contract(...);
    let dao_admin: Address = env.invoke_contract(...);
    require!(dao_admin == admin, "unauthorized");
}
```

**Impact**: Good - prevents unauthorized tree initialization

**Status**: 📝 Document admin verification in spec

---

## Summary

| Severity | Count | Action Required |
|----------|-------|-----------------|
| 🔴 Critical | 3 | Fix before mainnet |
| 🟡 Medium | 4 | Clarify/align spec ↔ code |
| 🟢 Low | 5 | Documentation updates |

### Recommended Priority

1. **Immediate** (before mainnet):
   - Add size limits to prevent DoS
   - Strengthen `set_vk` validation
   - Add backend hex validation

2. **Short-term** (clarify design):
   - Decide on DAORegistry permissionless creation
   - Document max tree depth policy
   - Update spec for root verification strictness

3. **Documentation** (ongoing):
   - Update spec to reflect actual data models
   - Document constructor patterns
   - Clarify nullifier scoping terminology

---

## Related Documents

- `audit.md` - Security audit findings
- `README.md` - Project specification
- `backend/README.md` - Backend documentation
- `scripts/README.md` - Deployment guide
