# 03. Brain service: deep design

Node 22, TypeScript strict, Hono, SQLite (better-sqlite3 + drizzle), near-api-js v7, zod. One process, one machine.

---

## 1. Module map

Matches PLAN.md file names, with what each module owns and exports.

| File | Owns | Main exports |
|---|---|---|
| `server.ts` | Hono app, CORS, error mapping, route wiring, boot (migrations, price load, scheduler start) | `app` |
| `config.ts` | Parse env with zod, fail fast on boot | `cfg` |
| `db.ts` + `schema.ts` | Drizzle schema and migrations (section 3) | `db` |
| `auth.ts` | NEP-413 nonce + verify, JWT sessions, device token check, `requireOwner(petId)` middleware | `authRoutes`, `requireOwner` |
| `near.ts` | RPC provider (failover), `getPet` with 5 s cache, `getConfig`, brain `Account` with multi-key signer | `near.getPet`, `near.call` |
| `nearai.ts` | Raw `fetch` client: chat (keeps exact bytes), STT, model prices, billing costs, signature, attestation | `nearai.chat`, `nearai.transcribe`, ... |
| `persona.ts` | Build the system prompt from pet state (pure function, unit tested) | `buildSystemPrompt(pet, ctx)` |
| `memory.ts` | Encrypted turns, summary, facts; summarise every 20 turns | `loadContext`, `appendTurn`, `maybeSummarise` |
| `chat.ts` | The chat pipeline (section 4) | `handleChat` |
| `billing.ts` | Cost calc, `thoughts` ledger, serial charge queue per key, retries, reconcile | `billThought`, `startBillingWorker` |
| `verify.ts` | Attestation cache, per-reply signature verification | `verifyThought`, `attestationStatus` |
| `scheduler.ts` | 15 min proactive loop, hourly `sweep_credit`, billing reconcile, event tail | `startScheduler` |
| `proactive.ts` | Trigger rules and canned lines (pure, unit tested) | `evaluateTriggers` |
| `inbox.ts` | Inbox rows, cursors, SSE fan-out | `pushInbox`, `bus` |
| `stt.ts` | WAV validation and transcription | `transcribe` |
| `limits.ts` | Token buckets, daily counters, global spend cap | `checkThoughtAllowed` |
| `crypto.ts` | AES-256-GCM with HKDF per-pet keys | `seal`, `open` |
| `log.ts` | Structured logger that refuses content fields | `log` |
| `pairing.ts`, `actions.ts` | **Role 4 owns**; brain hosts them | see 05-api-contract |

Keep everything in plain functions. No DI framework, no classes unless near-api-js needs one.

---

## 2. Request lifecycle and auth

| Caller | Credential | How it is checked |
|---|---|---|
| Web owner | `Authorization: Bearer <session JWT>` | HS256 JWT `{ sub: accountId, iat, exp: 7 d }`. For pet routes also `pet.owner === sub` (fresh `get_pet`, so a transfer instantly revokes access) |
| Device | `Authorization: Device <token>` | Random 32 bytes, stored as SHA-256 hash in `devices`. Row binds `pet_id` + `owner_account`. Rejected if `pet.owner !== owner_account` (transfer) or revoked |
| Public | none | Only `GET /pets/:id/state`, `GET /pets/:id/timeline`, `GET /attestation` |

Session flow details:
- `GET /auth/nonce` returns 32 random bytes, stored in `auth_nonces` with 5 min expiry, single use.
- Message text is fixed: `"Sign in to Nearling"`, recipient `"nearling"` (constant shared in `packages/shared`).
- `POST /session` calls `verifyMessage` from `near-api-js/nep413` with a provider, which also checks the public key is a full access key of `accountId`.
- Privy implicit accounts (64 hex chars) that are not on chain yet: accept if `publicKey` derives to the account id. [VERIFY S3]

---

## 3. Data model (SQLite)

Encrypted columns are marked `enc` (AES-256-GCM blob: `iv | ciphertext | tag`).

```
auth_nonces   (nonce PK, expires_at)
devices       (id PK, pet_id, owner_account, token_hash UNIQUE, device_pk, created_at, revoked_at)
pairing_codes (code PK, device_pk, poll_secret_hash, pet_id NULL, owner NULL, expires_at)   -- Role 4

pet_owners    (pet_id PK, owner_account, nickname enc NULL, timezone, since)   -- detects transfers
turns         (id PK, pet_id, owner_account, role, content enc, channel 'web'|'device', created_at)
memory        (pet_id + owner_account PK, summary enc, facts enc, turns_since_summary, updated_at, archived_at NULL)

thoughts      (id PK uuid, pet_id, kind 'chat'|'greeting'|'summary'|'stt',
               model, inference_id, chat_id, prompt_tokens, completion_tokens, reasoning_tokens,
               est_cost_nano, billed_cost_nano NULL,
               charge_micro, charge_status 'queued'|'sent'|'settled'|'failed'|'skipped',
               charge_tx NULL, charge_attempts, charged_micro NULL,
               verify_status 'pending'|'verified'|'unverified'|'error', verify_detail json NULL,
               latency_ms, created_at)

inbox         (id PK autoinc, pet_id, owner_account, trigger, text enc, thought_id NULL, created_at, read_at NULL)
proactive_log (pet_id, day, count, last_triggers json)          -- max 3/day, de-dupe thresholds
spend_daily   (day PK, total_nano)                               -- global cap
pet_events    (id PK, pet_id, kind, actor, amount, tx_hash, block_ts, raw json)   -- timeline
attestations  (id PK, model, nonce, fetched_at, ok, signing_addresses json, gateway_address, detail json)
```

Why SQLite: one process, a few hundred pets, zero ops, judges can run it locally with no Docker. Put the file on the Fly volume. Back it up with a daily copy (it holds memories).

---

## 4. Chat pipeline (`chat.ts`)

```
handleChat(petId, caller, input: {text} | {audio}, channel)
 1. auth           requireOwner or device token
 2. pet            pet = near.getPet(petId)          // settled view, includes life_state
 3. transfer check if pet.owner != pet_owners.owner -> archive memory, reset nickname, revoke devices (section 5.4)
 4. starving?      life_state in {Starving, Dormant} -> canned reply, sprite "sleeping"/"dormant", cost 0, no AI call
 5. limits         1 thought / 3 s / pet, 300 / day / pet, global daily cap, energy < 15 -> sleepy short mode
 6. audio?         stt.transcribe(wav) -> text (billed as its own thought, kind 'stt')
 7. context        memory.loadContext(petId, owner) -> { summary, facts, last10 }
 8. prompt         system = persona.buildSystemPrompt(pet, { nickname, facts, summary, channel, localTime })
                   messages = [system, ...last10, { role: user, content: text }]
 9. inference      nearai.chat({ model, messages, response_format: json_schema(ThoughtOut), max_tokens: 300 })
                   -> { rawReq, rawRes, inferenceId, chatId, usage }
10. parse          zod parse ThoughtOut; on failure: one retry without schema, treat whole text as reply, zero deltas
11. clamp          brain-side clamps mirror contract caps (section 4.3)
12. store          memory.appendTurn(user), appendTurn(pet); facts upsert; maybeSummarise()
13. ledger         thoughts row (est cost from usage x price table)
14. respond        { reply, sprite_state, cost_estimate_usd, thought_id, stats_preview }
15. async          billing.billThought(thought) ; verify.verifyThought(thought, rawReq, rawRes)
                   rawReq/rawRes are dropped from memory after hashing; never stored
```

Latency target (S1: p50 < 3 s): steps 2 to 8 under 300 ms (cached `get_pet`, local SQLite), step 9 is the rest. Non-streaming keeps the signature check and device simple. If S1 shows p50 > 3 s, stream to the **web only** and verify the `gateway`-kind signature.

### 4.1 Structured output (`ThoughtOut`)

One call returns the reply and the game deltas, so a thought costs one inference (CLAUDE.md 8.3 step 4 TBD: **choose single call with JSON output**). gpt-oss-120b lists `structured_outputs` on staging.

```ts
const ThoughtOut = z.object({
  reply: z.string().max(400),
  sprite_state: z.enum(["happy","talking","eating","hungry","sleepy","sad","excited","thinking"]),
  mood_delta: z.number().int().min(-10).max(10),
  xp_gain: z.number().int().min(0).max(5),
  trait_deltas: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int()]),  // playful, curious, calm, sassy, kind; each -1..1
  remember: z.array(z.object({
    fact: z.string().max(120),          // "Owner has a maths exam"
    follow_up_on: z.string().nullable() // ISO date, "2026-11-12", enables "How did your exam go?"
  })).max(2),
  nickname: z.string().max(24).nullable()  // owner told the pet what to call them
});
```

### 4.2 Prompt design (`persona.ts`)

Order matters for prompt caching (NEAR AI has a prompt caching guide; cache-read price is 10x cheaper). Put stable text first:

1. **Fixed core** (identical for every pet, cacheable): who Nearling is, kid-friendly rules, refuse harmful requests in character, no financial advice, never claim to be a real person, output JSON schema rules, "you pay for every thought with your own budget; you know this and can joke about it".
2. **Pet sheet** (changes slowly): name, stage, traits as words ("very playful, a bit sassy"), items worn, owner nickname.
3. **Now** (changes every turn): life state, mood, energy, fullness in words ("your tummy is about half full, about 2 days of food"), local time of owner, channel rule ("device: max 2 sentences" / "web: max 4").
4. **Memory**: summary paragraph, up to 10 facts (due follow-ups first).
5. Last 10 turns, then the user message.

Stage changes voice: Egg = only "...*wobble*" style lines (cheap, short), Baby = simple words, Teen = cheeky, Adult = full sentences. Life state changes behaviour per CLAUDE.md 5.3 (Hungry mentions food, Sleepy short).

`persona_hash` on chain = sha256 of part 1 plus part 2 template version. Who writes it is an open question for Role 1 (see 07).

### 4.3 Clamping (defence in depth)

Brain clamps before calling `charge`, contract clamps again. Brain-side extra rules:
- `trait_deltas` each in -1..1 per turn (contract allows ±2 per day).
- `xp_gain` 0 if the user message is under 3 characters or a repeat of the last one (stops "a a a a" farming).
- `mood_delta` positive only if the turn was friendly; the model decides, we cap.

### 4.4 Safety

- Fixed core prompt has the refusal rules; the pet refuses in character ("Nope! That's not a Nearling thing.").
- Optional pre-check with `openai/privacy-filter` classify on the user text to avoid storing emails or phone numbers in memory (P1, $0.01 per 1M tokens, private).
- Never log `text`, `reply`, facts, summary. `log.ts` drops these keys if passed by mistake.

---

## 5. Memory (`memory.ts`)

### 5.1 Shape

Per `(pet_id, owner_account)`:
- `turns`: append only, last 10 loaded for the prompt.
- `summary`: one paragraph, rewritten every 20 turns by a summary thought (kind `summary`, billed to the pet, shown in UI as "Nearling is dreaming about your chats").
- `facts`: up to 30 short facts with optional `follow_up_on`. Upsert by normalised text. Oldest without follow-up drops first.

No vector DB for MVP. Thirty facts plus a summary fit in about 600 tokens. If memory grows, add `Qwen/Qwen3-Embedding-0.6B` (private) later.

### 5.2 Encryption

`key_pet = HKDF-SHA256(MEMORY_MASTER_KEY, salt = "nearling-mem-v1", info = petId)`; AES-256-GCM, random 12-byte IV per row. Node built-in `crypto`, no dependency. Honest limit stays in README: the brain holds the master key, so the brain operator can read memories.

### 5.3 Privacy upgrade path (README roadmap)

- Run the brain step inside OutLayer or a TEE so the operator cannot read memories.
- E2EE to the model (01, section 2.4) so even the NEAR AI gateway sees ciphertext.

### 5.4 Transfer handling (nfts track story)

On any request or scheduler pass, if `get_pet.owner !== pet_owners.owner_account`:
1. Set `memory.archived_at` for the old owner (kept encrypted, never shown to the new owner).
2. Revoke every `devices` row for the pet.
3. Reset nickname, start a fresh memory row.
4. Inbox for the new owner: "Hi! I'm {name}. I don't know you yet, but I remember being loved."
5. Timeline event `owner_changed`.

---

## 6. Billing (`billing.ts`)

### 6.1 Cost of a thought

```
est_cost_nano = prompt_tokens * in_price_nano + completion_tokens * out_price_nano
                (cached prompt tokens at cache price if usage reports them)
charge_micro  = ceil(est_cost_nano / 1000)       // contract unit is micro-USD
```

Prices come from `GET /v1/model/list` at boot and every hour (nano-USD per token, exact integers, **live**). No hard-coded prices.

### 6.2 Reconcile with the real bill

The scheduler calls `POST /v1/billing/costs` with batches of `inference_id` older than 30 s, stores `billed_cost_nano`. If `billed > est` by more than 1 micro-USD, enqueue a capped correction. Since contract `credit()` only adds, over-charges are corrected with `credit`; under-charges are small and simply logged (we do not double-charge pets). Show "estimated vs billed" totals on an ops page; it is a nice honesty point for judges.

### 6.3 Charge queue

- `thoughts.charge_status = queued` on insert. A worker picks queued rows in order.
- Calls `charge(pet_id, charge_micro, usage_ref = inference_id, trait_deltas, xp_gain, mood_delta)`, gas 30 Tgas [VERIFY actual], deposit 0.
- On success: parse the `thought` event from the receipt logs for `charged_micro` (what the contract actually took after clamps), store `charge_tx`, `settled`, SSE `thought_settled`.
- On failure: retry with backoff (1 s, 5 s, 30 s, 5 min), then `failed` and alert in logs. The reply was already delivered (CLAUDE.md 8.3 step 5: "mark unbilled, retry later").
- Idempotency: the contract should reject a repeated `usage_ref` [ask Role 1]. Without it, a retry after a timeout could double-charge.

### 6.4 Brain keys and nonces

One NEAR account signs many concurrent transactions. Same access key in parallel = nonce clashes.

- Give the brain account **N = 4 function-call access keys**, receiver = pets contract, methods = `charge`, `credit`, `sweep_credit`. No full access key on the server. A leaked brain key can then only do capped charges; it cannot move the brain account's NEAR.
- One worker per key, each strictly serial. near-api-js v7 `MultiKeySigner` may do this rotation for us [VERIFY]; otherwise four `Account` objects with one `KeyPairSigner` each.
- Gas allowance on each key: 5 NEAR on testnet, top up from the deploy script.

### 6.5 Spend guards

- Per pet: 1 thought / 3 s, 300 / day (CLAUDE.md 8.5).
- Global: `spend_daily.total_nano` checked before each inference; above `GLOBAL_DAILY_SPEND_CAP_USD` the brain answers with a canned "my brain is resting" line and the web shows a banner. This protects team funds even if the contract has budget.
- 402 from NEAR AI = org out of credit or top-up pending: same canned line, ops alert, **do not** mark the pet starving.

---

## 7. Verification (`verify.ts`): privacy-track feature

### 7.1 Attestation cache

Every 30 min and at boot, per chat model:
1. `nonce = randomBytes(32).hex`
2. `GET /attestation/report?model=..&signing_algo=ecdsa&nonce=..`
3. Check the nonce is echoed in each report.
4. For each `model_attestations[i]`: POST `nvidia_payload` to NRAS, decode JWT, require `x-nvidia-overall-att-result` true and `eat_nonce == nonce`.
5. Store verified `signing_address` list and the gateway `signing_address`.
6. TDX: record the `intel_quote` and give a link to `proof.t16z.com`; full `dcap-qvl` check is P1 [VERIFY a JS/WASM build exists].

### 7.2 Per reply

```
req_hash  = sha256(rawReqBytes)       // the exact string we POSTed
resp_hash = sha256(rawResBytes)       // res.text() before JSON.parse, Accept-Encoding: identity
sig       = GET /signature/{chat_id}?model=..&signing_algo=ecdsa   (retry 404 up to 10 x 1 s)
kind      = sig.signature_kind
text_ok   = provider_tee: text == `${model}:${req_hash}:${resp_hash}` ; gateway: text == `${req_hash}:${resp_hash}`
signer    = ethers.verifyMessage(sig.text, sig.signature)
signer_ok = provider_tee: signer in verified model addresses (exactly one match) ; gateway: signer == gateway address
```

Store `verify_status` and a `verify_detail` JSON with: model, kind, hashes, signer, attestation id, NRAS result, time. No content. SSE `thought_verified` to the web.

Use `x-no-aliasing: true` on chat requests so the model id in the signed text is the canonical one.

### 7.3 What the UI shows (see 04, section 6.4)

Badge on each pet bubble: green "Verified in TEE", grey "Verifying...", amber "Not verified" (with reason). Drawer lists each check with pass/fail. Global `/privacy` page shows the latest attestation, NRAS verdict and what we do **not** verify yet (TDX quote, gateway TLS binding). Saying what we skip is exactly what the docs ask for.

---

## 8. Proactive messages (`proactive.ts` + `scheduler.ts`)

Every 15 min, for each pet with a known owner (enumerate `nft_tokens` from the contract, cache list 15 min):

| Trigger | Condition (from settled `get_pet` + DB) | Line | Billed? |
|---|---|---|---|
| `fullness_40` | fullness crossed below 40 since last pass | canned, per stage | free |
| `fullness_15` | crossed below 15 | canned | free |
| `lonely` | mood < 30 | canned | free |
| `stage_up` | stage > last seen stage | canned + confetti flag | free |
| `missed_you` | no owner turn for 24 h | inference, uses memory | billed |
| `morning` | owner local 07:00 to 10:00, once per day, pet not starving | inference | billed |
| `follow_up` | a fact with `follow_up_on == today` (owner tz) | inference ("How did your exam go?") | billed |
| `dormant` / `revived` | life state change | canned | free |

Rules: max 3 per pet per UTC day (CLAUDE.md 5.5); one trigger per pass; threshold triggers fire once per crossing (store last values in `proactive_log.last_triggers`); no billed pings at night (owner tz, 22:00 to 07:00); billed pings skipped if fullness < 15 (do not burn the last food on a greeting).

Other jobs on the same scheduler:
- Hourly: `sweep_credit()` (and `sync_from_farm` first if Role 1 says so).
- Every minute: billing worker health, reconcile batch.
- Every 30 s: event tail for the timeline (NearBlocks v3 or receipts) [VERIFY].
- Every 30 min: attestation refresh.

Use plain `setInterval` with a guard against overlap. No cron library needed.

---

## 9. Speech-to-text (`stt.ts`)

- Device posts multipart `audio` (16 kHz mono WAV, max 10 s = about 320 KB).
- Validate RIFF header, duration ≤ 12 s, size ≤ 1 MB.
- `POST /v1/audio/transcriptions` with `model=openai/whisper-large-v3`, `language=en` [VERIFY staging supports it].
- Cost: whisper is priced per token ($0.01 / 1M) and negligible; record as a `stt` thought, include it in the same `charge` as the reply (sum) to save a transaction.
- Empty transcript: reply "Hm? I didn't catch that" (canned, free).

---

## 10. SSE and realtime

`GET /pets/:id/stream` (session) using Hono `streamSSE`. Events: `state` (every 10 s or on change), `inbox`, `thought_settled`, `thought_verified`, `action_pending` (from Role 4's actions feed). Heartbeat every 20 s. An in-process `EventEmitter` bus is enough for one machine. Devices keep polling (simpler on ESP32).

---

## 11. Errors returned to clients

```json
{ "error": { "code": "pet_sleeping" | "rate_limited" | "brain_resting" | "not_owner" | "bad_audio" | "upstream", "message": "...", "retry_after_s": 3 } }
```

Canned in-character replies are **200** responses with `canned: true`, not errors, so the device always has something to show.

---

## 12. Testing

| Layer | Test |
|---|---|
| `persona.ts`, `proactive.ts`, clamps, cost calc | Pure unit tests (vitest) |
| `chat.ts` | `MOCK_AI=1` fake NEAR AI that returns fixed bodies; assert ledger rows, clamps, canned paths |
| `verify.ts` | Recorded real attestation + signature fixtures from S1 (hashes only, no content) |
| `billing.ts` | Fake `near.call` that fails twice then succeeds; assert one settled charge, no double charge |
| End to end | Script: mint on testnet, chat 3 times, assert `thought` events on chain and food went down |

---

## 13. Logging (CLAUDE.md rule 4)

Log lines carry: `pet_id`, `thought_id`, `inference_id`, `model`, tokens, `cost_nano`, `latency_ms`, `charge_status`, `verify_status`, `tx_hash`. Never `text`, `reply`, `facts`, `summary`, `nickname`, audio. `log.ts` has a deny-list and a unit test for it.
