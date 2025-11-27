# Changelog

## Unreleased
- Backend relayer hardening:
  - Added `/ready` endpoint (details gated by `RELAYER_AUTH_TOKEN` and `HEALTH_EXPOSE_DETAILS`).
  - Hashed-IP rate limiting to avoid storing raw IPs; optional `STRIP_REQUEST_BODIES` and `LOG_REQUEST_BODY` flags to minimize PII in logs; redaction of proof/nullifier/commitment.
  - RPC timeout + backoff wrappers; RELAYER_TEST_MODE stubs RPC, avoids binding ports, and short-circuits `/vote`.
- Frontend:
  - Relayer readiness check helper and Navbar status surfacing; configurable via `VITE_RELAYER_URL` / `VITE_RELAYER_AUTH`.
  - ZK credential cache namespaced with TTL; config guardrails for network/contract IDs.
  - Fetch relayer `/config` and flag mismatches vs local contracts; stores relayer-reported `vkVersion` when provided.
  - Flags relayer as mismatched when `/config` differs from local contracts/RPC/passphrase to avoid mispointed submissions.
- Contracts:
  - Version keys + `ContractUpgraded` events, reinit guards; typed error cleanups and VK version enforcement.
  - Per-version VK storage with proposal pinning; added explicit proposal creation with chosen VK version and view `vk_for_version` for off-chain verification.
  - Proposal `closed` flag + close_proposal helper; nullifier zero rejected; helpers for VK validation/version bump.
  - Added Poseidon/Merkle golden vectors test to validate host hash parity.
  - Added `Archived` state with close-before-archive enforcement, admin helper reuse, and invalid-state guard on close.
  - Domain-separated nullifier expectations documented; storage key `(dao_id, proposal_id, nullifier)` enforced.
- Tests:
  - Node built-in tests for relayer auth/health; Rust `cargo test --workspace` green; frontend build passing.
