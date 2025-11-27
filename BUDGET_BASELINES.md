# Budget Baselines (SDK test estimate)

Method: `tests/integration/tests/budget_smoke.rs` uses `Env::cost_estimate().budget()` (Rust test mode; underestimates WASM costs). Flows run with unlimited budget, then capture CPU deltas:

- `budget_vote_path_within_limit`: open-membership DAO → init tree depth 18 → mint SBT → set real VK → create proposal (no deadline, Fixed). Asserts CPU delta for proposal creation stays under 5,000,000.
- `budget_set_vk_within_limit`: DAO + tree init, then set real VK (admin checked via registry/tree). Asserts CPU delta for `set_vk` stays under 8,000,000.

Caveats:
- Proof verification remains short-circuited under `testutils`; voting path numbers still understate production (pairing/pedersen/poseidon omitted).
- `set_vk` now has a smoke ceiling but needs re-measure on WASM (`soroban rpc simulate`) to set a realistic upper bound.
- Registering first commitments includes tree updates; deeper trees/higher indices will change costs.

Next steps:
- Rerun both smoke tests against built WASM artifacts to record production-like budgets and tighten thresholds.
- Add a vote-path smoke test with a real proof once Circom artifacts are finalized for P25.
- When `soroban rpc simulate` is available, run:
  - `soroban contract invoke --wasm target/wasm32v1-none/release/voting.wasm --id <id> -- vote ... --cost-mode simulation`
  - Capture CPU/mem deltas for `set_vk`, `create_proposal`, `vote` and update `max_allowed` in `tests/integration/tests/budget_smoke.rs`.
- Shortcut: `scripts/run_budget_sim.sh` automates deploy + simulate for set_vk/create_proposal/vote and prints budgets; re-run it on the target network after each refactor and update the smoke thresholds accordingly.
- Pending: needs `STELLAR_NETWORK_PASSPHRASE`, `STELLAR_RPC_URL`, and funded `SOURCE` key configured before running the script. Until then, thresholds remain test-mode loose.
