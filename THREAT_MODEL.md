# Threat Model (DaoVote)

Scope: current multi-tenant Soroban contracts (registry, membership-sbt, membership-tree, voting), JS relay, and Circom/Groth16 stack. Focus on relay/admin adversaries; users interact via a relayer to preserve anonymity.

## Actors & Trust
- **Users (members)**: generate secrets locally; rely on relay for submission; do not trust relay with identity.
- **Relay (honest-but-curious)**: sees request metadata but is expected not to tamper; cannot access user wallet keys.
- **Relay (malicious)**: may drop/delay/reorder/alter submissions; holds its own key to sign transactions.
- **Contract admin (per DAO)**: can set VK, manage membership (via SBT/tree), and create proposals; not trusted with anonymity or vote integrity beyond defined controls.
- **Chain validators**: assumed honest in execution; P25 host functions enforce cryptography.

## What Relays Learn / Can Do
- **Can learn**: IP/headers/timing, daoId/proposalId/choice/nullifier/root/commitment/proof (from POST body), relayer account balance. Nullifier is per (dao, proposal), so a relay can link retries for the same vote but not map to a member without off-chain identifiers.
- **Cannot learn**: member identity or secret; which leaf in tree corresponds to the proof; voter’s wallet address (relay pays fees).
- **Can do (malicious)**: drop or delay submissions; replay the same payload (contract rejects reused nullifier); submit malformed tx to cause failure; front-run ordering of votes (tally unaffected because votes are additive); censor specific nullifiers by withholding.
- **Cannot do (malicious)**: forge a different vote/choice without an updated proof (pairing check fails); bypass root/nullifier checks; cast votes without valid proof; read on-chain secrets (none stored).

## What Contract Admins Learn / Can Do
- **Can learn**: proposal metadata, tallies, events (nullifier values are public on-chain), membership state they already manage. No access to secrets.
- **Can do**: set/rotate VK for their DAO; create proposals; mint/revoke/reinstate SBTs via membership contracts; initialize tree params per DAO; emit events; pause new proposals by withholding VK; choose vote mode (Fixed/Trailing) when creating proposals.
- **Cannot do**: see voter identities; override votes or edit tallies (no admin entrypoint); accept proofs without proper VK/root/nullifier checks; change VK for an existing proposal (vk_hash is snapshotted and enforced); bypass nullifier replay protection.
- Nullifier domain separation: circuit expects `nullifier = H(secret, dao_id, proposal_id)`; on-chain storage keyed by `(dao_id, proposal_id, nullifier)` to prevent reuse across proposals/DAOs.

## Code Alignment Checks (current repo)
- `contracts/voting/src/lib.rs`: no admin override path; nullifier checked first; VK hash snapshotted per proposal; root checks enforce snapshot/trailing rules; proof verification bound to public signals (dao/proposal/root/nullifier/choice/commitment); set_vk gated by registry admin.
- `contracts/membership-*`: SBT gating and tree registration restrict membership actions to admin + members per DAO; no entrypoints expose commitments or secrets beyond events with roots/nullifiers.
- Backend: relay receives full vote payload and logs processing lines; does not require user keys; health/ready endpoints expose relayer address/contract IDs only when auth is provided; input validation guards hex/field bounds/all-zero proofs.

## Assumptions & Residual Risks
- Users trust that relay will not log/link IPs to nullifiers; current code logs processing messages and returns detailed simulation errors (could correlate attempts).
- Censorship is possible by a malicious relay (dropping votes) or admin (revoking members, withholding VK); anonymity remains but availability can be impacted.
- Nullifiers are public on-chain; reuse across proposals/DAOs is prevented but nullifier values can be correlated by observers for the same proposal (expected).
- Timing/ordering leakage: observers (including relay) can see when votes land; no batching/cover traffic today.
- Admin can select vote_mode to broaden eligibility (Trailing) or limit (Fixed); this is intentional but should be documented per proposal.

## Next Hardening Steps
- Relay: structured logging with redaction; configurable log retention; coarser error responses; optional cover traffic/backoff to reduce correlation; explicit anti-censorship monitoring (missing votes vs submissions).
- Contracts: coarse error codes to avoid fine-grained leakage; optional per-contract versioning + upgrade events; ensure membership/admin checks stay isolated.
- Ops: monitor relayer availability; document user guidance (do not mix identifiable transactions around anonymous voting).
