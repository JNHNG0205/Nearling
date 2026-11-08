# Contract milestones (Role 1)

Owner: Role 1, Contract. Spec: `CLAUDE.md` sections 6 and 7. Dates follow `CLAUDE.md` section 13.

Each milestone is done only when its **Pass** checks run green (tests) or are seen on testnet. Tick a box only after the check passes.

---

## M0: Scaffold and NEARON spike (Nov 7)

Goal: a contract crate that builds and deploys, and S6 answered before we depend on Option A.

- [x] `contract/` crate: near-sdk 5.x + near-contract-standards, `cargo fmt`, `clippy -D warnings`
- [x] `scripts/deploy-testnet.sh`: creates `pets-vN.<team>.testnet`, deploys, calls `new(config)`
- [x] S6 spike (throwaway contract or the real one): from a contract account, call `deposit_and_stake`, `unstake`, `withdraw`, `claim_and_topup` on `mw-pool-1024.testnet`
- [ ] Record in `CLAUDE.md` section 14 (all done except a real `claim_and_topup` into the org): max gas per tx vs the 400+ Tgas pool calls plus callback, unlock epoch per queued unstake, real testnet farm rate

**Pass:**
- `cargo check --target wasm32-unknown-unknown` and `cargo near build` succeed
- The spike contract stakes 1 NEAR on testnet and `get_account(<contract>)` shows the iNEAR
- Option A confirmed in `CLAUDE.md`, or switched to Option B with the reason recorded

---

## M1: Mint, feed, lazy pet state (Nov 8)

Goal: a pet exists on-chain and its stats live and decay without any tick.

- [x] `Config`, `new`, `set_config` (admin only) (done early in M0, 3 unit tests)
- [x] NEP-171/177/181 via near-contract-standards; token ids `"0"`, `"1"`, ...
- [x] `nft_mint_pet(name)`: exactly 0.2 NEAR (0.1 storage to treasury, 0.1 starter food), random traits
- [x] `feed(pet_id)` by anyone
- [x] Lazy settlement (7.1): metabolism drain, mood decay, energy and auto-wake, `starving_since_ns`, life states
- [x] `get_pet` view with `life_state` (`self_sustaining` moves to M3, it needs stake)
- [x] Events: `fed`, NEP-256 mint

**Pass (unit tests):**
- Wrong mint deposit rejected; storage used by a new pet ≤ `mint_storage`
- Metabolism drains credit before food; `starving_since_ns` equals the exact time the budget hit 0
- Mood -2/h awake; energy +8/h asleep, auto-wake at 100
- Starving after 72 h is Dormant; `feed` revives
- Deployed to testnet; Role 2 can `get_pet` a minted pet

---

## M2: Charge, care XP, stages (Nov 9)

Goal: the brain can bill a thought, and care grows the pet.

- [x] `charge(...)`: credit first, then food at `near_usd_rate_micro`; food spent to treasury
- [x] Clamping: $0.005/call, $0.10/pet/day, xp ≤ 5/call and ≤ 50/day, mood ±10, traits ±2/trait/day
- [x] `credit(...)` capped correction
- [x] Daily check-in (+2 xp, `streak`), stages at 10 / 100 / 500 xp
- [x] `dormant` / `revived` emitted on the next write; `thought`, `credited`, `stage_up` events

**Pass (unit tests):**
- `charge` from a non-brain account panics; from brain it **never** panics on low funds or over-cap values
- A short budget charges what is left and the pet becomes Starving
- Over-cap xp / mood / trait deltas are clamped
- Check-in gives xp once per UTC day; a missed day resets the streak
- Crossing a threshold emits `stage_up` exactly once

---

## M3: NEARON stake, credit, sweep (Nov 10)

Goal: stake to live works for real on testnet.

- [x] `stake(pet_id)`: owner only, ≥ 1 NEAR, `deposit_and_stake` + callback (refund on failure)
- [x] Lazy credit accrual: `staked × farm_rate × elapsed`
- [x] `unstake(pet_id, amount)`: one pending per pet; `withdraw(pet_id)` after `unlock_epoch` pays only that pet's amount
- [x] `sweep_credit()`: anyone, always to `config.org_id`
- [x] ~~Mock pool for near-workspaces~~ replaced by unit tests that drive each callback with mocked promise results, plus the real NEARON pool on testnet (stronger than a mock, no sandbox download)
- [x] Events: `staked`, `unstaked`, `unstake_withdrawn`, `credit_swept`

**Pass:**
- Integration tests (mock pool): stake, unstake, withdraw happy path; failed pool call refunds and leaves pet state unchanged; second unstake while pending rejected; non-owner stake rejected
- Unit test: credit grows linearly with time and stake; `self_sustaining` flips at the expected stake
- On testnet: stake 10 NEAR for a pet, `get_pet` shows credit growing, `sweep_credit()` tops up the brain's org (Role 2 confirms balance)
- Status 2026-11-07: stake 2 NEAR, self-sustaining and unstake verified on `pets-v4`. Withdraw verified 2026-11-08 at epoch 5425 (after adding the 1 yocto the pool requires). Still open: real sweep needs the org id and ≥ 0.01 CREDIT

---

## M4: Play, device key, transfer, items (Nov 11)

Goal: the device can act for the pet, safely, and transfer is safe.

- [ ] `play(pet_id, action)` with cooldowns (pet 5 min, play 1 min); `played` event
- [ ] `register_device(pet_id, public_key)`: one key per pet, replaces old (emits `device_cleared`), cancels pending actions
- [ ] Device checks: `signer_account_pk() == device_pk` and `predecessor == owner`
- [ ] `stake_from_food`: 1 to 2 NEAR per action, ≤ 5 NEAR/day, leaves one day of burn as food
- [ ] Transfer rule: blocked while staked or unstake pending; clears device key and pending actions
- [ ] P1: `buy_item` from the config catalog (max 5, no duplicates, price to treasury)

**Pass:**
- Unit tests: cooldown rejection; device method with wrong signer key rejected; old owner's device key stops working after transfer; transfer with stake rejected; `stake_from_food` cap edges (0.99, 1, 2, 2.01 NEAR; 5 NEAR/day; burn reserve)
- S5 with Role 4: `play` signed by the device key succeeds on testnet; a deposit attempt from the device key fails

---

## M5: Approval flow (Nov 12)

Goal: value actions need the pet's body when approval mode is on.

- [ ] `set_approval_mode` (on direct, off gated), `propose_action`, `approve_action`, `cancel_action`, `get_pending_actions`
- [ ] Actions: Stake, Unstake, Withdraw, StakeFromFood (above caps), SetApprovalMode off, RegisterDevice, Transfer
- [ ] Execution inside `approve_action` with the held deposit; refund on NEARON failure
- [ ] Direct wallet calls of gated methods rejected while approval mode is on
- [ ] Events: `action_proposed`, `action_approved`, `action_cancelled`

**Pass:**
- Unit tests: same key cannot propose and approve; expired action rejected; cancel refunds; each gated direct call rejected in approval mode; stolen-wallet scenario (re-register device) blocked
- End to end with Role 4 on testnet: web proposes Stake 10 NEAR, device approves, stake lands; wallet key calling `approve_action` is rejected

---

## M6: Integration and demo seed (Nov 13)

Goal: other roles build on a stable deployment; demo pets are ready.

- [ ] Final `Pet` / `Config` shape frozen; `packages/shared` types match `get_pet` (with Role 2)
- [ ] `scripts/seed-demo.sh`: pets that are Happy, Hungry, Starving, Dormant and Self-sustaining
- [ ] Fresh deploy `pets-vN`; contract id updated in `.env.example`, brain, web and firmware

**Pass:**
- `cargo test` (unit + integration) green, `clippy -D warnings` clean
- Each seeded pet shows its intended `life_state` from `get_pet` on testnet
- Brain, web and device all read the same pet from the new deployment

---

## M7: Final deploy and README (Nov 14)

- [ ] Final testnet deploy and re-seed
- [ ] README contract sections: NEAR standards used, NEARON flow, security model (device key, approvals, caps), limitations

**Pass:** the README "do X, see Y" contract steps work from a fresh wallet on testnet. The human submits before 2026-11-14T23:59Z.
