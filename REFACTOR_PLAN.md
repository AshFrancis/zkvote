# Refactor Plan (Production Readiness)

## Phases
- **Phase 0 – Baseline & Risk**: Document current architecture/spec alignment, establish threat model (relay/admin), capture budget baselines for critical entrypoints, secret/license scans, identify deprecated/breaking APIs, define migration/rollback expectations.
- **Phase 1 – Contracts (Rust/Soroban)**: Enforce module boundaries, typed errors, storage/versioning scheme, governance FSM invariants, nullifier/replay safety, VK handling/rotation hooks, budget/meters optimization, minimal privacy-safe events, upgrade/version events.
- **Phase 2 – Circuits & Crypto**: Contract/circuit consistency (Poseidon params, encodings), VK/circuit rotation with per-proposal vk_id, golden vectors + CI, negative/side-channel-aware error handling, remove dev keys.
- **Phase 3 – Backend Relay**: Input validation, auth boundaries, privacy/log policy, resilience to RPC failures, env/config validation + healthcheck, removal of debug endpoints, tests for failures/replays/duplicates.
- **Phase 4 – Frontend (logic only)**: Centralized network/contract/vk config, guardrails against deanonymizing flows, minimal/secure caching of proofs, align bindings/ABIs, remove stale zk/vk assets.
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
