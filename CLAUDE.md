# CLAUDE.md: Nearling (working name)

Context file for Claude Code. Read fully before writing code. Single source of truth for scope, specs, interfaces and rules.

Spec status legend:
- **[FIXED]**: decided, implement exactly.
- **[VERIFY]**: based on docs but not yet tested; confirm with a spike, then update this file.
- **[TBD]**: open; pick the simplest option, record the choice here.

"Nearling" is a working name (no collision found in a quick search). Check the GitHub org, `.testnet`/`.near` account and domain before committing. "Nibble" was dropped: already used by other apps.

---

## 1. What we are building

**Nearling is an AI pet that lives on NEAR and pays for its own brain.** Every thought is a real private AI inference on NEAR AI Cloud, paid from the pet's own budget. Feed it NEAR and it thrives. Neglect it and it gets hungry, sleepy, then dormant. Stake NEAR for it through NEARON and the staking yield becomes AI credit that feeds it forever.

The pet has **two bodies, one brain**: a web app anyone can try, and a small hardware device (ESP32 with a screen) on your desk. Both show the same pet, driven by the same brain service and the same on-chain state.

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
| `security` | Device holds a limited access key that cannot move funds out; value actions need a physical approval on the device |

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
├── brain/                       # pet brain service, TypeScript (Node 22, Hono)
├── web/                         # Next.js app
├── firmware/                    # ESP32-S3 device, PlatformIO (Arduino framework)
│   ├── include/secrets.example.h
│   └── src/
├── packages/shared/             # TS types shared by brain and web
├── art/                         # sprite sheets (PNG) + sprite JSON
├── scripts/                     # deploy-testnet.sh, seed-demo.sh
└── docs/                        # DEMO.md, ARCHITECTURE.md
```

**Team split (4 people):**
| Role | Owns |
|---|---|
| 1. Contract | `contract/`, `scripts/`, NEARON integration on-chain, device key + approvals |
| 2. Web + brain | `web/`, `brain/` (chat, NEAR AI, billing, memory, persona, scheduler, STT), `packages/shared/`, NEAR Connect login |
| 3. Device: body | `firmware/` screens, sprites, touch to pet, mic/audio; `art/` (sprite sheet feeds web and firmware) |
| 4. Device: link | `firmware/` Wi-Fi, pairing, on-device signing (ed25519, Borsh, RPC), approve flow; brain `pairing.ts` and `actions.ts`; `docs/hardware/`. Works with Role 1 on spike S5 |

Both device owners must be physically available Nov 8 to 14 and each needs a board. Role 2 keeps the web to core pages first (adopt, pet home, device page, public page); shop is P1.

---

## 4. Architecture

```
                 NEAR testnet
   ┌────────────────────────────────────────────┐
   │ pets contract (NFT + budget ledger + stats) │◄── NEARON (iNEAR pool, CREDIT, sub-pool shares)
   └────────────────────────────────────────────┘
        ▲ view/call          ▲ charge()/credit()          ▲ play / stake_from_food / approve_action (device key)
        │                    │                            │
   Web app (NEAR Connect) ─► Brain service ◄────────────── Device (ESP32-S3)
                             - persona, memory, proactive pings
                             - bills each thought
                             - NEAR AI org topped up with NEARON CREDIT
                                    │
                                    ▼
                   NEAR AI Cloud staging API (private TEE models,
                   chat; speech-to-text [VERIFY on staging])
```

- **On-chain is the source of truth** for ownership, budget, stake, stage, xp, traits, items.
- **Brain service** owns conversation, memory, billing and proactive messages. It is the only account allowed to call `charge` and `credit`.
- **Web and device are clients.** Neither talks to NEAR AI directly.

---

## 5. Game design

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
| `energy` | Awake capacity | -3 per chat or play; +8 per hour asleep |

Daily burn = metabolism (passive, default $0.001/day [TBD]) + recent average thought cost.

### 5.3 Life states [FIXED]
| State | Condition | Behaviour |
|---|---|---|
| Happy | fullness ≥ 40 and mood ≥ 40 | Normal chat, idle animation |
| Hungry | fullness < 40 | Mentions food, shorter replies |
| Sleepy | energy < 15, or night mode | Short replies, recovers energy |
| Starving | budget = 0 | No inference; canned "zzz... I'm hungry", costs nothing |
| Dormant | starving for 72 h | Curled-up sprite; revived by feeding or staking. **Pets never die** |

### 5.4 Growth [FIXED, tune thresholds]
- Stages **Egg → Baby → Teen → Adult** by `xp` (10 / 100 / 500).
- XP comes from **care, not money**: chats, play, daily check-ins, streaks.
- **Traits** (five u8): playful, curious, calm, sassy, kind. Random at mint, nudged by how the owner treats the pet (brain proposes deltas; contract caps ±2 per trait per day).

### 5.5 The pet reaches out first [FIXED, core to the game loop]
- The brain checks every pet every 15 minutes. Triggers: fullness crosses 40 or 15, mood below 30, owner away 24 h, stage-up, morning greeting.
- Output: a short message in the pet's voice, delivered to the device (screen bounce + chime + message) and the web app (in-app notification; web push [TBD]).
- Max 3 proactive messages per pet per day. Threshold alerts use canned lines (free); greetings and "I missed you" use inference (billed).
- Memory makes it personal: "You said your exam was today. How did it go?"

### 5.6 Play and items
- Mini-games in character [TBD pick 1 for MVP]: guess-the-number, trivia, rock-paper-scissors. Raise mood and xp.
- 3 to 5 accessories (hat, scarf, glasses...) bought with NEAR, shown on web and device. Cosmetic + small mood bonus.

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

**Our design (Option A, preferred):**
1. The **pets contract is the sub-pool holder and reward router.**
2. `stake(pet_id)`: contract deposits the NEAR into `mw-pool-1024.testnet`, holds the iNEAR, records `staked[pet][staker]`.
3. Router shares are set **proportional to each pet's staked amount**. All beneficiaries bind to the **brain's single NEAR AI org** (one org, one API key).
4. Because the org balance is pooled, the contract keeps **per-pet credit accounting** itself: `credit_accrued += share × farm_rate × elapsed`, reconciled against the org's real balance by the brain via `credit(pet_id, amount)`.
5. `unstake(pet_id, amount)`: contract starts NEARON unstake; after the delay, `withdraw` returns NEAR to the staker.

**Option B (fallback):** owner stakes directly in NEARON from their wallet and binds a beneficiary to the brain's org; the brain tracks which pet it belongs to. Weaker on-chain story, faster to build.

**Fallback if NEARON is unavailable:** simulated APR in-contract, labelled "simulated".

**Spike questions:** exact method names and args for deposit, router shares, beneficiary binding and claim; whether a contract can be holder/router; how to read accrued CREDIT per beneficiary; whether staging API orgs accept CREDIT top-ups as documented.

---

## 7. Contract spec (`contract/`, account `pets.<team>.testnet`)

Start from **near-contract-standards**: NEP-171 (core), NEP-177 (metadata), NEP-181 (enumeration), NEP-297 / NEP-256 (events), NEP-145 (storage management) [FIXED]. NEP-178 approvals and NEP-199 payouts only if a marketplace is needed (cut for MVP).

### 7.1 Pet state
```
Pet {
  id, name, owner,
  born_at_ns, last_tick_ns,
  food_balance: u128 (yocto),               // from feeding
  credit_balance_micro: u64,                // micro-USD of CREDIT allocated to this pet
  staked_total: u128, stakes: map<AccountId, u128>,
  mood: u8, energy: u8, xp: u32, stage: u8, traits: [u8; 5],
  starving_since_ns: Option<u64>,
  items: Vec<u16>,
  persona_hash: String,                     // sha256 of the base persona prompt
  spent_today_micro: u64, spend_day: u32,
}
```

### 7.2 Methods
Owner:
- `nft_mint_pet(name) -> TokenId` payable: mint price + starter food; random traits from `env::random_seed()`.
- `feed(pet_id)` payable: adds to `food_balance`; clears starving; mood +5.
- `stake(pet_id)` payable (anyone can stake for any pet), `unstake(pet_id, amount)`, `withdraw(pet_id)`.
- `play(pet_id, action: "pet" | "play" | "sleep" | "wake")`: no deposit; callable by owner, including via the device key.
- `buy_item(pet_id, item_id)` payable.
- `register_device(pet_id, public_key)`: records the device's ed25519 public key for this pet. The owner must also add that key to their account as a limited access key (receiver = pets contract, methods = `play`, `stake_from_food`, `approve_action`), done through the wallet on the web app.
- `set_approval_mode(pet_id, on: bool)`: when on, value actions need a device approval (7.3).

Device (signed by the registered device key, checked with `env::signer_account_pk()`):
- `stake_from_food(pet_id, amount)`: no deposit; moves part of the pet's own food balance into NEARON stake (staker recorded = owner). Capped by `config.device_stake_max_per_action` and `config.device_stake_max_per_day`. Funds never leave the pet/owner.
- `approve_action(action_id)`: approves a pending action (7.3).

Brain only:
- `charge(pet_id, cost_micro_usd: u64, usage_ref: String, trait_deltas: Option<[i8;5]>, xp_gain: u32, mood_delta: i8)`: spends credit first, then food (converted at `config.near_usd_rate`); capped per call and per day; food spent goes to `treasury`; emits `thought`.
- `credit(pet_id, micro_usd: u64, ref: String)`: adds reconciled NEARON CREDIT to the pet.

Views: `get_pet(pet_id)` with stats computed at current block time + `life_state` + `self_sustaining`; `nft_tokens_for_owner`; `config()`.

### 7.3 Device approval flow [FIXED design, VERIFY S5]
"What you see is what you sign" on the pet's body.
1. **Propose (web, owner wallet):** `propose_action(pet_id, action)` payable where needed. Actions: `Stake { amount }`, `Unstake { amount }`, `Withdraw`, `StakeFromFood { amount }` above the device cap, `SetApprovalMode { off }`. Creates `PendingAction { id, pet_id, action, deposit, proposer_pk, expires_at = now + 10 min }`.
2. **Show (device):** polls the brain for pending actions and shows the exact action and amount on screen.
3. **Approve (device):** owner holds the on-screen Approve button for 2 s; device signs `approve_action(action_id)` with its key.
4. **Execute (contract):** only if `signer_account_pk() == registered device key`, `signer_account_pk() != proposer_pk` (one key cannot both propose and approve), not expired, and approval mode is on. Otherwise reject. `cancel_action(action_id)` from the owner refunds any deposit.
5. When approval mode is off, value actions run directly from the wallet as normal.

Key point: wallet and device keys both belong to the owner's account, so `predecessor` alone cannot tell them apart. The contract tells them apart by `env::signer_account_pk()`.

### 7.4 Transfer rules [FIXED]
- **Transfer is blocked while `staked_total > 0`** (stake belongs to stakers; unstake first). Simplest safe rule.
- On transfer: brain archives the old owner's memories (new owner starts fresh with the pet), revokes device tokens bound to the old owner, resets the owner nickname. Traits, stage, xp and items stay with the pet.
- Limited access keys live on the old owner's account, so the contract checks `predecessor == current owner` for device methods; old keys simply stop working. Transfer also clears the registered device key and pending actions.

### 7.5 Events (NEP-297, standard `nearling`, version `1.0.0`) + NEP-256 NFT events
`fed`, `thought` (pet_id, cost, usage_ref), `credited`, `played`, `staked`, `staked_from_food`, `unstaked`, `item_bought`, `stage_up`, `dormant`, `revived`, `device_registered`, `action_proposed`, `action_approved`, `action_cancelled`.

### 7.6 Invariants
- Only `brain` can `charge` and `credit`; charges capped per call and per day.
- Limited access keys cannot attach deposits, so the device can only call `play`, `stake_from_food` (pet's own funds, capped) and `approve_action`. It can never send funds to any other account.
- An action proposed by one key can only be approved by a different key (the registered device key).
- On testnet NEAR has no value; the real NEAR AI bill is paid in CREDIT (from NEARON) and team funds. The brain enforces a hard daily spend cap.

---

## 8. Brain service spec (`brain/`)

Node 22 + Hono, TypeScript. Holds the `brain` NEAR account key and the NEAR AI staging API key.

### 8.1 NEAR AI
- **Base URL:** `https://cloud-stg-api.near.ai/v1` (staging, OpenAI-compatible, Bearer key) [FIXED for hackathon].
- **Default model:** `openai/gpt-oss-120b` (private, TEE with attestation). Alternative: `Qwen/Qwen3.6-35B-A3B-FP8` (private). Do **not** use non-private models for chat. [VERIFY S1 latency]
- **Speech-to-text:** `POST /v1/audio/transcriptions`, multipart, `model=openai/whisper-large-v3`, ≤ 25 MB, WAV/MP3/WEBM/FLAC/OGG/M4A (production docs) [VERIFY on staging].
- **Cost per reply:** compute from returned token usage × model price, or the billing "costs by request IDs" endpoint (nano-USD per `inference-id`) [VERIFY S2].

### 8.2 API
| Route | Auth | Purpose |
|---|---|---|
| `POST /session` | NEP-413 signed message from owner wallet | Session token for that owner |
| `POST /pets/:id/chat` | session or device token | `{text}` or multipart `{audio}` → reply, cost, updated stats, sprite state |
| `GET /pets/:id/state` | public | Stats, life state, sprite, stage, items, budget, self-sustaining |
| `GET /pets/:id/inbox` | session or device token | Proactive messages since a cursor |
| `POST /pets/:id/pair` | session | Start pairing; returns a 6-digit code |
| `POST /devices/claim` | pairing code | Device gets a device token bound to pet + owner |

### 8.3 Chat flow
1. `get_pet`. Starving or Dormant → canned sleepy reply, no charge.
2. Audio → transcribe.
3. Prompt = base persona (stage, traits, mood, fullness, items, owner nickname) + memory summary + last 10 turns. Replies ≤ 2 sentences for device, ≤ 4 for web.
4. Chat completion on the private model, non-streaming. Structured tail with `trait_deltas`, `xp_gain`, `mood_delta`, `sprite_state` [TBD: single call with JSON output preferred].
5. Compute cost, call `charge(...)`. If it fails, return the reply, mark unbilled, retry later.
6. Append to memory; summarise every 20 turns.

### 8.4 Scheduler
Every 15 min: proactive message rules (5.5); reconcile NEARON CREDIT into pets via `credit` (hourly).

### 8.5 Memory, privacy, safety, cost
- Memory per pet, encrypted at rest (AES-256-GCM, per-pet key from a master key). Honest limit: the brain can read memories. Stretch: run the brain step in OutLayer.
- Kid-friendly system prompt; stays in character when refusing.
- Rate limits: 1 thought per 3 s per pet, 300 per day; global daily spend cap.

---

## 9. Web app spec (`web/`)

Next.js (App Router), TypeScript. **Wallet: NEAR Connect** (`@hot-labs/near-connect`) [FIXED]: wallets include HOT, Meteor, Intear, MyNearWallet, Nightly, Near Mobile Wallet, OKX and WalletConnect; filter `testnet: true`; sign-in with signed message (NEP-413). Email/social login only through Privy-based wallets [VERIFY S3]. Add a limited access key only after the user is active (it costs a transaction).

| Route | Purpose |
|---|---|
| `/` | Landing: what Nearling is, adopt button, a live public pet |
| `/adopt` | Name the egg, mint, hatching animation |
| `/pet/[id]` | Animated pet, stat bars, chat, inbox, feed / stake / play / sleep, budget ("credit $0.42 + food 0.8 NEAR = 9 days"), self-sustaining badge, cost per reply |
| `/pet/[id]/shop` | Accessories |
| `/pet/[id]/device` | Pair a device, add the device key (wallet `AddKey` with receiver = pets contract, methods = `play`, `stake_from_food`, `approve_action`), turn approval mode on/off |
| `/pet/[id]` actions | When approval mode is on, Stake / Unstake / Withdraw create a pending action and show "Approve on your Nearling" until the device approves |
| `/p/[id]` | Public read-only pet page |

Stretch: NEP-366 sponsored transactions via a relayer so new players pay no gas.

---

## 10. Device spec (`firmware/`)

**Hardware [TBD after S4]:** ESP32-S3 board with a **capacitive touch colour screen**, I2S mic and speaker/buzzer (an M5Stack CoreS3-class board fits; verify specs before ordering). Physical buttons optional; the UI is touch-first.

**Screens:** idle, happy, being-petted, talking, listening, eating, hungry, sleepy, sleeping, dormant, new-message (bounce + chime), approve-action, signing, no-wifi, pairing-code. Stage changes the sprite set; items render as overlays.

**Touch interactions [FIXED]:**
| Gesture | Effect |
|---|---|
| Tap or stroke the pet | **Pet the pet**: instant happy/purr animation + heart particles. Counted locally; synced on-chain as `play(pet, "pet")` at most once per 5 min (mood gain capped in contract) |
| Hold the mic button (on-screen) | Record ≤ 10 s, 16 kHz mono WAV → `/chat`; reply scrolls as text (no TTS) |
| Tap the food icon | Shows budget and days left; "Save food" → `stake_from_food` (within device caps) |
| Approve screen: hold Approve 2 s | Signs `approve_action(action_id)`; Reject cancels on screen |
| Menu | Stats, inbox, Wi-Fi, unpair |

**Networking:** Wi-Fi (captive portal or `secrets.h`), HTTPS to brain, poll `/state`, `/inbox` and pending actions every 20 s (every 3 s while an approval is open on web).

**Pairing:** device shows a 6-digit code → owner enters it on web → device calls `/devices/claim`, stores the token in flash.

**On-device signing [P1, VERIFY S5]:**
- Device generates an ed25519 key on first boot; private key stays in flash (enable ESP32 flash encryption + secure boot for the demo build). Public key shown on pairing and registered via `register_device`.
- Signing flow: fetch nonce for the device key (`view_access_key`) and a recent block hash from NEAR testnet RPC → build the transaction in Borsh (one `FunctionCall` action, zero deposit) → sign with ed25519 → `send_tx`. Libraries: ESP-IDF libsodium or an Arduino ed25519 library.
- Device-signed methods: `play`, `stake_from_food`, `approve_action`. The device key's gas allowance is small; top it up from the web if it runs out.
- Honest limit: an ESP32 is not a secure element. That is why the key is a limited access key and the contract caps everything it can do.

---

## 11. Art direction [TBD by Role 3, Device: body]

Pixel art, 64×64 base sprite, 4 stages × about 12 states. One palette that reads on the device screen. Sprite-sheet JSON (frame name → rect) shared by web and firmware.

---

## 12. Scope

**Must-have (submission)**
1. Contract: mint, feed, charge, credit, play, stats and life states, stages, events, transfer rule.
2. NEARON stake for a pet (Option A or B) with real CREDIT accrual shown; simulated fallback only if NEARON fails.
3. Brain: chat on a private model, real cost billing, memory, persona from stats and traits, proactive messages.
4. Web: adopt, pet home with chat, inbox, stats, budget, feed, stake, public pet page.
5. Device: same pet's state and sprite, touch to pet, hold-to-talk voice chat, new-message alert, pairing.
6. README with "do X, see Y" on testnet, demo video.

**P1 (ship after must-haves work):** on-device signing with the device key (`play`, `stake_from_food`), device approval flow for value actions, one mini-game, items and shop, trait evolution in UI.

**Should-have:** sponsored transactions (NEP-366) so the device needs no gas.

**Later (README roadmap):** battles (Illia's arena), visiting and breeding, pets earning via Agent Market, funding from other chains via NEAR Intents, brain in OutLayer, mainnet.

**Cut:** new tokens, marketplace, royalties, swapping and trading (roadmap: the pet manages its own treasury via Rhea under caps), meme.cooking, BRRRAIN, text-to-speech.

---

## 13. Timeline (Nov 7 to 14)

| Day | 1. Contract | 2. Web + brain | 3. Device: body | 4. Device: link |
|---|---|---|---|---|
| Nov 7 | Interfaces (sections 5 to 8); spike S6 | Spikes S1, S2, S3 | Art style, sprite list; S4 (screen, touch, mic) | S4 (Wi-Fi, HTTPS); start S5 |
| Nov 8 | NFT mint, feed, get_pet stats | Chat on private model; adopt + pet home | Sprite rendering, idle animations | Wi-Fi, `/state` polling |
| Nov 9 | charge with caps, life states | Billing, memory; chat UI, stats, budget | Touch to pet, being-petted animation | Pairing on device + brain `pairing.ts` |
| Nov 10 | NEARON stake/unstake, credit | Persona, trait deltas, scheduler; feed / stake UI, inbox | Hold-to-talk record + upload, reply scroll | Key gen, Borsh, `play` signed from device |
| Nov 11 | Stages, traits, transfer rule, device key, `stake_from_food` | Proactive messages, STT, limits; public page, device page (AddKey) | New-message alert, food screen | `stake_from_food` from device; brain `actions.ts` |
| Nov 12 | Approval flow (propose / approve / cancel) | Approval banner, spend cap, shop (P1) | Approve screen UI, polish | `approve_action` signing; approval end to end with Role 1 |
| Nov 13 | Integration, seed demo pets | Integration, README screenshots | Film device shots | Device integration test, `docs/hardware/` |
| Nov 14 | Final testnet deploy | Demo video, X post (human posts) | Buffer | Buffer |

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
| S6 | NEARON: deposit, router shares, beneficiary binding, claim, reading accrued CREDIT; can a contract be holder/router | Option A or B chosen and recorded |
| S7 | NEARON CREDIT top-up into the staging NEAR AI org; whisper on staging | Brain spends CREDIT for chat and STT |

Record results here.

---

## 15. Commands

```bash
# contract
cargo check --target wasm32-unknown-unknown        # near-sdk 5.x refuses plain host builds
cargo test
cargo near build                                   # [VERIFY flags]
./scripts/deploy-testnet.sh

# brain
pnpm --filter brain dev

# web
pnpm --filter web dev

# firmware
cd firmware && pio run -t upload && pio device monitor
```

---

## 16. Conventions

- Rust: `cargo fmt`, `clippy -D warnings`, no `unwrap()` on user input paths; unit tests for stat decay, caps, stages, budget order (credit before food), transfer block, device caps, approval (same key cannot propose and approve; expiry; cancel refunds).
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
