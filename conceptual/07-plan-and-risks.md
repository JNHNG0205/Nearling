# 07. Role 2 plan, spikes, risks and open questions

Today is 2026-11-08. The CLAUDE.md timeline started Nov 7 with spikes S1 to S3; we are one day behind on those, so spikes and the first chat happen together today.

## 1. Day plan (Role 2: web + brain)

Format: `step -> verify: check` (CLAUDE.md 2.1).

| Day | Brain | Web | Verify |
|---|---|---|---|
| **Nov 8** | S1 + S2 script: one chat on gpt-oss-120b and glm-5.3-flash on staging, read `inference-id`, call `/billing/costs`, fetch `/signature`, attestation report | Next.js skeleton, providers, NEAR Connect login on testnet (S3) | p50 latency and cost per reply recorded in CLAUDE.md section 14; testnet login works in 2 wallets |
| Nov 9 | Hono skeleton, config, db schema, `/session`, `/state`, `/chat` (no billing yet), persona v1 | `/adopt` mint + `/pet/[id]` with StatBars, ChatBox | Chat from web returns a private-model reply for a minted pet |
| Nov 10 | Billing queue + brain FC keys + `charge`; memory (encrypted) + facts; structured output | BudgetCard + live ticker, cost chip, Feed + Stake dialogs, session-key `play` | `thought` events on chain; budget drops in UI after chat; Pet click has no popup |
| Nov 11 | Scheduler: proactive rules, `sweep_credit`, inbox + SSE; STT route | Inbox, `/p/[id]` + OG image, `/pet/[id]/device` (pair + AddKey) | Proactive message appears after forcing a trigger; device can chat by voice via brain |
| Nov 12 | `verify.ts` (attestation + per-reply signature), timeline tail, spend caps | TEE badge + drawer, `/privacy`, ApprovalBanner, timeline, shop (P1) | Green badge on a real reply; approval flow end to end with Roles 1 and 4 |
| Nov 13 | Deploy brain (Fly) + web (Vercel), seed pets, reconcile job | Polish, empty/error states, README screenshots | Fresh-browser run of README steps passes |
| Nov 14 | Freeze, logs check (no content), demo video support | Demo video | Submit checklist (human submits) |

Cut order if late: shop -> timeline tail (use diff fallback) -> SSE (poll instead) -> TDX link -> mini-game. Never cut: real inference, real billing, verification badge (it is cheap and it is the privacy track).

## 2. Spike scripts (Nov 8)

**S1/S2 `brain/scripts/spike-nearai.ts`**
1. Build body string for a 800-token persona + short user message; POST to staging with `Accept-Encoding: identity`, `x-no-aliasing: true`.
2. Record latency, `usage`, `inference-id` header, response `id`.
3. Repeat 20 times per model -> p50, p95, mean tokens (including reasoning tokens).
4. After 10 s: `POST /billing/costs` with the ids -> compare with estimate.
5. `GET /attestation/report` with nonce; `GET /signature/{id}`; verify signature.
6. Try `response_format: json_schema` on both models.
Record: model choice, cost per reply, whether staging supports attestation and signatures.

**S3 `web/` login page**
1. NEAR Connect testnet, `connect({ signMessageParams })`, send to a local verify script.
2. Test HOT, Meteor, MyNearWallet; note which support testnet + signMessage.
3. Test `addFunctionCallKey` and a session-key `play` call against a hello contract.
4. Try Privy plugin; note account funding behaviour.

## 3. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Staging does not expose attestation / signatures | Privacy badge breaks | Verify against production host for attestation only (free, not billed), or run chat on production with our $10 builder credit; decide in S1 |
| gpt-oss-120b reasoning makes replies slow (> 3 s) | Device feels laggy | Low reasoning effort; switch default to glm-5.3-flash if it is private and fast |
| Structured output unreliable | Deltas lost | Zod parse + fallback to plain reply with zero deltas; deltas are a bonus |
| Brain nonce clashes under load | Charges fail | 4 FC keys, serial worker per key |
| NEARON top-up pending -> 402 "Out of credit" | All pets mute | Global canned reply + team-funded fallback key with a hard cap |
| Contract interface changes late | Web breaks | All method names, gas and deposits in `lib/contract.ts` and `near.ts`; shared types |
| Judges cannot wait days to see hunger | Weak demo of core loop | Demo-speed contract (ask C6) + pre-seeded pets in each life state |
| Wallet gas cap below 400 Tgas for stake | Stake fails in some wallets | Test in S3 with 2 wallets; document the working wallet in README |
| One person owns all of web + brain | Overload | Use `near-connect-hooks` (no custom wallet glue), SQLite (no infra), cut list above |

## 4. Decisions I need from the team

1. **Pairing direction** (05, section 3): device shows the code. OK?
2. **Testnet welcome drip** for social-login users: brain sends 0.5 testnet NEAR once per new account from a team faucet account, capped at e.g. 50 accounts/day. Allowed under the rule "testnet only"? It moves testnet NEAR only, but it is a new outward-facing action, so it needs explicit agreement.
3. **New brain routes** in 05, section 1 (stream, timeline, thoughts, verification, attestation, timezone).
4. **Contract asks C1 to C9** (05, section 4), mainly C2 (idempotent charge) and C6 (demo-speed deploy).
5. **Model default**: keep gpt-oss-120b or switch to glm-5.3-flash after S1 numbers.
6. **Staging vs production NEAR AI** for the verification calls, if staging lacks them.

## 5. Spec pushback (CLAUDE.md 2.1 "if a simpler design meets the same scope, say so")

- **Session key instead of NEP-366 relayer** for no-popup play. Same player experience, no relayer service to run. Relayer stays "should-have" for the device only.
- **No vector memory.** Summary + 30 facts with follow-up dates gives the "How did your exam go?" moment at zero extra cost.
- **SQLite, not Postgres.** One brain process; judges run it with no Docker.
- **SSE for web, polling for device.** No WebSocket server, no web push for MVP (CLAUDE.md lists web push as TBD; propose cutting it).
- **Single inference call per turn** with JSON output (resolves the CLAUDE.md 8.3 TBD).
