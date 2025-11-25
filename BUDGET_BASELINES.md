# Budget Baselines (SDK test estimate)

Method: `tests::budget_baseline_create_proposal_and_vote` in `tests/integration/src/lib.rs` uses `Env::cost_estimate().budget()` with default finite limits (Rust test mode; underestimates WASM costs). Flow: open-membership DAO → init tree depth 5 → mint SBT → register commitment → set VK → create proposal (no deadline, Fixed) → vote with dummy proof (testutils short-circuits verification).

Results from `cargo test -p daovote-integration-tests budget_baseline_create_proposal_and_vote -- --nocapture`:
- `create_dao`: cpu=52_740, mem=8_455 bytes
- `register_with_caller` (commitment): cpu=7_520_958, mem=444_121 bytes
- `set_vk`: cpu=0, mem=0 (no-op in test path; real WASM will be higher)
- `create_proposal`: cpu=210_407, mem=33_989 bytes
- `vote`: cpu=225_875, mem=36_600 bytes (proof check short-circuited in test mode)

Caveats:
- Proof verification is bypassed under `testutils`, so `vote` is far lower than production (no pairing/poseidon costs).
- `set_vk` likely underestimates production cost (point decoding and storage).
- Registering the first commitment includes tree work; deeper trees/higher indices will change costs.
- Real WASM deployment on P25 will differ; rerun on simulator with actual WASM to get production numbers.

Next steps:
- Add budget smoke assertions around these numbers with generous headroom.
- Rerun with WASM (soroban-cli simulate) to capture production-like budget and update baselines.
