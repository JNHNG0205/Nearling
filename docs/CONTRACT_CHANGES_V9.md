# Contract changes for `pets-v9` (request from Role 2, 2026-11-11)

Owner: Role 1 (contract). Requested by Role 2 after the team decided (2026-11-11): limited device key for hardware signing, the device can pay for feeding, NFT metadata synced with the pet, metadata on IPFS (Pinata). All three changes are breaking state changes, so they ship together in one fresh deploy `pets-v9` (no migrations, `CLAUDE.md` 7), then `register_pool`, re-seed, and Role 2 updates `PETS_CONTRACT`, the brain function-call keys and the web.

Invariant to keep: **a device key can never send NEAR to any other account** (`CLAUDE.md` 7.6). Every change below keeps it.

## 1. Unstake deposit (LIMITATIONS C6, blocker)

The NEARON pool now requires `get_account(<holder>).unstake_deposit` (0.00772 NEAR today) attached to `unstake`, refunded with the withdrawal. The contract attaches 1 yocto, so every unstake fails (tx `AhFwj7C9SgkfTavhWp9EtY1jfj1XfWzDdGpJXvqYVeKj`).

- `config.pool_unstake_deposit: U128` (admin sets it from the pool view; re-check after pool upgrades).
- `unstake(pet_id, amount)` becomes `#[payable]`: require `attached_deposit >= pool_unstake_deposit`, forward exactly `pool_unstake_deposit` to the pool, refund any excess to the owner.
- `PendingUnstake { amount, unlock_epoch, deposit }`. `on_unstake` failure: refund `deposit` to the owner. `on_withdraw` success: pay the owner `amount + deposit`.
- Approval path: `propose_action(Unstake { amount })` attaches the deposit (held like Stake's).
- Tests: deposit too small rejected; failure refunds; withdraw pays amount + deposit.
- Same check for `claim_deposit` on `sweep_credit` (0 today).

## 2. NFT metadata synced with the pet (Soul, look, IPFS)

Wallets and explorers read NEP-177 `nft_token(...).metadata`. Today only `title` is set.

- New brain-only method `set_metadata(pet_id, media: String, media_hash: Base64VecU8, reference: String, reference_hash: Base64VecU8)`:
  - `reference` = `ipfs://<cid>` of the pet's public JSON (name, Soul text and version, traits, stage, form, equipped shirt, image), pinned by the brain to Pinata.
  - `media` = `ipfs://<cid>` of the pet's PNG (rendered from the same sprites as web and device).
  - Hashes are sha256 of the exact bytes, as NEP-177 requires.
  - Caller: `config.brain` only (the brain is the one pinning). Caps: at most 1 update per pet per minute (`E_COOLDOWN`), strings at most 256 bytes.
- `nft_token` / `nft_tokens*` return `media`, `media_hash`, `reference`, `reference_hash`, plus `description` = first 200 bytes of the Soul (so wallets without IPFS still show the personality), and `updated_at`.
- Event `metadata_updated { pet_id, reference, media }`.
- The Soul itself stays on chain (`set_soul`, versioned): the IPFS JSON is a public mirror, never the source of truth.
- Tests: only brain can set; hashes length checked; `nft_token` shows the new fields; cooldown.

Add `set_metadata` to the brain's function-call key method list (`charge`, `credit`, `sweep_credit`, `set_metadata`).

## 3. Pantry: the device pays for feeding (no deposits from the device key)

Function-call keys cannot attach NEAR, so the device cannot call `feed` with money. Instead the owner stocks a per-pet **pantry** from the wallet once, and the device moves pantry into food.

- `Pet.pantry_yocto: u128`.
- `stock_pantry(pet_id)` `#[payable]`, owner only: adds the deposit to the pantry. Event `pantry_stocked`.
- `feed_from_pantry(pet_id, amount: U128)`, no deposit, callable by the **device key** (`signer_account_pk == pet.device_pk`, predecessor = owner, same checks as `stake_from_food`) and by the owner wallet: moves `amount` from pantry to `food_yocto`, mood +5, revives a starving or dormant pet, emits `fed { pet_id, by, amount, source: "pantry" }`. Caps for the device: at most `config.device_feed_max_per_day` (e.g. 1 NEAR) per UTC day (`E_DEVICE_CAP`).
- `empty_pantry(pet_id, amount)` owner only, gated by approval mode like `withdraw`: returns pantry NEAR to the owner.
- On transfer: the pantry stays with the pet like food? **Decision needed:** recommend refunding the pantry to the old owner on transfer (it is the owner's unspent money, not the pet's food).
- `get_pet` shows `pantry_yocto`.
- Add `feed_from_pantry` to the device key's method list in `register_device` docs and the web AddKey (`play`, `stake_from_food`, `feed_from_pantry`, `approve_action`).
- Tests: device feeds within cap; device over cap rejected; device cannot attach deposit; wallet stock and empty; transfer refund rule.

## 4. After deploy (Role 2 does these)

1. `PETS_CONTRACT=pets-v9.nearling.testnet`; brain function-call keys for v9 (B3).
2. Web: unstake attaches `pool_unstake_deposit`; pantry stock/empty UI; device AddKey method list.
3. Brain: pin metadata on mint, Soul, shirt, form and stage changes, then call `set_metadata`.
4. Re-run `scripts/e2e-chain.ts` and the Playwright suite.
