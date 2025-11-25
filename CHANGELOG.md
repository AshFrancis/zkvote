# Changelog

## Unreleased
- Backend relayer hardening:
  - Added `/ready` endpoint (details gated by `RELAYER_AUTH_TOKEN` and `HEALTH_EXPOSE_DETAILS`).
  - Hashed-IP rate limiting to avoid storing raw IPs; optional `STRIP_REQUEST_BODIES` and `LOG_REQUEST_BODY` flags to minimize PII in logs; redaction of proof/nullifier/commitment.
  - RPC timeout + backoff wrappers; RELAYER_TEST_MODE stubs RPC, avoids binding ports, and short-circuits `/vote`.
- Frontend:
  - Relayer readiness check helper and Navbar status surfacing; configurable via `VITE_RELAYER_URL` / `VITE_RELAYER_AUTH`.
  - ZK credential cache namespaced with TTL; config guardrails for network/contract IDs.
- Contracts:
  - Version keys + `ContractUpgraded` events, reinit guards; typed error cleanups and VK version enforcement.
- Tests:
  - Node built-in tests for relayer auth/health; Rust `cargo test --workspace` green; frontend build passing.
