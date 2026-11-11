# Contract integration plan (web + brain)

Status 2026-11-10, branch `zhijian` (contracts merged from `main`). Owner: Role 2, with the actions marked **Contract** done by the contract teammate. Interface: `docs/CONTRACT_INTERFACE.md`; contract source: `contract/`, `shirts/`.

## 1. Where integration stands

**Statically checked against the contract source (all match):**

| Call site | Contract | Result |
|---|---|---|
| Brain `charge(pet_id, cost_micro_usd, usage_ref, trait_deltas, xp_gain, mood_delta)` | `contract/src/budget.rs` `charge` | Argument names and types match; `thought` event data `{ pet_id, cost_micro, usage_ref, source }` in a `data` array, parsed correctly |
| Brain feeder `feed(pet_id)` + direct-tx check of the `fed` event | `budget.rs` `feed` | Match; `fed` carries `pet_id`, `by`, `amount` (closes the fuel engineer's [VERIFY]) |
| Brain `sweep_credit()` at 600 Tgas | `stake.rs` (`MIN_PREPAID_SWEEP` 600 Tgas) | Match |
| Brain views `get_pet`, `get_soul`, `config`, `nft_tokens` | `lib.rs`, `soul.rs` | Match (live reads work on `pets-v8` and `pets-demo`) |
| Web `nft_mint_pet(name, soul?)`, `set_soul`, `feed`, `stake`, `unstake(amount U128 string)`, `withdraw`, `nft_transfer` | `lib.rs`, `soul.rs`, `stake.rs` | Match; stake/unstake/withdraw at 450 Tgas (minimum 430) |
| Web `shirts.claim()` 0.01 NEAR, `nft_tokens_for_owner` | `shirts/src/lib.rs` | Match (live read works) |
| Web event parsing (`soul_updated` version, `staked`, `unstake_withdrawn`) | `events.rs` | Match |

**Never run end to end** (no keys, no browser): any brain write (`charge`, `feed`, `sweep_credit`) and any wallet transaction from the web.

## 2. Gaps found

| # | Gap | Impact | Fix | Owner |
|---|---|---|---|---|
| G1 | `config.org_id` is the placeholder `00000000-0000-0000-0000-000000000000` on both contracts | Brain Garden sweeps send CREDIT nowhere | `set_config` with our NEAR AI staging org id (the org that owns `NEARAI_API_KEY`) on `pets-v8` and `pets-demo` | **Contract** (admin `nearling.testnet`), Role 2 supplies the UUID |
| G2 | `brain.nearling.testnet` has only one **full access** key; the design wants function-call keys on the server | Security model (brain can only make capped charges) not real yet | Add function-call keys: receiver `pets-v8.nearling.testnet`, methods `charge`, `credit`, `sweep_credit`; and a separate set for `pets-demo.nearling.testnet`. 2 to 4 keys per contract | **Contract** (holds the brain account), keys handed to Role 2 privately |
| G3 | Brain uses one key pool (`BRAIN_KEYS`) for both contracts, but a function-call key works for one receiver only | Charges and sweeps on `pets-demo` pets fail | Config per contract: `BRAIN_KEYS_PETS=` and `BRAIN_KEYS_DEMO=`; signer picks the lane set by receiver | Role 2 |
| G4 | Charge worker and garden sweep each build their own signer from the same keys | Nonce clashes between the two jobs | One shared brain signer per contract in `Deps`, used by both | Role 2 |
| G5 | `feeder.nearling.testnet` has no keys | Simulated and live Feed orders wait in `settled` forever | Add one full access key (feeding attaches NEAR, which function-call keys cannot), fund with 5 to 20 testnet NEAR; set `FEEDER_ACCOUNT_ID` / `FEEDER_KEY` | **Contract** (or whoever owns `nearling.testnet`) |
| G6 | `.env` has empty `BRAIN_ACCOUNT_ID`, `BRAIN_KEYS`, `SESSION_JWT_SECRET`, `MEMORY_MASTER_KEY` | Charges queue; dev uses generated secrets in `brain/data/dev-secrets.env` | Fill after G2 and G5; generate real secrets for the deployed brain | Role 2 |
| G7 | Timeline is a `get_pet` snapshot diff: no payer, no tx hash | Weaker NFT history for the `nfts` track | Read `EVENT_JSON` logs (`fed.by`, `staked`, `soul_updated`, `thought`) from NearBlocks v3 receipts for the two contracts; keep the diff as fallback | Role 2 (P1) |
| G8 | 19 contract error codes have no web copy | Rare paths show the generic error | Add copy for the ones the web can hit (`E_STORAGE`, `E_NO_STAKE` variants); others are device, admin or approval paths | Role 2 (P2) |
| G9 | README "To be filled by Role 2" sections | Judges read the README first | Fill web + brain sections after the end-to-end run | Role 2 |

## 3. Plan

Each step: `action -> verify`.

**Step 1. Chain configuration (Contract teammate, about 30 min)**
1. `set_config` on both contracts with `org_id` = our staging org UUID -> `config()` shows it.
2. Add function-call keys on `brain.nearling.testnet` for each contract (G2) -> `view_access_key_list` shows `FC->pets-v8...` and `FC->pets-demo...`.
3. Give `feeder.nearling.testnet` a full access key and 10 testnet NEAR (G5) -> balance visible.
4. Hand keys over privately (never in git or chat logs).

**Step 2. Brain code (Role 2, about 2 h)**
1. G3 + G4: per-contract brain key sets and one shared signer per contract in `Deps`; charge worker, garden and any future brain call use it -> unit tests: a `pets-demo` charge uses the demo lane; charge and sweep never share a nonce lane concurrently.
2. Fill `.env` (G6) -> brain boots without "signer not configured" warnings.

**Step 3. End-to-end on testnet (Role 2 with Meteor, about 2 h)**, in this order, on `pets-demo` first (cheap, fast states), then `pets-v8`:

| # | Action | Expect |
|---|---|---|
| 1 | Connect Meteor on `/adopt`, sign in | `POST /session` 200; session stored |
| 2 | Mint on demo speed (0.105 NEAR) | token id read back; egg hatch plays; `/pet/[petRef]` shows about 1 thought (demo starter food) |
| 3 | Talk (text) | Reply on a private model; `charge_job` settles; `thought` event with `cost_micro` 1000 on chain; fuel chip shows the tx |
| 4 | Retry the same request (kill the network mid-request) | One turn, one `thought` event |
| 5 | Open the receipt | Model verified or Gateway verified (or an honest Unverified reason) |
| 6 | Wait for Low Fuel | Talk replaced by Feed; inbox "out of fuel" line |
| 7 | Feed 0.1 NEAR (direct) on `/feed` | `fed` event; order `fed`; fuel rises; "Yum" inbox line once |
| 8 | Simulated pay | Feeder `feed` tx; order `fed`; labelled "simulated" |
| 9 | Edit Soul | `soul_updated` v+1; next receipt shows the new version |
| 10 | Claim shirt, equip | `nft_tokens_for_owner` shows it; `/closet` equipped |
| 11 | Stake 1 NEAR on a `pets-v8` pet (Garden) | `staked`; credit ticker grows; unstake shows the unlock epoch |
| 12 | Sweep (when pool `claimable` ≥ 0.01 CREDIT) | `credit_swept`; NEAR AI org balance rises |
| 13 | Device pairing (with the hardware team) | Hatch & Pair QR, confirm on device, `/state` shows paired |

Record each tx hash in `CLAUDE.md` 14 (new "Role 2 integration" table), fix and update this file when something differs (`CLAUDE.md` rule 7).

**Step 4. Docs (Role 2, about 1 h)**: README web + brain sections (G9), `CLAUDE.md` 8.1 model choice after the S1 spike, close G7/G8 if time allows.

## 4. Risks

- **Contract redeploy (`pets-vN`)**: new contract id in `.env` and new brain function-call keys (G2); `pet_ref` includes the contract, so brain data stays valid.
- **NEAR AI staging may not expose attestation or signatures**: receipts then say Unverified with the reason; run `brain/scripts/spike-nearai.ts` first.
- **Sweep threshold**: 0.01 CREDIT needs about 15 NEAR-days of stake across pets; the demo may only show accrual, not a real sweep.

## 5. Results (2026-11-11, chain writes on testnet)

Script: `scripts/e2e-chain.ts` (run with `brain/node_modules/.bin/tsx scripts/e2e-chain.ts`, add `--garden` for the `pets-v8` part). Accounts were created with the public testnet faucet helper (10 NEAR each): player `nearling-e2e-s1zspx.testnet`, feeder `nearling-feeder-s1zspx.testnet`. Their keys live only in the gitignored `brain/data/testnet-accounts.env` (chmod 600) of the main checkout. Every event is parsed with the clients' own code: `web/lib/chain.ts` `parseEvents` / `eventData` / `returnValue` on the raw RPC `tx` result, and the brain's `createRpc().txStatus` plus `verifyFeedTx` (`fuel/orders.ts`). Total spent about 1.7 testnet NEAR (1 NEAR of it still staked, see 5.2).

Use `https://test.rpc.fastnear.com`: `rpc.testnet.near.org` now answers HTTP 429 ("this endpoint is deprecated") after a few calls.

### 5.1 `pets-demo.nearling.testnet` (all pass)
| Step | Tx | Result |
|---|---|---|
| Mint (price read from `config()`: 0.105 NEAR) | `An3TJ8j1Q9QGjyVRuCCa4Cue15o9t8JfvjVWL2NKZv64` | Token `1`. `returnValue` gives `"1"`; `nft_mint` data `{ owner_id, token_ids: ["1"] }` matches `MintForm` |
| `set_soul` | `7zxSUnX8ZeKdN33bANAnseFzEPd96wTswdxHxRsaCfi7` | `soul_updated` `{ pet_id: "1", version: 1, prompt }`; `get_soul` agrees |
| `feed` 0.01 NEAR (player, direct) | `HAcaiPsGrzM2M8hhXCLAWSwZBH2wzyu6m9MJSe7vYvvi` | `fed` data `{ pet_id, by, amount }` (array per NEP-297). `verifyFeedTx` returns `{ ok: true, payer: player }`; wrong pet or amount is rejected |
| `feed` 0.01 NEAR (feeder via `brain/src/chain/signer.ts`) | `GgSXvFtWDjJ1so5GGUSA9TJZeLMQkbRF9otqF6zttKjw` | Signer `parseOutcome` sees `fed`; `food_yocto` 0.01478 to 0.02471 NEAR; `verifyFeedTx` accepts it too |
| Shirt `claim` (0.01 NEAR) | `ELiaNinuFuRGQG3nYsEDyYWNa1XVaZPujcc36aGNdygs` | Shirt `1`, `nft_mint` parses, `nft_tokens_for_owner` shows it. A second run skips the claim |

Re-run after merging `zhijian` (tokens `3` and `4`): mint `RDqbZg4fhaAuuPUzBx77St5EshcgTBbdKjndCBYkMgm`, soul `BznSop8AXHo2RVM6QWW8r4pA5vYNzTAxspPoMBYrKuBD`, feed `BxWGRxjkFzfmA7YgRBsn7AfhjQrz2KLYiNEDajCgGziw`, feeder feed `81hgWBwX5zKeJtGyYuuVmzosrvmZKFFzB2VTs4UzhesF`, all pass. Note: a `final` view can lag the signer's result by a block or two (the script polls).

### 5.2 `pets-v8.nearling.testnet` Brain Garden
| Step | Tx | Result |
|---|---|---|
| Mint (0.2 NEAR) | `FDFWoxePRqTTWsd7ZCSLKojrtEvuR8RuEVsqzrEZFgms` | Token `5` |
| `stake` 1 NEAR at 450 Tgas | `FgyLYGndQ6YVUsAnjhAisJ92ga79Djd6aSTa7rcwmwYP` | Pool `ft_mint` 1 NEAR (memo `deposit_buffered`), `staked` `{ pet_id, owner, amount }`; `get_pet.staked` = exactly 1 NEAR; `daily_credit_micro` 657 |
| Credit accrual | (view) | `daily_credit_micro` = staked x `farm_rate` (657). `credit_micro` stays 0: metabolism (1000/day) spends credit first, so with 1 NEAR the accrual shows as slower food burn (net 343 micro-USD/day). `credit_micro` itself grows only once stake x 657 > 1000, i.e. 2+ NEAR |
| `unstake` 1 NEAR at 450 Tgas | `AhFwj7C9SgkfTavhWp9EtY1jfj1XfWzDdGpJXvqYVeKj`, retry `8aEHTZwghKGdUzS8KG9VbekMZ9wcg6JNZFtKa6gGLKW3` | **Blocked by a NEARON upgrade.** The pool panics "Attach 0.00772 NEAR to this unstake for the storage of its withdrawal record (refunded when you withdraw)"; the contract attaches 1 yocto. The callback `on_unstake` returned `false` and kept the stake (no `unstaked` event, `pending_unstake` null), as designed |

**Contract fix needed (Role 1):** attach the pool's `unstake_deposit` (read from `get_account(pets).unstake_deposit`, now 0.00772 NEAR, or a config value) to the pool `unstake` call, and have `withdraw` pass the refund on to the owner. Until then nobody can unstake from `pets-v8` or `pets-demo`, and staked pets cannot be transferred (`E_STAKED`). Pet `5` holds 1 NEAR stake until then.

**How to finish once the contract is fixed:** `brain/node_modules/.bin/tsx scripts/e2e-chain.ts --garden 5` (unstakes and records `pending_unstake`), wait for `unlock_epoch` (12 to 24 h; current epoch in `validators` RPC), then `brain/node_modules/.bin/tsx scripts/e2e-chain.ts --withdraw 5`. If withdraw says "Withdrawal funds not collected yet", retry later (CLAUDE.md 14).

### 5.3 NEARON pool `get_account` (F5)
`mw-pool-1024.testnet` `get_account(pets-v8.nearling.testnet)` after the stake:
```json
{"unstake_requested":"0","matured_withdrawals":"0","withdrawable":"0","balance":"4115330000000000000000000",
 "claimable":"3427006978107342597077","claimed":"0","acc_checkpoint":"8817727698890487273945","withdrawals":[],
 "owed_mint":"0","claim_deposit":"0","unstake_deposit":"7720000000000000000000","unstake_storage_paid":"0"}
```
`pets-demo` has the same fields (`balance` 0.11533 iNEAR = the house deposit, `claimable` 0.00012 CREDIT). `claimable` is the name `fuel/garden.ts` reads, so the sweep check was right; the other fields are now typed. `claimable` on `pets-v8` is 0.0034 CREDIT, under the 0.01 sweep threshold. New fields to watch: `unstake_deposit` (above) and `claim_deposit` (0 today; if it becomes non-zero, `sweep_credit` may need a deposit too).

### 5.4 Wallet validator (F4)
`validators` RPC, epoch 5434: `legends.pool.f863973.m0` is active but its `get_reward_fee_fraction` is 100/100 (all rewards kept by the validator). Chosen default: **`stakely_v2.pool.f863973.m0`**, active, 297/297 blocks produced, fee 3/100, `get_account_staked_balance` answers `"0"` for a new account. Other active pools: `aurora` 9%, `01node` 10%, `kiln` 99%.

### 5.5 NEAR Intents 1Click, dry quotes only (F2)
No `dry: false` request was sent. Shapes match the OpenAPI spec (`https://1click.chaindefuser.com/docs/v0/openapi.yaml`).
- `GET /v0/tokens`: 229 tokens, each `{ assetId, decimals, blockchain, symbol, price, priceUpdatedAt, contractAddress, coingeckoId }`. NEAR = `nep141:wrap.near` (wNEAR, 24 decimals, $3.66). Solana USDC = `nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near` (6 decimals).
- `POST /v0/quote` request: our body is right (all 12 required fields: `dry, swapType, slippageTolerance, originAsset, depositType, destinationAsset, amount, refundTo, refundType, recipient, recipientType, deadline`). `swapType` also allows `EXACT_INPUT`, `FLEX_INPUT`, `ANY_INPUT`; types also allow `INTENTS` / `CONFIDENTIAL_INTENTS`. `refundTo` must be a real wallet address on the origin chain (a token mint address gave 400 "Internal server error"; a bad one gives "refundTo is not valid").
- Response (201): `{ quote: { amountIn, amountInFormatted, amountInUsd, minAmountIn, amountOut, amountOutFormatted, amountOutUsd, minAmountOut, timeEstimate, refundFee, withdrawFee }, quoteRequest, signature, timestamp, correlationId }`. A dry quote has no `depositAddress` and no `deadline`. Without a JWT, `quoteRequest.appFees` shows a 20 bps fee.
- Errors are `{ message }` with HTTP 400; the client now includes the message.
- Route minimum, Solana USDC to NEAR: EXACT_OUTPUT 0.01 NEAR fails with "Amount is too low for bridge, try at least 60417919636664754098360" (0.0604 NEAR); EXACT_INPUT minimum 0.221486 USDC (equal to `refundFee`).
- Pack prices (EXACT_OUTPUT, 1% slippage): Snack 0.1 NEAR = 0.371035 USDC, Meal 0.5 NEAR = 1.855163 USDC, Feast 1 NEAR = 3.710327 USDC; `timeEstimate` 22 s. All clear the minimum, so the live price stays "same NEAR on mainnet as the testnet pack" (comment in `fuel/orders.ts`).
- `GET /v0/status?depositAddress=` for an unknown address: 404 `{ message: "Deposit address ... not found" }`. Status enum: `KNOWN_DEPOSIT_TX, PENDING_DEPOSIT, INCOMPLETE_DEPOSIT, PROCESSING, SUCCESS, REFUNDED, FAILED` (matches `OneClickStatus`).

### 5.6 Still open
`charge` from the brain and `sweep_credit` were not run here (they need the brain account keys, B3). The web wallet popups (Meteor) were not driven; the script signs the same calls with near-api-js and checks them with the same parsers.
