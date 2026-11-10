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

- `/ops` page (basic auth) for the team: spend today, charge queue, order states, feeder balance, attestation, NEARON claimable, NEAR AI org balance.
- Alerts are log lines with `level=alert` (Fly log tail during the demo): charge failed > 10 min, feeder < 2 NEAR, 402 from NEAR AI, attestation refresh failing.
- Contract upgrade checklist: new `PETS_CONTRACT`, add brain FC keys for it, restart brain; `pet_ref` includes the contract so old rows stay valid.

## 4. Testing

| Level | What |
|---|---|
| Unit (vitest) | prompt builder (safety core first, Soul wrapped), emotion tag parse, fuel math and `display_state`, order state machine, care mood and evolution once, approval state machine, log deny-list, race `simulate` golden vectors |
| Integration (`MOCK_AI=1`) | talk retry with same `request_id` returns the same reply and one charge job; Low Fuel path; failed generation creates no charge; duplicate settlement feeds once |
| Testnet | talk on `pets-demo` pet: `thought` event with `cost_micro` 1000; direct feed verified; sweep when claimable |
| Cross-platform | race golden vectors (seed, inputs -> crash tick) shared with firmware; firmware runs them on the ESP32 |
| Verification | recorded attestation + signature fixtures (hashes only) for `verify.ts` |
