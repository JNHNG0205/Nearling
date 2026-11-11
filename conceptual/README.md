# Nearling: conceptual design for web app + AI brain

> **Superseded (2026-11-11).** This folder is the pre-build, pre-hybrid draft, kept for history. The brain and web as built are described in [`AI-brain architectual/`](../AI-brain%20architectual/README.md) (routes: [`08-api-reference.md`](../AI-brain%20architectual/08-api-reference.md)) and [`web-app architectual/`](../web-app%20architectual/README.md); the spec is [`CLAUDE.md`](../CLAUDE.md). Notable differences: no structured JSON tail (replies carry an emotion tag only), no browser `play` key, pairing by device QR instead of a code, care is off chain, `drizzle-orm` was not used (raw SQL migrations).

Owner: Role 2 (web + brain). Status: **draft for team review**, no code yet. Written 2026-11-08 against `CLAUDE.md` and `PLAN.md`. Where this folder disagrees with `CLAUDE.md`, `CLAUDE.md` wins until the team agrees and the change is recorded there.

## Files

| File | What is in it |
|---|---|
| [01-ecosystem-research.md](01-ecosystem-research.md) | NEAR AI Cloud (live model prices, verification, billing, STT), NEARON live state, NEAR Connect, near-api-js v7, social login, RPC and indexing, versions |
| [02-system-architecture.md](02-system-architecture.md) | Data ownership, component diagram, sign-in / chat / feed / proactive sequences, deployment, env vars |
| [03-brain-design.md](03-brain-design.md) | Brain modules, SQLite schema, chat pipeline, structured output, persona, memory + encryption, billing queue, TEE verification, proactive rules, STT, SSE, testing, logging |
| [04-web-design.md](04-web-design.md) | Routes, app structure, wallet + session key (no-popup loop), pet home, live budget, tx table, approval flow, verify drawer, sprites, device page, timeline |
| [05-api-contract.md](05-api-contract.md) | Brain routes, `packages/shared` types, pairing proposal, asks to Roles 1, 3, 4 |
| [06-track-strategy.md](06-track-strategy.md) | What judges must see for games, nfts, privacy |
| [07-plan-and-risks.md](07-plan-and-risks.md) | Day plan Nov 8 to 14, spike scripts, risks, decisions needed, spec pushback |

## The design in ten lines

1. **Stack:** Next.js 16 on Vercel; brain is one Node 22 + Hono process on Fly with SQLite; near-api-js v7 everywhere; `near-connect-hooks` for wallets.
2. **No popups in the loop:** chat goes through the brain (pet pays, brain pays gas); pet/play/sleep are signed by a browser function-call key limited to `play`.
3. **One inference per turn** on a private TEE model returns JSON: reply, sprite, mood/xp/trait deltas, facts to remember with follow-up dates.
4. **Cost is real:** tokens x live price from `/v1/model/list`, charged via `charge()`, reconciled with `/v1/billing/costs` by `inference-id`.
5. **Billing never blocks the reply:** serial charge queue over 4 brain function-call keys, retries, idempotent `usage_ref`.
6. **Every reply is verified:** attestation (fresh nonce, NVIDIA NRAS) + per-reply ECDSA signature over request and response hashes -> green "Verified in TEE" badge.
7. **Memory:** last 10 turns + summary every 20 turns + up to 30 facts, AES-256-GCM per pet, archived on transfer.
8. **Pet reaches out first:** 15 min scheduler, threshold lines free, greetings and follow-ups billed, max 3 a day, quiet at night.
9. **NFT story:** per-pet timeline (ate, earned, spent, owners) and a clear transfer story.
10. **Judge-friendly:** demo-speed contract, seeded pets in every life state, hosted demo plus one-command local run.

## Top decisions needed

See [07-plan-and-risks.md](07-plan-and-risks.md), section 4: pairing direction, testnet welcome drip, new routes, contract asks (idempotent charge, demo-speed deploy), model default, staging vs production for verification.
