# Nearling

**Nearling is a physical AI Tamagotchi whose life depends on its own NEAR balance.** Every reply is a private AI inference on NEAR AI Cloud, paid on chain from the pet's own fuel; feed it and it thrives, neglect it and it starves and goes dormant, stake NEAR for it and the yield keeps it fed.

> Status: built for the NEAR Hackathon (Nov 2026), **testnet only**. Contract, web and brain sections are complete; the device section is still being written by the hardware team. Hosted demo: _URL added after deploy ([`docs/DEPLOY.md`](docs/DEPLOY.md))_; a full local run is described in [Run it locally](#run-it-locally).

## Why

AI pets usually run on a company's servers and a company's bill. Nearling makes the pet an NFT **that owns the money for its own mind**: its fuel lives in the pet's on-chain budget, every thought is billed there and logged as an event anyone can check, and NEARON staking can turn yield into AI credit that pays for it forever. That is Illia Polosukhin's "NFT pets each with a NEAR balance that pays for AI inference", on a desk.

## How it works

```
             NEAR testnet
   ┌──────────────────────────────────────┐        ┌───────────────────────────┐
   │ pets contract (pets-v9)              │◄──────►│ NEARON iNEAR pool          │
   │ pet NFT · fuel budget · Soul · stake │ stake, │ (stake NEAR -> AI CREDIT)  │
   │ events (thought, fed, staked, ...)   │ sweep  └─────────────┬─────────────┘
   └──────▲───────────────▲───────────────┘                      │ CREDIT top-up
          │ mint, feed,   │ charge (1 fuel per reply),           ▼
          │ stake, soul   │ feed after checkout          NEAR AI Cloud org
   Phone web app ──► Brain service ───────────────────► (private TEE models)
   (NEAR Connect,     voice, memory, receipts
    Meteor)                ▲
                           │ HTTPS
                    Nearling device (ESP32-S3, screen, buttons, sensors, speaker)
   shirts contract: Closet shirt NFTs, one free claim per account
```

- **The chain is the pet's bank:** ownership, fuel (food + staking credit), stake, Soul, events. Contract details: [`docs/CONTRACT_INTERFACE.md`](docs/CONTRACT_INTERFACE.md), full spec: [`CLAUDE.md`](CLAUDE.md) 6 and 7.
- **One reply = one fuel:** the brain calls `charge(pet, $0.001, turn id)`. Retries with the same id never double-charge; an empty budget makes the pet Starving (Low Fuel), and 72 hours later Dormant. Pets never die.
- **Product and device:** [`docs/Nearling-Hackathon-Build-Spec.md`](docs/Nearling-Hackathon-Build-Spec.md).

## Try it on testnet

Everything below runs with the [NEAR CLI](https://github.com/near/near-cli-rs) (`near`). Views need no account.

**1. See pets in every state** (seeded with `scripts/seed-demo.sh`):

```bash
for id in 1 2 3 4; do
  near contract call-function as-read-only pets-v9.nearling.testnet get_pet \
    json-args "{\"pet_id\":\"$id\"}" network-config testnet now
done
```

You see `#1 Sunny` **Happy**, `#2 Crumb` **Hungry** (`budget_micro` 1000, `fullness` 33), `#3 Echo` **Starving** (Low Fuel), `#4 Sprout` **Happy** with `"self_sustaining": true` (2 NEAR staked; `daily_credit_micro` covers its `daily_burn_micro`).

**2. Read a pet's Soul**, its public, versioned personality:

```bash
near contract call-function as-read-only pets-v9.nearling.testnet get_soul \
  json-args '{"pet_id":"1"}' network-config testnet now
```

**3. Adopt your own pet** (needs a funded testnet account, `YOU.testnet`):

```bash
near contract call-function as-transaction pets-v9.nearling.testnet nft_mint_pet \
  json-args '{"name":"Mochi","soul":"A shy, curious cat who loves rainy days."}' \
  prepaid-gas '50 Tgas' attached-deposit '0.2 NEAR' \
  sign-as YOU.testnet network-config testnet sign-with-keychain send
```

You see `nft_mint` and `soul_updated` events and the new token id. `get_pet` shows about 20 chats of fuel (`budget_micro` 20000: 0.1 NEAR at the testnet rate of $0.20 per NEAR).

**4. Watch it pay for its thoughts.** Each brain reply is a `charge`; look for `thought` events on the contract in a testnet explorer, each with `cost_micro` 1000 and `source` `credit` / `food` / `mixed`. In the web app (below) every reply shows its fuel chip and, once the charge lands, the transaction link.

**5. Let it starve, then feed it:** on the demo-speed contract a fresh pet starves in about 14 minutes and goes dormant about 43 minutes later.

```bash
near contract call-function as-transaction pets-demo-v9.nearling.testnet nft_mint_pet \
  json-args '{"name":"Blink"}' prepaid-gas '50 Tgas' attached-deposit '0.105 NEAR' \
  sign-as YOU.testnet network-config testnet sign-with-keychain send
# about an hour later: "life_state": "Dormant"
near contract call-function as-transaction pets-demo-v9.nearling.testnet feed \
  json-args '{"pet_id":"ID"}' prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' \
  sign-as YOU.testnet network-config testnet sign-with-keychain send
```

You see `revived` and `fed`, and `life_state` goes from **Dormant** to **Hungry**: at demo speed 0.1 NEAR is about 4.8 hours of food, still short of the three days that count as full. `pets-demo-v9` runs the same code with about 100× faster rates (`config.demo_speed = true`) and is labelled **demo speed** everywhere.

**6. Stake to live (Brain Garden):**

```bash
near contract call-function as-transaction pets-v9.nearling.testnet stake \
  json-args '{"pet_id":"ID"}' prepaid-gas '450 Tgas' attached-deposit '2 NEAR' \
  sign-as YOU.testnet network-config testnet sign-with-keychain send
```

The contract deposits into the NEARON pool `mw-pool-1024.testnet`; `get_pet` now shows `staked`, `credit_micro` growing every second, and `"self_sustaining": true` once the daily credit covers the daily burn (2 NEAR is enough at the testnet farm rate of $0.000657 per NEAR per day). `unstake` (attach the pool's unstake deposit, `config().pool_unstake_deposit`, 0.00772 NEAR) and `withdraw` give the NEAR and the deposit back after 12 to 24 hours.

**7. Claim a Closet shirt:**

```bash
near contract call-function as-transaction shirts.nearling.testnet claim json-args '{}' \
  prepaid-gas '30 Tgas' attached-deposit '0.01 NEAR' \
  sign-as YOU.testnet network-config testnet sign-with-keychain send
```

One per account; the shirt follows its owner when transferred.

### The same journey in the web app (no device needed)

Open the hosted web app, or run it locally ([Run it locally](#run-it-locally)) at `http://localhost:3000`. You need a testnet wallet with a little NEAR; Meteor (testnet) is the tested wallet, other NEAR Connect wallets also appear.

1. **Watch the demo pet.** The landing page shows a live pet on the demo-speed contract. **See:** its fuel bar drop in real time and its mood and sprite change, labelled **demo speed**.
2. **Adopt.** `/adopt` → connect your wallet → name the egg, optionally write its Soul → choose **Normal** (`pets-v8`, 0.2 NEAR) or **Demo speed** (`pets-demo`, 0.105 NEAR) → approve one transaction. **See:** the hatching animation, then the pet home `/pet/<contract>:<id>` with a browser Nearling (the same 240x240 screen the device draws).
3. **Talk, with receipts.** Type a message, or **Hold to talk** to speak (your browser records WEBM, NEAR AI whisper transcribes it). **See:** a short in-character reply with an emotion, a fuel chip "1 thought", the charge's testnet transaction link once it lands, and a badge **Model verified**, **Gateway verified** or **Unverified (reason)**. Click the badge for `/receipt/<turnId>`: model, Soul version, the GPU attestation and signature checks, request and response hashes, what is *not* checked, and **Publish this receipt** (opt-in) so anyone can inspect it. `/pet/<ref>/receipts` lists every turn.
4. **Low Fuel.** On a demo-speed pet, wait about 14 minutes (or keep talking). **See:** the talk button becomes "Out of fuel. Feed ..." and replies stop costing anything; **Pat**, **Rock** and **Lights off** still work because care is local.
5. **Feed the Brain.** `/feed/<ref>` → pick **Snack / Meal / Feast** → pay with your **NEAR wallet (testnet)**, which sends `feed(pet)` from your account. **See:** the order page turn to **Fed (+N thoughts)**, the fuel bar rise, the pet wake from Low Fuel or Dormant. Anyone can feed any pet (try the **Feed this pet** button on a public page). The NEAR Intents tab (pay from another chain) is shown only when the team enables it; the **Simulated** tab, where enabled, is labelled and moves no money (the team's testnet feeder pays).
6. **Care and evolution.** Tap **Pat**, **Rock** and **Lights off**. **See:** the pet react; completing all three care milestones plays the evolution and the pet grows **Wings**.
7. **Closet.** `/pet/<ref>/closet` → **Claim your free shirt** (0.01 NEAR, one per account, a NEP-171 NFT on `shirts.nearling.testnet`) → **Wear**. **See:** the shirt listed as equipped; the device draws it.
8. **Soul.** `/pet/<ref>/soul` → **Edit the Soul** → save (one transaction). **See:** the version go up; the next reply's receipt shows the new Soul version.
9. **Brain Garden.** `/pet/<ref>/garden` → **Plant NEAR** (stake at least 1 NEAR through NEARON). **See:** **Staked**, credit ticking up every second, and the **Self-sustaining** badge once daily credit covers the daily burn (2 NEAR is enough). **Take NEAR out** unstakes; it is **On its way back** for 12 to 24 hours.
10. **Nearling Run.** `/race` → **Start a new race** → open the code in a second tab (or on a phone) with **Join a race** → both press Ready. **See:** a countdown and a two-lane race; switch lanes with space or tap; the brain replays both players' inputs and declares the winner.
11. **Public page.** `/p/<ref>`, no wallet needed. **See:** the pet, its fuel, its timeline (fed, Soul versions, stage-ups), published receipts and a **Feed this pet** button. This is the link to share.

## The device

_Still to be filled by the hardware team (Roles 3 and 4): photos, video, parts list (see the Build Spec hardware reference), build and flash steps._ The brain side the device uses (pairing, talk with WAV upload, care sync, Closet, race WebSocket, wallet approvals) is built and documented in [`AI-brain architectual/08-api-reference.md`](AI-brain%20architectual/08-api-reference.md).

## NEAR tech per track

| Track | What we use |
|---|---|
| `games` | The care loop and Nearling Run; the chain stays invisible in play (no wallet pop-ups for chat) |
| `nfts` | Each pet is a **NEP-171 NFT that owns money**: its fuel budget, its stake and its spending history live on chain. Shirts are a second NEP-171 collection. NEP-177 metadata, NEP-181 enumeration, NEP-297 events |
| `agents` | The pet pays for its own compute: one on-chain `charge` per reply, funded by feeding or by its own staking yield |
| `privacy` | Every reply runs on a private (TEE) model on NEAR AI Cloud and comes with a receipt: GPU attestation with a fresh nonce, and a signature over the exact request and response hashes. Memories are encrypted at rest; logs hold ids and costs, never content |
| `security` | See below |

**NEARON:** the pets contract is the plain iNEAR holder of `mw-pool-1024.testnet`. It stakes per pet with `deposit_and_stake`, unstakes with `unstake` (attaching the pool's unstake deposit, paid by the owner and returned with the withdrawal) and `withdraw` (1 yocto), and sweeps CREDIT into the brain's NEAR AI org with `sync_from_farm` + `claim_and_topup`. Per-pet credit accrues lazily on chain at the measured farm rate. A one-time house deposit at deploy (`register_pool`) absorbs the pool's first-deposit fee, so every pet stake is recorded 1:1 with the iNEAR actually held. Spike results: `CLAUDE.md` 14.

**NEAR AI Cloud (brain):** all inference goes through the brain to the staging API (`https://cloud-stg-api.near.ai/v1`, OpenAI-compatible); web and device never call it directly.
- **Private models only:** the default chat model is `z-ai/glm-5.3-flash` (`NEARAI_CHAT_MODEL`), a private model that runs in a TEE; non-private models are never used for chat. Replies are short (2 sentences on the device, 4 on the web) and start with an emotion tag (`[happy]`, `[sleepy]`, ...) that drives the animation.
- **Prompt:** a brain-owned safety core first (kid-friendly, no financial advice, refuse in character), then the pet's on-chain **Soul** (`get_soul`, wrapped as character data so it cannot override the rules), pet state, encrypted memory summary and the last 10 turns.
- **Verification receipts:** before a reply the brain holds a fresh attestation (`/attestation/report` with a 32-byte nonce, GPU evidence checked with NVIDIA NRAS); after it, the brain hashes the exact request and response bytes and checks the per-reply ECDSA signature (`/signature/{id}`) against the attested signer. The receipt says **Model verified**, **Gateway verified** or **Unverified** with the reason, and lists what is not checked.
- **Speech:** `openai/whisper-large-v3` on `/audio/transcriptions` (device WAV 16 kHz, browser WEBM). Optional voice replies (ElevenLabs, off by default) are disclosed on the receipt.
- **Fuel:** one completed reply = one `charge` of `config.fuel_price_micro` with `usage_ref` = the turn id, sent from a queue over the brain's function-call keys, so retries never double-charge. The real provider cost (tokens x price) is logged separately and capped by a global daily spend cap.
- **NEARON → NEAR AI:** the brain calls `sweep_credit` hourly when at least 0.01 CREDIT is claimable, so staking yield tops up the same org that pays for the pets' thoughts.

**NEAR Connect and Meteor (web):** wallets come from `@hot-labs/near-connect` filtered to testnet; Meteor is the wallet we test on phones (one popup, no redirect). Sign-in is a NEP-413 signed message (`POST /session`), so chatting never opens the wallet; only value actions do (adopt, feed, stake, set Soul, claim a shirt). Contract calls are built with `near-api-js` 7 and the deposits and gas in [`docs/CONTRACT_INTERFACE.md`](docs/CONTRACT_INTERFACE.md); errors map the contract's `E_` codes to friendly lines.

**NEAR Intents (Feed the Brain):** the checkout can quote a payment from another chain through the 1Click API and, once the order settles, the brain's feeder account calls `feed(pet)` on testnet exactly once per order. NEAR Intents has no testnet, so a live payment is a mainnet payment. Policy: by default the brain requests **dry quotes only** (no deposit address, no money can move); live deposits need a human to set `INTENTS_LIVE_CONFIRMED=1`. The demo path is the testnet NEAR wallet pack (`direct`); a **Simulated** mode exists for demos and is always labelled.

**Wallet actions on the device (Build Spec 7, 8):** sending NEAR or transferring a pet starts as a one-use approval request in the brain; the owner holds Approve on the device, then signs the exact same transaction in Meteor on the phone. The brain checks the final transaction against the approved recipient and amount.

## Security model (contract)

- **Only the brain can spend fuel**, and only within caps: $0.005 per call and $0.10 per pet per day; xp, mood and trait changes are clamped too. A leaked brain key cannot drain pets or change config; only the admin can.
- **Only the owner stakes, and stake only returns to the owner.** CREDIT sweeps can only go to the configured NEAR AI org.
- **Transfer is blocked while a pet has stake, a pending unstake or a stake in flight**, and it resets device access and pending approvals.
- **Retries are safe:** a repeated `usage_ref` is a no-op, so the brain can retry a charge blindly.
- **Every pool call is locked before and restored on failure**, so a failed NEARON call never loses or double-counts stake.
- **The device signs with a limited function-call key that can never attach NEAR:** it can feed the pet from a pantry the owner stocked (at most 1 NEAR a day), stake the pet's own food (capped), and approve actions the wallet proposed (hold-to-approve, where only the device key can approve, `CLAUDE.md` 7.3). It can never send NEAR to another account; on transfer the pantry goes back to the old owner.
- **The NFT shows the pet:** the brain pins the pet's image and public JSON to IPFS and points the token's NEP-177 metadata at them (`set_metadata`, brain only, sha256 hashes, once a minute at most).
- Stable error codes (`E_NOT_OWNER: ...`) for every rejection; 186 unit tests (pets 181, shirts 5) cover each rule, including every NEARON callback on success and failure, and each flow was also run on testnet.

## Limitations

- **Testnet only.** NEAR, CREDIT and the $0.20 per NEAR food rate are testnet values.
- **NEARON is a testnet prototype** with an upgradeable owner key. It was upgraded during the hackathon (the first-deposit fee changed from 0.0055 to 0.08467 NEAR; matured withdrawals can now wait for the pool to collect them, in which case `withdraw` fails and can simply be retried).
- A CREDIT sweep needs at least 0.01 CREDIT, which takes about 15 NEAR-days of stake across all pets.
- The contract wasm is about 380 KB (about 3.8 NEAR of storage per deployment).
- **Staging API and prices.** NEAR AI runs on the staging API with staging prices; the model choice, latency and some staging endpoints (attestation, per-reply signature, whisper, billing costs) are still being confirmed with a real key. Fuel is a flat $0.001 per reply on chain; the real provider cost is only logged.
- **Receipts do not check everything** (shown on every receipt): the Intel TDX quote is not verified in the app, the NVIDIA NRAS token's signature is not checked (only its claims), and the gateway's TLS binding is not checked. If staging does not return a signature, the receipt honestly says **Unverified**.
- **The brain operator can read memories.** Memories are encrypted at rest (AES-256-GCM, a key per pet), but the master key lives on the brain server. Running the brain step inside a TEE (OutLayer) is on the roadmap.
- **Voice leaves the TEE.** With voice replies on (ElevenLabs), the reply text is sent to a third-party voice service; receipts say so. Voice is off by default.
- **NEAR Intents has no testnet.** A live cross-chain payment is a mainnet payment; the brain requests dry quotes only until a human sets `INTENTS_LIVE_CONFIRMED=1`. The testnet demo path is the NEAR wallet pack (and a labelled Simulated mode).
- **One brain instance.** Rate limits, per-pet locks, race rooms and live update streams are in memory and reset when the brain restarts; data (memories, receipts, orders) is in SQLite on a volume.
- **First end-to-end run pending.** The web, brain and contract pieces are each tested (unit tests, contract flows on testnet), but the full browser-wallet journey above is being run on testnet for the first time this week; open items are tracked in [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md).
- A new player needs a funded testnet wallet (no email login or welcome drip yet).

## Roadmap

Dedicated signing chip on the device, friend visits and postcards, Dream Journal, pets earning on Agent Market, arena prizes, the brain in OutLayer, mainnet (Build Spec "Future additions").

## Prior art

TamaTown (pets as AI agents with wallets), agentchi (x402 pay-per-action pets), Dæmons, Pett.ai, NEARON's own Tamagotchi demo. Our edge: a real game loop with a physical body, and a pet that visibly pays for every thought from its own on-chain budget.

## Repository

`contract/` pets contract · `shirts/` shirts contract · `brain/` brain service (Node 22, Hono, SQLite) · `web/` Next.js app · `packages/shared` types shared by brain and web · `packages/race` deterministic Nearling Run rules (golden vectors shared with the firmware) · `packages/sprites` procedural pet sprites · `scripts/` deploy and seed · `spikes/` NEARON spike · `docs/` interface, milestones, ABIs, Build Spec, [deploy guide](docs/DEPLOY.md), [limitations](docs/LIMITATIONS.md) · `AI-brain architectual/`, `web-app architectual/` design docs · `CLAUDE.md` spec · _`firmware/`: hardware team_

## Run it locally

Needs Node 22 and pnpm 9 (`corepack enable`). Testnet only.

```bash
pnpm install
cp .env.example .env                 # the brain reads ../.env
# fill at least NEARAI_API_KEY; for charges also BRAIN_ACCOUNT_ID + BRAIN_KEYS (function-call keys for the pets contract)
# set MEMORY_MASTER_KEY and SESSION_JWT_SECRET to `openssl rand -base64 32` each (keep them stable)
grep '^NEXT_PUBLIC_' .env.example > web/.env.local   # Next.js reads NEXT_PUBLIC_* from web/
pnpm dev:brain                       # http://localhost:8787  (check: curl localhost:8787/health)
pnpm dev:web                         # http://localhost:3000
```

Without `NEARAI_API_KEY` the pages still load and read the chain, but replies fail (there is no fake inference outside tests). Without brain keys, replies work and their charges wait in the queue. Tests: `pnpm -r typecheck && pnpm -r test`; contracts: `cargo test` in `contract/` and `shirts/`. Hosting (Fly.io for the brain, Vercel for the web): [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Libraries, prior code and AI assistance

All code in this repository was written during the hackathon (first commit 2026-11-07, after the 2026-10-19 announcement); there is no pre-hackathon code. No project template was used; the only third-party code is the libraries below.

| Part | Libraries |
|---|---|
| Contracts | `near-sdk` 5.30, `near-contract-standards` 5.30 (NEP-171/177/181/297) |
| Brain | `hono` 4, `@hono/node-server`, `@hono/node-ws` (race WebSocket), `better-sqlite3` (SQLite), `near-api-js` 7, `zod` (validation), `jose` (session JWT), `ethers` (ECDSA signer recovery for receipts), `tsx`, `typescript`, `vitest` |
| Web | `next` 16, `react` 19, `@hot-labs/near-connect` (wallets), `near-api-js` 7, `qrcode-generator`, `tailwindcss` 4, `typescript`, `vitest` |
| Tooling | pnpm workspaces, `cargo-near`, NEAR CLI (`near`), Docker / Fly.io and Vercel for hosting, GitHub Actions CI |

External services: NEAR AI Cloud (staging), NEARON (testnet prototype), NVIDIA NRAS (attestation check), NEAR Intents 1Click API (dry quotes unless enabled), ElevenLabs (optional voice, off by default), NEAR testnet RPC (FastNEAR, near.org).

**AI-assisted code:** most of the code and docs were written with **Claude Code** (Anthropic) under the rules in [`CLAUDE.md`](CLAUDE.md) (the spec it works from), with the team directing, reviewing and testing the changes.

## Team

_To be filled._
