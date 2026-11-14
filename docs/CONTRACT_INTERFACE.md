# Contract interface (pets-v9 code on petto.testnet, 2026-11-14)

Quick reference for the brain, web and device. Full rules: `CLAUDE.md` 6 and 7. Scope: hybrid, `CLAUDE.md` 1.1. Machine-readable ABIs (method names, argument and return types): [`docs/abi/petto_pets_abi.json`](abi/petto_pets_abi.json), [`docs/abi/petto_shirts_abi.json`](abi/petto_shirts_abi.json).

**Live on testnet:** `pets.petto.testnet` (current, `PETS_CONTRACT`), `pets-demo.petto.testnet` (same code, about 100× speed, `config.demo_speed = true`, label it "demo speed", `DEMO_PETS_CONTRACT`), `shirts.petto.testnet` (`SHIRTS_CONTRACT`). Seeded by `scripts/seed-demo.sh` (owner `seed.petto.testnet`, all hatched): `pets` #0 Sunny Happy, #1 Crumb Hungry, #2 Echo Starving, #3 Sprout Happy and self-sustaining (2 NEAR staked); `pets-demo` #0 Blink (starving about 14 min after the seed, dormant about 43 min later). The earlier `*.nearling.testnet` contracts (`pets-v9`, `pets-demo-v9`, `shirts`) still run but are no longer used; their events carry the standard `nearling`, the new ones `petto`.

**Names (2026-11-14):** the pets collection is "Petto" (`PETTO`), the shirts collection "Petto Shirts" (`PSHIRT`); the code was redeployed in place, so ids, pets and state are unchanged. The event standard stays `nearling` and the accounts keep `nearling.testnet`.

**pets-v9 changes** (`docs/CONTRACT_CHANGES_V9.md`): `unstake` takes the pool's unstake deposit, `set_metadata` syncs the NFT with the pet, and the pantry lets the device feed.

**Wire format:** u128 amounts and u64 timestamps are JSON strings; micro-USD fields are JSON numbers (1 USD = 1_000_000). Errors are panics starting with a stable code, `E_CODE: message`; map on the code.

**Interface changes after this point** need a heads-up to Role 2 and a note here.

## Pets contract

### Views (anyone, free)

| Method | Returns |
|---|---|
| `get_pet(pet_id)` | `PetView`: `id, owner, name, born_at_ns, food_yocto, pantry_yocto, credit_micro, budget_micro, fullness, mood, energy, asleep_since_ns, xp, stage, traits, starving_since_ns, life_state, staked, pending_unstake, daily_credit_micro, daily_burn_micro, self_sustaining, items, device_pk, approval_mode, soul_version`, settled to the current block time. `pending_unstake` = `{ amount, unlock_epoch, deposit }`. `life_state`: `Happy`, `Sad`, `Hungry`, `Sleepy`, `Starving`, `Dormant` (Starving and Dormant = Low Fuel) |
| `get_soul(pet_id)` | `{ version, prompt }`; version 0 = no soul |
| `get_pending_actions(pet_id)` | `PendingAction[]` (approval flow, not the demo path) |
| `config()` | `Config`, incl. `fuel_price_micro`, `near_usd_rate_micro`, `farm_rate_micro_per_near_day`, `pool_unstake_deposit` (yocto string), `device_feed_max_per_day` (yocto string), `demo_speed` |
| `nft_token`, `nft_tokens`, `nft_tokens_for_owner`, `nft_supply_for_owner`, `nft_total_supply`, `nft_metadata` | NEP-171 / 177 / 181. Token metadata: `title` = name, `description` = first 200 bytes of the Soul (updated by `set_soul`), `media`, `media_hash`, `reference`, `reference_hash`, `updated_at` from `set_metadata` |

### Owner (wallet)

| Method | Deposit | Gas | Notes / events / errors |
|---|---|---|---|
| `nft_mint_pet(name, soul?, look?)` | exactly `mint_storage + starter_food` (0.2 NEAR; 0.105 on demo) | 50 Tgas | Returns the token id. `nft_mint`, `soul_updated` if a soul is given. `E_DEPOSIT`, `E_NAME`, `E_SOUL_SIZE` `look: { colour: 0..7, pattern: 0..2 }` picks the body colour and pattern (`E_LOOK` otherwise): the contract moves `traits[0]` and `traits[2]` by a few points to land on them, the other traits stay random |
| `set_soul(pet_id, prompt)` | 0 | 30 Tgas | ≤ 1 KB, bumps the version. `soul_updated`. `E_NOT_OWNER`, `E_SOUL_SIZE` |
| `hatch(pet_id)` | 0 | 30 Tgas | Once: the egg becomes a Baby (stage 1) on chain; later stages still need XP (Teen 100, Adult 500). `stage_up`. `E_NOT_OWNER`, `E_HATCHED`, `E_LOOK` |
| `stake(pet_id)` | ≥ 1 NEAR | **450 Tgas** | Brain Garden. `staked` (in the callback). `E_MIN_STAKE`, `E_GAS`, `E_POOL_NOT_READY`, `E_APPROVAL_MODE` |
| `unstake(pet_id, amount)` | ≥ `config().pool_unstake_deposit` (0.00772 NEAR), excess refunded | 450 Tgas | NEARON's unstake deposit, returned with the withdrawal (`pending_unstake.deposit`). One pending per pet, unlocks at `pending_unstake.unlock_epoch` (12 to 24 h). `unstaked`. `E_DEPOSIT`, `E_UNSTAKE_PENDING`, `E_NO_STAKE` |
| `withdraw(pet_id)` | 0 | 450 Tgas | After unlock; pays `amount + deposit`. May fail with the unstake still pending while NEARON collects it: show "processing, retry later". `unstake_withdrawn { amount, deposit }` |
| `stock_pantry(pet_id)` | the NEAR, any amount > 0 | 30 Tgas | Direct even in approval mode. `pantry_stocked { pet_id, owner, amount, pantry }`. `E_DEPOSIT` |
| `feed_from_pantry(pet_id, amount)` | 0 | 30 Tgas | Wallet or **device key**: pantry into food, like `feed` (`fed` with `source: "pantry"`). The device key is capped at `config().device_feed_max_per_day` (1 NEAR) per UTC day. `E_PANTRY`, `E_DEVICE_CAP` |
| `empty_pantry(pet_id, amount)` | 0 | 30 Tgas | Pantry back to the owner. Rejected in approval mode (turn it off first). `pantry_emptied`. `E_PANTRY`, `E_APPROVAL_MODE` |
| `nft_transfer(receiver_id, token_id)` | 1 yocto | 30 Tgas | `E_STAKED` while staked, unstaking or a stake is in flight. Clears the device and pending actions, refunds the pantry to the old owner (`pantry_emptied`) |

### Anyone

| Method | Deposit | Gas | Notes |
|---|---|---|---|
| `feed(pet_id)` | the food, any amount > 0 | 30 Tgas | Feed the Brain: after a NEAR Intents order settles, the brain calls this with the delivered NEAR, once per order id. Revives a starving pet. `fed { pet_id, by, amount, source: "wallet" }`. `E_DEPOSIT` |
| `sweep_credit()` | 0 | **≥ 600 Tgas** | `sync_from_farm` then `claim_and_topup` into `config.org_id`. Call only when the pool's `get_account(pets).claimable` ≥ 0.01 CREDIT. `credit_swept` |

### Brain only (`config.brain`)

| Method | Gas | Notes |
|---|---|---|
| `charge(pet_id, cost_micro_usd = config.fuel_price_micro, usage_ref = inference id, trait_deltas?, xp_gain, mood_delta)` | 50 Tgas | One per completed reply. Never fails for low funds (clamped, the pet goes Starving). A repeated `usage_ref` (last 32 per pet) is a no-op, so retry blindly. `thought { pet_id, cost_micro, usage_ref, source }` with `source` = `credit` / `food` / `mixed` / `none`. `E_NOT_BRAIN` |
| `credit(pet_id, micro_usd, ref)` | 30 Tgas | Capped correction. `credited`. `E_CREDIT_CAP` |
| `set_metadata(pet_id, media, media_hash, reference, reference_hash)` | 30 Tgas | Points the NFT at the pinned PNG and public JSON. Links `ipfs://`, ≤ 256 bytes; hashes base64 of 32 bytes (sha256); one update per pet per 60 s. `metadata_updated { pet_id, media, reference }`. `E_METADATA`, `E_COOLDOWN` |

The brain signs these with function-call keys on `brain.petto.testnet` (receiver = one pets contract, methods `charge, credit, sweep_credit, set_metadata`), added by `scripts/add-brain-keys.sh` from public keys the brain generates.

### Admin (`config.admin`)

**Battles (2026-11-14, brain only):** `record_battle(winner, loser, draw, loser_ran, battle_id)` scores one finished battle for both pets: win `20 + 5 × (opponent level − own level)` clamped 10 to 40, loss 8, draw 10 each, `loser_ran` = loser 0; at most 100 battle XP per pet per UTC day; level up at `20 × L`, cap 20; a repeated `battle_id` is a no-op (8 bytes of its sha256 are kept forever: about 50 bytes of storage per battle, paid from the contract balance). Events `battle { battle_id, winner, loser, draw, xp: [w, l], level: [w, l] }` and `battle_level_up { pet_id, level }`. `E_NOT_BRAIN`, `E_UNKNOWN_PET`, `E_BATTLE` (same pet twice). View `get_battle(pet_id) -> { level, xp, wins, losses, draws, xp_today, day }` (level 1 and zeros before the first battle). Testnet dev cheat: `admin_set_battle_level(pet_id, level)`, admin only, level 1 to 20 (`E_BATTLE` otherwise), XP toward the next level reset to 0, wins and losses kept, emits `battle_level_up` (`scripts/dev-battle-level.sh`). Stored outside `Pet`, so it shipped as an in-place update.

`admin_add_xp(pet_id, xp)`: testnet dev cheat, adds XP past the daily cap and grows the pet as usual (`stage_up`); run it with `scripts/dev-grow.sh <pet_id> <xp> [demo]`. `set_config(config)`, `register_pool()` (once at deploy, house deposit). `scripts/deploy-testnet.sh` does both and copies the pool's live `get_account(contract).unstake_deposit` into `pool_unstake_deposit`; re-check it after NEARON upgrades.

### Kept in code, not the demo path (hybrid 1.1)

`play(pet_id, "pet" | "play" | "sleep" | "wake")`, `register_device(pet_id, public_key)`, `stake_from_food(pet_id, amount)` (device key), `set_approval_mode`, `propose_action` (an `Unstake` proposal holds at least `pool_unstake_deposit`), `approve_action` (device key), `cancel_action`, `buy_item`. Semantics in `CLAUDE.md` 7.2 and 7.3.

**Device key** (owner's account, function-call access, receiver = the pets contract): methods `play, stake_from_food, feed_from_pantry, approve_action`. It can never attach NEAR, so it only moves the pet's own food or the owner's pantry.

## Shirts contract

| Method | Caller | Deposit | Gas | Notes |
|---|---|---|---|---|
| `claim()` | anyone, once per account | 0.01 NEAR (excess refunded) | 30 Tgas | Returns the token id. `nft_mint`. `E_CLAIMED`, `E_DEPOSIT` |
| `buy(costume)` | anyone, any number | exactly 0.05 NEAR (kept by the contract) | 30 Tgas | One of the 38 keys in `costumes()`. Returns the token id; `metadata.extra` = `{"costume":"<key>"}`. `nft_mint`. `E_COSTUME`, `E_DEPOSIT` |
| `costumes()` | view | | | `{ costumes: string[], price: "<yocto>" }` |
| `nft_transfer(receiver_id, token_id)` | owner | 1 yocto | 30 Tgas | Ownership follows the wallet; re-check `nft_tokens_for_owner` when the Closet syncs |
| `nft_tokens_for_owner(account_id)` and other NEP-171 / 181 views | anyone | | | Collection "Petto Shirts" (`PSHIRT`); new tokens titled "Petto Shirt" (the first 3 claims keep "Nearling Shirt") |

## Events

NEP-297, standard `nearling`, version `1.0.0`, in `EVENT_JSON:` logs: `fed` (with `source`), `thought`, `credited`, `credit_swept`, `soul_updated`, `pool_registered`, `staked`, `staked_from_food`, `unstaked`, `unstake_withdrawn`, `played`, `item_bought`, `stage_up`, `dormant`, `revived`, `device_registered`, `device_cleared`, `action_proposed`, `action_approved`, `action_cancelled`, `metadata_updated`, `pantry_stocked`, `pantry_emptied`; plus NEP-171 `nft_mint` and `nft_transfer`.

## Error codes

`E_NOT_ADMIN`, `E_NOT_BRAIN`, `E_NOT_OWNER`, `E_NOT_DEVICE`, `E_UNKNOWN_PET`, `E_DEPOSIT`, `E_NAME`, `E_GAS`, `E_COOLDOWN`, `E_ASLEEP`, `E_MIN_STAKE`, `E_NO_STAKE`, `E_UNSTAKE_PENDING`, `E_NO_UNSTAKE`, `E_LOCKED`, `E_DEVICE_CAP`, `E_FOOD_RESERVE`, `E_STAKED`, `E_ITEM`, `E_CREDIT_CAP`, `E_STORAGE`, `E_APPROVAL_MODE`, `E_EXPIRED`, `E_SAME_KEY`, `E_NO_ACTION`, `E_TOO_MANY_ACTIONS`, `E_SOUL_SIZE`, `E_POOL_NOT_READY`, `E_POOL_READY`, `E_METADATA`, `E_PANTRY`, `E_HATCHED`; shirts: `E_CLAIMED`, `E_DEPOSIT`.
