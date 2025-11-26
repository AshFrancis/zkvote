# Refactor Plan (Production Readiness)

## Phases
- **Phase 0 – Baseline & Risk**: Document current architecture/spec alignment, establish threat model (relay/admin), capture budget baselines for critical entrypoints, secret/license scans, identify deprecated/breaking APIs, define migration/rollback expectations.
- **Phase 1 – Contracts (Rust/Soroban)**: Enforce module boundaries, typed errors, storage/versioning scheme, governance FSM invariants, nullifier/replay safety, VK handling/rotation hooks, budget/meters optimization, minimal privacy-safe events, upgrade/version events.
  - Done: per-DAO VK versioning with `VkByVersion`, proposal pinning, explicit VK selection API, `vk_for_version` getter, VK-change compatibility tests.
  - Done: Proposal close flag guarded in vote, nullifier zero guard, shared VK validation/version bump helpers; budget smoke tests for core flows.
  - Done: Added `ProposalState` (Active/Closed/Archived), admin helper reused for VK/close/archive; archive path and vote guards.
- **Phase 2 – Circuits & Crypto**: Contract/circuit consistency (Poseidon params, encodings), VK/circuit rotation with per-proposal vk_id, golden vectors + CI, negative/side-channel-aware error handling, remove dev keys.
  - Done: Poseidon/Merkle golden vectors validated against host (`tests/golden_vectors.rs` + `circuits/utils/golden_vectors.json`).
- **Phase 3 – Backend Relay**: Input validation, auth boundaries, privacy/log policy, resilience to RPC failures, env/config validation + healthcheck, removal of debug endpoints, tests for failures/replays/duplicates.
  - Done: `/config` surfaced (auth-gated) with contract IDs, network, optional vkVersion; health/ready endpoints; hashed-IP limiting and PII redaction; test-mode stubs.
- **Phase 4 – Frontend (logic only)**: Centralized network/contract/vk config, guardrails against deanonymizing flows, minimal/secure caching of proofs, align bindings/ABIs, remove stale zk/vk assets.
  - Done: Relayer readiness probe, relayer `/config` fetch with mismatch warnings vs local contracts.
- **Phase 5 – Docs & DevEx**: THREAT_MODEL, CHANGELOG/Upgrade Guide, migration/rollback/runbooks, clean scripts, pinned tools/images, CI/tooling enforcement.

## Cross-Cutting Requirements
- **Migration/rollback**: For any storage/VK/circuit change, define migration path (on-chain fn or off-chain script) and rollback (older VK/version), dry-run on prod-state copy.
- **Budget baselines**: Measure and set soft limits for vote/create_proposal/add_member; add smoke tests to catch regressions.
- **Formal-ish invariants**: Encode invariants (nullifier uniqueness, proposal FSM) with tests and optional debug asserts.
- **Supply chain**: Secret scan (history), license checks (Rust/JS), pin Docker/tools to digests.
- **Deprecation**: Mark deprecated APIs/events, decide removal window, maintain explicit breaking-changes list.

## Phase 0 Deliverables
- THREAT_MODEL.md (relay/admin assumptions and validation points).
- Baseline report: spec drift, security status, test coverage gaps, budget measurements (or noted gaps), deprecated/breaking APIs list.
- Backlog for Phases 1–5 with priorities/owners and migration/rollback notes where relevant.
