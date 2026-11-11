# 09. Security, operations, testing

## 1. Threats

| Threat | Mitigation |
|---|---|
| Brain key leak drains pets | Brain keys are FC keys for `charge` / `credit` / `sweep_credit` only; contract caps $0.005 per call, $0.10 per pet per day |
| Feeder key leak | Small balance, daily cap in code, ops alert on low balance; testnet NEAR only |
| Double charge on retries | `request_id` unique per pet (no second inference); `usage_ref = turn_id` (contract no-op on repeat) |
| Double feed on duplicate notifications | `settle_ref` and `feed_tx` unique; single guarded status transition |
| Spoofed "I paid" from the client | Direct mode verifies the tx on chain; live mode trusts only 1Click status for our deposit address |
| Old owner keeps device access after transfer | Owner re-check on every device call (5 s cache); devices revoked on mismatch |
| Pairing hijack | 128-bit single-use token, 10 min expiry, physical confirm on the device, device secret required |
| Replay of wallet approvals | One-use, 5 min expiry, bound to device, account, action, destination, amount; tx verified against all fields |
| Soul prompt injection | Brain-owned safety core above the Soul; Soul wrapped as character data; replies capped |
| Kid safety | Safety core, refusal in character, no financial advice; Soul cannot override |
| Chat content leakage | Private TEE models only (boot check: refuse a model with `verifiable=false` in `/v1/model/list`); memory encrypted; no content in logs; TTS disclosure on receipts |
| Race cheating | Server replays inputs with the shared deterministic rules |
| Cost runaway | Per-pet limits, global daily provider cap, TTS char cap |

## 2. Logging (`CLAUDE.md` rule 4)

Allowed fields: ids (`turn_id`, `pet_ref`, `device_id`, `order_id`, `inference_id`), model, token counts, costs, latencies, statuses, tx hashes, error codes. A deny-list in `log.ts` drops `text`, `reply`, `transcript`, `soul`, `summary`, `facts`, `nickname`, `audio`, `secret`, `token`, `key`; a unit test asserts it.

## 3. Operations

Code: `brain/src/ops/` (module `opsModule` in `modules.ts`), migration `600_ops.sql`.

| Item | What runs | Config |
|---|---|---|
| `GET /ops` (D7) | JSON for the team, HTTP basic auth, **404 while either credential is unset**. Fields: `spend_today` (chat and summary USD, STT USD, TTS characters and USD, total vs cap, billed and unbilled turns), `charge_queue` (depth, retrying, failed, oldest pending age), `orders` (count by status, feeds waiting to retry), `feeder` (account, balance), `attestation` (latest per model), `nearon_claimable` (pool `get_account` for both pets contracts), `org_balance` (last reading), `elevenlabs_credits` (cached 1 h), `backups` | `OPS_USER`, `OPS_PASSWORD` |
| Billing reconcile (A5) | Every 5 min: `POST {NEARAI_BASE_URL}/billing/costs` with `{ "requestIds": [...] }` (the `inference-id` UUIDs of `done` turns from the last 24 h, at least 1 min old). The billed nano-USD is stored in `turn.billed_cost_nano`, and that day's `spend_daily.provider_nano` moves by billed minus the token estimate, so the cap uses billed cost where known. Ids returned with `costNanoUsd: 0` (not visible yet) are asked again, up to 6 times | `NEARAI_API_KEY` (off with `MOCK_AI=1`) |
| Spend cap (A6) | Cap total = chat and summaries + STT + TTS. STT: whisper's per-token price from `/v1/model/list` (10 nano-USD in and out on 2026-11-11) x an estimate of 1,500 input tokens per started 30 s of audio (response `duration`, else the file size) plus about 4 characters per output token [VERIFY how NEAR AI counts audio tokens; the reconcile job does not cover STT since transcriptions return no `inference-id`]. TTS: characters x `TTS_USD_PER_1K_CHARS` / 1,000 | `TTS_USD_PER_1K_CHARS` (default 0.05, ElevenLabs Flash API price [VERIFY our plan]) |
| Org balance (F6) | After every successful `sweep_credit`: `GET {NEARAI_BASE_URL}/organizations/{org_id}/usage/balance`, stored in `org_balance`, change in `remaining` logged (`delta_nano`). [VERIFY] the docs list session-token auth for this route; with an API key it may return 401/403 (logged, `/ops` shows the last stored value) | `NEARAI_ORG_ID`, else the contract `config().org_id` |
| Feeder retries (F3) | A failed `feed` waits 2 s, 10 s, 60 s, 60 s; after the 5th failed try the order is `failed` with an alert. Never feeds twice: a failed try with a tx hash is re-read on chain first (a `fed` event marks the order fed without a new call); a failure without a hash (timeout, network) is retried only if the feeder's access key nonces are unchanged since before the try, else the order fails with an alert to check by hand. The daily cap counts the order once | none |
| SQLite backup (O2) | `db.backup()` once a day (checked hourly, first check 1 min after boot) to `nearling-<UTC time>.db`, newest 7 kept. Backups hold sealed memories: same care as the live DB, same `MEMORY_MASTER_KEY` needed | `BACKUP_DIR` (default `./data/backups`) |
| Alerts (O4) | Every `log.alert` line is also POSTed as `{ "content": ..., "text": ... }` (Discord and Slack webhook shapes) with the already cleaned fields (ids, costs, statuses only). Same message at most once per 10 min, at most 20 posts per hour | `ALERT_WEBHOOK_URL` (optional) |

- Alerts are log lines with `level=alert` (Fly log tail during the demo), also sent to the webhook when set: charge failed > 10 min, feeder < 2 NEAR, feeder feed failed after retries or with an unknown outcome, 402 from NEAR AI, attestation refresh failing, backup failed.
- Known limit (F3): a tx that timed out but lands more than a few seconds later, after an unchanged-nonce retry was sent, could still feed twice. Rare on testnet; the alert and `/ops` make it visible.
- Contract upgrade checklist: new `PETS_CONTRACT`, add brain FC keys for it, restart brain; `pet_ref` includes the contract so old rows stay valid.

## 4. Testing

| Level | What |
|---|---|
| Unit (vitest) | prompt builder (safety core first, Soul wrapped), emotion tag parse, fuel math and `display_state`, order state machine, care mood and evolution once, approval state machine, log deny-list, race `simulate` golden vectors |
| Integration (`MOCK_AI=1`) | talk retry with same `request_id` returns the same reply and one charge job; Low Fuel path; failed generation creates no charge; duplicate settlement feeds once |
| Testnet | talk on `pets-demo` pet: `thought` event with `cost_micro` 1000; direct feed verified; sweep when claimable |
| Cross-platform | race golden vectors (seed, inputs -> crash tick) shared with firmware; firmware runs them on the ESP32 |
| Verification | recorded attestation + signature fixtures (hashes only) for `verify.ts` |
