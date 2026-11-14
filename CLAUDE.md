# CLAUDE.md: Nearling (working name)

Context file for Claude Code. Read fully before writing code. Single source of truth for scope, specs, interfaces and rules.

Spec status legend:
- **[FIXED]**: decided, implement exactly.
- **[VERIFY]**: based on docs but not yet tested; confirm with a spike, then update this file.
- **[TBD]**: open; pick the simplest option, record the choice here.

**Renamed to Petto (2026-11-14):** the repo is `JNHNG0205/Petto` and the product, web and brain copy say Petto. **Accounts switched the same day:** the live contracts are `pets.petto.testnet`, `pets-demo.petto.testnet` and `shirts.petto.testnet` (admin and treasury `petto.testnet`, brain `brain.petto.testnet` with the same function-call keys, relayer `relayer.petto.testnet`, seed owner `seed.petto.testnet`); they emit the event standard `petto`, and the brain also reads `nearling` for the history of the earlier `*.nearling.testnet` contracts, which still run but are unused (pets, costumes and stakes there did not move). Packages are `@petto/*`, crates `petto-pets` / `petto-shirts`, the NEP-413 recipient is `petto`. Kept on purpose: this file's section names, the `nearling` names in history below, internal identifiers such as `NearlingFrame`, the brain DB path and Fly app `nearling-brain` (renaming wipes hosted data), the memory key context `nearling-mem-v1`, and the device-side names (Wi-Fi `Nearling-`, NVS namespace, `art/nearling_sprites.h`; Role 3). NFT collections: "Petto" (`PETTO`) and "Petto Shirts" (`PSHIRT`). Not affiliated with nearling.xyz. "Nibble" was dropped: already used by other apps.

---

## 1. What we are building

**Nearling is an AI pet that lives on NEAR and pays for its own brain.** Every thought is a real private AI inference on NEAR AI Cloud, paid from the pet's own budget. Feed it NEAR and it thrives. Neglect it and it gets hungry, sleepy, then dormant. Stake NEAR for it through NEARON and the staking yield becomes AI credit that feeds it forever.

The pet has **two bodies, one brain**: a web app anyone can try, and a small hardware device (ESP32-S3, 240×240 screen, buttons, touch pad, motion and light sensors, speaker) on your desk. Both show the same pet, driven by the same brain service and the same on-chain fuel.

**Pitch line:** "A Tamagotchi whose life literally depends on its wallet. Every thought costs real AI compute, paid by the pet itself. Stake 10 NEAR and it lives forever."

**Origin:** Illia Polosukhin's Oct 3 2026 idea list: an AI Tamagotchi, NFT pets each with a NEAR balance that pays for AI inference; feeding, dressing, battle arenas later. NEARON's docs list "AI Tamagotchi" as a use case too, so expect other teams to build on the same plumbing.

**Hackathon:** NEAR HACKATHON. Build window 2026-11-01T00:00Z to **2026-11-14T23:59Z (= Nov 15 07:59 Malaysia time)**. Judges include Claude Code and Codex as AI judges, who read this repo.

**Tracks (one submission, several tracks):**
| Track id | Why it fits |
|---|---|
| `games` (main) | "NPCs with wallets... judged on the game loop, bonus if players never notice the chain" |
| `nfts` | "NFTs as accounts that own money": each pet holds and spends its own budget |
| `agents` | The pet pays for its own compute |
| `privacy` | Chats run on NEAR AI private (TEE) models |
| `security` | Value actions need a physical hold-to-approve on the device before Meteor signs on the phone; the brain can only make capped charges. On-chain device-key approvals (7.3) exist as an option |

### 1.1 Hybrid scope [FIXED 2026-11-09]

Two documents define the product:
- **This file** is the source of truth for the chain: contract, fuel, NEARON, events, security caps.
- **`docs/Nearling-Hackathon-Build-Spec.md`** (Build Spec) is the source of truth for product features, device hardware and UX: hatch and pair, verified talk with voice, offline care, Closet, Nearling Run, Wallet.

Where they disagreed, the team chose a hybrid: **the Build Spec's product and hardware, with the pet's fuel kept on chain.**

| Keep on chain (contract, built and verified) | Adopt from the Build Spec | Kept in code, not the demo path |
|---|---|---|
| **Fuel = the pet's on-chain budget** (5.1). One chat = one `charge` of `config.fuel_price_micro`; idempotent `usage_ref` gives the brain's reserve / debit / retry | Hardware, offline pat / rock / shake / sleep (Build Spec 4), winged evolution | On-device key signing, `stake_from_food`, the on-chain approval flow (7.3, M5) |
| **Feed the Brain:** NEAR Intents checkout settles to the project account, then the brain calls `feed(pet)` with that NEAR | **Soul:** public, versioned personality prompt on chain (7.2, new) | On-chain care stats driven by `play` (mood, energy); care is device-local |
| **Brain Garden = NEARON stake** (6), already working | **Shirt NFT** for the Closet (replaces `buy_item`) | `buy_item` |
| Pet NFT, transfer rules, events, `E_` codes, demo-speed deployment | Nearling Run, voice replies (TTS), Wi-Fi setup portal (no contract impact) | Wallet send and validator staking (only if time allows) |
| | Approvals for Wallet actions and pet transfer: backend approval request, hold-to-approve on the device, **Meteor signs on the phone** | |

**Update 2026-11-11 (team):** the device signs with a limited device key again (pantry feeding, `stake_from_food`, on-chain approvals), and the NFT metadata is synced with the pet on IPFS. Contract side: `pets-v9`, `docs/CONTRACT_CHANGES_V9.md`. Where the table above or section 12 says on-device signing is not the demo path, this update wins.

**Prior art:** TamaTown (ETHGlobal Open Agents, Sepolia: pets as AI agents with wallets), agentchi (Base, x402 pay-per-action pet game for agents), Dæmons (wallet-to-pet game), Pett.ai / PettBro (Web3 AI pet), NEARON's own Tamagotchi demo sub-pool (`mw-tama-1031.testnet`). **Our edge, in order of importance:** the game loop (needs, memory, the pet reaching out first), the hardware body, the pet visibly paying for each thought, stake to live.

---

## 2. Hard rules for Claude Code

1. **Never** without the human's explicit confirmation: `git push`, force-push, making the repo public, mainnet deploys, mainnet transactions, spending real money, posting anywhere, submitting the hackathon form.
2. **Testnet only.** All contracts, accounts and NEARON interactions are on NEAR testnet; NEAR AI calls use the staging API unless told otherwise.
3. **Never commit secrets:** NEAR keys, NEAR AI API keys, device tokens, Wi-Fi credentials. Use `.env` and a gitignored `firmware/include/secrets.h`; commit only `.env.example` and `secrets.example.h`.
4. **Never log chat content or pet memories** in plaintext logs. Log ids, costs and timings only.
5. **No fake inference in the demo path.** Mock NEAR AI only behind `MOCK_AI=1` for tests. Anything simulated must be labelled "simulated" in the UI and README.
6. Kid-friendly pet. No financial advice, no impersonation of real people, refuse harmful requests in character.
7. When a [VERIFY] item turns out different, fix the code and update this file in the same change.
8. Small commits, conventional messages (`feat(contract): ...`).
9. Docs style: no em dashes.

### 2.1 How to work (Karpathy guidelines)

These favour care over speed. For trivial edits, use judgment.

**Think before coding.**
- State assumptions out loud. If a spec line here can be read two ways, list both and ask; do not pick one quietly.
- A [VERIFY] item is an assumption, not a fact. Run its spike (section 14) before building on it.
- If a simpler design meets the same scope (section 12), say so and push back, even on this file.
- If something is unclear, stop, name it, and ask the owning role (section 3).

**Simplicity first.**
- Build only what section 12 lists for the current tier (must-have, then P1). No speculative features, config knobs or abstractions for single-use code.
- No error handling for cases that cannot happen; do handle every case a user, device or the brain can actually trigger (`no unwrap()` on user input, see section 16).
- If 200 lines could be 50, rewrite it. Ask: "Would a senior engineer call this overcomplicated?"

**Surgical changes.**
- Touch only what the task needs. Do not reformat, rename or refactor neighbouring code. Match the existing style.
- Stay inside your role's directories (section 3). A change to a shared interface (contract methods, brain routes, `packages/shared` types) is agreed with the other role first and recorded here.
- Remove imports or functions your change made unused. Mention other dead code; do not delete it.
- Every changed line should trace back to the task.

**Goal-driven execution.**
- Turn each task into a check you can run: "add charge caps" becomes "write tests for over-cap calls, then make them pass".
- For multi-step work, write a short plan first: `1. step -> verify: check`.
- Done means verified: tests pass (`cargo test`, brain tests) or the behaviour was seen on testnet / on the device. Report failures with their output.

---

## 3. Repository layout

```
nearling/
├── CLAUDE.md
├── README.md                    # judge-facing: what, why, try it on testnet, "do X, see Y"
├── .env.example
├── contract/                    # NEAR contract, Rust, near-sdk 5.x + near-contract-standards
├── shirts/                      # Closet shirt NFT collection (NEP-171), separate small contract
├── brain/                       # pet brain service, TypeScript (Node 22, Hono)
├── web/                         # Next.js app
├── firmware/                    # ESP32-S3 device, PlatformIO (Arduino framework)
│   ├── include/secrets.example.h
│   └── src/
├── packages/shared/             # TS types shared by brain and web
├── art/                         # sprite sheets (PNG) + sprite JSON
├── scripts/                     # deploy-testnet.sh, seed-demo.sh
├── spikes/                      # throwaway spike code (e.g. s6-nearon), results go to section 14
└── docs/                        # MILESTONES.md, CONTRACT_INTERFACE.md (client quick reference), abi/ (generated ABIs), Build Spec
```

**Team split (4 people, as worked) [updated 2026-11-11]:**
| Role | People | Owns |
|---|---|---|
| 1. Contract | 1 | `contract/`, `shirts/`, `scripts/`, NEARON integration on chain, device key + on-chain approvals (kept in code) |
| 2. Web + brain | 1 | **All server code:** `brain/` (talk, NEAR AI, receipts, fuel and charge queue, Feed the Brain, Garden sweep, pairing, care, Closet, wallet approvals, race server, proactive inbox), `web/`, `packages/` (`shared`, `race`, `sprites`), NEAR Connect login, deployment (`docs/DEPLOY.md`, CI) |
| 3 + 4. Hardware | 2 | `firmware/` (C++, PlatformIO), 3D-printed case, soldering and wiring, screens, buttons and sensors, audio, Wi-Fi and pairing client, race C++ port (must match `packages/race` golden vectors), `docs/hardware/` |

Roles 3 and 4 are one hardware team of two; the brain routes the device calls (pairing, talk, care, Closet, approvals, race) are built by Role 2 and documented in `AI-brain architectual/08-api-reference.md`. Pets are procedural sprites from `packages/sprites` (no separate art owner).

---

## 4. Architecture

Hybrid scope as built [updated 2026-11-11]:

```
                       NEAR testnet
   ┌──────────────────────────────────────────────┐     ┌──────────────────────────┐
   │ pets / pets-demo.petto: NFT, fuel, pantry,   │◄───►│ NEARON iNEAR pool         │
   │ Soul, stake, events  ·  shirts: Closet NFTs  │     │ stake -> CREDIT           │
   └──▲──────────────▲──────────────────▲─────────┘     └────────────┬─────────────┘
      │ mint, feed,  │ charge (1 fuel), │ feed after a settled        │ sweep_credit:
      │ stake, Soul, │ sweep_credit     │ order (feeder account)      │ CREDIT top-up
      │ shirt claim, │                  │                             ▼
      │ wallet tx    │                  │                    NEAR AI Cloud org (staging)
   Phone web app ──HTTPS, SSE──► Brain service (Node 22, Hono, SQLite) ──► private TEE chat,
   (Next.js, NEAR Connect,       talk + receipts, memory, inbox,            whisper, attestation
    Meteor signs value tx)       pairing, care, Closet, approvals, race
                                     ▲            │
                    HTTPS + race WS  │            └──► NEAR Intents 1Click (mainnet; dry quotes
                                     │                 unless a human enables live)
                  Nearling device (ESP32-S3, 240x240 screen, buttons, touch pad,
                  motion + light sensors, speaker): hold to talk, offline care,
                  Closet, Nearling Run, hold-to-approve for wallet actions
```

- **On-chain is the source of truth** for ownership, fuel (food + staking credit), stake, Soul, stage and xp. Care (mood, milestones, winged form) is brain and device state (1.1).
- **Brain service** owns conversation, memory, receipts, billing, proactive messages, pairing, race rooms and approval requests. It is the only account allowed to call `charge` and `credit`; its feeder account calls `feed` for settled orders.
- **Web and device are clients.** Neither talks to NEAR AI directly. The device holds no chain key in the demo path: value actions are approved on the device, then signed in Meteor on the phone.

---

## 5. Game design

**Hybrid note (1.1):** 5.1 (budget = fuel) and the starving / dormant states of 5.3 stay on chain and drive the demo. Care is device-local (Build Spec 4); the on-chain mood, energy and `play` of 5.2 remain in the contract but are not the demo path. Evolution in the demo is the Build Spec's winged form; the on-chain xp stages (5.4) still grow from chats.

### 5.1 The pet's budget [FIXED]
Each pet has two budget sources, both shown in the UI:
| Source | What it is | How it is used |
|---|---|---|
| **Credit** (from stake) | The pet's share of NEARON CREDIT accrued from NEAR staked for it (1 CREDIT = $1 of NEAR AI) | Spent first |
| **Food** (from feeding) | NEAR deposited directly ("snacks") | Spent when credit runs out, converted at a fixed testnet rate |

Each thought's real cost (USD) is billed: credit first, then food. "Self-sustaining" badge when projected daily credit accrual ≥ average daily thought cost.

**Reference maths (staging prices, recheck in S1):** `openai/gpt-oss-120b` (private) is $0.15 in / $0.55 out per 1M tokens. A short chat with persona and memory (about 800 in, 100 out) costs about $0.0002. At NEARON's stated mainnet farm rate (about 1.97 CREDIT per 100 NEAR per month), 10 NEAR staked ≈ 35 chats a day. Use the real testnet rate in the UI.

### 5.2 Stats (0 to 100, computed lazily from timestamps) [FIXED, tune numbers]
| Stat | Meaning | Changes |
|---|---|---|
| `fullness` | Days of budget left, scaled | Derived from (credit + food) / daily burn; 100 = 3+ days |
| `mood` | Happiness | -2 per hour idle; + on chat, play, pet, items, owner returning |
| `energy` | Awake capacity | -3 per chat or play; +8 per hour asleep; auto-wake at 100 |

Daily burn = metabolism (passive, default $0.001/day [TBD]) + recent average thought cost. Metabolism really drains the budget (lazily, credit first, then food; 7.1), so a neglected pet starves even if nobody chats.

### 5.3 Life states [FIXED]
| State | Condition | Behaviour |
|---|---|---|
| Happy | fullness ≥ 40 and mood ≥ 40 | Normal chat, idle animation |
| Hungry | fullness < 40 | Mentions food, shorter replies |
| Sad | fed and awake, mood < 40 | Asks to be petted or played with |
| Sleepy | energy < 15, or night mode | Short replies, recovers energy. Night mode is brain/client only; on-chain sleep is `play("sleep")` and auto-wakes at energy 100 |
| Starving | budget = 0 | No inference; canned "zzz... I'm hungry", costs nothing |
| Dormant | starving for 72 h | Curled-up sprite; revived by feeding or staking. **Pets never die** |

Precedence (first match wins): Dormant > Starving > Sleepy (also while asleep) > Hungry > Sad > Happy. A new pet starts at mood 80, energy 100.

### 5.4 Growth [FIXED, tune thresholds]
- Stages **Egg → Baby → Teen → Adult** by `xp` (10 / 100 / 500). **Hatching [2026-11-14]:** the owner's one-time `hatch(pet_id)` makes the egg a Baby on chain straight away (no XP needed), so the app and the chain agree; Teen and Adult still come from XP. Deployed in place on `pets-v9` and `pets-demo-v9` (txs `467kBGxL…`, `5nwqpAjy…`); `hatch` on pet #0 emitted `stage_up` 1, a second call gave `E_HATCHED`.
- XP comes from **care, not money**: chats, play, daily check-ins, streaks.
- **Traits** (five u8): playful, curious, calm, sassy, kind. Random at mint, nudged by how the owner treats the pet (brain proposes deltas; contract caps ±2 per trait per day).

### 5.5 The pet reaches out first [FIXED, core to the game loop]
- The brain checks every pet every 15 minutes. Triggers: fullness crosses 40 or 15, mood below 30, owner away 24 h, stage-up, morning greeting.
- Output: a short message in the pet's voice, delivered to the device (screen bounce + chime + message) and the web app (in-app notification; web push [TBD]).
- Max 3 proactive messages per pet per day. Threshold alerts use canned lines (free); greetings and "I missed you" use inference (billed).
- Memory makes it personal: "You said your exam was today. How did it go?"

### 5.6 Play and items
- **Game:** Nearling Run, the two-lane race (Build Spec 6), off chain.
- **Closet:** a **shirt NFT** the owner claims; the device draws it as a sprite layer (Build Spec 5). Replaces the `buy_item` accessories, which stay in the contract unused. **Shirts contract [FIXED, M5b]** (`shirts/`, `shirts.petto.testnet`): NEP-171/177/181, `claim()` mints one shirt per account, ever (`E_CLAIMED`); the claimer attaches 0.01 NEAR for storage and the excess is refunded. Shirts transfer freely; the brain checks ownership with `nft_tokens_for_owner` when the Closet syncs. Kept separate so the pets contract's `nft_tokens` stay pets only. **Costume shop [2026-11-14]:** `buy(costume)` mints one of 36 costumes for exactly 0.05 NEAR (kept by the contract), key in `metadata.extra` as `{"costume":"<key>"}` (`E_COSTUME` for an unknown key); `costumes()` lists the catalog and price. Deployed in place on `shirts.nearling.testnet`. `packages/sprites/src/costumes.ts` draws each costume as back and front layers from the pet's geometry; the brain stores the worn costume key (`PetState.equipped_costume`) and the web Closet has try on, buy and wear. Firmware support is Role 3's (a header regeneration).

---

## 6. NEARON integration [VERIFY S6, S7]

NEARON is a **testnet prototype** that turns staked NEAR into NEAR AI credit (`https://stg.nearon.dev/#/docs/use-cases`).

**Facts from its docs:**
- **iNEAR:** minted 1:1 for staked NEAR; earns CREDIT every second. Unstake takes about 12 h on testnet (about 2 days mainnet); no instant exit.
- **CREDIT:** 1 CREDIT = $1 of NEAR AI. Claim to a wallet or top up a NEAR AI org whose API keys spend it.
- **Sub-pools:** a holder splits its CREDIT among beneficiaries by share. A **reward router** sets shares and binds each beneficiary to a NEAR AI org with a signed message. The router can change the split but cannot touch principal.
- **Testnet contracts:** iNEAR / pool `mw-pool-1024.testnet` · CREDIT `mw-cloud-1024.testnet` · farm `hos-e2e-0601144939.testnet` · sender `mw-issuer-1031.testnet/nearon-issuer` (runs on OutLayer) · demo Tamagotchi sub-pool holder `mw-tama-1031.testnet`.
- **Parameters:** minimum deposit 0.1 NEAR · protocol fee 0% (max 20%) · top-up fee 0.002 NEAR · minimum API burn 0.01 CREDIT · mainnet farm rate about 1.97 CREDIT per 100 NEAR per month.
- **Trust:** the iNEAR owner can upgrade contracts and set fees; a guardian can pause deposits and claims (unstake and withdraw always work); NEAR AI sets the farm rate, CREDIT value and model prices. Not ready for mainnet value.

**iNEAR pool methods we use (`mw-pool-1024.testnet`, from NEARON docs):**
| Method | Caller | Notes |
|---|---|---|
| `deposit_and_stake()` | anyone | Attach NEAR (≥ 0.1, plus first-deposit storage fee), 400+ Tgas. Mints iNEAR 1:1. Under 1 NEAR it waits in a buffer until `flush_buffer()` |
| `unstake(amount)` | holder | iNEAR amount, exactly 1 yocto attached, 400+ Tgas. Pays at once if the pool buffer covers it, else queues NEAR with unlock epoch = current + farm delay (1 on testnet) + 1 (S6) |
| `withdraw()` | holder | **Exactly 1 yocto attached** (S6, not in the docs), 400+ Tgas. Pays out **all** matured withdrawals of the holder and returns the amount (string); returns 0 if none |
| `claim_and_topup(org_id)` | holder | Turns all claimable CREDIT into a top-up for that NEAR AI org (lowercase UUID) |
| `get_account(account_id)` | view | Balance, claimable, claimed, queued withdrawals |

Docs confirm a contract can be holder and router. Sub-pool beneficiaries need an off-chain NEP-413 binding signed with the router's full-access key, which is why we do not use sub-pools.

**Our design (Option A, chosen) [FIXED, VERIFY S6]:**
1. The **pets contract is the plain iNEAR holder.** No sub-pools, no beneficiary binding, no contract key in the brain.
2. `stake(pet_id)`: owner only, ≥ `config.min_stake` (1 NEAR, so nothing idles in the buffer). Contract calls `deposit_and_stake` with the attached NEAR (pool calls need ≥ 430 Tgas prepaid); the callback adds to `pet.staked`, or refunds the owner on failure. **Pool registration [FIXED 2026-11-09]:** the pool keeps a one-time fee from a holder's first deposit ever, and its size changed with a pool upgrade (0.0055 NEAR in S6, 0.08467 NEAR after `settlement_version` 2: `pets-v8`'s 0.2 NEAR house deposit minted 0.11533 iNEAR; it had left `pets-v7`'s ledger 0.079 NEAR above its iNEAR). So the admin calls `register_pool()` once at deploy with a small house deposit (`HOUSE`, 0.2 NEAR in `deploy-testnet.sh`) that absorbs the fee; until then every stake is rejected (`E_POOL_NOT_READY`). After it, each pet stake mints iNEAR 1:1 and `pet.staked` is recorded as the full amount. The house iNEAR belongs to no pet; its CREDIT goes to the org on sweeps.
3. **Per-pet credit accrues lazily in the contract:** `credit_micro += staked × config.farm_rate × elapsed`, computed in `get_pet` and settled on every write (own as-of time `credit_at_ns`). The UI sees credit grow live. **A starving pet is revived by stake only when it is self-sustaining** (daily credit ≥ metabolism + average spend); a smaller accrual is eaten by metabolism, so the 72 h dormant clock keeps running.
4. `sweep_credit()`: **anyone** can call; it calls `sync_from_farm()` (150 Tgas) and then `claim_and_topup(config.org_id)` (400 Tgas) in one transaction; callers attach ≥ 600 Tgas (C9: `claimable` only updates after a sync). On testnet the whole sweep burnt about 15 Tgas. With nothing claimable after a fresh sync, NEARON panics "Nothing to claim" and the sweep emits nothing. The org is fixed in config, so a caller cannot redirect CREDIT. The brain calls it hourly. `claim_and_topup` returns no value (with 0 claimable it succeeds and does nothing, seen on testnet), so `credit_swept { org_id, result }` cannot report an amount; the brain reads the org balance to see what arrived.
5. `unstake(pet_id, amount)`: one pending unstake per pet; a second one while one is pending is rejected. **Payable [FIXED, pets-v9]:** the owner attaches at least `config.pool_unstake_deposit` (excess refunded), which the contract attaches to the pool `unstake` (at least 1 yocto); NEARON started requiring it after a pool upgrade (C6, 14). Records `pending_unstake { amount, unlock_epoch = current + 2, deposit }`; a failed pool call restores the stake and refunds the deposit. **Always treated as pending** [FIXED after S6]: the pool may pay at once from its buffer or queue it, and the return value does not say which, so the owner always waits for `unlock_epoch`.
6. `withdraw(pet_id)`: after `unlock_epoch`, calls pool `withdraw()` (pays all matured NEAR to the contract; returns 0 if the buffer already paid it), then pays the owner only that pet's pending amount plus its unstake deposit. Emits `unstake_withdrawn { amount, deposit }`.
7. `credit(pet_id, micro_usd, ref)` stays only as a brain-only, capped correction.

**Option B (fallback only if Option A fails S6):** owner stakes directly in NEARON from their wallet and binds their account to the brain's org; the brain tracks which pet it belongs to.

**Fallback if NEARON is unavailable:** simulated accrual in-contract at `config.farm_rate`, labelled "simulated".

**Spike questions (S6):** does max gas per transaction cover an outer call plus the 400+ Tgas pool call and a callback (also from the device key in `approve_action`); do earlier unstakes keep their own unlock epoch when a new one is queued (matters only across pets, since each pet has at most one); real testnet farm rate; does `claim_and_topup` from a contract reach the staging NEAR AI org.

---

## 7. Contract spec (`contract/`, account `pets.<team>.testnet`)

Start from **near-contract-standards**: NEP-171 (core), NEP-177 (metadata), NEP-181 (enumeration), NEP-297 / NEP-256 (events) [FIXED]. **No NEP-145:** the mint price covers the pet's storage (asserted in tests). NEP-178 approvals and NEP-199 payouts only if a marketplace is needed (cut for MVP). Token ids are incrementing integers stored as strings (`"0"`, `"1"`, ...).

**Demo speed [FIXED, M4b]:** the same wasm is also deployed as `pets-demo.petto.testnet` (`pets-demo-v9.nearling.testnet` before the rename; the script names it `pets-demo[-v$PETS_VERSION]`) with `config.demo_speed = true` and about 100× faster rates (metabolism, mood decay, energy gain, dormant after about 43 min), so judges can watch hungry to starving to dormant in minutes. Web and README label it "demo speed" (rule 5). Deployed 2026-11-09 with `DEMO_SPEED=1 ./scripts/deploy-testnet.sh`: metabolism, mood decay and energy gain ×100 (metabolism $0.10/day, mood -1 per 18 s, energy +1 per 4.5 s), dormant after 43.2 min, and `starter_food` 0.005 NEAR so a fresh demo pet starves in about 14 min (mint price there: 0.105 NEAR). 0.1 NEAR of food buys about 4.8 h.

**Redeploys [FIXED]:** no migration code. Any breaking state change deploys to a fresh account `pets-vN.<team>.testnet` via `deploy-testnet.sh`, then `seed-demo.sh`. A code-only change with the same state layout is deployed in place with `near contract deploy <account> use-file <wasm> without-init-call` (done 2026-11-14 for the Petto names on `pets-v9`, `pets-demo-v9` and `shirts`: txs `AkxCaAT7PSN5QNj3MgcZ8NK1PzobWW55JkKm3kQMJ6qq`, `6MXicCBC9cW4e7YSVXeNrXyBeiCiU3k5FmuD9eLMWsK2`, `79FegYRGVHicCA5bzf9LE1THx2gUoPPCJAXJJd9dqzJf`; supplies, pets and config unchanged, `feed` works). Brain, web and firmware read the contract id from config / `.env`.

### 7.1 State
```
Pet {
  name, born_at_ns,                         // id is the map key; owner comes from the NFT core (owner_by_id), never copied
  budget_at_ns, mood_at_ns, energy_at_ns,   // each lazy value has its own as-of time, advanced only by the time it used (frequent writes never round decay away)
  food_yocto: u128,                         // from feeding (anyone can feed)
  credit_micro: u64,                        // micro-USD of CREDIT accrued to this pet (lazy, section 6)
  staked: u128,                             // owner's NEARON stake for this pet (owner-only staking)
  pending_unstake: Option<{ amount: u128, unlock_epoch: u64, deposit: u128 }>,  // at most one; deposit = pool unstake deposit, paid back on withdraw
  mood: u8, energy: u8,
  asleep_since_ns: Option<u64>,             // auto-wakes when energy reaches 100
  xp: u32, stage: u8, traits: [u8; 5],
  starving_since_ns: Option<u64>,           // exact moment the budget reached 0 (computed, not "first seen")
  last_life_state: LifeState,               // lets the next write emit `dormant` / `revived`
  items: Vec<u16>,                          // max 5, no duplicates; stays with the pet on transfer
  recent_usage_refs: Vec<u64>,              // first 8 bytes of sha256(usage_ref) of the last 32 charges (C2 idempotency)
  today: u32,                               // UTC day index (now / 1 day); the counters below reset when it rolls
  spent_today_micro: u64, xp_today: u32, traits_moved_today: [i8; 5],   // daily caps; traits ±2 per trait per day
  avg_daily_spend_micro: u64,               // on rollover: (avg × 3 + yesterday) / 4, then × 3/4 per extra idle day; adds to daily burn (fullness) and drives self_sustaining
  last_checkin_day: Option<u32>, streak: u16,
  last_pet_ns, last_play_ns: Option<u64>,   // cooldowns
  device_pk: Option<PublicKey>,             // one device per pet, one pet per device
  approval_mode: bool,
  pending_actions: Vec<u64>,                // ids into the contract's actions map, max 5 per pet
  device_staked_today: u128,                // reset on day rollover with the other daily counters
  pantry_yocto: u128,                       // pets-v9: owner's NEAR waiting to become food (device feeding); refunded to the old owner on transfer
  device_fed_today: u128,                   // pets-v9: reset on day rollover
  soul: String, soul_version: u32,          // M5b
  metadata_at_ns: Option<u64>,              // pets-v9: last set_metadata (60 s cooldown)
  stakes_in_flight: u8,                     // stake / stake_from_food sent to the pool, callback pending; blocks transfer
}

Config {                                    // set by `admin` via set_config; brain cannot change it
  admin, brain, treasury: AccountId,
  pool: AccountId,                          // mw-pool-1024.testnet
  org_id: String,                           // brain's NEAR AI org (CREDIT sweep target)
  farm_rate_micro_per_near_day: u64,        // 657 (1.97 CREDIT / 100 NEAR / month), measured on testnet in S6
  near_usd_rate_micro: u64,                 // "testnet rate", tuned so starter food lasts about 1 day of active chat [TBD, start 200_000 = $0.20/NEAR]
  mint_storage: u128 (0.1 NEAR, to treasury), starter_food: u128 (0.1 NEAR),
  metabolism_micro_per_day: u64,            // 1_000 = $0.001/day [TBD]
  fuel_price_micro: u64,                    // 1_000 = $0.001 per chat ("1 fuel", hybrid 1.1)
  charge_max_per_call_micro: 5_000, charge_max_per_day_micro: 100_000,
  xp_max_per_call: 5, xp_max_per_day: 50, mood_delta_max: 10,
  credit_correction_max_micro: u64,
  min_stake: 1 NEAR,
  pool_unstake_deposit: u128,               // pets-v9: NEARON's unstake_deposit (0.00772 NEAR); deploy-testnet.sh copies the pool's live value
  device_stake_min: 1 NEAR, device_stake_max_per_action: 2 NEAR, device_stake_max_per_day: 5 NEAR,
  device_feed_max_per_day: 1 NEAR,          // pets-v9: feed_from_pantry signed by the device key
  cooldown_pet_ns: 5 min, cooldown_play_ns: 1 min,
  mood_ns_per_point: 30 min, energy_ns_per_point: 7.5 min, dormant_after_ns: 72 h,   // M4b, so demo speed is config only
  demo_speed: bool,                         // M4b, clients show "demo speed"
  items: Vec<{ id: u16, price: u128, mood_bonus: u8 }>,
}
```

**Lazy settlement [FIXED]:** every write (and `get_pet`, without saving) first settles each value from its own as-of time to now, in this order: accrue credit from `staked`; drain metabolism (credit first, then food); decay mood (-2/h awake); energy +8/h while asleep, auto-wake at 100; compute `starving_since_ns` as the exact time the budget hit 0; life state (5.3). If the life state changed since `last_life_state`, the write emits `dormant` or `revived`.

### 7.2 Methods
Admin:
- `new(admin, brain, treasury, pool, org_id)`: other config fields start at the 7.1 defaults. `set_config(config)`: admin only; tunes numbers and can rotate the `brain` account.

Owner (wallet key):
- `nft_mint_pet(name, soul?, look?) -> TokenId` payable exactly `mint_storage + starter_food` (0.2 NEAR). **Look [2026-11-14]:** optional `look { colour: 0..7, pattern: 0..2 }` (`E_LOOK` otherwise) moves the random `traits[0]` / `traits[2]` to the nearest value (less than 8 / 3 points away) whose remainder gives that sprite colour and pattern, so players pick the look while the personality stays random; deployed in place on `pets` and `pets-demo` (txs `EWuuDUoZ…`, `GLmaLNZg…`). `mint_storage` **stays in the contract** to pay for the pet's storage (NEAR locks balance for storage; asserted on every mint), `starter_food` becomes food; random traits from `env::random_seed()`; name 1 to 32 bytes.
- `stake(pet_id)` payable ≥ `min_stake`, `unstake(pet_id, amount)` payable ≥ `pool_unstake_deposit`, `withdraw(pet_id)`: section 6. Owner only. Gated by approval mode (7.3).
- **Pantry [FIXED, pets-v9]** (function-call keys cannot attach NEAR, so the device feeds from a pantry the owner stocked): `stock_pantry(pet_id)` payable > 0, direct even in approval mode, emits `pantry_stocked { pet_id, owner, amount, pantry }`; `feed_from_pantry(pet_id, amount)` no deposit, owner wallet or device key, moves pantry into food exactly like `feed` (emits `fed` with `source: "pantry"`), the device key capped at `device_feed_max_per_day`; `empty_pantry(pet_id, amount)` pays it back to the owner, gated by approval mode, emits `pantry_emptied`. `E_PANTRY` when the amount is 0 or above the pantry.
- `play(pet_id, action: "pet" | "play" | "sleep" | "wake")`: no deposit; callable by owner, including via the device key. Cooldowns: pet 5 min, play 1 min (rejected inside the cooldown). Effects [tune]: `pet` mood +3; `play` mood +5, energy -3, +1 xp (inside the daily xp cap), rejected while asleep; `sleep` / `wake` set or clear sleep. Every call is the owner's daily check-in. Emits `played`.
- `buy_item(pet_id, item_id)` payable exactly the catalog price: price to treasury; max 5 items, no duplicates; adds `mood_bonus`. Emits `item_bought`.
- `register_device(pet_id, public_key)`: sets the pet's device key, replacing any previous one (emits `device_cleared`) and cancelling pending actions. Gated by approval mode. The owner must also add that key to their account as a limited access key (receiver = pets contract, methods = `play`, `stake_from_food`, `feed_from_pantry`, `approve_action`, allowance 1 NEAR), done through the wallet on the web app.
- `set_approval_mode(pet_id, on: bool)`: turning on runs directly (needs a registered device); turning off is gated (7.3).
- `propose_action(pet_id, action)` payable, `cancel_action(action_id)`: 7.3.
- `nft_transfer`: 7.4.

Anyone:
- `feed(pet_id)` payable: adds to `food_yocto`; mood +5; revives a starving or dormant pet. Emits `fed { pet_id, by, amount, source: "wallet" }`.
- `sweep_credit()`: section 6.

Device (signer is the pet's registered device key, checked with `env::signer_account_pk()`, and predecessor is the current owner):
- `play(...)` as above.
- `stake_from_food(pet_id, amount)`: no deposit; moves the pet's own food into its NEARON stake. `1 NEAR ≤ amount ≤ 2 NEAR` per action, ≤ 5 NEAR per day, and must leave at least one day of burn as food. Funds never leave the pet/owner. Above these caps, use a proposed `StakeFromFood`.
- `feed_from_pantry(pet_id, amount)`: owner's pantry into food, ≤ 1 NEAR per day from the device (pets-v9).
- `approve_action(action_id)`: approves and executes a pending action in the same transaction (7.3).

Brain only:
- `charge(pet_id, cost_micro_usd: u64, usage_ref: String, trait_deltas: Option<[i8;5]>, xp_gain: u32, mood_delta: i8)`: settles, then spends credit first, then food (converted at `near_usd_rate_micro`); food spent goes to `treasury`. **Never panics for lack of funds or caps:** cost is clamped to the per-call cap ($0.005), the daily cap ($0.10 per pet) and what is left; if short, the pet becomes starving. Deltas are clamped: xp ≤ 5 per call and ≤ 50 per day (the check-in bonus is on top), mood ±10, traits ±2 per trait per day (0 to 100). Each chat also costs 3 energy (5.2). Emits `thought { pet_id, cost_micro, usage_ref, source }` with the amount actually charged and `source` = `credit` / `food` / `mixed` / `none` (C3, M4b). **Idempotent (C2, M4b):** a `usage_ref` already among the pet's last 32 charges is a no-op (no charge, no event), so the brain can retry blindly. Only thought spending goes to the treasury; food burnt by metabolism stays in the contract.
- `credit(pet_id, micro_usd: u64, ref: String)`: capped correction only (credit normally accrues lazily). Above `credit_correction_max_micro` it panics (a correction that large is a bug, not a retry). Clears starving if the budget is now above 0. Emits `credited`.
- `set_metadata(pet_id, media, media_hash, reference, reference_hash)` [FIXED, pets-v9]: points the NFT (NEP-177) at the pet's PNG and public JSON that the brain pinned on IPFS. Links start with `ipfs://` and are ≤ 256 bytes, hashes are 32-byte sha256 (base64 in JSON), else `E_METADATA`; one update per pet per 60 s (`E_COOLDOWN`). Sets `media`, `media_hash`, `reference`, `reference_hash`, `updated_at` and `description` (first 200 bytes of the Soul, cut on a char boundary; `set_soul` and mint also set it). Emits `metadata_updated { pet_id, media, reference }`. The brain's function-call keys list `charge, credit, sweep_credit, set_metadata` (`scripts/add-brain-keys.sh`).

**Panic codes [FIXED, M4b] (C4):** every panic message starts with a stable code and a colon, e.g. `E_NOT_OWNER: Only the owner`, so the web can map it to a friendly line. Codes: `E_NOT_ADMIN`, `E_NOT_BRAIN`, `E_NOT_OWNER`, `E_NOT_DEVICE`, `E_UNKNOWN_PET`, `E_DEPOSIT`, `E_NAME`, `E_GAS`, `E_COOLDOWN`, `E_ASLEEP`, `E_MIN_STAKE`, `E_NO_STAKE`, `E_UNSTAKE_PENDING`, `E_NO_UNSTAKE`, `E_LOCKED`, `E_DEVICE_CAP`, `E_FOOD_RESERVE`, `E_STAKED`, `E_ITEM`, `E_CREDIT_CAP`, `E_STORAGE`, `E_APPROVAL_MODE`, `E_EXPIRED`, `E_SAME_KEY`, `E_NO_ACTION`, `E_TOO_MANY_ACTIONS`, `E_SOUL_SIZE`, `E_POOL_NOT_READY`, `E_POOL_READY`, `E_METADATA`, `E_PANTRY` (pets-v9), `E_HATCHED` (hatch, 2026-11-14), `E_LOOK` (mint look, 2026-11-14); shirts: `E_CLAIMED`, `E_DEPOSIT`, `E_COSTUME`.

**persona_hash (C5):** not stored on chain; the brain keeps the persona.

**Care XP [FIXED, tune numbers]:** the first owner interaction per UTC day (feed by the owner, play, chat via `charge`; a stranger feeding does not count) gives +2 xp and extends `streak` (resets after a missed day). Chat xp comes from `charge`. Any write that crosses a stage threshold (5.4) emits `stage_up`.

**Hybrid additions [FIXED, M5b]:**
- **Soul:** `nft_mint_pet(name, soul: Option<String>)` can set it at mint (version 1); `set_soul(pet_id, prompt)` is **owner only**, at most **1 KB** (`E_SOUL_SIZE`), and bumps `version`; `get_soul(pet_id) -> { version, prompt }`; `get_pet` shows `soul_version`. Only the current prompt is stored; every change emits `soul_updated { pet_id, version, prompt }`, so the full history is public in the logs. Version 0 = no soul (brain uses its default persona). The Soul stays with the pet on transfer. A full 1 KB soul at mint costs 0.019 NEAR of storage, inside `mint_storage`.
- **Fuel price:** `config.fuel_price_micro` = 1_000 ($0.001 per chat). The brain passes it as `cost_micro_usd` on every `charge`, so "1 fuel" is the same for every reply; the real provider cost is logged off chain. Starter food (0.1 NEAR at $0.20) is about 20 chats; feeding 1 NEAR about 200.
- **Shirts:** separate contract, see 5.6.

Views: `get_pet(pet_id) -> PetView` settled to current block time: `id, owner, name, born_at_ns, food_yocto, pantry_yocto, credit_micro, budget_micro, fullness, mood, energy, asleep_since_ns, xp, stage, traits, starving_since_ns, life_state, staked, pending_unstake { amount, unlock_epoch, deposit }, daily_credit_micro, daily_burn_micro, self_sustaining, items, device_pk` (`daily_burn_micro` = metabolism + average spend, M4b; u64 timestamps and u128 amounts are JSON strings; `self_sustaining` = daily credit ≥ metabolism + `avg_daily_spend_micro`); `get_pending_actions(pet_id)`; `nft_tokens_for_owner`; `config()`.

### 7.3 Device approval flow [FIXED design, VERIFY S5]
"What you see is what you sign" on the pet's body.
1. **Propose (web, owner wallet):** `propose_action(pet_id, action)` payable where needed. Actions: `Stake { amount }`, `Unstake { amount }`, `Withdraw`, `StakeFromFood { amount }` above the device caps, `SetApprovalMode { on }`, `RegisterDevice { public_key }`, `Transfer { receiver_id }` (JSON: `{"Stake":{"amount":"…"}}`, `"Withdraw"`). Needs approval mode on. `Stake` attaches exactly `amount` (≥ `min_stake`); `Unstake` at least `pool_unstake_deposit` (on approval the excess is refunded); every other action attaches nothing. At most 5 pending per pet (`E_TOO_MANY_ACTIONS`: each one costs contract storage). Creates `PendingAction { id, pet_id, action, deposit, proposer_pk = signer_account_pk, expires_at_ns = now + 10 min }` and emits `action_proposed` with it. View: `get_pending_actions(pet_id)`.
2. **Show (device):** polls the brain for pending actions and shows the exact action and amount on screen.
3. **Approve (device):** owner holds the on-screen Approve button for 2 s; device signs `approve_action(action_id)` with its key and enough gas for the action (Stake / Unstake / Withdraw / StakeFromFood include the 400 Tgas NEARON call and its callback: attach 450 Tgas; max per tx is 1000 Tgas, S6).
4. **Execute (contract):** only if `signer_account_pk() == pet.device_pk`, `signer_account_pk() != proposer_pk` (one key cannot both propose and approve), not expired, and approval mode is on. Otherwise reject. The action runs inside `approve_action`, using the deposit held since the proposal; a failed NEARON call refunds it in the callback. `cancel_action(action_id)` from the owner refunds any deposit, also for expired actions. An approved `StakeFromFood` skips the device caps but still keeps a day of food. Approved `RegisterDevice` and any transfer drop (cancel and refund) all other pending actions; a transfer also turns approval mode off, since the new owner has no device.
5. **While approval mode is on**, the direct wallet calls `stake`, `unstake`, `withdraw`, `register_device`, `set_approval_mode(false)` and `nft_transfer` are rejected; they only run through steps 1 to 4. `feed`, `play`, `buy_item`, `stock_pantry` and `feed_from_pantry` stay direct; `empty_pantry` is rejected (turn approval mode off first). When approval mode is off, everything runs directly from the wallet.

Key point: wallet and device keys both belong to the owner's account, so `predecessor` alone cannot tell them apart. The contract tells them apart by `env::signer_account_pk()`. Gating `register_device` closes the hole where a stolen wallet key swaps in its own device key and approves itself.

### 7.4 Transfer rules [FIXED]
- **Transfer is blocked while `staked > 0`, `pending_unstake` is set, or a stake is in flight** (`stakes_in_flight > 0`, closes the race where the callback has not recorded the stake yet). Unstake and withdraw first. Under approval mode it also needs a device approval (`Transfer`).
- On transfer: the contract clears the device key (emits `device_cleared`) and pending actions, and refunds the whole pantry to the old owner (emits `pantry_emptied`; pantry is the owner's unspent NEAR, food stays with the pet). Traits, stage, xp and items stay with the pet. The brain archives the old owner's memories (new owner starts fresh with the pet), revokes device tokens bound to the old owner, resets the owner nickname.
- Limited access keys live on the old owner's account, so the contract checks `predecessor == current owner` for device methods; old keys simply stop working.

### 7.5 Events (NEP-297, standard `petto` since 2026-11-14, `nearling` on the earlier contracts, version `1.0.0`) + NEP-256 NFT events
`fed`, `thought` (pet_id, cost, usage_ref), `credited`, `credit_swept`, `soul_updated`, `pool_registered`, `played`, `staked`, `staked_from_food`, `unstaked`, `unstake_withdrawn`, `item_bought`, `stage_up`, `dormant`, `revived`, `device_registered`, `device_cleared`, `action_proposed`, `action_approved`, `action_cancelled`; pets-v9: `metadata_updated`, `pantry_stocked`, `pantry_emptied`, `fed.source` (`wallet` / `pantry`), `unstaked.pending.deposit` and `unstake_withdrawn.deposit`.

### 7.6 Invariants
- Only `brain` can `charge` and `credit`; both are capped. Only `admin` can change config.
- Only the owner can stake; stake and withdrawals go back only to the owner.
- `sweep_credit` can only send CREDIT to `config.org_id`.
- Limited access keys cannot attach deposits, so the device can only call `play`, `stake_from_food` (pet's own funds, capped), `feed_from_pantry` (owner's pantry into the pet's food, capped) and `approve_action`. It can never send funds to any other account.
- An action proposed by one key can only be approved by a different key (the registered device key).
- A NEARON call that fails refunds its deposit in the callback; pet state is updated only on success.
- On testnet NEAR has no value; the real NEAR AI bill is paid in CREDIT (from NEARON) and team funds. The brain enforces a hard daily spend cap.

---

## 8. Brain service spec (`brain/`)

Node 22 + Hono, TypeScript. Holds the `brain` NEAR account key and the NEAR AI staging API key.

### 8.1 NEAR AI
- **Base URL:** `https://cloud-api.near.ai/v1` (production, OpenAI-compatible, Bearer key) [FIXED 2026-11-11 by the team: the team key is a production key, staging rejects it (401). Verified: real reply + `model_verified` receipt (provider_tee). Consequence: NEARON CREDIT top-ups target the staging org, so Brain Garden credit does not reach this production org; the on-chain fuel accounting is unchanged]. Staging (`https://cloud-stg-api.near.ai/v1`) still works by setting `NEARAI_BASE_URL`.
- **Default model:** `z-ai/glm-5.3-flash` (private, `verifiable: true`, $0.075 in / $0.25 out per 1M tokens) [FIXED 2026-11-11 from S1, see section 14]. `openai/gpt-oss-120b` is listed as private but staging has **no attestation provider** for it (`/attestation/report` HTTP 503), so its receipts could never be verified. Alternative with attestation: `Qwen/Qwen3.6-35B-A3B-FP8`. Do **not** use non-private models for chat. [VERIFY S1 latency: blocked, the staging key in `.env` is rejected]
- **Speech-to-text:** `POST /v1/audio/transcriptions`, multipart, `model=openai/whisper-large-v3`, ≤ 25 MB, WAV/MP3/WEBM/FLAC/OGG/M4A (production docs) [VERIFY on staging].
- **Cost per reply:** compute from returned token usage × model price, or the billing "costs by request IDs" endpoint (nano-USD per `inference-id`) [VERIFY S2].

### 8.2 API
**As built [updated 2026-11-11]: the full route list, auth and payloads are in `AI-brain architectual/08-api-reference.md`** (that file wins over this summary). Pets are addressed by `:petRef` = URL-encoded `contract:token_id`, so one brain serves `pets-v8` and `pets-demo`.

| Group | Main routes | Auth |
|---|---|---|
| Identity | `GET /auth/nonce`, `POST /session` (NEP-413 signed message → JWT) | public |
| Pet | `GET /pets/:petRef/state`, `/timeline`, `/stream` (SSE) | public / session |
| Talk | `POST /pets/:petRef/talk` (text or audio, client `request_id` for safe retries), `GET /receipts/:turnId`, `/audio/:key`, `/attestation` | session or `Authorization: Device <token>` |
| Feed the Brain | `GET /feed/packs`, `POST /orders`, `GET /orders/:id`, `POST /orders/:id/direct-tx` | public |
| Device pairing | `POST /devices/hello`, `GET /devices/pairing`, `POST /devices/pairing/confirm` (headers `X-Device-Id`, `X-Device-Secret`); the web claims with `POST /pairings/:token/claim`. QR code with a 128-bit token, not a 6-digit code | device secret / session |
| Care, Closet, inbox | `POST /pets/:petRef/care`, `GET /pets/:petRef/closet`, `POST .../closet/equip`, `GET /pets/:petRef/inbox` | session or device |
| Wallet approvals | `POST /approvals`, `/approvals/:id/approve`, `/reject`, `/submitted` | device / session |
| Race | `POST /race/rooms`, `POST /race/rooms/:code/join`, `GET /race/ws` (WebSocket), `GET /race/matches/:id` | public, race token or device |

### 8.3 Chat flow
1. `get_pet`. Starving or Dormant (no fuel) → canned "Low Fuel" reply, no charge; device care still works.
2. Audio → transcribe.
3. Prompt = the pet's **Soul** from chain (`get_soul`, version shown on the receipt) + pet state (stage, fullness, shirt, owner nickname) + memory summary + last 10 turns. Replies ≤ 2 sentences for device, ≤ 4 for web.
4. Chat completion on the private model, non-streaming, one call. The model returns plain dialogue that starts with one emotion tag (`[happy] [excited] [sleepy] [sad] [hungry] [curious] [silly]`; missing or unknown = `happy`) that drives the animation. No structured tail [FIXED 2026-11-11]: the brain does not ask the model for trait, xp or mood deltas.
5. Call `charge(pet, config.fuel_price_micro, usage_ref = turn id, trait_deltas = null, xp_gain = 1, mood_delta = 1)` from a queue after the reply is saved (hybrid 1.1: one chat = one fuel). Retries with the same `usage_ref` never double-charge. Log the real provider cost separately. Voice playback (TTS) runs after the reply text is saved (Build Spec 2).
6. Append to memory; summarise every 20 turns.

### 8.3b Feed the Brain (hybrid 1.1)
The phone checkout uses NEAR Intents (Build Spec 3). When the order settles to the project account, the brain calls `feed(pet_id)` with the delivered NEAR, once per order (store the order id). Fuel then lives on chain like any other feed, and a friend can gift from another chain.

### 8.4 Scheduler
Every 15 min: proactive message rules (5.5). Hourly: call `sweep_credit()` to move NEARON CREDIT into the org. Per-pet credit accrues in the contract; use `credit` only for capped corrections.

### 8.5 Memory, privacy, safety, cost
- Memory per pet, encrypted at rest (AES-256-GCM, per-pet key from a master key). Honest limit: the brain can read memories. Stretch: run the brain step in OutLayer.
- Kid-friendly system prompt; stays in character when refusing.
- Rate limits: 1 thought per 3 s per pet, 300 per day; global daily spend cap.

---

## 9. Web app spec (`web/`)

Next.js (App Router), TypeScript. **Wallet: NEAR Connect** (`@hot-labs/near-connect`) [FIXED]: wallets include HOT, Meteor, Intear, MyNearWallet, Nightly, Near Mobile Wallet, OKX and WalletConnect; filter `testnet: true`; sign-in with signed message (NEP-413). Email/social login only through Privy-based wallets [VERIFY S3]. Add a limited access key only after the user is active (it costs a transaction).

**Routes as built [updated 2026-11-11]** (`[petRef]` = `contract:token_id`; details in `web-app architectual/03-pages-and-flows.md`):

| Route | Purpose |
|---|---|
| `/` | Landing: pitch, live demo-speed pet, try it / I have a Nearling |
| `/adopt` | Name the egg, optional Soul, Normal or Demo speed contract, mint, hatching |
| `/hatch?t=<token>` | Hatch & Pair from the device QR: connect, mint or pick a pet, wait for the device button |
| `/pet/[petRef]` | Browser Nearling (240x240 screen), fuel, text and hold-to-talk chat with receipt badges, care (pat, rock, lights off), inbox, links |
| `/pet/[petRef]/receipts`, `/receipt/[turnId]` | Turn list and one receipt (verification checks, Soul version, fuel tx, publish opt-in) |
| `/feed/[petRef]`, `/order/[orderId]` | Feed the Brain: packs, NEAR wallet (testnet), NEAR Intents (when enabled), Simulated (labelled); order status |
| `/pet/[petRef]/closet` | Claim the free shirt NFT, wear / take off |
| `/pet/[petRef]/soul` | Read and edit the on-chain Soul |
| `/pet/[petRef]/garden` | Brain Garden: plant (stake), take out (unstake, withdraw), credit ticker, self-sustaining |
| `/pet/[petRef]/device` | Paired device status, unpair |
| `/approve/[approvalId]`, `/wallet` | Device-approved wallet actions signed in Meteor; balances and saved recipients (P1) |
| `/race`, `/race/[code]` | Nearling Run rooms, browser racer |
| `/p/[petRef]` | Public pet page with timeline, published receipts, Feed this pet, OG image |
| `/privacy` | What is verified and what is not |

Not built: the shop (`buy_item`), the AddKey device-key page and approval-mode toggle (on-chain approvals are not the demo path, 1.1).

Stretch: NEP-366 sponsored transactions via a relayer so new players pay no gas.

---

## 10. Device spec (`firmware/`)

**Hybrid note (1.1):** hardware, inputs (3 buttons, touch pad, motion, light), audio (spoken replies) and offline care follow the **Build Spec** (its hardware reference wins over this section). The on-device signing below is kept as an option but is **not the demo path**: approvals go through the backend and Meteor (Build Spec 7, 8).

**Hardware [TBD after S4]:** ESP32-S3 board with a **capacitive touch colour screen**, I2S mic and speaker/buzzer (an M5Stack CoreS3-class board fits; verify specs before ordering). Physical buttons optional; the UI is touch-first.

**Screens:** idle, happy, being-petted, talking, listening, eating, hungry, sleepy, sleeping, dormant, new-message (bounce + chime), approve-action, signing, no-wifi, pairing-code. Stage changes the sprite set; items render as overlays.

**Touch interactions [FIXED]:**
| Gesture | Effect |
|---|---|
| Tap or stroke the pet | **Pet the pet**: instant happy/purr animation + heart particles. Counted locally; synced on-chain as `play(pet, "pet")` at most once per 5 min (mood gain capped in contract) |
| Hold the mic button (on-screen) | Record ≤ 10 s, 16 kHz mono WAV → `/chat`; reply scrolls as text (no TTS) |
| Tap the food icon | Shows budget and days left; "Save food" → `stake_from_food` (1 to 2 NEAR, shown only when food ≥ 1 NEAR + one day of burn) |
| Approve screen: hold Approve 2 s | Signs `approve_action(action_id)`; Reject cancels on screen |
| Menu | Stats, inbox, Wi-Fi, unpair |

**Networking:** Wi-Fi (captive portal or `secrets.h`), HTTPS to brain, poll `/state`, `/inbox` and pending actions every 20 s (every 3 s while an approval is open on web).

**Pairing:** device shows a 6-digit code → owner enters it on web → device calls `/devices/claim`, stores the token in flash.

**On-device signing [P1, VERIFY S5]:**
- Device generates an ed25519 key on first boot; private key stays in flash (enable ESP32 flash encryption + secure boot for the demo build). Public key shown on pairing and registered via `register_device`.
- Signing flow: fetch nonce for the device key (`view_access_key`) and a recent block hash from NEAR testnet RPC → build the transaction in Borsh (one `FunctionCall` action, zero deposit) → sign with ed25519 → `send_tx`. Libraries: ESP-IDF libsodium or an Arduino ed25519 library.
- Device-signed methods: `play`, `stake_from_food`, `approve_action`. The device key gets a 1 NEAR gas allowance at AddKey (approvals carry NEARON calls of 400+ Tgas); top it up from the web if it runs out.
- Honest limit: an ESP32 is not a secure element. That is why the key is a limited access key and the contract caps everything it can do.

---

## 11. Art direction [TBD by Role 3, Device: body]

Pixel art, 64×64 base sprite, 4 stages × about 12 states. One palette that reads on the device screen. Sprite-sheet JSON (frame name → rect) shared by web and firmware.

**Decision 2026-11-11:** procedural 32×32 sprites from `packages/sprites` (no art owner; ×6 on the 240 px screen, quarter of the flash), shared by web and firmware via `art/nearling_sprites.h`; spec in `web-app architectual/07-pet-animation.md`.

---

## 12. Scope

**Must-have (submission, hybrid 1.1)**
1. Contract: pet NFT, on-chain fuel (`feed`, `charge` at `fuel_price_micro`, `credit`), starving / dormant, events, transfer rule (done); **Soul** and **shirt NFT** (M5b).
2. Brain Garden: NEARON stake for a pet with CREDIT accrual shown (done, Option A).
3. Brain: verified chat on a private model, voice, one `charge` per chat, Soul fetched from chain, memory, proactive messages.
4. Web / phone: Hatch & Pair, Feed the Brain via NEAR Intents ending in `feed(pet)`, receipts, Closet claim, public pet page.
5. Device (Build Spec): pairing, hold-to-talk, offline care, Closet, Nearling Run, approve-on-device for Wallet actions.
6. README with "do X, see Y" on testnet, demo video.

**P1 (ship after must-haves work):** Wallet send and validator staking, approve pet transfer on the device, second physical racer.

**Kept in code, not in the demo:** on-device signing (`play`, `stake_from_food`, on-chain `approve_action`), `buy_item`, on-chain care stats.

**Should-have:** sponsored transactions (NEP-366) so the device needs no gas. **Done for the web (2026-11-14):** `POST /relay` (`brain/src/relay/`) pays gas for single no-deposit calls (1 yocto at most) to our contracts from wallets that sign delegate actions (Meteor, Intear, Ledger, Email or Google). Under NEP-366 the relayer pays any NEAR attached to the inner calls, so calls with a deposit (mint, feed, stake, pantry, shirt) are never relayed: the user signs and pays them (found 2026-11-14 when relayed mints and feeds had drawn 0.42 NEAR from the relayer); relayer `relayer.petto.testnet` (was `relayer.nearling.testnet`), 100 relays per account per day. Verified on testnet: a relayed `set_soul` cost the user 0 and the relayer 0.000336 NEAR; a relayed `E_NOT_OWNER` comes back as the outcome status (the brain follows the inner receipt chain).

**Later (README roadmap):** dedicated signing chip, friend visits and postcards, Dream Journal, pets earning via Agent Market, arena prizes, brain in OutLayer, mainnet (Build Spec "Future additions").

**Cut:** new tokens, marketplace, royalties, swapping and trading (roadmap: the pet manages its own treasury via Rhea under caps), meme.cooking, BRRRAIN.

---

## 13. Timeline (Nov 7 to 14)

**Updated 2026-11-11.** The original per-day plan (pre-hybrid, four separate roles) is past; what actually landed and what is left:

| When | 1. Contract | 2. Web + brain | Hardware (2 people) |
|---|---|---|---|
| Nov 7 to 10 (done) | M0 to M5b: S6 spike, mint, feed, charge, NEARON stake, approvals, Soul, shirts; `pets-v8`, `pets-demo`, `shirts` deployed and seeded (`docs/MILESTONES.md`) | Brain: talk + receipts, fuel and charge queue, Feed the Brain, Garden sweep, pairing, care, Closet, wallet approvals, race server, proactive inbox. Web: all routes in section 9. Shared types, race rules, sprites | Case, wiring, firmware (see `firmware/` and `docs/hardware/`) |
| Nov 11 to 12 | `pets-v9` (`docs/CONTRACT_CHANGES_V9.md`: unstake deposit, `set_metadata`, pantry) deployed and seeded; brain function-call keys, `org_id` (`docs/LIMITATIONS.md` B3, C1) | First end-to-end testnet run (LIMITATIONS B2), spikes S1, S2, S3, S7, deploy (`docs/DEPLOY.md`), README | Device against the hosted brain: pairing, talk, race golden vectors |
| Nov 13 | Final deploy only if needed, re-seed | Integration fixes, screenshots | Film device shots |
| Nov 14 | Buffer | Demo video; X post and submission are human actions | Buffer |

**Submit before 2026-11-14T23:59Z (Nov 15 07:59 MYT).** Human submits.

---

## 14. Spikes [VERIFY]

| ID | Question | Pass |
|---|---|---|
| S1 | Staging private models: latency and token cost of a short chat | Model picked; p50 < 3 s |
| S2 | Per-reply cost from usage or billing endpoint | Cost per reply recorded |
| S3 | NEAR Connect on testnet; any email/social option | New user can adopt with minimal friction |
| S4 | ESP32-S3 board: touch screen, Wi-Fi, HTTPS, I2S mic WAV | Tap detected on sprite; recorded clip transcribed via brain |
| S5 | ed25519 + Borsh signing of a NEAR function call on ESP32; contract reads `env::signer_account_pk()` | `play` succeeds from device key; deposit attempt rejected; `approve_action` rejects the wallet key and accepts the device key |
| S6 | NEARON from the pets contract as plain holder: `deposit_and_stake`, `unstake`, `withdraw`, `claim_and_topup` via cross-contract calls; max gas per tx vs 400+ Tgas pool calls (incl. from the device key); unlock epochs per queued unstake; real testnet farm rate | Docs answered method names and "contract can be holder" (section 6). Pass: stake, sweep and withdraw work from the contract on testnet |
| S7 | NEARON CREDIT top-up into the staging NEAR AI org; whisper on staging | Brain spends CREDIT for chat and STT |

Record results here.

### S1/S2/S7 results (Role 2, 2026-11-11, `brain/scripts/spike-nearai.ts`, `attest-check.ts`, `tts-check.ts`)
The `NEARAI_API_KEY` in `.env` is rejected by staging (`401 invalid_api_key` on `/chat/completions`, `/audio/transcriptions` and auth-only routes), so every check that needs a key is still open. Rerun `spike-nearai.ts` with a fresh staging key; it stops after the first 401.
| Question | Result |
|---|---|
| `/model/list` format | Public (no key). `{ models, limit: 100, offset, total: 74 }`; each entry `modelId`, `inputCostPerToken` / `outputCostPerToken` as `{ amount, scale: 9, currency }`, `metadata.verifiable`. Matches `parseModelList` |
| Prices (nano-USD per token, in / out) | `z-ai/glm-5.3-flash` 75 / 250, `openai/gpt-oss-120b` 150 / 550, `Qwen/Qwen3.6-35B-A3B-FP8` 170 / 1100, `openai/whisper-large-v3` 10 / 10; all four `verifiable: true` |
| Chat latency p50 / p95, token usage, `inference-id` header, `/billing/costs`, json_schema | **Not measured** (key rejected). Estimate for the 800 in / 100 out prompt: $0.000085 per reply on GLM-5.3-flash, $0.000175 on gpt-oss-120b |
| `/attestation/report` | **Public** (no key; a bad key makes it 401, so the brain sends none). Nonce is echoed in `gateway_attestation.request_nonce` and in each `model_attestations[].request_nonce` (no top-level field). GLM-5.3-flash: 1 model attestation with `nvidia_payload` (JSON string) and `signing_address`, plus a gateway attestation (TDX quote only, no GPU payload). gpt-oss-120b: HTTP 503 "No provider found that supports attestation reports". Qwen3.6-35B and DeepSeek-V4.1-Flash: HTTP 200 |
| NVIDIA NRAS | Accepts the GLM `nvidia_payload` as is: overall result true, `eat_nonce` = our nonce. `refreshAttestation` ends `ok`, 1 model signer, gateway signer present, in about 2 s |
| `/signature/{chat_id}`, `signature_kind`, end-to-end `model_verified` | **Not run** (needs a completion, key rejected) |
| Whisper on staging (WAV, WEBM, `language=en`) | **Not run** (key rejected). Test clips: an ElevenLabs WAV and its Opus WEBM (`SPIKE_AUDIO=a.wav,b.webm`) |
| ElevenLabs `eleven_flash_v2_5`, `pcm_16000` | Works with a **premade** voice: 44 characters in 483 ms, valid WAV (RIFF size correct, PCM mono 16 kHz 16-bit, 2.28 s, real signal), billed 22 credits (0.5 per character). The voice id in `.env` is a library voice: the free plan gets **402 `paid_plan_required`** for it, so `TTS_VOICE_ID` must be a premade voice (e.g. Jessica, playful and warm) |
| ElevenLabs credits check | `/v1/user/subscription` works: tier free, limit 10,000 characters; `character_count` updates within a minute |

### S6 results (2026-11-07, spike contract `s6-spike.nearling.testnet`, code in `spikes/s6-nearon/`)
| Question | Result |
|---|---|
| Max gas per tx | **1000 Tgas** (testnet protocol 88, `max_total_prepaid_gas`). 400+ Tgas pool calls plus callback fit, also from the device key |
| Contract as holder: `deposit_and_stake` | **Works.** 1.1 NEAR minted 1.0945 iNEAR: one-time first-deposit storage fee ≈ 0.0055 NEAR per holder, then 1:1. Inner gas 100 and 300 Tgas both worked; whole tx burnt ≈ 22 Tgas. We still attach the documented 400 Tgas (unburnt gas is refunded) |
| `unstake(amount)` | **Requires exactly 1 yoctoNEAR attached** (contract attaches it from its own balance). Returns empty. **If the pool buffer covers the amount, NEAR is paid back immediately** (no queued withdrawal); otherwise queued with `unlock_epoch = current + 2` (epoch = 43200 blocks ≈ 12 h, so 12 to 24 h). Decision: always treat as pending (section 6 step 5) |
| Separate unlock epoch per queued unstake | Open: only same-epoch entries seen so far (all unlock at 5424). Matters little: each pet has at most one pending unstake |
| `withdraw()` | **Requires exactly 1 yoctoNEAR attached** (first try failed without it; the pets contract kept the unstake pending, as designed). Returns the amount paid, e.g. `"500000000000000000000000"`. Verified at epoch 5425: spike got 0.5 NEAR; `pets-v4` pet #0 withdraw paid the player 0.5 NEAR and cleared `pending_unstake` |
| `withdraw()` after unlock (2026-11-09) | The pool was upgraded: `get_account` now shows `matured_withdrawals`, `withdrawable`, `unstake_requested`. At `unlock_epoch` a matured withdrawal can still fail with **"Withdrawal funds not collected yet; retry later"** until the pool collects it from its validator (seen on `pets-v5`, tx `GWs1GJYotNSFRdnKUiVy6atPcYJ6GykCqKzFmsmuQby8`). The pets contract keeps the unstake pending (callback restore), so the owner simply retries; web and brain should show "withdrawal processing, retry later" |
| CREDIT accrual | CREDIT has 24 decimals. `claimable` updates after anyone calls `sync_from_farm()`. Measured: 0.7945 iNEAR earned 0.000444687 CREDIT from 2026-11-07T14:04:57Z to 2026-11-08T10:31:32Z = **657 µ$ per NEAR per day**, same as the mainnet figure and our config default |
| `claim_and_topup(org_id)` | From `pets-v4` with 0 claimable and a placeholder org: succeeded, returned empty, did nothing. From `pets-v6` right after `sync_from_farm` with no stake: panicked "Nothing to claim" (M4b sweep, tx `E6Fp8LKY1Wjr2kYZwd8GbZnXATA7Y9NbG5GaW8Lf72WJ`). Real top-up still open: needs the brain's org id (Role 2) and ≥ 0.01 CREDIT. Note: minimum burn 0.01 CREDIT, so at about 0.000657 CREDIT per NEAR per day a sweep needs ≈ 15 NEAR-days of stake across all pets. The brain should only call `sweep_credit` when `get_account(pets).claimable ≥ 0.01 CREDIT` |
| Wasm toolchain | Rust 1.99 + cargo-near 0.23 output deploys and runs; no toolchain pin needed |

M5b on testnet (2026-11-09, `pets-v8` + `shirts.nearling.testnet`, owner `nearling-player2.testnet`): `register_pool` emitted `pool_registered` (house 0.2 NEAR = 0.11533 iNEAR); mint with a soul emitted `soul_updated` v1, `set_soul` v2, a stranger got `E_NOT_OWNER`; stake 1 NEAR recorded exactly 1 NEAR and the pool held house + 1 to the yocto; the brain charged one fuel (`cost_micro` 1000, `source` food); shirt claim minted #0, a second claim gave `E_CLAIMED`, the transfer moved it to `nearling-player1.testnet`.

pets-v9 on testnet (2026-11-11, `pets-v9` + `pets-demo-v9`, owner `nearling-seed.testnet`, pet #0; `docs/CONTRACT_CHANGES_V9.md` 6.4):
| Check | Result |
|---|---|
| Unstake deposit (C6) | `register_pool` then the live `get_account(pets-v9).unstake_deposit` = 0.00772 NEAR into config. Stake 1 NEAR, then `unstake` 0.5 NEAR with 0.00772 attached: works, `unstaked.pending.deposit` = 0.00772 (tx `DXbLn1r8MhQ2HbrVwNS4h2EH7Yg6oyD93kQ4NQrYvN3q`). Afterwards the pool showed `unstake_storage_paid` 0.00772 and this holder's `unstake_deposit` fell to 0.00183 (as on the old `pets-v5`/`v7`): the 0.00772 looks like a one-time storage payment for the holder's withdrawal queue. Later unstakes still attach the config value (more than needed). **Open:** whether the pool's `withdraw` returns the deposit (unlock epoch 5438); if not, the contract pays it from its own balance |
| First-deposit fee | Back to 0.0055 NEAR (house 0.2 NEAR minted 0.1945 iNEAR); pet stakes are 1:1 either way |
| Pantry | `stock_pantry` 0.5 NEAR; a function-call key with `feed_from_pantry` signed `feed_from_pantry` 0.1 NEAR: `fed` with `source: "pantry"` (tx `31GEvSBrkaGKZCy4KibDxWFNHNnYFVTuTzqn6TG8tjm6`); more than the pantry: `E_PANTRY`; the device key attaching a deposit: refused by the protocol |
| `set_metadata` | Brain-signed with the two Pinata CIDs: `metadata_updated`, `nft_token` shows media, hashes, reference, `description` from the Soul, `updated_at` (tx `EaoRQV6TrH1tv6sHmKfDpzzzNokbd2R1JVxtxAvBMzSv`); again within 60 s: `E_COOLDOWN`; a stranger: `E_NOT_BRAIN`; a view call with `{}` fails on deserialize (not `MethodNotFound`), so the brain detects the method |

Petto accounts on testnet (2026-11-14): `petto.testnet` created by the faucet and funded by deleting the unused `pets-demo.nearling.testnet` and `s6-spike.nearling.testnet` (their iNEAR stays in the pool, lost; `pets-v8` kept: its pre-v9 `unstake` cannot attach the deposit NEARON now requires). `deploy-testnet.sh` (normal and `DEMO_SPEED=1`) and `deploy-shirts.sh` deployed `pets`, `pets-demo` and `shirts` under it; the brain's 8 existing function-call public keys were added to `brain.petto.testnet` (4 per pets contract) and the relayer key to `relayer.petto.testnet`. `seed-demo.sh` seeded and hatched #0 Sunny, #1 Crumb, #2 Echo, #3 Sprout (2 NEAR staked, self-sustaining) and demo #0 Blink. A brain-signed `charge` emitted `{"standard":"petto","event":"thought",...}` (tx `CndDMwrmsz5B8xjg36UdSy4dZjzPy8HibRpwdtgZawoy`).

M3 on testnet (2026-11-07, `pets-v4`, player `nearling-player1.testnet`): stake 2 NEAR recorded 1.9945 = pool iNEAR balance; `self_sustaining: true` at 1310 µ$/day; unstake 0.5 NEAR queued at epoch 5424 in both the pet and the pool; early withdraw rejected. Stake tx `6btDMVHSYj5P3koLiGQP33WBKRqbE5i2EqWbf1VAyFfL`.

### S5 contract side (2026-11-08, `pets-v5`, CLI signing with a real limited access key; the ESP32 part is Role 4)
Function-call keys are bound to one receiver contract, so each new `pets-vN` needs a new device key (AddKey again). Limited key on `nearling-player1.testnet`: receiver `pets-v5.nearling.testnet`, methods `play, stake_from_food, approve_action`, allowance 1 NEAR (`near account add-key ... grant-function-call-access`).
| Check | Result |
|---|---|
| `register_device` from the wallet | `device_registered` |
| `stake_from_food` 1 NEAR signed by the device key | Works: `env::signer_account_pk()` matched; staked 0.9945 (first deposit of this holder paid the pool fee) |
| `stake_from_food` signed by the wallet key | Rejected: "Only the pet's device" |
| `play("pet")` signed by the device key | Works |
| Device key call with a deposit | Rejected: function-call access keys cannot attach deposits |
| Approval flow (M5, `pets-v7`, new limited key for v7) | Wallet `propose_action(Stake 1 NEAR)` held the deposit; device key `approve_action` ran the stake (0.9945 staked) and cleared the action; wallet key approving: `E_NOT_DEVICE`; direct `stake` in approval mode: `E_APPROVAL_MODE`; `cancel_action` emitted `action_cancelled` |

Evidence: stake tx `FLjbh7CA1tRw9TknMGRctba4DjFnQr9dCKQgmiFF9sT6`; failed unstake without 1 yocto `5GpH91VtbhCdVXF4mTyceBwDsdSmoQWwb7b4LA1PPHBq`.

---

## 15. Commands

```bash
# contract
cargo check --target wasm32-unknown-unknown        # near-sdk 5.x refuses plain host builds
cargo test
cargo near build non-reproducible-wasm             # cargo-near 0.23; output in target/near/ [VERIFY on first deploy]
./scripts/deploy-testnet.sh                        # DEMO_SPEED=1 for pets-demo-vN; registers the NEARON pool, sets pool_unstake_deposit
./scripts/deploy-shirts.sh
./scripts/dev-grow.sh <pet_id> <xp> [demo]         # dev cheat: admin adds XP past the daily cap (Teen 100, Adult 500)
./scripts/add-brain-keys.sh <contract> <pk>...       # brain function-call keys (public keys from the brain), once per pets contract
./scripts/seed-demo.sh                             # demo pets in each state (owner seed.<parent>, hatched)

# brain
pnpm --filter brain dev

# web
pnpm --filter web dev

# firmware
cd firmware && pio run -t upload && pio device monitor
```

---

## 16. Conventions

- Rust: `cargo fmt`, `clippy -D warnings`, no `unwrap()` on user input paths; unit tests for stat decay, metabolism drain and `starving_since`, lazy credit accrual, charge clamping (never panics on low funds), cooldowns, stages, budget order (credit before food), transfer block, device caps, approval (same key cannot propose and approve; expiry; cancel refunds; gated wallet calls rejected in approval mode), NEARON callback refunds.
- TS: strict, shared types from `packages/shared`.
- Firmware: no blocking delays in the main loop; one state machine per screen.
- Log each reply's cost and `inference-id`, never content.

---

## 17. README requirements (judges include AI judges)

Order: What it is (2 sentences) → Why (pets that pay for their own private AI) → How it works (diagram) → **Try it on testnet** ("do X, see Y": adopt, chat, watch the budget drop, let it starve, feed it, stake 10 NEAR and see "self-sustaining") → The device (photos, video, build steps) → NEAR tech per track (NEAR AI, NEARON, NEAR Connect, NEAR standards) → Limitations (testnet only, NEARON is a prototype with an upgradeable owner key, staging API and prices, brain can read memories) → Roadmap → Prior art → Team.

The web version must be fully usable without the device, since judges cannot touch hardware.

---

## 18. References

- NEARON use cases: https://stg.nearon.dev/#/docs/use-cases
- NEAR AI docs index: https://docs.near.ai/llms.txt
- NEAR AI staking for inference: https://docs.near.ai/cloud/staking-for-inference/overview.md
- NEAR AI audio transcription: https://docs.near.ai/api-reference/audio/audio-transcription-endpoint.md
- NEAR Connect README: https://unpkg.com/@hot-labs/near-connect@0.11.4/README.md
- NEAR connector tutorial: https://docs.near.org/web3-apps/tutorials/web-login/near-connector
- NEAR standards (NEPs): https://near.github.io/NEPs/
- OutLayer docs: https://app.outlayer.ai/docs/getting-started
- Hackathon: https://nearhackathon.com and https://nearhackathon.com/HACKATHON.md
- Illia's idea list coverage: https://crypto.news/near-co-founder-pitches-ai-pets-private-trading/
