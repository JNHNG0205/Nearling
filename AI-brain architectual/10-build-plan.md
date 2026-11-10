# 10. Build plan (brain), Nov 10 to 14

Format `step -> verify` (`CLAUDE.md` 2.1). Web plan is in `web-app architectual/06-build-plan.md`; both run in parallel.

## 1. What teammates can build against, and when

| Date | Ready for teammates | Who uses it |
|---|---|---|
| Nov 10 evening | Brain deployed with `/devices/hello`, pairing routes, `/pets/:petRef/state`, `/talk` (text + WAV, real model), `/care` | Hardware teammates (firmware) |
| Nov 11 | `/inbox`, `/closet`, audio replies, receipts | Firmware, web |
| Nov 12 | Race WebSocket + `packages/race` golden vectors | Firmware (C++ port of the rules) |
| Nov 12 | `/approvals`, `/wallet` | Firmware |

Until a route is live, teammates use the JSON examples in 08 as fixtures.

## 2. Day plan

| Day | Steps | Verify |
|---|---|---|
| Nov 10 | Monorepo (`pnpm`, `packages/shared` from `docs/abi`), brain skeleton, env, SQLite schema; S1/S2 spike (glm-5.3-flash vs gpt-oss-120b, inference-id, billing costs, signature on staging); `get_pet` / `get_soul` client; `/talk` text path with charge queue; pairing routes; deploy to Fly | A text talk on a `pets-demo` pet returns a reply and a `thought` event with `cost_micro` 1000; S1 numbers recorded in `CLAUDE.md` 14 |
| Nov 11 | STT (WAV, WEBM), TTS provider (ElevenLabs), retry idempotency, Low Fuel, memory + summary, care sync + evolution, closet, inbox | Same `request_id` twice = one reply, one charge; device WAV round trip; winged once |
| Nov 12 | Verification + receipts; orders (direct + simulated, then live dry quotes); feeder; race rooms + validation | Receipt shows Model verified; duplicate order notifications feed once; device vs browser race gives the same result on both |
| Nov 13 | Proactive scheduler, garden sweep, approvals + wallet (P1), ops page, rate limits and spend cap; integration with device | Proactive message arrives on device; testnet send approved on device and signed in Meteor |
| Nov 14 | Freeze, log audit (no content), README brain sections, demo support | Fresh clone runs with `.env`; README steps pass |

Cut order if late: wallet approvals (P1) -> live Intents (keep direct + simulated) -> follow-up facts -> Kokoro -> ops page. Never cut: real private inference, one charge per reply, receipt verification, pairing, Low Fuel.

## 3. Interfaces I need from others

| From | What | By |
|---|---|---|
| Role 1 | Brain FC keys added for `pets-v8` and `pets-demo`; `config.brain` = brain account; `org_id` set to our NEAR AI org | Nov 10 |
| Hardware teammates | Audio format agreement (WAV 16 kHz in, PCM/MP3 out); emotion tag -> animation list; race rules port | Nov 11 |
| Hardware teammates | Confirm pairing, talk and approval route shapes (05, 08); device secret storage; QR URLs | Nov 10 |
| Team | Answers to Q1 to Q4 (README) | Nov 10 |
