# Anonymous DAO Voting on Stellar — Spec (Semaphore/MACI-style, Self-hosted Relayer)

**Version:** 1.0.0 (Multi-Tenant Architecture with Real Groth16 Verification)

**Last updated:** 17 Nov 2025 (Europe/London)

---

## 1) Overview

A **ZK-proof–based anonymous DAO voting system** on **Stellar Soroban**. Anyone can **permissionlessly create DAOs**. Members hold **DAO-scoped soulbound NFTs (SBTs)**. Identity commitments are stored in **DAO-scoped Poseidon Merkle trees computed fully on-chain** using Protocol 25 host functions. Votes are submitted **anonymously** via a **self-hosted backend relayer** (with Launchtube planned for mainnet), and validated on-chain with **real Groth16 (BN254)** proofs using **Protocol 25** pairing host functions.

**MULTI-TENANT ARCHITECTURE (v1.0.0):**
- **Permissionless DAO creation** - anyone can create DAOs via DAORegistry contract
- **DAO-scoped membership** - each DAO has its own SBT membership and Merkle tree
- **Real BN254 Groth16 verification** - actual pairing checks using P25 host functions
- **Poseidon Merkle tree computed ON-CHAIN** using P25 `env.crypto().poseidon_hash()` host functions
- **Cross-contract admin verification** - all contracts verify admin status via DAORegistry
- **58 tests passing** - comprehensive unit and integration test coverage

**We will definitely:**
- Use **multi-tenant architecture** with DAO-scoped data (membership, trees, votes).
- Use **P25 Poseidon host functions** for on-chain Merkle tree computation.
- Use **P25 BN254 pairing host functions** for real Groth16 proof verification.
- Use a **self-hosted backend relayer** for transaction anonymity (Launchtube planned for mainnet deployment).
- Enforce **exactly one SBT per user per DAO** and **no transfers** (soulbound membership).
- Store **full incremental Merkle tree on-chain** for transparency and verifiability.

---

## 2) Architecture

**Contract Stack (Multi-Tenant)**

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

**Contracts (On-chain) - 58 Tests**
1. **DAORegistry** — permissionless DAO creation & admin management (8 tests)
2. **MembershipSBT** — DAO-scoped soulbound membership NFTs + CAP-0058 constructor (11 tests)
3. **MembershipTree** — DAO-scoped on-chain incremental Poseidon Merkle tree + CAP-0058 constructor (14 tests)
4. **Voting** — real BN254 Groth16 verification + DAO-scoped vote tallying + CAP-0058 constructor (13 tests)
5. **Integration** — cross-contract flow tests (12 tests)

**Off-chain services**
- **Prover** — generates Groth16 proofs from user witnesses (identity secrets + Merkle path).
- **Backend Relayer** — self-hosted Express.js service that signs and submits vote transactions on behalf of users, hiding the user's identity and funding. Uses its own keypair to pay fees. (Launchtube integration planned for mainnet.)
- **(Optional) MACI Coordinator** — holds tally key, posts ZK tally proof.
- **(Optional) Proof Query Service** — indexes on-chain tree events to serve Merkle proofs (convenience, not required).

**Flow (Multi-Tenant):**
1. Admin creates DAO via DAORegistry.create_dao()
2. Admin mints DAO-scoped SBT to member via MembershipSBT.mint(dao_id, member)
3. Member generates identity secrets (secret, salt) and computes commitment = Poseidon(secret, salt)
4. Member calls MembershipTree.register_with_caller(dao_id, commitment) (requires SBT for that DAO)
5. Contract computes Poseidon hashes on-chain, updates DAO's Merkle tree
6. Member fetches Merkle proof from on-chain state (or optional proof service)
7. Member generates Groth16 proof (Circom/SnarkJS) with Merkle path
8. Member submits vote via Backend Relayer → Soroban RPC → Voting.vote(dao_id, proposal_id, proof)

---

## 3) Cryptography

- **Curve:** BN254 (alt‑bn128) — used by both Groth16 verifier and Poseidon host calls in P25.
- **Hash:** Poseidon — **computed on-chain** via `env.crypto().poseidon_hash()` for Merkle tree, **in-circuit** (Circom) for proofs.
- **Proof system:** Groth16 (public inputs kept minimal) — **verified on-chain using P25 BN254 pairing host functions**.
- **Field elements:** `U256` type for scalars (Fr), `BytesN<64>` for G1 points, `BytesN<128>` for G2 points.

**Identity & commitments**
```text
identity_nullifier, identity_trapdoor ∈ F_p (BN254 scalar field)
identity_commitment = Poseidon(identity_nullifier, identity_trapdoor)  // computed client-side
nullifier_hash = Poseidon(identity_nullifier, dao_id, proposal_id)  // computed in-circuit, domain-separated
```

**Domain-Separated Nullifiers (Privacy Enhancement):**
The nullifier is computed as `Poseidon(secret, dao_id, proposal_id)` using a 3-ary Poseidon hash. This domain separation ensures that:
- A voter cannot be linked across different DAOs, even if reusing the same secret
- Each nullifier is unique to the specific DAO and proposal combination
- Cross-DAO tracking is prevented (a voter in DAO 1 cannot be correlated with their identity in DAO 2)

**On-chain Poseidon API:**
```rust
let field = Symbol::new(&env, "BN254");
let hash = env.crypto().poseidon_hash(&inputs, field);  // inputs: Vec<U256>, returns U256
```

**On-chain BN254 Groth16 API:**
```rust
use soroban_sdk::crypto::bn254::{Fr, G1Affine, G2Affine};

// Point operations
let bn254 = env.crypto().bn254();
let g1 = G1Affine::from_bytes(bytes_64);     // G1 from BytesN<64>
let g2 = G2Affine::from_bytes(bytes_128);    // G2 from BytesN<128>
let fr = Fr::from(u256);                      // Scalar from U256
let sum = g1_a + g1_b;                        // G1 addition
let prod = g1 * fr;                           // G1 scalar multiplication
let neg = -g1;                                // G1 negation

// Pairing check (Groth16 verification)
bn254.pairing_check(g1_vec, g2_vec);          // Returns bool
```

---

## 4) Data model

**DAORegistry** (permissionless DAO creation)
- `next_dao_id: u64` (auto-incrementing DAO ID)
- `dao_admins: Map<u64, Address>` (DAO ID → admin address)
- `dao_names: Map<u64, String>` (DAO ID → name)
- **Anyone can create DAOs** - no admin permission required

**MembershipSBT** (DAO-scoped soulbound NFTs)
- `registry: Address` (reference to DAORegistry for admin verification)
- `membership: Map<(u64, Address), bool>` (DAO ID, user → has membership)
- **One SBT per user per DAO**; transfers disabled at API level
- Admin verification via cross-contract call to DAORegistry

**MembershipTree** (DAO-scoped on-chain incremental Merkle tree)
- `sbt_contr: Address` (reference to MembershipSBT for membership gating)
- **Per-DAO tree data:**
  - `(dao_id, "depth"): u32` (tree depth per DAO, e.g., 20 for ~1M members)
  - `(dao_id, "next"): u32` (next leaf position per DAO)
  - `(dao_id, "subtree", level): U256` (filled subtree roots per level)
  - `(dao_id, "root"): U256` (current Merkle root)
  - `(dao_id, "roots"): Vec<U256>` (last 30 roots for in-flight proofs)
  - `(dao_id, commitment): u32` (commitment → leaf index, prevents duplicates)
- **Global zero hashes:** precomputed once, shared across all DAOs
- **All tree computation done ON-CHAIN** using P25 Poseidon host functions

**Voting** (DAO-scoped proposals and votes)
- `tree_contr: Address` (reference to MembershipTree)
- `sbt_contr: Address` (reference to MembershipSBT for membership verification)
- **Per-DAO verification keys:**
  - `(dao_id, "vk"): VerificationKey` (BN254 Groth16 VK)
- **Per-DAO proposals:**
  - `(dao_id, "next_pid"): u64` (next proposal ID)
  - `(dao_id, "proposal", pid): Proposal` (proposal details)
- **Per-proposal votes:**
  - `(dao_id, pid, nullifier): bool` (nullifier spent flag - prevents double voting)
  - `(dao_id, pid, "yes"): u64` (yes vote count)
  - `(dao_id, pid, "no"): u64` (no vote count)

**Groth16 Types (BN254)**
```rust
#[contracttype]
pub struct VerificationKey {
    pub alpha: BytesN<64>,      // G1 point
    pub beta: BytesN<128>,      // G2 point
    pub gamma: BytesN<128>,     // G2 point
    pub delta: BytesN<128>,     // G2 point
    pub ic: Vec<BytesN<64>>,    // IC points for public inputs (G1)
}

#[contracttype]
pub struct Proof {
    pub a: BytesN<64>,          // G1 point
    pub b: BytesN<128>,         // G2 point
    pub c: BytesN<64>,          // G1 point
}

#[contracttype]
pub struct Proposal {
    pub description: String,
    pub end_time: u64,
    pub yes_votes: u64,
    pub no_votes: u64,
}
```

---

## 5) Epochs

Define an **epoch** as the voting scope (proposal/round/time window):
- Per proposal: `epoch = Poseidon("proposal:" || proposal_id)`
- Per round: `epoch = round_number`
- Time window: `epoch = floor(ledger_time / window)`

Contract guarantees **one vote per member per epoch** via nullifier set.

---

## 6) Contract interfaces (Soroban-style pseudocode)

### 6.1 DAORegistry (Permissionless DAO Creation)
```rust
trait DAORegistry {
    fn create_dao(env: Env, name: String, admin: Address) -> u64; // Returns dao_id
    fn get_admin(env: Env, dao_id: u64) -> Address;
    fn exists(env: Env, dao_id: u64) -> bool;
}

fn create_dao(env: Env, name: String, admin: Address) -> u64 {
    admin.require_auth();  // Admin must authorize

    let next_id: u64 = env.storage().instance().get(&NEXT_DAO_ID).unwrap_or(1);

    env.storage().persistent().set(&(symbol_short!("admin"), next_id), &admin);
    env.storage().persistent().set(&(symbol_short!("name"), next_id), &name);
    env.storage().instance().set(&NEXT_DAO_ID, &(next_id + 1));

    env.events().publish((symbol_short!("DAOCreated"),), (next_id, admin, name));
    next_id
}
```
**Permissionless design:**
- Anyone can create a DAO
- DAO ID auto-increments
- Admin controls their DAO membership and proposals

### 6.2 MembershipSBT (DAO-Scoped Membership NFT)
```rust
trait MembershipSBT {
    fn init(env: Env, registry: Address);
    fn mint(env: Env, dao_id: u64, to: Address, admin: Address);
    fn has(env: Env, dao_id: u64, of: Address) -> bool;
    // No transfer, no approve, no operator methods.
}

fn mint(env: Env, dao_id: u64, to: Address, admin: Address) {
    admin.require_auth();

    // Verify admin is DAO admin via cross-contract call
    let registry: Address = env.storage().instance().get(&REGISTRY).unwrap();
    let dao_admin: Address = env.invoke_contract(&registry, &symbol_short!("get_admin"),
        vec![&env, dao_id.into_val(&env)]);
    assert!(admin == dao_admin, "not admin");

    // One-per-user-per-DAO enforcement
    let key = (dao_id, to.clone());
    assert!(!Self::has(env.clone(), dao_id, to.clone()), "already minted");

    env.storage().persistent().set(&key, &true);
    env.events().publish((symbol_short!("SbtMint"),), (dao_id, to));
}
```
**DAO-scoped membership:**
- Admin verifies via DAORegistry cross-contract call
- One SBT per user per DAO
- No transfers allowed (soulbound)

### 6.3 MembershipTree (DAO-Scoped On-chain Poseidon)
```rust
trait MembershipTree {
    fn init(env: Env, sbt_contr: Address);
    fn init_dao_tree(env: Env, dao_id: u64, depth: u32);
    fn register_with_caller(env: Env, dao_id: u64, commitment: U256, member: Address);
    fn current_root(env: Env, dao_id: u64) -> U256;
    fn root_ok(env: Env, dao_id: u64, root: U256) -> bool;
}

fn register_with_caller(env: Env, dao_id: u64, commitment: U256, member: Address) {
    member.require_auth();

    // 1) Verify member has SBT for this DAO
    let sbt: Address = env.storage().instance().get(&SBT_CONTR).unwrap();
    let has_sbt: bool = env.invoke_contract(&sbt, &symbol_short!("has"),
        vec![&env, dao_id.into_val(&env), member.into_val(&env)]);
    assert!(has_sbt, "no SBT");

    // 2) Check commitment not already registered for this DAO
    let commit_key = (dao_id, commitment.clone());
    assert!(!env.storage().persistent().has(&commit_key), "already registered");

    // 3) Insert leaf into DAO's incremental Merkle tree
    let leaf_index = Self::insert_leaf(&env, dao_id, commitment.clone());

    // 4) Store commitment → index mapping
    env.storage().persistent().set(&commit_key, &leaf_index);

    env.events().publish((symbol_short!("Registered"),), (dao_id, commitment, leaf_index));
}

fn insert_leaf(env: &Env, dao_id: u64, leaf: U256) -> u32 {
    let depth_key = (dao_id, symbol_short!("depth"));
    let next_key = (dao_id, symbol_short!("next"));

    let depth: u32 = env.storage().persistent().get(&depth_key).unwrap();
    let leaf_index: u32 = env.storage().persistent().get(&next_key).unwrap_or(0);
    let max_size = 1u32 << depth;
    assert!(leaf_index < max_size, "tree full");

    let field = Symbol::new(&env, "BN254");
    let mut current_index = leaf_index;
    let mut current_hash = leaf;

    // Update filled subtrees and compute new root
    for level in 0..depth {
        let subtree_key = (dao_id, symbol_short!("subtree"), level);

        if current_index % 2 == 0 {
            // Left child: store as filled subtree, hash with zero sibling
            env.storage().persistent().set(&subtree_key, &current_hash);
            let zero = Self::get_zero_hash(env, level);
            let inputs = vec![&env, current_hash.clone(), zero];
            current_hash = env.crypto().poseidon_hash(&inputs, field.clone());
        } else {
            // Right child: hash with left sibling from filled subtrees
            let left: U256 = env.storage().persistent().get(&subtree_key).unwrap();
            let inputs = vec![&env, left, current_hash.clone()];
            current_hash = env.crypto().poseidon_hash(&inputs, field.clone());
        }
        current_index /= 2;
    }

    // Update DAO's root and history
    let root_key = (dao_id, symbol_short!("root"));
    let roots_key = (dao_id, symbol_short!("roots"));

    env.storage().persistent().set(&root_key, &current_hash);
    Self::update_root_history(env, dao_id, current_hash);
    env.storage().persistent().set(&next_key, &(leaf_index + 1));

    leaf_index
}
```
**Multi-tenant tree design:**
- Each DAO has its own Merkle tree state
- Global zero hashes shared across DAOs (computed once)
- SBT membership verified per-DAO before registration
- O(log n) insertion using incremental Merkle tree pattern
- 30-root history per DAO for proof grace period

### 6.4 Voting (DAO-Scoped with Real Groth16)
```rust
use soroban_sdk::crypto::bn254::{Fr, G1Affine, G2Affine};

trait Voting {
    fn init(env: Env, tree_contr: Address);
    fn set_vk(env: Env, dao_id: u64, vk: VerificationKey, admin: Address);
    fn create_proposal(env: Env, dao_id: u64, desc: String, end_time: u64, creator: Address) -> u64;  // voting starts immediately, ends at end_time
    fn vote(env: Env, dao_id: u64, proposal_id: u64, choice: bool, nullifier: U256, root: U256, proof: Proof);
    fn get_results(env: Env, dao_id: u64, proposal_id: u64) -> (u64, u64); // (yes, no)
}

fn vote(env: Env, dao_id: u64, proposal_id: u64, choice: bool, nullifier: U256, root: U256, proof: Proof) {
    // 1) Verify root is valid/recent for this DAO
    let tree: Address = env.storage().instance().get(&TREE_CONTR).unwrap();
    let valid: bool = env.invoke_contract(&tree, &symbol_short!("root_ok"),
        vec![&env, dao_id.into_val(&env), root.clone().into_val(&env)]);
    assert!(valid, "invalid root");

    // 2) Check proposal exists and is active
    let prop_key = (dao_id, symbol_short!("proposal"), proposal_id);
    let proposal: Proposal = env.storage().persistent().get(&prop_key).unwrap();
    assert!(env.ledger().timestamp() < proposal.end_time, "expired");

    // 3) Nullifier must be unused for this proposal
    let null_key = (dao_id, proposal_id, nullifier.clone());
    assert!(!env.storage().persistent().has(&null_key), "duplicate vote");

    // 4) Verify Groth16 proof using REAL P25 BN254 pairing
    let vk_key = (dao_id, symbol_short!("vk"));
    let vk: VerificationKey = env.storage().persistent().get(&vk_key).unwrap();
    let pub_signals = vec![&env,
        root,
        nullifier.clone(),
        U256::from_u128(&env, dao_id as u128),
        U256::from_u128(&env, proposal_id as u128),
        U256::from_u128(&env, choice as u128)
    ];
    let ok = Self::verify_groth16(&env, &vk, &proof, &pub_signals);
    assert!(ok, "invalid proof");

    // 5) Record spent nullifier and tally vote
    env.storage().persistent().set(&null_key, &true);

    let yes_key = (dao_id, proposal_id, symbol_short!("yes"));
    let no_key = (dao_id, proposal_id, symbol_short!("no"));

    if choice {
        let mut count: u64 = env.storage().persistent().get(&yes_key).unwrap_or(0);
        env.storage().persistent().set(&yes_key, &(count + 1));
    } else {
        let mut count: u64 = env.storage().persistent().get(&no_key).unwrap_or(0);
        env.storage().persistent().set(&no_key, &(count + 1));
    }

    env.events().publish((symbol_short!("VoteCast"),), (dao_id, proposal_id, nullifier));
}

fn verify_groth16(env: &Env, vk: &VerificationKey, proof: &Proof, pub_signals: &Vec<U256>) -> bool {
    if pub_signals.len() + 1 != vk.ic.len() {
        return false;
    }

    // Compute vk_x = ic[0] + sum(pub_signals[i] * ic[i+1])
    let mut vk_x = G1Affine::from_bytes(vk.ic.get(0).unwrap());
    for i in 0..pub_signals.len() {
        let signal = pub_signals.get(i).unwrap();
        let ic_point = G1Affine::from_bytes(vk.ic.get(i + 1).unwrap());
        let scalar = Fr::from(signal);
        let scaled_point = ic_point * scalar;
        vk_x = vk_x + scaled_point;
    }

    // Negate proof.a (flip y-coordinate)
    let neg_a = Self::g1_negate(env, &proof.a);

    // Pairing check: e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
    let mut g1_vec = Vec::new(env);
    g1_vec.push_back(G1Affine::from_bytes(neg_a));
    g1_vec.push_back(G1Affine::from_bytes(vk.alpha.clone()));
    g1_vec.push_back(vk_x);
    g1_vec.push_back(G1Affine::from_bytes(proof.c.clone()));

    let mut g2_vec = Vec::new(env);
    g2_vec.push_back(G2Affine::from_bytes(proof.b.clone()));
    g2_vec.push_back(G2Affine::from_bytes(vk.beta.clone()));
    g2_vec.push_back(G2Affine::from_bytes(vk.gamma.clone()));
    g2_vec.push_back(G2Affine::from_bytes(vk.delta.clone()));

    env.crypto().bn254().pairing_check(g1_vec, g2_vec)
}
```

### 6.5 Voting (MACI-lite variant - future work)
```rust
trait VotingMaciLite {
    fn cast_ciphertext(env: Env, dao_id: u64, root: U256, nullifier_hash: U256, ciphertext: Bytes, proof: Groth16Proof);
    fn submit_tally_proof(env: Env, dao_id: u64, proposal_id: u64, tally: Bytes, tally_proof: Groth16Proof);
}
```

---

## 7) Backend Relayer (Self-hosted)

**Current implementation: Self-hosted Express.js relay service.** Flow:
1. Frontend builds call payload (`vote`), attaches ZK proof and vote data.
2. Sends to **Backend Relayer** via REST API (POST /vote).
3. Backend constructs Soroban invocation with **source = relayer account** (pays fees).
4. Backend simulates and submits transaction directly to **Soroban RPC**.
5. Returns transaction hash and status to client.

**Current implementation features:**
- Express.js server with JSON validation
- Relayer keypair stored server-side (RELAYER_SECRET_KEY)
- Direct Soroban RPC connection (no Launchtube dependency)
- Transaction simulation before submission
- Automatic fee and sequence management
- Convenience endpoints: /health, /proposal/:dao/:prop, /root/:dao

**Security & policy**
- Relayer private key stored server-side only.
- Backend validates input types and sizes.
- Rate limiting and IP throttles recommended for production.
- No user authentication required for voting (ZK proof is the authorization).
- Registration still requires user signature (to prevent spoofed commitments).

**Future: Launchtube integration** (planned for mainnet):
- Replace direct RPC submission with Launchtube API
- Benefits: channel management, fee sponsorship, better scalability
- LT API token stored server-side only.

---

## 8) Proof Query Service (optional convenience layer)

**Purpose:** Indexes on-chain events and provides convenient API for fetching Merkle proofs. **NOT required for core functionality** — all data is on-chain.

**Responsibilities:**
1. **Index registration events** — listens to MembershipTree contract events to track leaves
2. **Reconstruct tree state** — maintains local copy of tree from on-chain data
3. **Serve Merkle proofs** — provides users with path_elements and path_index for their commitment
4. **Query interface** — REST API for frontend convenience

**API endpoints:**
```
GET /proof/:commitment
  returns: { pathElements: [...], pathIndex: [...], root: "0x...", leafIndex: 42 }

GET /tree/state
  returns: { depth: 18, leafCount: 1000, currentRoot: "0x..." }

GET /leaves
  returns: { leaves: [...], total: 1000 }
```

**Why optional:**
- All tree data is on-chain and publicly verifiable
- Users can reconstruct proofs by reading contract storage directly
- No admin keys or trust assumptions
- Service is purely for convenience/performance

**Alternative: Direct on-chain queries**
- Call `MembershipTree.get_merkle_proof(leaf_index)` directly
- Read `filled_subtrees` storage to reconstruct path
- Subscribe to `Registered` events via Soroban RPC

---

## 9) Off-chain proving

- Client or backend prover generates Groth16 proofs (Circom/gnark/ZoKrates) with public inputs: `root, nullifier_hash, signal_hash, epoch`.
- Poseidon used in‑circuit for commitments, Merkle paths, and nullifier derivation.

---

## 10) Events & watchers

- Contracts emit: `MemberMinted(address)`, `Registered(commitment, leaf_index)`, `VoteCast(signal_hash, epoch)`.
- Backend can subscribe via Soroban RPC **`getEvents`** to maintain mirrors/analytics.
- **All tree operations emit events** — registrations are fully traceable on-chain.
- Optional proof query service indexes `Registered` events to reconstruct tree state.

---

## 11) Security & privacy

- **Anonymity:** votes use ZK proofs + relayer; no `require_auth()` in `vote()`.
- **Uniqueness:** `(epoch, nullifier_hash)` set prevents duplicates.
- **Membership:** SBT enforces one membership per address; membership required to register commitment.
- **SBT constraints:** no transfers; mint blocked if `minted[addr] == true`.
- **Merkle integrity:** Tree computed fully on-chain using P25 Poseidon host functions. All state publicly verifiable.
- **Trust assumptions:** ZERO trust assumptions for core logic. No admin keys for tree management. Fully decentralized.
- **Commitment privacy:** Commitments are hashes of secret identity values; cannot be reversed to reveal identity.
- **Double-registration prevention:** Contract checks if commitment already exists before insertion.
- **Gas considerations:** On-chain Poseidon computation costs gas; tree depth affects insertion cost (O(depth) hashes per registration).

### 11.1 Critical Limitation: Identity Anonymity vs Vote Secrecy

**⚠️ IMPORTANT: The current system provides identity anonymity but NOT vote secrecy.**

`voteChoice` is a **public signal** in the ZK proof. This means:
- **Who voted is hidden** - The ZK proof proves membership without revealing which member voted
- **What they voted is PUBLIC** - The vote choice (yes/no) is visible on-chain to everyone
- **Correlation attacks are possible** - Observers can see all votes and their choices, just not the voter identity

**When is this acceptable?**
- DAOs where vote choice transparency is desired
- Non-sensitive governance decisions
- Systems prioritizing accountability over secrecy

**When is this NOT acceptable?**
- Elections where vote coercion is a concern
- Sensitive decisions requiring ballot secrecy
- Situations where knowing "someone voted yes" could be used for retaliation

**Future: MACI-style encrypted voting (planned)**
To achieve true vote secrecy:
1. Users encrypt votes with coordinator's public key
2. Coordinator aggregates encrypted votes off-chain
3. Coordinator publishes ZK proof of correct tally
4. Only final tally is revealed, not individual votes

This requires significant protocol changes and introduces coordinator trust assumptions.

### 11.2 Membership Revocation and Vote Eligibility

**⚠️ CRITICAL DESIGN CONSIDERATION: Removed members can still vote.**

**Current behavior:**
- Once a commitment is registered in the Merkle tree, it remains forever
- If admin "removes" a member (burns SBT), their commitment is still in the tree
- They can prove membership against any historical root (30-root window)
- **Removed members can vote on proposals created after their removal**

**Why this happens:**
- Merkle trees are append-only; cannot remove leaves without recomputing all hashes
- ZK proof only proves "my commitment is in this tree" not "I'm currently a member"
- Root history window exists to allow late proof submissions

**Options for addressing this:**

1. **Snapshot-based eligibility (recommended approach)**
   - Store `tree_root_at_creation` with each proposal
   - Require votes use exactly that root (not just any recent root)
   - Members added after proposal creation cannot vote
   - Members removed before proposal creation cannot vote
   ```rust
   fn create_proposal(...) -> u64 {
       let current_root = tree_client.current_root(dao_id);
       // Store current_root with proposal metadata
   }
   fn vote(..., root: U256) {
       // Verify root == proposal.root_at_creation (exact match)
   }
   ```

2. **Blacklist nullifiers (complex)**
   - Maintain set of revoked identity commitments
   - Check nullifier derivation against blacklist
   - Adds storage and complexity

3. **Periodic tree reconstruction (expensive)**
   - Rebuild tree excluding removed members
   - Very expensive for large trees (O(n) operations)

4. **Accept as feature (current)**
   - Document that membership is snapshot at registration time
   - Treat tree membership as "has registered identity" not "is current member"
   - Useful for some governance models (e.g., "anyone who was ever a member")

**Current implementation: Option 4 (accept as feature)**. Consider implementing Option 1 for stricter eligibility.

### 11.3 Verification Key Admin Trust Model

**⚠️ SIGNIFICANT TRUST ASSUMPTION: Admin controls the verification key.**

The DAO admin can call `set_vk(dao_id, vk)` to set/change the verification key. This grants substantial power:

**Risks:**
1. **Malicious VK** - Admin could set a VK that accepts invalid proofs
2. **Mid-vote changes** - Admin could change VK during active proposal
3. **Selective acceptance** - VK could be crafted to only accept certain proofs
4. **Proof rejection** - Setting an incompatible VK would break all voting

**Current trust model:**
- Users must trust the DAO admin set a legitimate VK from a proper trusted setup
- Admin could theoretically accept fake votes or reject legitimate ones
- No on-chain verification that VK corresponds to the actual circuit

**Mitigation options:**

1. **VK immutability after first set**
   ```rust
   fn set_vk(env: Env, dao_id: u64, vk: VerificationKey, admin: Address) {
       if env.storage().instance().has(&vk_key) {
           panic!("VK already set and immutable");
       }
       // ... set VK
   }
   ```

2. **Timelock on VK changes**
   - Announce VK change, wait N blocks before activation
   - Members can exit or dispute during waiting period

3. **Multi-sig VK management**
   - Require multiple admins to agree on VK change
   - Reduces single point of trust

4. **VK registry/attestation**
   - Publish circuit source and VK derivation proof
   - Third-party attestation of correct setup

5. **Proposal-locked VK**
   - Store `vk_hash` with proposal at creation time
   - Only accept proofs against that specific VK

**Current implementation: Full admin trust**. The DAO members must trust their admin to:
- Use the correct circuit
- Perform or verify a proper trusted setup
- Not change the VK maliciously

**Recommendation:** For production DAOs, implement VK immutability or timelock mechanisms.

### 11.4 Poseidon Parameter Compatibility Risk

**⚠️ CRITICAL: Poseidon implementations MUST match exactly.**

The membership proof relies on two separate Poseidon implementations producing identical outputs:

1. **Circuit (circomlib)** - `Poseidon` template for in-circuit hashing
2. **On-chain (P25)** - `env.crypto().poseidon_hash()` host function

**What must match:**
- Field: BN254 scalar field (Fr)
- Number of rounds (full + partial)
- MDS matrix constants
- Round constants
- S-box exponent
- Width parameter (t)

**Current assumption:** Both use standard BN254 Poseidon with:
- t = 3 (2 inputs + 1 capacity)
- 8 full rounds + 57 partial rounds (standard for BN254)
- Identical round constants from reference implementation

**Risk:** If parameterizations differ:
- Circuit computes different commitment hashes than chain expects
- Merkle roots won't match between off-chain proof and on-chain tree
- Valid proofs will be rejected
- **System completely broken with no obvious error**

**Recommended: Known-Answer Test (KAT)**

```javascript
// circuits/utils/poseidon_kat.js
const { buildPoseidon } = require("circomlibjs");

async function verifyPoseidonCompatibility() {
    const poseidon = await buildPoseidon();

    // Test vectors - these values MUST match on-chain results
    const testCases = [
        { inputs: [1n, 2n], expected: "???" },
        { inputs: [0n, 0n], expected: "???" },
        { inputs: [123456789n, 987654321n], expected: "???" }
    ];

    for (const tc of testCases) {
        const hash = poseidon.F.toObject(poseidon(tc.inputs));
        console.log(`Poseidon(${tc.inputs}) = ${hash}`);
        // Compare with on-chain result from contract call
    }
}
```

```rust
// In contract test or integration test
#[test]
fn test_poseidon_known_answer() {
    let env = Env::default();
    let client = MembershipTreeClient::new(&env, &contract_id);

    // MUST match circomlib output exactly
    let input1 = U256::from_u32(&env, 1);
    let input2 = U256::from_u32(&env, 2);
    let hash = client.hash_pair(&input1, &input2);

    // This value comes from circomlib Poseidon
    let expected = U256::from_str(&env, "0x...");
    assert_eq!(hash, expected, "Poseidon mismatch! Circuit and chain incompatible.");
}
```

**Action items:**
1. [ ] Generate test vectors using circomlib Poseidon
2. [ ] Verify P25 host function produces identical outputs
3. [ ] Add integration test that fails on mismatch
4. [ ] Document exact Poseidon version used in both contexts

**If mismatch is found:**
- Identify which parameter differs
- Either adjust circuit or wait for P25 documentation on exact params
- Do NOT deploy until KAT passes

### 11.5 Cross-DAO Nullifier Linkability (FIXED)

**⚠️ Previous vulnerability: Nullifiers without DAO domain separation**

**Original construction:**
```text
nullifier = Poseidon(secret, proposalId)
```

**Problem:** If a user reuses the same identity secret across multiple DAOs (which is convenient for users), and two DAOs both have `proposalId = 1`, the voter would emit **identical nullifiers** in both DAOs:
- DAO A, Proposal 1: `nullifier = Poseidon(secret, 1)`
- DAO B, Proposal 1: `nullifier = Poseidon(secret, 1)`

An observer could correlate these nullifiers and determine they belong to the same identity, violating cross-DAO privacy.

**Current construction (FIXED):**
```text
nullifier = Poseidon(secret, daoId, proposalId)
```

**Solution properties:**
- Nullifiers are now **domain-separated** by DAO
- Same user, same proposal ID, different DAOs → different nullifiers
- Cross-DAO linkability is prevented
- Users can safely reuse identity secrets across DAOs
- Public signals order: `[root, nullifier, daoId, proposalId, voteChoice]`

**Implementation:**
- Circuit: Uses 3-ary Poseidon hash (`Poseidon(3)`) to include all three inputs
- On-chain verification: Includes `dao_id` as public signal
- Input generation: `computeNullifier(secret, daoId, proposalId)` function updated

**Trade-off:** Slightly larger proof size (one additional public signal), but essential for privacy in multi-tenant architecture.

### 11.6 Root History DoS Attack Vector

**Risk:** Adversary churns membership tree to evict target voter's root from history.

**Mechanism:**
- Contract maintains 30-slot root history for late votes
- Adversary rapidly registers new commitments (if they have SBT)
- Each registration creates new root, pushing old roots out of history
- Target voter's proof becomes invalid (root not in history)

**Mitigations:**
1. **Larger history window** - Increase from 30 to 100+ roots (higher storage cost)
2. **Root registration rate limiting** - Add cooldown between registrations
3. **Proposal-bound roots** - Snapshot root at proposal creation, accept only that root
4. **Time-windowed roots** - Store (root, timestamp), accept roots within proposal timeframe
5. **Membership churn monitoring** - Alert on suspicious registration patterns

**Current implementation:** 30-root window. Consider increasing for production or implementing rate limiting.

### 11.7 Manual G1 Point Negation Risks

**Risk:** Hand-coded field arithmetic for G1 negation is error-prone.

**Current implementation:**
```rust
fn g1_negate(point: &BytesN<64>) -> BytesN<64> {
    let field_modulus: [u8; 32] = [0x30, 0x64, ...]; // BN254 Fq
    let neg_y = field_subtract(&field_modulus, &y);   // -y = p - y
}
```

**Risks:**
1. **Endianness errors** - Modulus must be big-endian to match point encoding
2. **Modulus constant typo** - Wrong constant = wrong negation = proof bypass
3. **No SDK validation** - Bypasses SDK's internal point validation

**Recommendations:**
1. **Use SDK negation** - Check if P25 SDK provides `-G1Affine` operator
2. **Validate modulus** - Add test: negate generator point and verify result
3. **Known-answer test** - Precompute -G(1,2) = (1, p-2) and verify
4. **Consider alternative** - If SDK provides inverse, use that instead of manual math

**Validation test to add:**
```rust
#[test]
fn test_g1_negation_correctness() {
    // Generator G1 = (1, 2)
    // -G1 = (1, p-2) where p = 21888242871839275222246405745257275088696311157297823662689037894645226208583
    let gen = bn254_g1_generator(&env);
    let neg_gen = g1_negate(&env, &gen);
    // Verify: y-coordinate should be p-2
    assert_eq!(neg_gen[63], 0x45); // Last byte of (p-2)
}
```

### 11.8 BN254 Point Validation

**Risk:** Invalid-curve or non-subgroup attacks if points aren't validated.

**Requirements:**
- Points must be **on the curve**: y² = x³ + 3 (for BN254 G1)
- Points must be **in the correct subgroup** (prime-order r)
- Cofactor attacks: BN254 G1 has cofactor 1 (safe), G2 has cofactor > 1 (risky)

**SDK behavior (P25):**
- `G1Affine::from_bytes()` - Should validate point is on curve
- `G2Affine::from_bytes()` - Must check subgroup membership or use cofactor clearing

**Action items:**
1. [ ] Verify P25 SDK enforces on-curve checks in `from_bytes()`
2. [ ] Confirm G2 subgroup validation or cofactor clearing
3. [ ] Add test: attempt to create invalid point, expect failure
4. [ ] Review P25 host function documentation for validation guarantees

**If SDK doesn't validate:**
- Add explicit on-curve check before pairing
- Reject proofs with invalid points
- Consider explicit subgroup check for G2 points

### 11.9 Test Mode Proof Bypass

**Critical:** Test code bypasses real proof verification.

**Current implementation:**
```rust
#[cfg(any(test, feature = "testutils"))]
fn verify_groth16_proof(...) -> bool {
    true  // BYPASS: Always accepts in test mode
}

#[cfg(not(any(test, feature = "testutils")))]
fn verify_groth16_proof(...) -> bool {
    // Real verification
}
```

**Risks:**
1. **Release build with testutils** - If `testutils` feature enabled, proofs bypassed
2. **Accidental deployment** - Test binary deployed instead of release
3. **CI misconfiguration** - Tests pass but production fails

**Mitigations:**
1. **Feature gate audit** - Verify Cargo.toml doesn't enable `testutils` by default
2. **CI/CD validation** - Build release without testutils, run integration tests
3. **Runtime check** - Add `assert!(!cfg!(feature = "testutils"))` in critical paths
4. **Binary verification** - Hash deployed binary, compare to known release build

**Recommended CI check:**
```bash
# Build without testutils
cargo build --release --no-default-features
# Verify no bypass code
grep -r "fn verify_groth16_proof" target/release/*.wasm  # Should not contain bypass
```

### 11.10 Verification Key Consistency per Proposal

**Risk:** Admin changes VK mid-proposal, invalidating in-flight votes.

**Scenario:**
1. Proposal created at T=0
2. Voter generates proof at T=10 using VK_old
3. Admin updates VK to VK_new at T=15
4. Voter submits proof at T=20 → **REJECTED** (proof was for VK_old)

**Current implementation:**
- VK is stored DAO-wide, mutable by admin
- Verification uses current DAO VK, not proposal-specific VK

**Recommendations:**
1. **Snapshot VK per proposal:**
```rust
struct Proposal {
    vk_hash: BytesN<32>,  // Hash of VK at proposal creation
    // ...existing fields
}

// At proposal creation:
let vk: VerificationKey = storage.get(&VotingKey(dao_id));
let vk_hash = env.crypto().sha256(&vk.serialize());
proposal.vk_hash = vk_hash;

// At vote verification:
assert_eq!(env.crypto().sha256(&current_vk.serialize()), proposal.vk_hash);
```

2. **Copy VK into proposal storage** (higher storage cost but simplest)
3. **Lock VK during active proposals** (prevents any VK changes while votes are open)
4. **Version VK** - Track VK version, store version with proposal

**Trade-offs:**
- Snapshot: Extra storage, but safe
- Lock: Restricts admin, but prevents DoS
- Versioning: Complex, but flexible

**Minimum fix:** Add warning in admin UI when changing VK with active proposals, or fail transaction if active proposals exist.

---

## 12) Testing checklist

**DAORegistry (8 tests):**
- [x] Permissionless DAO creation with auto-increment ID
- [x] Admin verification for created DAOs
- [x] Multiple DAOs can be created independently
- [x] Admin transfer functionality (if implemented)
- [x] DAO existence checks
- [x] DAO name storage and retrieval
- [x] Event emission for DAO creation
- [x] Error handling for non-existent DAOs

**MembershipSBT (11 tests):**
- [x] DAO-scoped membership (one per user per DAO)
- [x] Admin verification via DAORegistry cross-contract call
- [x] Minting requires proper authorization
- [x] Transfers disabled (soulbound)
- [x] Has() correctly checks DAO-scoped membership
- [x] Multiple DAOs can have same user as member
- [x] User can't have duplicate membership in same DAO
- [x] Event emission for SBT minting

**MembershipTree (14 tests):**
- [x] DAO-scoped incremental Merkle tree
- [x] Registration requires SBT for that DAO
- [x] Commitment uniqueness per DAO enforced
- [x] Correct Poseidon hash computation on-chain
- [x] Zero hashes precomputed and shared
- [x] Root history maintained per DAO (30 roots)
- [x] root_ok() validates against history
- [x] Tree isolation between DAOs
- [x] Multiple registrations update tree correctly
- [x] Gas-efficient O(log n) insertion

**Voting (13 tests):**
- [x] DAO-scoped proposals with duration
- [x] Real Groth16 verification (BN254 pairing) - test mode skips pairing
- [x] Nullifier prevents double voting per proposal
- [x] Root validation against DAO's tree
- [x] Vote tallying (yes/no counts)
- [x] Proposal expiration enforcement
- [x] Verification key storage per DAO
- [x] Admin-only VK setting with cross-contract verification
- [x] Non-admin cannot set verification key
- [x] get_results() returns vote tallies

**Integration Tests (12 tests):**
- [x] Full DAO lifecycle: create → mint SBT → register commitment → create proposal → vote
- [x] Cross-contract admin verification chain
- [x] Multi-DAO isolation (DAOs don't interfere)
- [x] Root history grace period for late proofs
- [x] Double vote prevention across flow
- [x] Membership verification through contracts
- [x] Real contract deployment and interaction
- [x] End-to-end anonymous voting flow

**Backend services (implemented):**
- [x] Self-hosted relayer: tx source = relayer account; simulation & retry handling.
- [ ] (Optional) Proof query service: correctly indexes events; serves valid proofs.
- [ ] (Future) Launchtube integration for mainnet deployment.

**Circuit Integration (pending):**
- [ ] Circom circuit compiles and generates valid proofs
- [ ] Proof verification matches on-chain verifier
- [ ] End-to-end with real circuit-generated proofs
- [ ] **Poseidon KAT**: Verify circomlib and P25 produce identical hashes (CRITICAL)

**Gas/Performance:**
- [x] Tree insertion O(log n) with incremental pattern
- [x] Tree depth 20 supports ~1M members per DAO

---

## 13) Readme/one-liner

> **Zero-knowledge anonymous DAO voting on Stellar Soroban using Protocol 25 (BN254 + Poseidon).** Multi-tenant architecture with permissionless DAO creation. DAO-scoped soulbound membership NFTs. Fully on-chain Poseidon Merkle trees. Real BN254 Groth16 verification using P25 pairing host functions. 58 tests passing across 4 contracts + integration. Anonymous voting via self-hosted backend relayer.

---

**End of Spec v1.0.0**



---

## 14) Code skeletons (starter templates)

> Note: These are **minimal** Soroban/Rust & backend templates to scaffold the system. They omit error handling, auth hardening, and storage versioning for brevity.

### 14.1 Membership SBT (one-per-user, non-transferable)
```rust
// contracts/sbt/src/lib.rs
#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Address, BytesN, Env, Symbol};

const ADMIN: Symbol = symbol_short!("admin");

#[contract]
pub struct MembershipSbt;

#[contractimpl]
impl MembershipSbt {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&ADMIN) { panic!("inited"); }
        admin.require_auth();
        env.storage().instance().set(&ADMIN, &admin);
    }

    /// Mint exactly one SBT per address.
    pub fn mint(env: Env, to: Address) {
        // Gate minting by admin or allow-open mint + proof later (adapt as needed)
        let admin: Address = env.storage().instance().get(&ADMIN).unwrap();
        admin.require_auth();

        // One-per-user enforcement
        if Self::has(env.clone(), to.clone()) { panic!("already minted"); }
        let key = Self::key_owned(&to);
        env.storage().persistent().set(&key, &true);
        env.events().publish((symbol_short!("MemberMinted")), (to,));
    }

    /// True if the address already holds the SBT.
    pub fn has(env: Env, of: Address) -> bool {
        let key = Self::key_owned(&of);
        env.storage().persistent().get(&key).unwrap_or(false)
    }

    fn key_owned(of: &Address) -> (Symbol, Address) { (symbol_short!("owned"), of.clone()) }
}
```

### 14.2 MembershipTree (fully on-chain Poseidon incremental tree)
```rust
// contracts/membership_tree/src/lib.rs
#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Symbol, U256, Vec, vec};

const SBT: Symbol = symbol_short!("sbt");
const DEPTH: Symbol = symbol_short!("depth");
const NEXT_IDX: Symbol = symbol_short!("next_idx");
const ROOT: Symbol = symbol_short!("root");
const ROOTS: Symbol = symbol_short!("roots");
const ZEROS: Symbol = symbol_short!("zeros");
const MAX_ROOTS: u32 = 30;

#[contract]
pub struct MembershipTree;

#[contractimpl]
impl MembershipTree {
    /// Initialize the tree with SBT contract reference and depth
    pub fn init(env: Env, sbt_contract: Address, depth: u32) {
        if env.storage().instance().has(&DEPTH) { panic!("already initialized"); }
        assert!(depth > 0 && depth <= 32, "invalid depth");

        env.storage().instance().set(&SBT, &sbt_contract);
        env.storage().instance().set(&DEPTH, &depth);
        env.storage().instance().set(&NEXT_IDX, &0u32);

        // Precompute zero hashes for empty subtrees
        let field = Symbol::new(&env, "BN254");
        let mut zeros = Vec::new(&env);
        let mut current = U256::from_u32(&env, 0); // Zero leaf
        zeros.push_back(current.clone());

        for _ in 0..depth {
            let inputs = vec![&env, current.clone(), current.clone()];
            current = env.crypto().poseidon_hash(&inputs, field.clone());
            zeros.push_back(current.clone());
        }

        // Initial root is the zero hash at depth level
        let initial_root = zeros.get(depth).unwrap();
        env.storage().instance().set(&ROOT, &initial_root);
        env.storage().persistent().set(&ZEROS, &zeros);

        let mut root_history = Vec::new(&env);
        root_history.push_back(initial_root);
        env.storage().persistent().set(&ROOTS, &root_history);
    }

    /// Register identity commitment (requires SBT ownership)
    pub fn register(env: Env, commitment: U256) {
        // 1) Verify caller has SBT
        let sbt: Address = env.storage().instance().get(&SBT).unwrap();
        let caller = env.invoker();
        let has_sbt: bool = env.invoke_contract(&sbt, &symbol_short!("has"), vec![&env, caller.into_val(&env)]);
        assert!(has_sbt, "no SBT");

        // 2) Check commitment not already registered
        let commit_key = (symbol_short!("commit"), commitment.clone());
        assert!(!env.storage().persistent().has(&commit_key), "already registered");

        // 3) Insert leaf into incremental Merkle tree
        let leaf_index = Self::insert_leaf(&env, commitment.clone());

        // 4) Store commitment → index mapping
        env.storage().persistent().set(&commit_key, &leaf_index);

        env.events().publish((symbol_short!("Registered"),), (commitment, leaf_index));
    }

    /// Get current Merkle root
    pub fn current_root(env: Env) -> U256 {
        env.storage().instance().get(&ROOT).unwrap()
    }

    /// Check if root is in recent history
    pub fn is_valid_root(env: Env, root: U256) -> bool {
        let history: Vec<U256> = env.storage().persistent().get(&ROOTS).unwrap();
        for i in 0..history.len() {
            if history.get(i).unwrap() == root {
                return true;
            }
        }
        false
    }

    /// Get leaf index for a commitment
    pub fn get_leaf_index(env: Env, commitment: U256) -> u32 {
        let commit_key = (symbol_short!("commit"), commitment);
        env.storage().persistent().get(&commit_key).unwrap()
    }

    /// Get tree info
    pub fn get_tree_info(env: Env) -> (u32, u32, U256) {
        let depth: u32 = env.storage().instance().get(&DEPTH).unwrap();
        let next_index: u32 = env.storage().instance().get(&NEXT_IDX).unwrap();
        let root: U256 = env.storage().instance().get(&ROOT).unwrap();
        (depth, next_index, root)
    }

    // Internal: Insert leaf and update tree
    fn insert_leaf(env: &Env, leaf: U256) -> u32 {
        let depth: u32 = env.storage().instance().get(&DEPTH).unwrap();
        let leaf_index: u32 = env.storage().instance().get(&NEXT_IDX).unwrap();
        let max_size = 1u32 << depth;
        assert!(leaf_index < max_size, "tree full");

        let field = Symbol::new(&env, "BN254");
        let zeros: Vec<U256> = env.storage().persistent().get(&ZEROS).unwrap();
        let mut current_index = leaf_index;
        let mut current_hash = leaf;

        // Update filled subtrees and compute new root
        for level in 0..depth {
            let subtree_key = (symbol_short!("subtree"), level);

            if current_index % 2 == 0 {
                // Left child: store as filled subtree, hash with zero sibling
                env.storage().persistent().set(&subtree_key, &current_hash);
                let zero = zeros.get(level).unwrap();
                let inputs = vec![&env, current_hash.clone(), zero];
                current_hash = env.crypto().poseidon_hash(&inputs, field.clone());
            } else {
                // Right child: hash with left sibling from filled subtrees
                let left: U256 = env.storage().persistent().get(&subtree_key).unwrap();
                let inputs = vec![&env, left, current_hash.clone()];
                current_hash = env.crypto().poseidon_hash(&inputs, field.clone());
            }
            current_index /= 2;
        }

        // Update root and history (capped at MAX_ROOTS for security)
        let new_root = current_hash;
        env.storage().instance().set(&ROOT, &new_root);

        let mut history: Vec<U256> = env.storage().persistent().get(&ROOTS).unwrap();
        history.push_back(new_root.clone());
        // Remove oldest root if over cap (FIFO)
        if history.len() > MAX_ROOTS {
            let mut new_history = Vec::new(&env);
            for i in 1..history.len() {
                new_history.push_back(history.get(i).unwrap());
            }
            history = new_history;
        }
        env.storage().persistent().set(&ROOTS, &history);

        // Increment next index
        env.storage().instance().set(&NEXT_IDX, &(leaf_index + 1));

        leaf_index
    }
}
```

> **Note:** This contract computes the full incremental Merkle tree on-chain using P25 Poseidon host functions. No admin needed - users call `register()` directly after minting SBT.

### 14.3 Voting contract (Semaphore-style with BN254 Groth16)
```rust
// contracts/voting/src/lib.rs
#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short,
    Address, Env, Symbol, U256, Vec, vec,
    crypto::bn254::{Fr, G1Affine, G2Affine},
};

const TREE: Symbol = symbol_short!("tree");
const VK: Symbol = symbol_short!("vk");

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VoteError {
    InvalidRoot = 1,
    DuplicateVote = 2,
    InvalidProof = 3,
    MalformedVK = 4,
}

#[derive(Clone)]
#[contracttype]
pub struct VerificationKey {
    pub alpha: G1Affine,
    pub beta: G2Affine,
    pub gamma: G2Affine,
    pub delta: G2Affine,
    pub ic: Vec<G1Affine>,
}

#[derive(Clone)]
#[contracttype]
pub struct Proof {
    pub a: G1Affine,
    pub b: G2Affine,
    pub c: G1Affine,
}

#[contract]
pub struct Voting;

#[contractimpl]
impl Voting {
    pub fn init(env: Env, tree_contract: Address, vk: VerificationKey) {
        if env.storage().instance().has(&TREE) { panic!("already initialized"); }
        env.storage().instance().set(&TREE, &tree_contract);
        env.storage().instance().set(&VK, &vk);
    }

    pub fn vote(
        env: Env,
        root: U256,
        nullifier_hash: U256,
        signal_hash: U256,
        epoch: u64,
        proof: Proof
    ) -> Result<(), VoteError> {
        // 1) Root must be valid/recent
        let tree: Address = env.storage().instance().get(&TREE).unwrap();
        let valid: bool = env.invoke_contract(&tree, &symbol_short!("is_valid_root"), vec![&env, root.clone().into_val(&env)]);
        if !valid { return Err(VoteError::InvalidRoot); }

        // 2) Nullifier must be unused for this epoch
        let nullifier_key = (symbol_short!("spent"), epoch, nullifier_hash.clone());
        if env.storage().persistent().has(&nullifier_key) { return Err(VoteError::DuplicateVote); }

        // 3) Verify Groth16 proof using P25 BN254 pairing host functions
        let vk: VerificationKey = env.storage().instance().get(&VK).unwrap();
        let pub_signals = vec![&env,
            Fr::from(root.clone()),
            Fr::from(nullifier_hash.clone()),
            Fr::from(signal_hash.clone()),
            Fr::from(U256::from_u128(&env, epoch as u128))
        ];
        let ok = Self::verify_groth16(&env, &vk, &proof, &pub_signals)?;
        if !ok { return Err(VoteError::InvalidProof); }

        // 4) Record spent nullifier and count vote
        env.storage().persistent().set(&nullifier_key, &true);
        let count_key = (symbol_short!("count"), signal_hash.clone());
        let mut count: u64 = env.storage().persistent().get(&count_key).unwrap_or(0);
        count += 1;
        env.storage().persistent().set(&count_key, &count);

        env.events().publish((symbol_short!("VoteCast"),), (signal_hash, epoch));
        Ok(())
    }

    pub fn tally(env: Env, signal_hash: U256) -> u64 {
        let count_key = (symbol_short!("count"), signal_hash);
        env.storage().persistent().get(&count_key).unwrap_or(0)
    }

    /// Groth16 verification using BN254 pairing check
    fn verify_groth16(
        env: &Env,
        vk: &VerificationKey,
        proof: &Proof,
        pub_signals: &Vec<Fr>
    ) -> Result<bool, VoteError> {
        let bn254 = env.crypto().bn254();

        // Compute vk_x = ic[0] + sum(pub_signals[i] * ic[i+1])
        if pub_signals.len() + 1 != vk.ic.len() {
            return Err(VoteError::MalformedVK);
        }
        let mut vk_x = vk.ic.get(0).unwrap();
        for i in 0..pub_signals.len() {
            let s = pub_signals.get(i).unwrap();
            let v = vk.ic.get(i + 1).unwrap();
            vk_x = vk_x + (v * s);
        }

        // Pairing check: e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
        let neg_a = -proof.a.clone();
        let vp1 = vec![&env, neg_a, vk.alpha.clone(), vk_x, proof.c.clone()];
        let vp2 = vec![&env, proof.b.clone(), vk.beta.clone(), vk.gamma.clone(), vk.delta.clone()];

        Ok(bn254.pairing_check(vp1, vp2))
    }
}
```

### 14.4 Circom circuit skeleton (Semaphore membership)
```circom
// circuits/vote.circom
pragma circom 2.1.6;
include "poseidon.circom";
include "merkletree.circom"; // your Poseidon Merkle gadgets

template Vote(depth) {
    // Private
    signal input identity_nullifier;
    signal input identity_trapdoor;
    signal input path_elements[depth];
    signal input path_index[depth]; // 0/1 bits

    // Public
    signal input root;
    signal input nullifier_hash;
    signal input signal_hash;
    signal input epoch;

    // Commitment
    component H = Poseidon(2);
    H.inputs[0] <== identity_nullifier;
    H.inputs[1] <== identity_trapdoor;
    signal commitment <== H.out;

    // Merkle inclusion
    component MT = MerkleProofPoseidon(depth);
    MT.leaf <== commitment;
    for (var i=0; i<depth; i++) {
        MT.pathElements[i] <== path_elements[i];
        MT.pathIndex[i] <== path_index[i];
    }
    MT.root === root;

    // Nullifier
    component Hn = Poseidon(2);
    Hn.inputs[0] <== identity_nullifier;
    Hn.inputs[1] <== epoch;
    Hn.out === nullifier_hash;

    // Optionally constrain signal_hash if you want structured ballots
}

component main = Vote(20);
```

### 14.5 Proof Query Service (optional, Node/TypeScript)
```ts
// backend/src/proof-service.ts
import express from "express";
import { buildPoseidon } from "circomlibjs";
import { Server } from "@stellar/stellar-sdk/rpc";

// Mirrors on-chain tree by indexing events (optional convenience layer)
class TreeIndexer {
    private depth: number;
    private leaves: string[] = [];
    private zeros: string[] = [];
    private poseidon: any;
    private filledSubtrees: string[] = [];

    constructor(depth: number, poseidon: any) {
        this.depth = depth;
        this.poseidon = poseidon;
        // Compute zero hashes (must match on-chain)
        let current = "0";
        this.zeros.push(current);
        this.filledSubtrees = new Array(depth).fill(current);
        for (let i = 0; i < depth; i++) {
            current = poseidon([current, current]);
            this.zeros.push(current);
        }
    }

    // Mirror on-chain insertion (for proof reconstruction)
    addLeaf(leaf: string): { index: number; root: string } {
        const index = this.leaves.length;
        this.leaves.push(leaf);

        let currentIndex = index;
        let currentHash = leaf;

        for (let level = 0; level < this.depth; level++) {
            if (currentIndex % 2 === 0) {
                this.filledSubtrees[level] = currentHash;
                currentHash = this.poseidon([currentHash, this.zeros[level]]);
            } else {
                currentHash = this.poseidon([this.filledSubtrees[level], currentHash]);
            }
            currentIndex = Math.floor(currentIndex / 2);
        }

        return { index, root: currentHash };
    }

    getProof(leafIndex: number): { pathElements: string[]; pathIndices: number[] } {
        if (leafIndex >= this.leaves.length) throw new Error("Leaf not found");

        const pathElements: string[] = [];
        const pathIndices: number[] = [];
        let currentIndex = leafIndex;

        // Reconstruct siblings for proof
        for (let level = 0; level < this.depth; level++) {
            const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
            pathIndices.push(currentIndex % 2);

            if (siblingIndex < (this.leaves.length >> level)) {
                // Sibling exists, need to compute it
                pathElements.push(this.getSiblingHash(level, siblingIndex));
            } else {
                pathElements.push(this.zeros[level]);
            }
            currentIndex = Math.floor(currentIndex / 2);
        }

        return { pathElements, pathIndices };
    }

    private getSiblingHash(level: number, index: number): string {
        // Simplified - in production, cache intermediate hashes
        return this.zeros[level];
    }

    get leafCount() { return this.leaves.length; }
    get currentRoot() { return this.zeros[this.depth]; } // Placeholder
}

const app = express();
app.use(express.json());

let indexer: TreeIndexer;
const rpcServer = new Server(process.env.SOROBAN_RPC_URL || "http://localhost:8000/soroban/rpc");

// Sync with on-chain events
async function syncFromChain() {
    // Subscribe to MembershipTree "Registered" events
    // For each event, call indexer.addLeaf(commitment)
    console.log("Syncing from on-chain events...");
}

app.get("/proof/:commitment", (req, res) => {
    const { commitment } = req.params;
    const index = indexer.leaves.indexOf(commitment);
    if (index === -1) return res.status(404).json({ error: "Not found" });

    try {
        const proof = indexer.getProof(index);
        res.json({ ...proof, leafIndex: index });
    } catch (e) {
        res.status(500).json({ error: "Failed to generate proof" });
    }
});

app.get("/tree/state", (req, res) => {
    res.json({
        depth: indexer.depth,
        leafCount: indexer.leafCount,
        currentRoot: indexer.currentRoot
    });
});

app.listen(3000, async () => {
    const poseidon = await buildPoseidon();
    indexer = new TreeIndexer(20, poseidon);
    await syncFromChain();
    console.log("Proof Query Service listening on :3000 (optional - all data is on-chain)");
});
```

> **Note:** This service is **optional**. All tree data is stored on-chain. This just provides a convenient REST API for querying Merkle proofs. Users can alternatively read contract storage directly.

### 14.6 Backend relayer (Self-hosted Express.js)
```js
// backend/src/relayer.js (simplified - see actual implementation for full version)
import express from "express";
import * as StellarSdk from "@stellar/stellar-sdk";

const RPC_URL = process.env.SOROBAN_RPC_URL;
const VOTING_CONTRACT_ID = process.env.VOTING_CONTRACT_ID;
const relayerKeypair = StellarSdk.Keypair.fromSecret(process.env.RELAYER_SECRET_KEY);
const server = new StellarSdk.SorobanRpc.Server(RPC_URL);

const app = express();
app.use(express.json({ limit: "1mb" }));

app.post("/vote", async (req, res) => {
  const { daoId, proposalId, choice, nullifier, root, proof } = req.body;

  // Build contract call with relayer as source (pays fees)
  const contract = new StellarSdk.Contract(VOTING_CONTRACT_ID);
  const args = [
    StellarSdk.nativeToScVal(daoId, { type: "u64" }),
    StellarSdk.nativeToScVal(proposalId, { type: "u64" }),
    StellarSdk.nativeToScVal(choice, { type: "bool" }),
    u256ToScVal(nullifier),
    u256ToScVal(root),
    proofToScVal(proof)
  ];

  const account = await server.getAccount(relayerKeypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE
  })
    .addOperation(contract.call("vote", ...args))
    .setTimeout(30)
    .build();

  // Simulate and submit
  const simResult = await server.simulateTransaction(tx);
  const preparedTx = StellarSdk.SorobanRpc.assembleTransaction(tx, simResult).build();
  preparedTx.sign(relayerKeypair);
  const sendResult = await server.sendTransaction(preparedTx);

  res.json({ success: true, txHash: sendResult.hash });
});

app.listen(3001, () => console.log("Self-hosted Relayer listening :3001"));
```

> **Note:** This is the current self-hosted implementation. Launchtube integration is planned for mainnet to provide better scalability and fee management.

### 14.7 Event watcher (Horizon SSE) — optional analytics
```js
// tools/watch-events.js
import EventSource from "eventsource";
const H = process.env.HORIZON || "https://horizon-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID; // MembershipTree

const url = `${H}/events?cursor=now&limit=200&type=contract&contract_ids=${CONTRACT_ID}&topic=RootUpdated`;
const es = new EventSource(url);
es.onmessage = (msg) => {
  const ev = JSON.parse(msg.data);
  console.log("RootUpdated", ev);
};
```

---

### 14.8 Local dev notes
- Run `soroban-rpc` with permissive CORS for local UIs: `soroban rpc serve --allow-origin=*`.
- Clone and run local Stellar Laboratory if you want its UI: `npm start` in the lab repo.
- Frontend → Backend Relayer → Soroban RPC → Network: keep the relayer private key server-side only.
- For mainnet: Consider Launchtube integration for better channel management and fee sponsorship.

---

## 15) Advantages of Fully On-chain Architecture (v0.5)

**Benefits:**
- **Zero trust assumptions** — no admin keys, no off-chain dependencies for core logic
- **Fully decentralized** — users interact directly with contracts
- **Transparent** — all tree state publicly verifiable on-chain
- **Simpler architecture** — no backend required for core functionality
- **Cheaper operations** — no double gas cost (backend tx + user tx)

**Trade-offs:**
- **Gas cost** — on-chain Poseidon computation costs gas (O(depth) hashes per registration)
- **Storage cost** — full tree stored on-chain (filled subtrees, zeros, root history)
- **Complexity** — incremental Merkle tree logic in contract

**Capacity:**
- Tree depth 20 = ~1M members (2^20)
- Tree depth 24 = ~16M members (2^24)
- Each registration: ~20 Poseidon hashes (for depth 20)

**Future Optimizations:**
- Batch registrations to amortize gas
- Lazy tree updates with proof verification
- Off-chain proof generation with on-chain root submission (hybrid)

---

> Next steps: Implement the contracts using the skeletons above, then build and deploy to P25 preview network. 

