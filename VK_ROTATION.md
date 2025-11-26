# VK Rotation & Backward Compatibility

This contract now stores verification keys per DAO per version (`VkByVersion(dao_id, vk_version)`). Every `set_vk` bumps the version and writes both the “latest” key and a versioned copy. Proposals pin the VK hash and version at creation; `vote` loads the VK by that version to keep old proposals working after rotations.

## Rotation Procedure
1) Upload new VK (circom/snarkjs output) to the relayer/config repo and compute its hash.
2) Call `set_vk(dao_id, vk, admin)` once per DAO. This:
   - Increments `VkVersion(dao_id)` by 1.
   - Stores the new VK at `VkByVersion(dao_id, new_version)`.
   - Publishes `VKSetEvent`.
3) Off-chain indexer should record the new `vk_version` (e.g., by polling `vk_version(dao_id)` or subscribing to events).
4) Frontend/relayer should continue to create proposals without specifying `vk_version`; they will pin the current version automatically. If an old version must be used, call `create_proposal_with_vk_version`.

## Rollback
- If a new VK is faulty, you can rotate back by calling `set_vk` again with the prior VK. The version number will increment, but existing proposals remain pinned to their original version.
- For proposals that should remain on VK N while latest is M, pass `vk_version = N` explicitly at creation time.

## Tests to Run After Rotation
- `cargo test -p voting --lib` (includes:
  - `test_vk_change_after_proposal_creation_resists_vk_change`
  - `test_vk_version_mismatch_rejected`
  - `test_create_proposal_with_specific_vk_version`
  - `test_vk_for_version_exposes_stored_key`
- Integration snapshots: `cargo test --tests` (ensures voting flows remain stable under VK changes).

## Backfilling Legacy Deployments
- If migrating an existing deployment without versioned VK history, set the current VK once with `set_vk` to initialize `VkVersion` and `VkByVersion`. Existing proposals must then be re-created; legacy proposals without a stored versioned VK are not supported by this build.

## Off-chain Consumers
- Use `vk_version(dao_id)` to display the latest version.
- Use `vk_for_version(dao_id, version)` to fetch a specific VK for auditing or to reconstruct proofs for old proposals.
- Index `VKSetEvent` to track rotation history.
