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

**Note:** With CAP-0058 constructors, initialization happens at deployment time. The contracts require dependency addresses passed to their constructors. See `scripts/init-local.sh` for details.

For testing, use the integration test suite which properly initializes contracts:
```bash
cargo test -p daovote-integration-tests
```

## How It Works

### 1. Create a DAO
```rust
// Anyone can create a DAO
let dao_id = registry.create_dao("My DAO", admin_address);
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
    "Fund development",
    end_time,       // Unix timestamp (must be in the future)
    creator_address
);
// Voting starts immediately - Merkle root snapshot taken at creation
// This defines the eligible voter set
```

### 5. Vote Anonymously
```rust
// First fetch the proposal to get the eligible voter set root
let proposal = voting.get_proposal(dao_id, proposal_id);
let root = proposal.eligible_root;  // Must use this exact root

// Generate ZK proof off-chain proving:
// - Membership in Merkle tree at eligible_root
// - Valid nullifier derivation
// - Binary vote choice

voting.vote(
    dao_id,
    proposal_id,
    vote_choice,  // true=yes, false=no
    nullifier,    // Prevents double voting
    root,         // Must match proposal.eligible_root
    proof         // Groth16 proof
);
```

## ZK Circuit

The vote circuit (`circuits/vote.circom`) proves:

1. **Membership**: `Poseidon(secret, salt) = commitment ∈ MerkleTree`
2. **Nullifier**: `Poseidon(secret, daoId, proposalId) = nullifier` (domain-separated)
3. **Vote validity**: `voteChoice ∈ {0, 1}`

Public signals: `[root, nullifier, daoId, proposalId, voteChoice]`
Private inputs: `[secret, salt, pathElements, pathIndices]`

**Domain-Separated Nullifiers**: The nullifier includes `daoId` to prevent cross-DAO voter linkability. A voter reusing the same secret across different DAOs cannot be correlated.

Tree depth: 20 levels (supports ~1M members per DAO)

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

- **Trusted Setup**: Groth16 requires a ceremony for the proving key
- **Secret Management**: Voter secrets must be kept private
- **Nullifier Design**: Unique per (secret, daoId, proposalId) with domain separation
- **Eligible Voter Set**: Merkle root snapshotted at proposal creation prevents sybil attacks
- **VK Immutability**: VK hash snapshotted per proposal prevents mid-vote changes

### Important Limitations (see [spec.md](./spec.md) Section 11 for details)

- **Identity Anonymity ≠ Vote Secrecy**: `voteChoice` is a public signal. System hides WHO voted, but vote choices are visible on-chain. For true ballot secrecy, MACI-style encryption is needed (planned future).
- **Membership Revocation**: Removed members retain voting ability because commitments are permanent in the append-only Merkle tree. Snapshot-based eligibility recommended for stricter control.
- **VK Admin Trust**: DAO admin controls the verification key. Members must trust admin to set a legitimate VK and not change it maliciously. Consider VK immutability for production.
- **Poseidon Compatibility**: Circuit (circomlib) and on-chain (P25) Poseidon implementations MUST use identical parameters. A Known-Answer Test should verify compatibility before deployment.

## License

MIT
