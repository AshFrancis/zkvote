# Phase 0 Report (Baseline & Risk)

## Scope
- Baseline review of specs/security/test plans and code alignment.
- Threat model drafted (relay/admin).
- Secret/credential hygiene sweep.
- Budget baseline status.
- Backlog for Phase 1+.

## Findings
- **Threat model**: `THREAT_MODEL.md` added; confirms no admin override in voting; relay sees vote payload + metadata but not identities; residual risk from detailed backend errors/logging.
- **Spec/security/test docs**: `SECURITY_STATUS.md` and `SPEC_DRIFT.md` already mark drift issues resolved; `TEST_PLAN.md` shows many tests rely on unlimited budget and still miss negative-path coverage and VK rotation tests.
- **Secrets**: A real relayer key was in repo (`SCR...`). Replaced with `REPLACE_ME_RELAYER_SECRET` in:
  - `backend/.env`
  - `backend/.env.example`
  - `backend/src/set-public-dao-vk.js`
  - `scripts/set-public-dao-vk.js`
  - `scripts/deploy-local-complete.sh`
  Treat the exposed key as compromised and rotate anywhere it was used.
- **Supply chain (partial)**: Ad-hoc scan with `rg` surfaced the key above; node_modules contain test RSA keys (expected). Full history scan (git-secrets/trufflehog) and license checks remain outstanding.

## Budget Baselines (gap)
- Captured SDK-test estimates (underestimate WASM):
  - `create_dao`: cpu=52,740; mem=8,455 bytes
  - `register_with_caller` (commitment): cpu=7,520,958; mem=444,121 bytes
  - `set_vk`: cpu=0; mem=0 (test-mode no-op; expect higher in WASM)
  - `create_proposal`: cpu=210,407; mem=33,989 bytes
  - `vote`: cpu=225,875; mem=36,600 bytes (proof verification bypassed in tests)
- Recorded in `BUDGET_BASELINES.md`; `tests::budget_baseline_create_proposal_and_vote` emits these values.
- Action: rerun with WASM (soroban-cli simulate) for production numbers; add budget smoke asserts with headroom.

## Deprecations / Breaking Changes
- None explicitly marked yet. Need a deprecation/breaking list once Phase 1 refactors are scoped.

## Backlog for Phase 1+
- Contracts: typed errors, versioning hooks, VK rotation with per-proposal vk_id, invariant/budget tests, coarse error codes, storage key versioning, root/nullifier replay edge cases, budget optimization.
- Circuits: golden vectors + CI, VK/circuit rotation tests (VK1 vs VK2), side-channel/error hardening, remove dev keys.
- Backend: structured/redacted logging, log retention policy, coarse error responses, env validation/healthcheck, failure-mode tests (RPC down, duplicates).
- Frontend: central config for network/contract/vk, privacy guardrails, secure/minimal caching of proofs, remove stale assets, align bindings.
- Supply chain: full secret history scan, license compliance (Rust/JS), pin Docker/tools to digests.
- Docs/DevEx: CHANGELOG/Upgrade Guide, migration/rollback runbooks (incl. key rotation), budget baseline doc, deprecation list.
