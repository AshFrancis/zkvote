# DaoVote - Anonymous DAO Voting on Stellar

Zero-knowledge anonymous DAO voting on Stellar Soroban using Protocol 25 (BN254 + Poseidon).

**Version:** 1.0.0 - Multi-Tenant Architecture with Real Groth16 Verification

## Overview

DaoVote enables anonymous voting for decentralized autonomous organizations (DAOs) on Stellar's Soroban platform:

- **Multi-tenant architecture** - Anyone can create DAOs permissionlessly
- **Soulbound NFT membership** - Non-transferable tokens for DAO membership
- **Fully on-chain Poseidon Merkle tree** - Identity commitments stored on-chain
- **Groth16 ZK proofs** - Real BN254 pairing verification using P25 host functions
- **Anonymous voting** - Vote without revealing identity or choice linkage
- **Backend relayer** - Transaction anonymity layer (Launchtube planned for mainnet)

### Verifying Key Versioning

- Each DAO tracks a `vk_version` in the voting contract. Proposals snapshot the active version at creation, and votes must prove against that version.
- The frontend surfaces vk version in Members, proposal cards, and the public votes page so users see the expected verifier.
- When rotating circuits/VKs, set the new vk on-chain and confirm the UI shows the incremented version before accepting proofs.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  DAORegistry │────▶│MembershipSBT │────▶│MembershipTree│────▶│    Voting    │
│              │     │              │     │              │     │              │
│ create_dao   │     │ mint(dao_id) │     │ register_    │     │ vote(proof)  │
│ get_admin    │     │ has(dao_id)  │     │ commitment   │     │ verify_      │
│              │     │              │     │              │     │ groth16      │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
       ▲                     ▲                    ▲                    ▲
       │                     │                    │                    │
       └─────────────────────┴────────────────────┴────────────────────┘
                         Cross-contract admin verification
```

**Contract Dependency Chain**:
- Voting contract stores `tree_contract` address (from constructor)
- Voting derives `sbt_contract` by calling `tree.sbt_contract()` on each operation
- Voting derives `registry` by calling `sbt.registry()` when needed
- This derivation approach (vs direct storage) ensures:
  - Always uses correct contract references
  - Resilient to contract upgrades
  - Prevents stale reference bugs
  - Maintains single source of truth
  - Negligible overhead from cross-contract calls

### Contracts (65 tests passing)

| Contract | Description | Size | Tests |
|----------|-------------|------|-------|
| **dao-registry** | Permissionless DAO creation & admin management | 3.4KB | 8 |
| **membership-sbt** | Multi-tenant Soulbound NFT membership (CAP-0058 constructor) | 2.3KB | 11 |
| **membership-tree** | On-chain Poseidon Merkle tree (CAP-0058 constructor) | 27KB | 15 |
| **voting** | Groth16 verification + vote tallying (CAP-0058 constructor) | 14KB | 18 |
| **integration** | Cross-contract flow tests | - | 13 |

## Project Structure

```
daovote/
├── contracts/
│   ├── dao-registry/      # DAO creation & admin management
│   ├── membership-sbt/    # Soulbound membership NFTs
│   ├── membership-tree/   # On-chain Poseidon Merkle tree
│   └── voting/            # Groth16 verification + voting
├── circuits/              # Circom ZK circuits
│   ├── vote.circom        # Main vote proof circuit
│   ├── merkle_tree.circom # Poseidon Merkle inclusion
│   └── utils/             # VK/proof conversion tools
├── tests/
│   └── integration/       # Cross-contract integration tests
└── backend/               # Relayer service for anonymous voting
```

## Prerequisites

- **Rust** (stable) - https://rustup.rs/
- **wasm32v1-none target** - `rustup target add wasm32v1-none`
- **Stellar CLI** - `cargo install stellar-cli`
- **Node.js** (v18+) - https://nodejs.org/
- **Circom** & **SnarkJS** - For circuit compilation

## Quick Start

### 1. Build Contracts

```bash
cargo build --target wasm32v1-none --release
```

### 2. Run Tests

```bash
# Run all 61 tests
cargo test --workspace

# Run integration tests only
cargo test -p daovote-integration-tests
```

### 3. Deploy Contracts (Local P25 Network)

**Using helper scripts (recommended):**
```bash
# Complete setup: start network, fund account, build, test
./scripts/setup-local.sh

# Deploy all contracts
./scripts/deploy-local.sh

# Initialize (generates backend/.env)
./scripts/init-local.sh
```

**Manual deployment:**
```bash
# Start local network
stellar container start -t future
stellar keys fund mykey --network local

# Deploy all contracts
stellar contract deploy \
  --wasm target/wasm32v1-none/release/dao_registry.wasm \
  --source mykey --network local

stellar contract deploy \
  --wasm target/wasm32v1-none/release/membership_sbt.wasm \
  --source mykey --network local

stellar contract deploy \
  --wasm target/wasm32v1-none/release/membership_tree.wasm \
  --source mykey --network local

stellar contract deploy \
  --wasm target/wasm32v1-none/release/voting.wasm \
  --source mykey --network local
```

### 4. Initialize Contracts

**CAP-0058 Constructor Pattern**: All contracts use modern `__constructor` pattern called automatically at deployment:

```rust
// MembershipSBT constructor - called at deploy time
pub fn __constructor(env: Env, registry: Address) {
    env.storage().instance().set(&REGISTRY, &registry);
}

// MembershipTree constructor - called at deploy time
pub fn __constructor(env: Env, sbt_contract: Address) {
    env.storage().instance().set(&SBT_CONTRACT, &sbt_contract);
}

// Voting constructor - called at deploy time
pub fn __constructor(env: Env, tree_contract: Address) {
    env.storage().instance().set(&TREE_CONTRACT, &tree_contract);
}
```

**Deployment with constructors** (see `scripts/deploy-local.sh`):
```bash
# Deploy in dependency order, passing constructor args with '-- --argname value'
stellar contract deploy --wasm dao_registry.wasm --source mykey --network local

stellar contract deploy --wasm membership_sbt.wasm --source mykey --network local \
  -- --registry $REGISTRY_ID

stellar contract deploy --wasm membership_tree.wasm --source mykey --network local \
  -- --sbt_contract $SBT_ID

stellar contract deploy --wasm voting.wasm --source mykey --network local \
  -- --tree_contract $TREE_ID
```

For testing, use the integration test suite which properly initializes contracts:
```bash
cargo test -p daovote-integration-tests
```

## How It Works

### 1. Create a DAO
```rust
// Anyone can create a DAO (permissionless)
// Creator automatically becomes admin
let dao_id = registry.create_dao(
    "My DAO",          // Max 256 chars (DoS protection)
    creator_address    // Must auth - becomes admin automatically
);
// Cannot create DAOs for others without their consent
```

### 2. Add Members (Admin only)
```rust
// Admin mints SBT to member
sbt.mint(dao_id, member_address, admin_address);
```

### 3. Register Identity Commitment (Members)
```rust
// Member generates: commitment = Poseidon(secret, salt)
// Then registers on-chain:
tree.register_with_caller(dao_id, commitment, member_address);
```

### 4. Create Proposal (Members)
```rust
let proposal_id = voting.create_proposal(
    dao_id,
    "Fund development",        // Max 1024 chars
    end_time,                  // Unix timestamp (must be in the future)
    creator_address
);
// Voting starts immediately - Merkle root snapshot taken at creation
// This defines the eligible voter set (snapshot-based eligibility)
```

**Proposal Data Model**:
```rust
pub struct ProposalInfo {
    pub id: u64,
    pub dao_id: u64,
    pub description: String,    // Max 1024 chars (DoS protection)
    pub yes_votes: u64,
    pub no_votes: u64,
    pub end_time: u64,         // Unix timestamp
    pub created_by: Address,   // Proposal creator
    pub vk_hash: BytesN<32>,   // SHA256 of VK (prevents mid-vote VK changes)
    pub eligible_root: U256,   // Merkle root snapshot (defines voter set)
}
```

### 5. Vote Anonymously

**Snapshot-Based Eligibility**: Only members present when the proposal was created can vote.

```rust
// First fetch the proposal to get the eligible voter set root
let proposal = voting.get_proposal(dao_id, proposal_id);
let root = proposal.eligible_root;  // Must use this exact root (snapshot)

// Generate ZK proof off-chain proving:
// - Membership in Merkle tree at eligible_root (snapshot at proposal creation)
// - Valid nullifier derivation
// - Binary vote choice

voting.vote(
    dao_id,
    proposal_id,
    vote_choice,  // true=yes, false=no
    nullifier,    // Prevents double voting (scoped to proposal)
    root,         // Must EXACTLY match proposal.eligible_root
    proof         // Groth16 proof
);
```

**Why Snapshot-Based**:
- Clear, unambiguous eligibility rules
- Prevents late-joining governance attacks
- No complex root history tracking needed
- More secure than flexible root acceptance
- Members who join after proposal creation cannot vote (prevents manipulation)

## ZK Circuit

The vote circuit (`circuits/vote.circom`) proves:

1. **Membership**: `Poseidon(secret, salt) = commitment ∈ MerkleTree`
2. **Nullifier**: `Poseidon(secret, daoId, proposalId) = nullifier` (domain-separated)
3. **Vote validity**: `voteChoice ∈ {0, 1}`

Public signals: `[root, nullifier, daoId, proposalId, voteChoice]`
Private inputs: `[secret, salt, pathElements, pathIndices]`

**Domain-Separated Nullifiers**:
- Formula: `nullifier = Poseidon(secret, daoId, proposalId)`
- Scoped per `(dao_id, proposal_id)` pair
- Prevents double voting on the same proposal
- Allows reuse of same secret across different proposals and DAOs
- No cross-DAO or cross-proposal linkability
- Nullifiers stored as: `(symbol_short!("null"), dao_id, proposal_id, nullifier) -> bool`

Tree depth: 18 levels (supports ~262,144 members per DAO, 2^18)

## Groth16 Verification

Real BN254 pairing verification using P25 host functions:

```rust
// Verification equation:
// e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) = 1

// Compute vk_x = IC[0] + sum(pub_signals[i] * IC[i+1])
let vk_x = compute_vk_x(env, vk, pub_signals);

// Perform pairing check
env.crypto().bn254().pairing_check(g1_vec, g2_vec)
```

## Key Features

- **Permissionless** - Anyone can create DAOs without permission
- **Multi-tenant** - Single contract set serves all DAOs
- **Gas efficient** - Incremental Merkle tree updates
- **Secure** - Real cryptographic verification (not mocked)
- **Anonymous** - No link between voter and vote
- **Auditable** - All state verifiable on-chain

## Testing

```bash
# All tests (61 total)
cargo test --workspace

# Specific contract
cargo test -p dao-registry
cargo test -p membership-sbt
cargo test -p membership-tree
cargo test -p voting
cargo test -p daovote-integration-tests

# Build release WASM
cargo build --target wasm32v1-none --release
```

### Poseidon KAT (Critical Pre-deployment Test)

**MUST pass before production deployment** - verifies circuit and on-chain Poseidon match:

```bash
# Generate circomlib test vectors
node circuits/utils/poseidon_kat.js

# Generate Merkle root expected values
node scripts/poseidon-kat-verify.js

# Run full E2E test on P25 testnet (requires Docker)
./scripts/e2e-poseidon-kat.sh
```

If KAT fails, circuit and on-chain Poseidon parameters don't match - system will not work.

## Development Status

- [x] DAORegistry contract (multi-tenant DAO creation)
- [x] MembershipSBT contract (DAO-scoped SBTs)
- [x] MembershipTree contract (on-chain Poseidon)
- [x] Voting contract (Groth16 verification)
- [x] Circom circuits (vote proof)
- [x] Integration tests (12 cross-contract tests)
- [x] Real BN254 pairing verification
- [x] Backend relayer (local relay service)
- [ ] Frontend/CLI interface
- [ ] Circuit integration testing (end-to-end with real proofs)

## Resources

- [CLAUDE.md](./claude.md) - Development context & AI instructions
- [spec.md](./spec.md) - Technical specification
- [circuits/README.md](./circuits/README.md) - Circuit documentation
- [P25 Preview Examples](https://github.com/jayz22/soroban-examples/tree/p25-preview/p25-preview)
- [CAP-0059: ZK Primitives](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0059.md)

## Security Considerations

### Cryptographic Security
- **Trusted Setup**: Groth16 requires a ceremony for the proving key
- **Secret Management**: Voter secrets must be kept private
- **Nullifier Design**: Unique per (secret, daoId, proposalId) with domain separation
- **Eligible Voter Set**: Merkle root snapshotted at proposal creation prevents sybil attacks
- **VK Immutability**: VK hash snapshotted per proposal prevents mid-vote changes
- **Point Validation**: G1 points validated on curve (y² = x³ + 3 mod p) to prevent invalid curve attacks
- **Field Membership**: All public signals validated to be in BN254 scalar field

### DoS Protection
- **DAO Names**: Max 256 characters
- **Proposal Descriptions**: Max 1024 characters (1KB)
- **VK IC Length**: Exactly 6 elements (5 public signals + 1) for vote circuit
- **Tree Depth**: Max 20 levels (supports ~1M members)
- **Backend Rate Limiting**: 10 votes/min, 60 queries/min per IP

### Input Validation
- **Hex Strings**: Even-length required, format validated
- **Contract IDs**: Stellar address format validation
- **Proof Components**: Cannot be all zeros
- **BN254 Field**: Values must be < field modulus

### Important Limitations (see [spec.md](./spec.md) Section 11 for details)

- **Identity Anonymity ≠ Vote Secrecy**: `voteChoice` is a public signal. System hides WHO voted, but vote choices are visible on-chain. For true ballot secrecy, MACI-style encryption is needed (planned future).
- **Membership Revocation**: Removed members retain voting ability because commitments are permanent in the append-only Merkle tree. Snapshot-based eligibility recommended for stricter control.
- **VK Admin Trust**: DAO admin controls the verification key. Members must trust admin to set a legitimate VK and not change it maliciously. Consider VK immutability for production.
- **Poseidon Compatibility**: Circuit (circomlib) and on-chain (P25) Poseidon implementations MUST use identical parameters. A Known-Answer Test should verify compatibility before deployment.

## License

MIT
