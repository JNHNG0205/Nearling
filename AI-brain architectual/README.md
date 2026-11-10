# AI brain (backend): detailed architecture

Owner: Role 2 (web + brain). Written 2026-11-10 for the **hybrid scope** (`CLAUDE.md` 1.1): Build Spec product and hardware, pet fuel on chain. Supersedes `conceptual/03` and `conceptual/05` for the brain. On conflict, `CLAUDE.md` (chain) and `docs/Nearling-Hackathon-Build-Spec.md` (product) win; the frozen contract interface is `docs/CONTRACT_INTERFACE.md`.

The Build Spec calls this service "the backend". It is one Node process: the pet's mind plus the game server.

## Files

| File | Content |
|---|---|
| [01-overview.md](01-overview.md) | Responsibilities, context, tech stack, module map, accounts and keys, deployment, env |
| [02-data-model.md](02-data-model.md) | SQLite schema for every shared record in Build Spec "Shared records" |
| [03-chat-voice-receipts.md](03-chat-voice-receipts.md) | Verified Talk: pipeline, retry idempotency, Soul + safety prompt, STT, TTS, fuel charge, TEE verification, receipts |
| [04-fuel-feed-garden.md](04-fuel-feed-garden.md) | Fuel accounting, charge queue, Feed the Brain (direct, NEAR Intents, simulated), feeder account, Brain Garden sweep |
| [05-devices-care-closet-wallet.md](05-devices-care-closet-wallet.md) | Pairing, device auth, offline care sync and evolution, Closet, Wallet and transfer approval requests |
| [06-race-arena.md](06-race-arena.md) | Nearling Run rooms, WebSocket protocol, deterministic rules, result validation |
| [07-memory-proactive.md](07-memory-proactive.md) | Encrypted memory, scheduler, the pet reaching out first |
| [08-api-reference.md](08-api-reference.md) | Every route, auth, payloads, errors, SSE and WebSocket events |
| [09-security-ops-testing.md](09-security-ops-testing.md) | Threats, logging rules, monitoring, tests |
| [10-build-plan.md](10-build-plan.md) | Nov 10 to 14 plan, what teammates can build against and when |

## Decisions I made (change if the team disagrees)

| # | Decision | Why |
|---|---|---|
| D1 | Chat model default `z-ai/glm-5.3-flash` (private, $0.075 / $0.25 per 1M), fallback `openai/gpt-oss-120b`, chosen by S1 | Build Spec names GLM Flash; cheapest private model; `CLAUDE.md` 8.1 gets updated after S1 (rule 7) |
| D2 | **Dialogue only** replies plus a leading emotion tag `[happy]` parsed by regex; `charge` sends `xp_gain = 1`, `mood_delta = 1`, `trait_deltas = null` | Build Spec: "the chat model generates dialogue only"; on-chain care stats are not the demo path |
| D3 | Chat idempotency by a client `request_id`: a retry returns the saved reply, never a second inference or charge | Build Spec 2 "Done when"; contract `usage_ref` covers only the charge |
| D4 | `usage_ref` = our `turn_id` (UUID), not the inference id | Known before the model call; stable across brain restarts; inference id still stored |
| D5 | A separate **feeder** testnet account (full access key, small balance) calls `feed`; brain account keeps function-call keys only | Function-call keys cannot attach deposits (S5) |

## Decisions the team must make

| # | Question | My recommendation |
|---|---|---|
| Q1 | NEAR Intents has **no testnet** (HACKATHON.md). How do we demo Feed the Brain? | Three modes, one order pipeline: **Direct** (payer's testnet wallet calls `feed`, real, default), **Intents live** (tiny mainnet payment to the project's mainnet account, then the feeder feeds on testnet; each live run needs explicit human approval, `CLAUDE.md` rule 1), **Simulated** (labelled). See 04 |
| Q2 | ~~TTS provider~~ **Decided 2026-11-10: ElevenLabs Flash v2.5** (10,000 team credits, about 130 spoken replies), disclosed on receipts; Kokoro kept as fallback. Budget rules in 03 section 6 | done |
| Q3 | Chain `life_state` drifts to `Sad` because care is device-local and on-chain mood only decays | Brain computes `display_state`: fuel states from chain (Dormant, Starving, Hungry), mood from device care sync. Web and device show `display_state` |
| Q4 | Who draws the sprite sheet (`art/`: pet stages, winged form, shirt layer, emotions) used by both web and firmware? Nobody on the team has it yet | I start with placeholder shapes; whoever has time first takes it (AI-generated pixel art is fine if listed in the README) |

## Team split (actual, 2026-11-10)

| Who | Owns | Interface with me |
|---|---|---|
| Me (web + brain) | `web/`, `brain/`, `packages/shared`, `packages/race`, **all** server routes incl. pairing, approvals, race rooms | n/a |
| Contract teammate | `contract/`, `shirts/`, `scripts/` | Frozen interface `docs/CONTRACT_INTERFACE.md`; brain keys and `org_id` |
| Hardware teammates (2) | 3D printed case, soldering, C++ firmware for the ESP32-S3 | They are clients of my API: 08 (routes), 03 (talk, audio), 05 (pairing, care, closet, approvals), 06 (race protocol and rules to port) |

This replaces the Role 3 / Role 4 split in `CLAUDE.md` 3, where Role 4 owned `pairing.ts` and `actions.ts` on the brain. `CLAUDE.md` 3 needs the same update (shared file, agree with the team first).
