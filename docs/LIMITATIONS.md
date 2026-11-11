# Limitations, unresolved and incomplete items (excluding hardware)

Audit of branch `zhijian` on 2026-11-10, statuses updated 2026-11-11 after the fix round (contracts merged from `main`). Covers web, brain, shared packages, contracts as used by web and brain, docs, deployment and submission. Hardware and firmware are out of scope. Integration steps for the chain items: [INTEGRATION_PLAN.md](INTEGRATION_PLAN.md).

Severity: **Blocker** (the demo or submission fails without it), **High** (a headline feature or track claim is not real yet), **Medium** (works, with a visible gap), **Low** (polish or edge case).

## 1. Blockers

| # | Item | Why it matters | Fix | Owner |
|---|---|---|---|---|
| B1 | **Fixed 2026-11-11:** MIT `LICENSE` added. No `LICENSE` file in the repo | HACKATHON.md requires one (MIT is fine) | Add `LICENSE` (MIT) | Team |
| B2 | **Partly done 2026-11-11** (INTEGRATION_PLAN.md section 5, `scripts/e2e-chain.ts`): mint, `set_soul`, direct `feed` (checked by the brain's `verifyFeedTx`), feeder `feed` via the brain signer, shirt `claim` and `stake` ran on testnet and every event parses with the web and brain code. Still not run: brain `charge`, `sweep_credit`, wallet popups from the web; `unstake` is blocked (C6) | "The pet pays for each thought" is the core claim; `charge` is still untested | Run steps 1 to 6 and 12 of INTEGRATION_PLAN.md section 3 once brain keys exist (B3) | Role 2 + you |
| B3 | Brain keys not configured: `BRAIN_ACCOUNT_ID` and `BRAIN_KEYS` empty in `.env`; `brain.nearling.testnet` has one full access key, no function-call keys | Every charge stays `queued`; fuel never drops after a chat | Contract teammate adds function-call keys per contract; fill `.env` (INTEGRATION_PLAN G2, G6) | Contract + Role 2 |
| B4 | **Fixed 2026-11-11:** `BRAIN_KEYS_PETS` / `BRAIN_KEYS_DEMO`, one shared signer per contract in `deps.brain` used by charge and sweep; shared `deps.feeder`. One brain key pool for both contracts, but a function-call key works for one receiver only; charge worker and garden sweep build separate signers on the same keys | Charges on `pets-demo` pets fail; nonce clashes between jobs | Per-contract key sets and one shared signer per contract (INTEGRATION_PLAN G3, G4) | Role 2 |
| B5 | **Partly done 2026-11-11:** `brain/Dockerfile`, `fly.toml`, `web/vercel.json`, `docs/DEPLOY.md` ready; the deploy itself needs your Fly and Vercel accounts. Not deployed: no Fly.io / Railway config for the brain, no Vercel project for the web, no public URLs | Judges need a hosted demo or a working local run; the device needs HTTPS | Add `brain/Dockerfile` + `fly.toml` (volume for SQLite), Vercel project rooted at `web/`, set env | Role 2 |
| B6 | **Partly done 2026-11-11:** README web and brain sections, libraries and AI disclosure written; device and Team sections still owed by Roles 3/4. README web and brain sections are still "To be filled by Role 2" (try-it steps, NEAR AI, verification, NEAR Connect, limitations) | AI judges read the README first; "do X, see Y" must work | Write after B2 | Role 2 |
| B7 | **Partly done 2026-11-11:** spike run (`CLAUDE.md` 14, S1/S2/S7 table): model list, prices, attestation, NRAS and ElevenLabs verified; chat latency, billing, signature and whisper blocked because the staging key in `.env` is rejected (401). S3 not in scope here | Model choice, latency, cost per reply, staging verification support, whisper on staging, wallet support are all assumptions | Run the spike; record results in `CLAUDE.md` 14 | Role 2 |

## 2. Chain configuration (needs the contract teammate)

| # | Item | Severity | Fix |
|---|---|---|---|
| C1 | `config.org_id` is `00000000-0000-0000-0000-000000000000` on `pets-v8` and `pets-demo` | High | `set_config` with our NEAR AI staging org UUID |
| C2 | **Resolved 2026-11-11** for testing: faucet-funded feeder `nearling-feeder-s1zspx.testnet` (about 10 NEAR, full access key in the gitignored `brain/data/testnet-accounts.env`) fed a pet through `brain/src/chain/signer.ts`. Copy `FEEDER_ACCOUNT_ID` / `FEEDER_KEY` into `.env`; `feeder.nearling.testnet` itself still has no keys | Low | Top up from the faucet when `feeder balance low` alerts |
| C3 | Real CREDIT top-up into the NEAR AI org never done (MILESTONES M3, S6/S7) | High | Needs C1 plus at least 0.01 CREDIT claimable (about 15 NEAR-days of stake across pets) |
| C4 | Final testnet deploy and re-seed pending (MILESTONES M6, M7); a new `pets-vN` needs new brain function-call keys and `.env` updates | Medium | Agree a freeze date; redeploy once, then re-key |
| C5 | **Fixed 2026-11-11:** `cargo test`: 138 passed (`contract/`), 5 passed (`shirts/`); README says 143, contract owner to correct. Contract Rust tests not re-run on this branch (no Rust toolchain in this environment) | Low | `cargo test` in `contract/` and `shirts/` before submission |
| C6 | **New 2026-11-11:** NEARON now requires 0.00772 NEAR attached to `unstake` (pool `get_account.unstake_deposit`, refunded on withdraw); the contract attaches 1 yocto, so every `unstake` on `pets-v8` and `pets-demo` fails and the callback keeps the stake (tx `AhFwj7C9SgkfTavhWp9EtY1jfj1XfWzDdGpJXvqYVeKj`). Staked pets cannot unstake or transfer | High | Contract: attach `unstake_deposit` to the pool call (owner pays it, refund passed on in `withdraw`), redeploy (C4), then `scripts/e2e-chain.ts --garden <id>` and `--withdraw <id>` |

## 3. AI brain

### Talk, models, voice
| # | Item | Severity |
|---|---|---|
| A1 | **Fixed 2026-11-11:** `CLAUDE.md` 8.1 now says `z-ai/glm-5.3-flash` (cheapest private model; staging has no attestation provider for `openai/gpt-oss-120b`, HTTP 503). Latency still unmeasured (A2) | Medium |
| A2 | **Partly done 2026-11-11:** `/model/list` format verified (matches `parseModelList`). Still open, because the `NEARAI_API_KEY` in `.env` gets 401 on staging: `inference-id` header, whisper (`language=en`, WEBM), `/billing/costs` body, latency. Needs a fresh staging key, then `brain/scripts/spike-nearai.ts` | High |
| A3 | **Partly done 2026-11-11:** ElevenLabs `pcm_16000` to WAV and the credits check verified (`brain/scripts/tts-check.ts`, 0.5 credit per character). Left: the `TTS_VOICE_ID` in `.env` is a library voice and gets 402 `paid_plan_required` on the free plan; set a premade voice and `TTS_PROVIDER=elevenlabs` | Medium |
| A4 | **Fixed 2026-11-11:** `POST /pets/:petRef/turns/:turnId/voice` + "Hear it" button (owner only, once per clip, credit floor). The web never requests voice (to save credits); "Play voice" only appears for device turns. Tap-to-hear on the web would need an on-demand TTS route | Low |
| A5 | **Fixed 2026-11-11:** reconcile job posts `requestIds` to `/billing/costs` every 5 min, stores `billed_cost_nano` [VERIFY with a valid key]. No billing reconcile: provider cost is estimated from tokens x price; `/v1/billing/costs` is not called by a job (design 03 section 5) | Low |
| A6 | **Fixed 2026-11-11:** spend cap = chat + summaries + STT (whisper tokens estimate) + TTS (`TTS_USD_PER_1K_CHARS`). Global daily spend cap counts chat and summary tokens only; STT has no price and TTS is counted in characters, not dollars | Low |
| A7 | Low Fuel replies are not saved as turns (`turn_id` null), so they have no receipt or history | Low |
| A8 | Failed generation returns HTTP 200 `status: "failed"` (by design); clients must retry with the same `request_id` | Low |
| A9 | **Fixed 2026-11-11:** `PUT /pets/:petRef/profile` (nickname encrypted, owner only, dropped after transfer) + web settings page. Owner nickname is supported in the prompt but nothing can set it (no `PUT /pets/:petRef/profile` route) | Medium |
| A10 | **Fixed 2026-11-11:** same route stores `owner_tz`; the web sends the browser time zone once after sign-in. Owner timezone is never set (no route), so morning greetings and night quiet hours use UTC | Medium |

### Verification and privacy
| # | Item | Severity |
|---|---|---|
| P1 | **Partly done 2026-11-11:** `/attestation/report` works on staging (public), echoes the nonce per gateway and model attestation, and GLM-5.3-flash passes NRAS (`brain/scripts/attest-check.ts`). `/signature` and an end-to-end `model_verified` receipt are still untested (needs a working key, A2) | High |
| P2 | Intel TDX quote not verified in app; NRAS JWT signature not checked (only its claims); gateway TLS binding not checked. All shown honestly on receipts | Medium |
| P3 | **Fixed 2026-11-11:** confirmed on staging: `gateway_attestation` carries a TDX quote and our nonce but no `nvidia_payload`, so `gateway_verified` rightly needs only the nonce echo | Low |
| P4 | The brain operator can read memories (master key on the server); brain in OutLayer / TEE is roadmap | Medium (disclose) |
| P5 | With ElevenLabs on, reply text leaves the TEE; receipts hard-code the provider as `elevenlabs` whenever audio exists | Medium (disclose) |
| P6 | E2EE to the model (client-side encryption) not implemented | Low (roadmap) |
| P7 | **Partly done 2026-11-11:** production secrets steps in `docs/DEPLOY.md`; local dev uses `brain/data/dev-secrets.env`. Dev secrets: `.env` has empty `SESSION_JWT_SECRET` and `MEMORY_MASTER_KEY`; local runs use generated values in `brain/data/dev-secrets.env`. Production needs real ones, kept stable (changing the master key makes stored memories unreadable) | High at deploy |

### Fuel, Feed the Brain, Garden, Wallet
| # | Item | Severity |
|---|---|---|
| F1 | NEAR Intents has no testnet. Live mode requests dry quotes only until a human sets `INTENTS_LIVE_CONFIRMED=1`; every live payment is a mainnet transaction that needs explicit approval | High |
| F2 | **Resolved 2026-11-11** with dry quotes only (INTEGRATION_PLAN.md 5.5): shapes match the OpenAPI spec, `nep141:wrap.near` is right, Solana USDC route minimum 0.0604 NEAR out / 0.2215 USDC in; packs cost 0.37 / 1.86 / 3.71 USDC; live price = same NEAR as the testnet pack. Live (`dry: false`) is still never sent without a human | Low |
| F3 | **Fixed 2026-11-11:** feeder retries 2 s, 10 s, 60 s, 60 s with on-chain `fed` and nonce checks before each retry (rare double-feed window documented in 09). A failed feeder `feed` call marks the order failed and is not retried | Low |
| F4 | **Resolved 2026-11-11:** `legends` is live but keeps 100% of rewards; default is now `stakely_v2.pool.f863973.m0` (active, 3% fee, `get_account_staked_balance` works) | Low |
| F5 | **Resolved 2026-11-11:** real fields recorded (INTEGRATION_PLAN.md 5.3) and typed in `fuel/garden.ts`; `claimable` was already right. Watch `claim_deposit` (0 today) | Low |
| F6 | **Fixed 2026-11-11:** org balance read after each sweep into `org_balance` [VERIFY: the route may need a session token]. Reading the NEAR AI org balance after a sweep is not implemented | Low |
| F7 | The `credit` correction path exists in the contract but the brain never calls it (fuel is a flat price, so no corrections are needed) | Low |

### Devices, pairing, proactive, timeline, race
| # | Item | Severity |
|---|---|---|
| D1 | A device that loses its token must unpair and pair again (only the hash is stored) | Low |
| D2 | **Fixed 2026-11-11:** `/session` accepts base64, `ed25519:<base58>` and hex. `/session` accepts base64 signatures only; a wallet returning `ed25519:<base58>` is rejected (check with Meteor) | Medium |
| D3 | **Fixed 2026-11-11:** stream re-checks the owner every 60 s and closes with `event: closed`. The SSE stream does not re-check ownership after connect; a transferred pet's old owner keeps receiving events until reconnect | Low |
| D4 | **Fixed 2026-11-11:** timeline from real `EVENT_JSON` logs via FastNEAR (payer, tx hash, daily thoughts row); snapshot diff only as a marked fallback. Pet timeline is a `get_pet` snapshot diff: no payer, no tx hash, amounts net of metabolism, two changes inside 30 s merge (NearBlocks v3 events would fix it) | Medium (nfts track) |
| D5 | Proactive turns count toward the 300 talks per pet per day limit | Low |
| D6 | **Fixed 2026-11-11:** `GET /pets/:petRef/receipts?public=1` + shown on `/p/[petRef]` and the landing page. No public list of published receipts, so `/p/[petRef]` never shows any | Low |
| D7 | **Fixed 2026-11-11:** `GET /ops` behind basic auth (`OPS_USER`/`OPS_PASSWORD`). No `/ops` page (spend, queues, feeder balance, attestation, claimable) | Low |
| D8 | **Fixed 2026-11-11:** `GET /me/pets` + `/my` page. No `GET /me/pets`; the web reads owned pets from chain directly (works, but differs from the API doc) | Low |
| D9 | Race: `@hono/node-ws` 1.3.1 has an unmet peer (`@hono/node-server ^1`, we use 2.1.6); works in tests and a live run | Low |
| D10 | Race prizes and paid entry not built (Build Spec: separate decision) | Low (roadmap) |

### Operations
| # | Item | Severity |
|---|---|---|
| O1 | Single brain instance by design: rate limits, per-pet locks, race rooms and SSE subscribers are in memory and reset on restart | Medium |
| O2 | **Fixed 2026-11-11:** daily `db.backup()` to `BACKUP_DIR`, keep 7. No SQLite backup job (holds memories, orders, inbox) | Medium |
| O3 | **Fixed 2026-11-11:** `.github/workflows/ci.yml` (typecheck, tests, web build, cargo test). No CI (tests and typecheck run only by hand) | Low |
| O4 | **Fixed 2026-11-11:** `ALERT_WEBHOOK_URL` (Discord/Slack), rate limited, ids only. Alerts are log lines only (`level=alert`); nobody is notified | Low |

## 4. Web app

| # | Item | Severity |
|---|---|---|
| W1 | Never run in a real browser with a wallet: Meteor one-popup sign-in, mint and token id read-back, 450 Tgas stake/unstake/withdraw in Meteor, failed-tx error copy, popup cancel, phone layout in Meteor's in-app browser | High |
| W2 | Hold-to-talk (MediaRecorder WEBM), the SSE live stream, audio playback, sprite animations and the race canvas are compiled and unit-tested but have never been seen running | High |
| W3 | **Fixed 2026-11-11:** `/pet/[petRef]/transfer`: direct transfer, blocked while staked, or started on the phone and approved on the paired device. No pet transfer page (`/pet/[petRef]/transfer`, Build Spec 8, stretch); the brain supports `transfer_pet` approvals | Low |
| W4 | **Fixed 2026-11-11:** shirt drawn as its own layer in every clip, web and device header (309 KB frames). No shirt layer on the pet sprite (sprites package has none), so an equipped shirt is not drawn on web or device | Medium |
| W5 | **Fixed 2026-11-11:** QR + copy for the live deposit address. Live Intents deposit address is text only (no QR) | Low |
| W6 | Redirect wallets (MyNearWallet) lose page state mid-flow; Meteor uses a popup | Low |
| W7 | No social or email login (Privy, spike S3) and no testnet welcome drip, so a new player needs a funded testnet wallet | Medium (games track "never notice the chain") |
| W8 | **Partly done 2026-11-11:** unread badge and browser notifications while the tab is open; true web push (service worker) stays roadmap. No web push; the inbox only updates while the page is open (`CLAUDE.md` 5.5 web push [TBD]) | Low |
| W9 | **Fixed 2026-11-11:** copy for all 30 contract `E_` codes, enforced by a test. 19 contract error codes have no friendly copy (mostly device, admin, approval paths the web does not call) | Low |
| W10 | **Fixed 2026-11-11:** one global header with wallet button. Landing page has its own header; a global header with `ConnectButton` would duplicate it | Low |
| W11 | **Fixed 2026-11-11:** `/my` page. No "my pets" page (`/my`); pets are found via Hatch & Pair or a direct link | Low |
| W12 | No Playwright or other browser tests | Low |
| W13 | taste-skill layout and finish checks not run (no Chrome here); only its copy linter ran (0 FAIL, 1 WARN kept on purpose) | Low |
| W14 | **Fixed 2026-11-11:** `web/AGENTS.md` committed (Next.js agent rules). Next.js 16 created `web/AGENTS.md` on first start; commit or delete | Low |
| W15 | Figma file for the pixel design was not created (connector was disconnected) | Low |

## 5. Shared packages and art

| # | Item | Severity |
|---|---|---|
| S1 | **Fixed 2026-11-11:** decision recorded: keep procedural 32x32 (`CLAUDE.md` 11, `07-pet-animation.md`). Pets are procedural 32x32 sprites (no art owner); `CLAUDE.md` 11 suggested 64x64 hand-drawn | Medium |
| S2 | **Fixed 2026-11-11:** personality from the highest trait: hop, look around, slow blink, smirk, extra hearts. Traits `playful`, `calm`, `kind` do not affect the look or idle behaviour yet (only colour and pattern) | Low |
| S3 | Race rules are integer-only and golden-tested in TypeScript; the C++ port (hardware team) must reproduce the golden vectors | Medium (cross-team) |
| S4 | **Fixed 2026-11-11:** `InboxItem`, `TimelineItem`, `Receipt` in `packages/shared`. `InboxItem` and `TimelineItem` types live in the brain, not `packages/shared` | Low |

## 6. Docs out of date

| # | Item | Severity |
|---|---|---|
| X1 | **Fixed 2026-11-11:** `CLAUDE.md` 3 team split (Role 4 owned brain `pairing.ts` / `actions.ts`; actual: all server code is Role 2) | Medium |
| X2 | **Fixed 2026-11-11:** `CLAUDE.md` 4 diagram, 8.2 routes (pairing "returns a 6-digit code"), 8.3 step 4 (structured tail), 9 web routes (shop, AddKey device page), 13 timeline are pre-hybrid | Medium |
| X3 | **Fixed 2026-11-11:** superseded banner + as-built summary. `Architecture.md` (repo root) describes the touch-screen device, on-device signing and on-chain approvals as the demo path | Medium |
| X4 | **Fixed 2026-11-11:** superseded banner. `conceptual/` is superseded by `AI-brain architectual/` and `web-app architectual/` but not marked as such | Low |
| X5 | **Fixed 2026-11-11:** `AI-brain architectual/08-api-reference.md` lacks the race protocol additions (`request_inputs`, `opp_crash`, `error`) and the `/devices/*` header auth details | Low |
| X6 | **Fixed 2026-11-11:** MILESTONES: "`packages/shared` types match `get_pet`" and "brain, web point at `pets-v8`/`shirts`" are done in code but not ticked | Low |

## 7. Submission checklist status (HACKATHON.md)

| Requirement | Status |
|---|---|
| Public repo by 2026-11-14 23:59 UTC | Not public yet (human decision) |
| README with "do X, see Y" | Contract part done; web and brain parts missing (B6) |
| LICENSE | Missing (B1) |
| Hosted demo (a plus) | Not deployed (B5) |
| X post with video or screenshots | Not done (human posts) |
| Libraries and AI-assisted code disclosed in README | Not done |
| No secrets in history | Checked on 2026-11-10: none tracked; the only `ed25519:` strings are public keys in contract tests |
| Mainnet payout account for the form | Human |

## 8. Contract fix needed for C6 (for the contract owner)

Found 2026-11-11 by `scripts/e2e-chain.ts` on `pets-v8` (pet 5 holds 1 NEAR stake and cannot unstake). Proposed change in `contract/src/stake.rs`, not made by Role 2 because the contract and its deploy belong to Role 1:

1. `unstake(pet_id, amount)` becomes `#[payable]`; require the attached deposit to be at least `config.pool_unstake_deposit` (new config field, set from the pool's `get_account(<contract>).unstake_deposit`, 0.00772 NEAR today) and forward exactly that deposit to the pool `unstake` call (`internal_unstake`, currently `NearToken::from_yoctonear(1)`).
2. Store the deposit in `PendingUnstake { amount, unlock_epoch, deposit }`; on `on_unstake` failure refund it to the owner; on `on_withdraw` success pay the owner `amount + deposit` (the pool refunds the deposit to the holder with the withdrawal).
3. Same for the approval path `Unstake { amount }` (attach the deposit at `propose_action`).
4. `PendingUnstake` changes shape, so this is a breaking state change: deploy `pets-v9` (no migrations, `CLAUDE.md` 7), re-register the pool, re-seed, then Role 2 updates `PETS_CONTRACT` and the brain function-call keys, and the web attaches the deposit in `unstake` (`web/lib/chain.ts`, read from `config()`).
5. Check `get_account.claim_deposit` the same way for `sweep_credit` (0 today).
