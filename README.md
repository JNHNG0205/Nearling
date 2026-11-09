# Nearling

**Nearling is a physical AI Tamagotchi whose life depends on its own NEAR balance.** Every reply is a private AI inference on NEAR AI Cloud, paid on chain from the pet's own fuel; feed it and it thrives, neglect it and it starves and goes dormant, stake NEAR for it and the yield keeps it fed.

> Status: built for the NEAR Hackathon (Nov 2026), **testnet only**. Contract sections are complete; sections marked _To be filled_ belong to the web, brain and device roles.

## Why

AI pets usually run on a company's servers and a company's bill. Nearling makes the pet an NFT **that owns the money for its own mind**: its fuel lives in the pet's on-chain budget, every thought is billed there and logged as an event anyone can check, and NEARON staking can turn yield into AI credit that pays for it forever. That is Illia Polosukhin's "NFT pets each with a NEAR balance that pays for AI inference", on a desk.

## How it works

```
             NEAR testnet
   ┌──────────────────────────────────────┐        ┌───────────────────────────┐
   │ pets contract (pets-v8)              │◄──────►│ NEARON iNEAR pool          │
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
- **One reply = one fuel:** the brain calls `charge(pet, $0.001, inference id)`. Retries with the same id never double-charge; an empty budget makes the pet Starving (Low Fuel), and 72 hours later Dormant. Pets never die.
- **Product and device:** [`docs/Nearling-Hackathon-Build-Spec.md`](docs/Nearling-Hackathon-Build-Spec.md).

## Try it on testnet

Everything below runs with the [NEAR CLI](https://github.com/near/near-cli-rs) (`near`). Views need no account.

**1. See pets in every state** (seeded with `scripts/seed-demo.sh`):

```bash
for id in 1 2 3 4; do
  near contract call-function as-read-only pets-v8.nearling.testnet get_pet \
    json-args "{\"pet_id\":\"$id\"}" network-config testnet now
done
```

You see `#1 Sunny` **Happy**, `#2 Crumb` **Hungry** (`budget_micro` 1000, `fullness` 33), `#3 Echo` **Starving** (Low Fuel), `#4 Sprout` **Happy** with `"self_sustaining": true` (2 NEAR staked; `daily_credit_micro` covers its `daily_burn_micro`).

**2. Read a pet's Soul**, its public, versioned personality:

```bash
near contract call-function as-read-only pets-v8.nearling.testnet get_soul \
  json-args '{"pet_id":"1"}' network-config testnet now
```

**3. Adopt your own pet** (needs a funded testnet account, `YOU.testnet`):

```bash
near contract call-function as-transaction pets-v8.nearling.testnet nft_mint_pet \
  json-args '{"name":"Mochi","soul":"A shy, curious cat who loves rainy days."}' \
  prepaid-gas '50 Tgas' attached-deposit '0.2 NEAR' \
  sign-as YOU.testnet network-config testnet sign-with-keychain send
```

You see `nft_mint` and `soul_updated` events and the new token id. `get_pet` shows about 20 chats of fuel (`budget_micro` 20000: 0.1 NEAR at the testnet rate of $0.20 per NEAR).

**4. Watch it pay for its thoughts.** Each brain reply is a `charge`; look for `thought` events on the contract in a testnet explorer, each with `cost_micro` 1000 and `source` `credit` / `food` / `mixed`. _To be filled by Role 2: chat in the web app and see the cost on every reply._

**5. Let it starve, then feed it:** on the demo-speed contract a fresh pet starves in about 14 minutes and goes dormant about 43 minutes later.

```bash
near contract call-function as-transaction pets-demo.nearling.testnet nft_mint_pet \
  json-args '{"name":"Blink"}' prepaid-gas '50 Tgas' attached-deposit '0.105 NEAR' \
  sign-as YOU.testnet network-config testnet sign-with-keychain send
# about an hour later: "life_state": "Dormant"
near contract call-function as-transaction pets-demo.nearling.testnet feed \
  json-args '{"pet_id":"ID"}' prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' \
  sign-as YOU.testnet network-config testnet sign-with-keychain send
```

You see `revived` and `fed`, and `life_state` goes from **Dormant** to **Hungry**: at demo speed 0.1 NEAR is about 4.8 hours of food, still short of the three days that count as full. `pets-demo` runs the same code with about 100× faster rates (`config.demo_speed = true`) and is labelled **demo speed** everywhere.

**6. Stake to live (Brain Garden):**

```bash
near contract call-function as-transaction pets-v8.nearling.testnet stake \
  json-args '{"pet_id":"ID"}' prepaid-gas '450 Tgas' attached-deposit '2 NEAR' \
  sign-as YOU.testnet network-config testnet sign-with-keychain send
```

The contract deposits into the NEARON pool `mw-pool-1024.testnet`; `get_pet` now shows `staked`, `credit_micro` growing every second, and `"self_sustaining": true` once the daily credit covers the daily burn (2 NEAR is enough at the testnet farm rate of $0.000657 per NEAR per day). `unstake` and `withdraw` give the NEAR back after 12 to 24 hours.

**7. Claim a Closet shirt:**

```bash
near contract call-function as-transaction shirts.nearling.testnet claim json-args '{}' \
  prepaid-gas '30 Tgas' attached-deposit '0.01 NEAR' \
  sign-as YOU.testnet network-config testnet sign-with-keychain send
```

One per account; the shirt follows its owner when transferred.

_To be filled by Role 2: the same journey in the web app (adopt, chat with receipts, Feed the Brain checkout via NEAR Intents, Closet), which must work without the device._

## The device

_To be filled by Roles 3 and 4: photos, video, parts list (see the Build Spec hardware reference), build and flash steps._

## NEAR tech per track

| Track | What we use |
|---|---|
| `games` | The care loop and Nearling Run; the chain stays invisible in play (no wallet pop-ups for chat) |
| `nfts` | Each pet is a **NEP-171 NFT that owns money**: its fuel budget, its stake and its spending history live on chain. Shirts are a second NEP-171 collection. NEP-177 metadata, NEP-181 enumeration, NEP-297 events |
| `agents` | The pet pays for its own compute: one on-chain `charge` per reply, funded by feeding or by its own staking yield |
| `privacy` | Private (TEE) models on NEAR AI Cloud with verified receipts. _Details: Role 2_ |
| `security` | See below |

**NEARON:** the pets contract is the plain iNEAR holder of `mw-pool-1024.testnet`. It stakes per pet with `deposit_and_stake`, unstakes with `unstake` and `withdraw` (each with the 1 yocto the pool requires), and sweeps CREDIT into the brain's NEAR AI org with `sync_from_farm` + `claim_and_topup`. Per-pet credit accrues lazily on chain at the measured farm rate. A one-time house deposit at deploy (`register_pool`) absorbs the pool's first-deposit fee, so every pet stake is recorded 1:1 with the iNEAR actually held. Spike results: `CLAUDE.md` 14.

_To be filled by Role 2: NEAR AI Cloud (models, verification, speech), NEAR Connect and Meteor, NEAR Intents._

## Security model (contract)

- **Only the brain can spend fuel**, and only within caps: $0.005 per call and $0.10 per pet per day; xp, mood and trait changes are clamped too. A leaked brain key cannot drain pets or change config; only the admin can.
- **Only the owner stakes, and stake only returns to the owner.** CREDIT sweeps can only go to the configured NEAR AI org.
- **Transfer is blocked while a pet has stake, a pending unstake or a stake in flight**, and it resets device access and pending approvals.
- **Retries are safe:** a repeated `usage_ref` is a no-op, so the brain can retry a charge blindly.
- **Every pool call is locked before and restored on failure**, so a failed NEARON call never loses or double-counts stake.
- In code but not the demo path: a limited device key that can never attach deposits, and on-chain hold-to-approve where the wallet proposes and only the device key can approve (`CLAUDE.md` 7.3).
- Stable error codes (`E_NOT_OWNER: ...`) for every rejection; 143 unit tests cover each rule, including every NEARON callback on success and failure, and each flow was also run on testnet.

## Limitations

- **Testnet only.** NEAR, CREDIT and the $0.20 per NEAR food rate are testnet values.
- **NEARON is a testnet prototype** with an upgradeable owner key. It was upgraded during the hackathon (the first-deposit fee changed from 0.0055 to 0.08467 NEAR; matured withdrawals can now wait for the pool to collect them, in which case `withdraw` fails and can simply be retried).
- A CREDIT sweep needs at least 0.01 CREDIT, which takes about 15 NEAR-days of stake across all pets.
- The contract wasm is about 380 KB (about 3.8 NEAR of storage per deployment).
- _To be filled by Role 2: staging API and prices, the brain can read memories, receipts' limits._

## Roadmap

Dedicated signing chip on the device, friend visits and postcards, Dream Journal, pets earning on Agent Market, arena prizes, the brain in OutLayer, mainnet (Build Spec "Future additions").

## Prior art

TamaTown (pets as AI agents with wallets), agentchi (x402 pay-per-action pets), Dæmons, Pett.ai, NEARON's own Tamagotchi demo. Our edge: a real game loop with a physical body, and a pet that visibly pays for every thought from its own on-chain budget.

## Repository

`contract/` pets contract · `shirts/` shirts contract · `scripts/` deploy and seed · `spikes/` NEARON spike · `docs/` interface, milestones, ABIs, Build Spec · `CLAUDE.md` spec · _`brain/`, `web/`, `firmware/`, `art/`: other roles_

## Team

_To be filled._
