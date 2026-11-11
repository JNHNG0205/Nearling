# Contract changes for `pets-v9`: implementation guide for Role 1

Owner: Role 1 (contract). Written by Role 2 on 2026-11-11. The web and brain are **already built against this interface**, and they switch the new features on automatically once v9 is live (feature detection). Please keep method names, argument names and JSON shapes **exactly** as written here. If you need to change any of them, tell Role 2 first and update this file.

Background (team decisions, 2026-11-11):
- Hardware signs with a **limited device key** (function-call access key).
- The **device can pay for feeding** itself.
- **NFT metadata is synced** with the pet (Soul, look) and points at IPFS (Pinata).

All three changes alter state layout, so they ship together in **one fresh deploy, `pets-v9.nearling.testnet`**. There is no migration code (`CLAUDE.md` 7, "Redeploys").

**Invariant to keep:** a device key can never send NEAR to any other account (`CLAUDE.md` 7.6). Every change below keeps it.

---

## 0. Checklist (tick in order)

- [x] 1. Unstake deposit (section 1) + tests
- [x] 2. `set_metadata` + richer `nft_token` metadata (section 2) + tests
- [x] 3. Pantry: `stock_pantry`, `feed_from_pantry`, `empty_pantry` (section 3) + tests
- [x] 4. `PetView` and `Config` additions (section 4)
- [x] 5. New events and error codes (section 5)
- [x] 6. `cargo fmt`, `cargo clippy -D warnings`, `cargo test` (pets 181)
- [x] 7. Regenerate the ABI into `docs/abi/` and update `docs/CONTRACT_INTERFACE.md`
- [x] 8. Deploy `pets-v9` + `pets-demo-v9`, `register_pool`, set `pool_unstake_deposit`, seed (section 6)
- [ ] 9. Add the brain's function-call keys (section 6.3): waiting for the public keys from Role 2; run `scripts/add-brain-keys.sh <contract> <pk>...` once per contract
- [x] 10. Update `CLAUDE.md` sections 7.1, 7.2, 7.5 and 14 (rule 7)

**Status (Role 1, 2026-11-11):** live as `pets-v9.nearling.testnet` and `pets-demo-v9.nearling.testnet`, all names and JSON shapes exactly as written below. Smoke test results and tx ids: `CLAUDE.md` 14 ("pets-v9 on testnet"). Notes:
- `PETS_VERSION=9 ./scripts/deploy-testnet.sh` does not work as written: the script sources `.env` with `set -a`, which overrides the command-line value. Set `PETS_VERSION=9` in `.env` instead. The demo deploy is now named `pets-demo-v$PETS_VERSION` by the script.
- The pool's `unstake_deposit` is per holder and changed after the first unstake (0.00772 to 0.00183 for `pets-v9`); the contract keeps attaching `config.pool_unstake_deposit` (0.00772). Whether the pool's `withdraw` returns the deposit is checked after unlock epoch 5438.
- On transfer the pantry refund also emits `pantry_emptied` (with `pantry: "0"`), so the timeline can show it.
- `empty_pantry` has no proposal action: in approval mode the owner turns approval mode off first (device approval), then empties.

---

## 1. Unstake deposit (LIMITATIONS C6, **blocker**)

### Problem
After a NEARON pool upgrade, the pool's `unstake` requires a deposit equal to `get_account(<holder>).unstake_deposit` (0.00772 NEAR today), which is refunded with the withdrawal. Our contract attaches 1 yocto in `internal_unstake` (`contract/src/stake.rs:212-216`), so **every unstake fails today** (tx `AhFwj7C9SgkfTavhWp9EtY1jfj1XfWzDdGpJXvqYVeKj`).

Check the live value:
```bash
near contract call-function as-read-only mw-pool-1024.testnet get_account json-args '{"account_id":"pets-v8.nearling.testnet"}' network-config testnet now
```

### Changes

**`Config` (`contract/src/lib.rs:38`)**: add
```rust
/// NEARON's `unstake_deposit`, attached to the pool `unstake`, refunded on withdraw. Admin re-checks after pool upgrades.
pub pool_unstake_deposit: NearToken,   // JSON: string yocto
```
Default in `with_defaults`: `NearToken::from_yoctonear(7_720_000_000_000_000_000_000)` (0.00772 NEAR). The web reads `config().pool_unstake_deposit` and attaches exactly that.

**`PendingUnstake` (`contract/src/pet.rs:106`)**:
```rust
pub struct PendingUnstake {
    pub amount: U128,
    pub unlock_epoch: U64,
    pub deposit: U128,   // new: what we attached to the pool, returned to the owner with the withdrawal
}
```
`get_pet` already serializes `pending_unstake`; the web and brain read `pending_unstake.deposit` as an optional string.

**`unstake` (`contract/src/stake.rs:66`)**: make it `#[payable]`.
```rust
#[payable]
pub fn unstake(&mut self, pet_id: TokenId, amount: U128) -> Promise {
    let owner = self.require_owner(&pet_id);
    self.require_direct(&pet_id);
    let need = self.config.pool_unstake_deposit.as_yoctonear();
    let got = env::attached_deposit().as_yoctonear();
    require!(got >= need, format!("E_DEPOSIT: Attach {need} yocto for the pool unstake deposit"));
    if got > need {
        Promise::new(owner.clone()).transfer(NearToken::from_yoctonear(got - need)).detach();
    }
    self.internal_unstake(pet_id, owner, amount, need)
}
```

**`internal_unstake`**: take `owner` and `deposit`, store `deposit` in `PendingUnstake`, and attach `deposit` (not 1 yocto) to the pool call:
```rust
self.pool_call("unstake", json!({ "amount": amount }), NearToken::from_yoctonear(deposit))
    .then(self.callback().on_unstake(pet_id, owner, amount, U128(deposit)))
```
Edge case: if `pool_unstake_deposit` is ever set to 0, attach 1 yocto (the pool needs at least 1 yocto, S6). Use `max(deposit, 1)` for the attachment and store what you attached.

**`on_unstake`**: on failure, restore `staked`, clear `pending_unstake` (as today) **and refund `deposit` to `owner`**. The `unstaked` event stays as is (it already includes `pending`, which now carries `deposit`).

**`internal_withdraw` / `on_withdraw`**: on success pay the owner `amount + deposit` (today: `amount`). On failure keep restoring `pending_unstake`, **including `deposit`**. Note: `on_withdraw` currently rebuilds `PendingUnstake` with `unlock_epoch = env::epoch_height()`; pass the original `deposit` through the callback args so it is not lost. The `unstake_withdrawn` event: keep `amount` as the unstaked principal and add `"deposit"`.

Pool `withdraw()` returns all matured NEAR (principal + deposit) to the contract, so the contract has the funds to pay `amount + deposit`. If the pool's withdrawal turns out **not** to include the deposit, pay `amount` only and tell Role 2 (we will update the UI copy). Verify this on testnet with one unstake and record the result in `CLAUDE.md` 14.

**Approval path (`contract/src/approvals.rs`)**:
- `propose_action` (`approvals.rs:61`, deposit check at ~line 69-79): for `Action::Unstake { .. }` require `deposit >= config.pool_unstake_deposit` (today the `_` arm requires zero). Keep the deposit in `PendingAction.deposit` like `Stake`.
- `approve_action` (`approvals.rs:131`, the `Action::Unstake` arm): pass the held deposit to `internal_unstake`; refund any excess above `pool_unstake_deposit` to the owner.
- `cancel_action` already refunds `deposit`; nothing to change.

**`sweep_credit`**: check `get_account(pets).claim_deposit` on the pool. If it is non-zero, add `config.pool_claim_deposit` the same way. It is 0 today, so you can skip this, but please note it in a comment.

### Tests (`contract/src/lib.rs` test module)
- `unstake` with deposit below `pool_unstake_deposit` → panics `E_DEPOSIT`.
- `unstake` with excess deposit → excess refunded to the owner (check the promise receipts or the mocked transfer).
- `PendingUnstake.deposit` is set after `unstake`.
- `on_unstake` failure → stake restored, `pending_unstake` None, deposit refunded.
- `on_withdraw` success → owner paid `amount + deposit`.
- `on_withdraw` failure → `pending_unstake` restored **with** `deposit`.
- `propose_action(Unstake)` with too little deposit → `E_DEPOSIT`; with the right deposit → held; `cancel_action` refunds it.

---

## 2. NFT metadata synced with the pet (Soul, look, IPFS)

### Goal
Wallets and explorers (Meteor, NearBlocks, Mintbase) read NEP-177 `nft_token(...).metadata`. Today only `title` is set at mint (`contract/src/lib.rs:223`). The brain already pins two files per pet to Pinata (verified live on 2026-11-11):
- a **PNG** of the pet (256x256, from `packages/sprites`, same art as the web and device)
- a **JSON** with public fields only: name, Soul text and version, traits, stage, form, equipped shirt, image

The brain then calls `set_metadata` (code: `brain/src/metadata/sync.ts:79`). Example of what it will send:
```json
{
  "pet_id": "5",
  "media": "ipfs://bafkreihz7qo37lkdkpxyws43xfjx6hzrfnlwhcbepirgr2hozknagzrzoa",
  "media_hash": "<base64 of sha256(png bytes), 32 bytes>",
  "reference": "ipfs://bafkreidhldo67eikc56veqskchamat4qqi2zfgei4b6swbnufskureenuy",
  "reference_hash": "<base64 of sha256(json bytes), 32 bytes>"
}
```

### New method
```rust
/// Brain only. Points the NFT at the pet's pinned image and public JSON (NEP-177).
pub fn set_metadata(
    &mut self,
    pet_id: TokenId,
    media: String,
    media_hash: Base64VecU8,
    reference: String,
    reference_hash: Base64VecU8,
)
```
Rules:
1. `require!(env::predecessor_account_id() == self.config.brain, "E_NOT_BRAIN: ...")`.
2. Pet must exist (`E_UNKNOWN_PET`).
3. `media` and `reference` each ≤ 256 bytes and start with `ipfs://` → else `E_METADATA: ...` (new code).
4. `media_hash` and `reference_hash` must be exactly 32 bytes (sha256) → else `E_METADATA`.
5. Cooldown: at most one update per pet per 60 s (`E_COOLDOWN`). Store `metadata_at_ns: u64` on the pet (or in a side map).
6. Write into the token's `TokenMetadata` in `self.tokens.token_metadata_by_id` (a `LookupMap<TokenId, TokenMetadata>`):
   - `media = Some(media)`, `media_hash = Some(media_hash)`
   - `reference = Some(reference)`, `reference_hash = Some(reference_hash)`
   - `description = Some(first 200 bytes of the current Soul prompt, cut on a UTF-8 char boundary)`, or `None` if soul version is 0
   - `updated_at = Some(env::block_timestamp_ms().to_string())`
   - keep `title` = pet name
7. Emit `metadata_updated { pet_id, media, reference }`.
8. No deposit. Storage grows by about 300 bytes per pet; that fits inside `mint_storage` (0.1 NEAR covers 10 KB). Please assert in a test that a pet with a full 1 KB Soul plus full metadata stays inside `mint_storage`.

**Important for the brain's feature detection** (`brain/src/metadata/sync.ts:38-62`): the brain checks if `set_metadata` exists by calling it as a **view** with `{}`. Any panic (`ProhibitedInView`, deserialize error, `E_...`) counts as "exists"; only `MethodNotFound` means "missing". So just a normal `pub fn set_metadata(&mut self, ...)` works. Do not rename it.

**Also on `set_soul`** (`contract/src/soul.rs:22`): update `description` in the token metadata there too, so wallets see the new Soul even before the brain re-pins. Optional but nice.

### Tests
- Non-brain caller → `E_NOT_BRAIN`.
- Hash of 31 or 33 bytes → `E_METADATA`; `media` without `ipfs://` → `E_METADATA`; 257-byte string → `E_METADATA`.
- Second call within 60 s → `E_COOLDOWN`; after 60 s → works.
- `nft_token(id).metadata` shows `media`, `media_hash`, `reference`, `reference_hash`, `description`, `updated_at`.
- `description` cut on a char boundary (Soul with multi-byte chars like emoji near byte 200).
- Metadata stays after `nft_transfer`.

---

## 3. Pantry: the device pays for feeding

### Problem
Function-call keys cannot attach NEAR, so the device cannot call `feed` (which is payable). The **owner stocks a per-pet pantry** from the wallet once; the device then moves pantry into food with a zero-deposit call. Money never leaves the owner/pet.

### State
`Pet` (`contract/src/pet.rs:45`):
```rust
pub pantry_yocto: u128,           // owner's NEAR waiting to become food
pub device_fed_today: u128,       // reset in roll_day with the other daily counters
```
`Config`:
```rust
pub device_feed_max_per_day: NearToken,   // default 1 NEAR
```
Reset `device_fed_today = 0` in `Pet::roll_day` (`pet.rs:195`), next to `device_staked_today`.

### Methods
```rust
/// Owner only, payable (any amount > 0). Direct even in approval mode (it adds money, like feed).
#[payable]
pub fn stock_pantry(&mut self, pet_id: TokenId)
```
- `require_owner`; deposit > 0 (`E_DEPOSIT`); `pet.pantry_yocto += deposit`.
- Emit `pantry_stocked { pet_id, owner, amount, pantry }`.

```rust
/// Device key (or owner wallet). No deposit. Moves pantry into food.
pub fn feed_from_pantry(&mut self, pet_id: TokenId, amount: U128)
```
- `require_owner(&pet_id)` (predecessor must be the current owner; the device key lives on the owner's account).
- `amount > 0` and `amount <= pet.pantry_yocto` → else `E_PANTRY: Not enough in the pantry` (new code).
- If `env::signer_account_pk() == pet.device_pk` (device call): `device_fed_today + amount <= config.device_feed_max_per_day` → else `E_DEVICE_CAP`. Add to `device_fed_today`.
- Wallet calls (any other key of the owner) skip the device cap.
- Then do **exactly what `feed` does** (`contract/src/budget.rs:13`): settle, `food_yocto += amount`, mood +5, revive a starving or dormant pet, owner check-in. Best: extract the body of `feed` into `fn internal_feed(&mut self, pet_id, by: AccountId, amount: u128, source: &str)` and call it from both.
- Emit `fed { pet_id, by, amount, source: "pantry" }`. The existing `feed` emits `source: "wallet"` (add the field; the brain indexer reads `fed` and ignores unknown fields).

```rust
/// Owner only, gated by approval mode like withdraw. Returns pantry NEAR to the owner.
pub fn empty_pantry(&mut self, pet_id: TokenId, amount: U128)
```
- `require_owner`, `require_direct` (rejected in approval mode, `E_APPROVAL_MODE`).
- `amount <= pantry_yocto` (`E_PANTRY`); subtract, transfer to owner.
- Emit `pantry_emptied { pet_id, owner, amount, pantry }`.

### Transfer rule (decided by Role 2, please confirm)
On `nft_transfer`, **refund the whole pantry to the old owner** in `before_transfer` (`contract/src/nft.rs`, after the stake checks). Reason: it is the owner's unspent money, not the pet's food. Food stays with the pet like today.

### Device key method list
The device key's method names become: `play`, `stake_from_food`, `feed_from_pantry`, `approve_action`. The web adds `feed_from_pantry` automatically when `get_pet` returns `pantry_yocto` (`web/lib/chain.ts:268`). Update the `register_device` doc comment and `CLAUDE.md` 7.2.

### Tests
- `stock_pantry` by a non-owner → `E_NOT_OWNER`; with 0 deposit → `E_DEPOSIT`.
- Device feeds 0.5 NEAR → food +0.5, pantry -0.5, mood +5, `fed` with `source: "pantry"`.
- Device over the daily cap → `E_DEVICE_CAP`; next UTC day → works again.
- Owner wallet key over the device cap → works (no cap for the wallet).
- `feed_from_pantry` more than the pantry → `E_PANTRY`.
- Starving pet fed from the pantry → revived.
- `empty_pantry` in approval mode → `E_APPROVAL_MODE`; outside → owner paid.
- Transfer refunds the pantry to the old owner; new owner sees `pantry_yocto = "0"`.
- A stranger (not owner) calling `feed_from_pantry` → `E_NOT_OWNER`.

---

## 4. View changes (exact JSON the clients read)

`get_pet` → `PetView` (`contract/src/lib.rs:139`), add:
```jsonc
"pantry_yocto": "0",                                  // string u128
"pending_unstake": { "amount": "...", "unlock_epoch": "...", "deposit": "..." }   // deposit added
```
`config()` adds:
```jsonc
"pool_unstake_deposit": "7720000000000000000000",     // string yocto
"device_feed_max_per_day": "1000000000000000000000000"
```
The client types are in `packages/shared/src/index.ts` (`PetView`, lines 10-39) and `brain/src/chain/near.ts` (`PetsConfig`). Both already have these fields as optional. Use `NearToken` / `U128` so they serialize as strings.

`nft_token` / `nft_tokens` / `nft_tokens_for_owner`: return the updated `TokenMetadata` (section 2).

---

## 5. Events and error codes

New NEP-297 events (standard `nearling`, version `1.0.0`, via `events::emit`):
| Event | Data |
|---|---|
| `metadata_updated` | `{ pet_id, media, reference }` |
| `pantry_stocked` | `{ pet_id, owner, amount, pantry }` |
| `pantry_emptied` | `{ pet_id, owner, amount, pantry }` |

Changed: `fed` gains `source: "wallet" | "pantry"`; `unstake_withdrawn` gains `deposit`.

New error codes: `E_METADATA`, `E_PANTRY`. Reused: `E_DEPOSIT`, `E_DEVICE_CAP`, `E_COOLDOWN`, `E_NOT_BRAIN`, `E_APPROVAL_MODE`. Add the new ones to `CLAUDE.md` 7.2 "Panic codes" and to the web map in `web/lib/errors.ts` (Role 2 does the web part; just tell us).

---

## 6. Deploy and hand-over

### 6.1 Build and deploy
```bash
cd contract
cargo fmt && cargo clippy --target wasm32-unknown-unknown -- -D warnings
cargo test
cargo near build non-reproducible-wasm
cd .. && PETS_VERSION=9 ./scripts/deploy-testnet.sh                  # pets-v9.$NEAR_PARENT_ACCOUNT, registers the NEARON pool
DEMO_SPEED=1 ./scripts/deploy-testnet.sh                          # pets-demo.$NEAR_PARENT_ACCOUNT (existing account: redeploy needs a fresh name, edit the script)
./scripts/seed-demo.sh
```

### 6.2 Set the pool deposit from the live pool
```bash
near contract call-function as-read-only mw-pool-1024.testnet get_account json-args '{"account_id":"pets-v9.nearling.testnet"}' network-config testnet now
# copy unstake_deposit into config.pool_unstake_deposit with set_config
```

### 6.3 Brain function-call key
Add a function-call key on the **brain account** with receiver `pets-v9.nearling.testnet` and methods `charge`, `credit`, `sweep_credit`, `set_metadata`. Send Role 2 the **public key** only; the brain generates and keeps the private key (`brain/data/testnet-accounts.env`, gitignored). Never paste private keys in chat or commits.

### 6.4 Smoke test on testnet (record tx hashes in `CLAUDE.md` 14)
1. Mint a pet, `stake` 1 NEAR, `unstake` 0.5 NEAR with the deposit → `unstaked` event with `deposit`.
2. After the unlock epoch, `withdraw` → owner receives 0.5 + deposit.
3. `stock_pantry` 0.5 NEAR; add a limited device key with `feed_from_pantry`; `register_device`; device-signed `feed_from_pantry` 0.1 NEAR → `fed` with `source: "pantry"`.
4. Brain-signed `set_metadata` with the CIDs above; `nft_token` shows them; a second call within 60 s → `E_COOLDOWN`.

### 6.5 Tell Role 2
Send: the contract ids, the brain FC public key and the smoke test tx hashes. Role 2 then sets `PETS_CONTRACT` (and `DEMO_PETS_CONTRACT`) in `.env`, restarts the brain and web, and re-runs `scripts/e2e-chain.ts` and Playwright. Web features (Pantry card, unstake with deposit, device pantry feeding, on-chain metadata) turn on automatically.

---

## 7. What Role 2 already built against this (for reference, do not edit)

| Feature | Client code |
|---|---|
| Unstake with deposit | `web/lib/chain.ts:235` (`unstake(..., deposit)`), Garden page |
| Propose `Unstake` with deposit | `web/lib/chain.ts:284` |
| Pantry stock / feed / empty | `web/lib/chain.ts:240-245`, `web/components/garden/PantryCard.tsx` |
| Device key method list | `web/lib/chain.ts:58`, `:268` |
| `set_metadata` caller + detection | `brain/src/metadata/sync.ts` |
| Pinata pinning | `brain/src/metadata/pinata.ts`, `docs/IPFS.md` |
| Types | `packages/shared/src/index.ts` (`PetView`), `brain/src/chain/near.ts` (`PetsConfig`) |

Questions: ask Role 2 before changing any name or shape above.
