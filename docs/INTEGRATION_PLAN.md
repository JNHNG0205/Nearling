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
