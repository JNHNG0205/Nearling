# 01. NEAR ecosystem research (web + brain view)

Researched 2026-11-08. Everything marked **live** was checked against a running endpoint today. Everything else comes from docs and still needs a spike.

---

## 1. Hackathon facts that shape the design

Source: `https://nearhackathon.com/HACKATHON.md` and `github.com/nearai/near-hackathon-prompt-examples`.

| Fact | What it means for web + brain |
|---|---|
| Deadline 2026-11-14 23:59 UTC, repo **public** by then, LICENSE file required | Add `LICENSE` (MIT). Human makes the repo public. |
| Judging: Claude Code and Codex screen every repo for **reproducibility and feature verification**, then humans decide | README "do X, see Y" must actually work. Brain must run locally with one command and a `.env`. Hosted demo is a plus. |
| Demo = public X post with video or screenshots, tagging @NEARProtocol and #NEARHackathon | Public pet page `/p/[id]` with an OpenGraph image makes the post look good. |
| One submission, choose every track that fits | We pick `games`, `nfts`, `privacy` (plus `agents`, `security` per CLAUDE.md). |
| **games**: "judged on the game loop, not the token", bonus "if players never notice the chain". Hints: agent NPCs, **social login**. The example prompt asks for "no seed phrases, no wallet popups, no gas prompts in the normal game loop" | The core loop (chat, pet, play, sleep) must run with **zero wallet popups**. See 04-web-design, section 4. |
| **nfts**: "NFTs as accounts that own money". The example prompt asks for a **history view per NFT** and a clear story of what happens on transfer | Pet timeline page (what it earned, ate, spent, who owned it). Transfer story in README. |
| **privacy**: hints "private AI, TEE, NEAR AI Cloud". The example prompt asks to **fetch the attestation report with a fresh nonce, verify it, and show a "Verified" panel** | Per-reply "Verified in TEE" badge with a drawer listing what was checked. See 03-brain-design, section 7. |
| Testnet-only projects are eligible (Intents has no testnet, we do not use Intents) | Good, we stay testnet. |

---

## 2. NEAR AI Cloud

### 2.1 Endpoints (OpenAI-compatible)

| Item | Value |
|---|---|
| Staging base URL | `https://cloud-stg-api.near.ai/v1` (CLAUDE.md choice; NEARON tops up staging orgs) |
| Production base URL | `https://cloud-api.near.ai/v1` (what the privacy track prompt uses) |
| Auth | `Authorization: Bearer <api key>`; keys live in a NEAR AI org/workspace. New keys take 5 to 10 s to activate (NEARON docs) |
| Chat | `POST /v1/chat/completions` |
| Model list with prices | `GET /v1/model/list` (**live**, public, nano-USD per token) and `GET /v1/models` (**live**, OpenAI shape, includes `supported_features`) |
| Speech-to-text | `POST /v1/audio/transcriptions`, multipart `file`, `model=openai/whisper-large-v3`, 25 MB max, returns `{ text, id: "trans-..." }` |
| Embeddings | `POST /v1/embeddings`, `Qwen/Qwen3-Embedding-0.6B` (private) |
| PII redaction | `POST /v1/privacy/redact` and `/v1/privacy/classify`, `openai/privacy-filter` (private, $0.01 / 1M) |
| Per-request cost | `POST /v1/billing/costs` body `{ requestIds: [uuid] }` returns `costNanoUsd` per id. The id is the **`inference-id` response header** of `/v1/chat/completions`, **not** `x-request-id`. Usage can take a few seconds to show up; unknown ids return 0 plus a `warning` |
| Org balance | `GET` organization balance (usage API), useful for the spend dashboard |
| Errors | `402` insufficient credits; `401` bad key; `429` with `error.type` = `rate_limit_exceeded` or `service_overloaded` (retry with backoff) |

### 2.2 Private models on staging (live, 2026-11-08)

`verifiable=true` in `/v1/model/list` means the model runs in a NEAR TEE. Prices per 1M tokens.

| Model | In | Out | Context | Features | Fit for Nearling |
|---|---|---|---|---|---|
| `openai/gpt-oss-120b` | $0.15 | $0.55 | 131k | tools, structured_outputs, reasoning | **Default** (CLAUDE.md). Reasoning tokens add cost and latency; set low reasoning effort [VERIFY S1] |
| `z-ai/glm-5.3-flash` | $0.075 | $0.25 | 1M | (not listed in features) | **Cheapest private chat model**. It is the model the E2EE docs use as their example. Strong S1 candidate |
| `Qwen/Qwen3.6-35B-A3B-FP8` | $0.17 | $1.10 | 262k | (see `/v1/models`) | CLAUDE.md alternative |
| `Qwen/Qwen3.8-27B` | $0.44 | $3.30 | 262k | | Too pricey for chat |
| `openai/whisper-large-v3` | $0.01 | $0.01 | | audio | STT for the device |
| `Qwen/Qwen3-Embedding-0.6B` | $0.01 | $0.01 | 32k | | Only if we add memory search (not MVP) |
| `openai/privacy-filter` | $0.01 | 0 | 128k | | Optional PII scrub before storing memory (P1) |

Non-private (gateway "incognito") models such as `anthropic/*`, `openai/gpt-5*`, `google/*` are **forbidden for chat** by CLAUDE.md 8.1.

Cost check for one chat turn (800 in, 100 out, no reasoning): gpt-oss-120b = $0.000175; glm-5.3-flash = $0.000085. With 150 reasoning tokens gpt-oss-120b goes to about $0.00026. All well under the $0.005 per-call cap.

### 2.3 Verification (the privacy-track centrepiece)

Source: `docs.near.ai/cloud/verification/*`, `near/agent-skills/near-ai-cloud`, `near-examples/nearai-cloud-verification-example`.

Chain of trust: **hardware attestation -> signing_address -> per-reply signature over request and response hashes.**

1. `GET /v1/attestation/report?model=<id>&signing_algo=ecdsa&nonce=<64 hex>` (API key needed, free, not billed). Returns `model_attestations[]` each with `signing_address`, `nvidia_payload`, `intel_quote`, plus gateway attestation.
2. GPU check: POST `nvidia_payload` to NVIDIA NRAS `https://nras.attestation.nvidia.com/v3/attest/gpu`; decode the JWT; check `x-nvidia-overall-att-result == true` and `eat_nonce == our nonce`.
3. CPU check: TDX quote via `dcap-qvl` or the TEE explorer `https://proof.t16z.com/`. The official example repo **skips** full TDX verification; so can we for MVP, but we must say so in the panel.
4. Per reply: hash the **exact request body bytes** and **exact response body bytes** (SHA-256). Keep `Accept-Encoding: identity` so we hash uncompressed bytes.
5. `GET /v1/signature/{chat_id}?model=<id>&signing_algo=ecdsa`. Retry on 404 for a short time (signature is cached on the node that served it).
6. `signature_kind`:
   - `provider_tee`: `text = <model_id>:<req_hash>:<resp_hash>`, signer must match a verified model attestation `signing_address`.
   - `gateway`: `text = <req_hash>:<resp_hash>`, signer must match the gateway attestation.
7. ECDSA: recover the EIP-191 signer from `text` + `signature` (e.g. `ethers.verifyMessage`), compare case-insensitively.

Implication: **the brain must not use the OpenAI SDK for chat**, because it re-serialises the body and parses the response. Use `fetch` with a body string we built and `await res.text()` before `JSON.parse`.

Open question: do `/v1/attestation/report` and `/v1/signature` work on the **staging** host the same way? [VERIFY S1]

### 2.4 End-to-end encryption (stretch)

E2EE v2: client Ed25519 key, X25519 ECDH with the attested model key, HKDF-SHA256, XChaCha20-Poly1305. Headers `X-Signing-Algo: ed25519`, `X-Client-Pub-Key`, `X-Model-Pub-Key`, `X-Encryption-Version: 2`, `x-no-aliasing: true`. Encrypts `content`, `reasoning`, `reasoning_content`, `audio.data`. With E2EE even the gateway sees only ciphertext. Models: example uses `z-ai/glm-5.3-flash`; no list published. This is a strong privacy story but is **P2**: it complicates structured output and signature hashing. Mention it in the README roadmap unless S1 shows it is trivial.

### 2.5 Staking for inference (NEAR AI side)

NEAR AI documents its own "stake NEAR, rewards pay for inference" product (credits accrue per second, 1 credit = $1, unused credits carry over). NEARON is the testnet prototype of this. Org-level endpoints exist: "get organization staking farm state" and "sync organization staking farm credits". The brain can show the org's real CREDIT balance on an ops page.

---

## 3. NEARON (live state)

`get_pool_info` on `mw-pool-1024.testnet` (**live**, 2026-11-08): `paused=false`, `fee_bps=0`, `total_staked` about 10,091 NEAR, `credit_id=mw-cloud-1024.testnet`, `farm_id=hos-e2e-0601144939.testnet`, `buffered` 1.19 NEAR. So the pool is up.

Extra methods not in CLAUDE.md that matter to the brain:
- `sync_from_farm()` (anyone): pulls new CREDIT from the farm. The hourly `sweep_credit` job may need to call this first (contract role decides).
- Top-ups can sit **pending** ("rewards not posted yet", "limit reached"). NEARON's site has `POST /api/apply-topups` to ask the sender to deliver. The brain ops page should show pending top-ups.
- NEARON's own Tamagotchi pattern uses **sub-pools** (NFT contract as holder and reward router, each pet a beneficiary bound to an org). CLAUDE.md chose Option A (plain holder) to avoid the off-chain NEP-413 binding. This is Role 1's call; noted here only so we are not surprised if judges compare.

NEAR AI error "Out of credit" appears when the org balance is used up **or a top-up is pending**. The brain must treat a 402 as "global outage", not "this pet is starving".

---

## 4. Wallet and login

### 4.1 NEAR Connect (`@hot-labs/near-connect`, npm latest 0.12.0)

- `new NearConnector({ network: "testnet", features: { signMessage: true, testnet: true }, signIn?: { contractId, methodNames }, walletConnect?, footerBranding? })`
- `connector.connect()`, `connector.disconnect()`, `connector.wallet()`, events `wallet:signIn`, `wallet:signOut`, `wallet:signInAndSignMessage`.
- Sign in **and** sign a NEP-413 message in one step: `connect({ signMessageParams: { message, recipient, nonce } })`, read `accounts[0].signedMessage`. This gives us brain login with a single popup.
- Wallet methods: `signAndSendTransaction({ receiverId, actions })`, `signAndSendTransactions({ transactions })`, `signMessage({ message, recipient, nonce })`, `getAccounts()`.
- Actions: near-api-js `actions.functionCall(...)`, `actions.addKey(...)` (recommended format) or the legacy wallet-selector JSON format.
- Wallets: HOT, Meteor, Intear, MyNearWallet, Nightly, NEAR Mobile, Unity, OKX, WalletConnect.
- Browser only. In Next.js it must live in a client component.

### 4.2 `near-connect-hooks` (npm 1.1.6)

React provider + `useNearWallet()` with `signedAccountId`, `signIn`, `signOut`, `viewFunction`, `callFunction`, `addFunctionCallKey({ publicKey, contractId, methodNames, allowance })`, `signNEP413Message`, `signAndSendTransactions`, `provider`. Testnet RPC default `https://test.rpc.fastnear.com`. Saves us a day of glue code. Recommended.

### 4.3 Email / social login (S3)

- Official NEAR docs point to **Privy** (`@peerfolio/privy-near-connect` plugs Privy into NEAR Connect, so it appears as one more wallet). Privy embedded wallets sign silently.
- Catch: Privy creates an account that is **not funded**. Minting costs 0.2 NEAR plus gas. A new social-login player cannot adopt without testnet NEAR.
- Web3Auth is the documented alternative.
- Proposal (needs team agreement): a capped **testnet welcome drip** from a team faucet account (for example 0.5 NEAR once per new account, testnet only). See 07-plan-and-risks.

### 4.4 Server-side libraries

| Library | Status | Use |
|---|---|---|
| `near-api-js` v7 (npm 7.4.0) | Official | Brain: `Account`, `JsonRpcProvider`, `FailoverRpcProvider`, `KeyPairSigner`, `MultiKeySigner`, `actions`, `verifyMessage` from `near-api-js/nep413` (checks the key is on the account) |
| `near-kit` (0.20.x) | Community | Nicer API, `RotatingKeyStore` for concurrent txs, `verifyNep413Signature`. Official docs warn it is community-maintained |

Recommendation: **near-api-js v7 in both brain and web** (one library, official, matches NEAR Connect action format). Use several function-call keys on the brain account to avoid nonce clashes (03-brain-design, section 6.4).

NEP-413 rule: the signature must come from a **full access key** on the account. `verifyMessage` with a provider checks this. Privy implicit accounts that do not exist on chain yet need a special case (public key derived from the implicit account id).

### 4.5 Meta transactions (NEP-366)

near-api-js v7: `account.createSignedMetaTransaction(...)` on the client, `relayerAccount.relayMetaTransaction(signedDelegate)` on the relayer. This is the CLAUDE.md "should-have" for gasless play. With our session-key design (04-web-design, section 4) we do not need it for MVP.

---

## 5. RPC and indexing

| Need | Option | Note |
|---|---|---|
| Testnet RPC | `https://test.rpc.fastnear.com` (**live**), `https://rpc.testnet.near.org` | Use `FailoverRpcProvider` with both |
| Per-pet history (nfts track) | NearBlocks testnet API | **v1 was retired 2026-11-05** (live error). Use `/v3` [VERIFY shape] |
| | Brain-side event tail | Brain already sees every `charge` it sends; for feeds and stakes it can read receipts of the pets contract from NearBlocks v3 and parse `EVENT_JSON:` logs |
| | Fallback | Diff `get_pet` snapshots (food went up = fed). Crude but zero dependency |

---

## 6. Versions to pin (npm latest, 2026-11-08)

`next 16.4.5` · `hono 4.13.17` · `@hot-labs/near-connect 0.12.0` · `near-connect-hooks 1.1.6` · `near-api-js 7.4.0` · `zod 4.6.7` · `drizzle-orm 0.45.4` · `better-sqlite3 13.0.3`. Pin exact versions in `package.json`; CLAUDE.md references near-connect 0.11.4 docs, 0.12.0 is current [VERIFY no breaking change].

## 7. Sources

- Hackathon rules: https://nearhackathon.com/HACKATHON.md
- Track prompts: https://github.com/nearai/near-hackathon-prompt-examples
- NEAR agent skills (near-ai-cloud, near-api-js, near-dapp, near-kit): https://github.com/near/agent-skills
- NEAR AI docs index: https://docs.near.ai/llms.txt
- Billing costs: https://docs.near.ai/api-reference/billing/get-costs-by-request-ids.md
- Response signatures: https://docs.near.ai/cloud/verification/cloud-api/response-signatures.md
- E2EE: https://docs.near.ai/cloud/guides/e2ee-chat-completions.md
- Verification example: https://github.com/near-examples/nearai-cloud-verification-example
- NEARON docs: https://stg.nearon.dev/#/docs/use-cases
- NEAR Connect README: https://unpkg.com/@hot-labs/near-connect@0.11.4/README.md
- Privy on NEAR: https://docs.near.org/web3-apps/tutorials/privy
