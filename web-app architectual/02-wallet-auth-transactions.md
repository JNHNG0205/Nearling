# 02. Wallet, auth and transactions

## 1. Two credentials

| Credential | How | Used for |
|---|---|---|
| Wallet connection | NEAR Connect `connect()`; Meteor primary (Build Spec), others allowed | Every value transaction |
| Brain session | NEP-413 signed at connect time: `connect({ signMessageParams: { message: "Sign in to Nearling", recipient: "nearling", nonce } })` with the nonce from `GET /auth/nonce`, then `POST /session` | Owner-only brain routes, SSE |

One popup for both. The JWT (7 days) lives in `localStorage` keyed by account; sign-out clears it. If the wallet does not support sign-in-with-message, fall back to `signMessage` after connect (second popup).

No browser session key and no `play` calls: care is device-local (hybrid 1.1).

## 2. Transactions sent from the web

All built in `lib/chain.ts`; values from `docs/CONTRACT_INTERFACE.md`. `useTx` sends with `wallet.signAndSendTransaction`, waits for the outcome, parses `EVENT_JSON` logs, maps `E_` panics to copy (section 3).

| Action | Contract . method | Deposit | Gas | Success signal |
|---|---|---|---|---|
| Adopt | pets `nft_mint_pet(name, soul?)` | `config.mint_storage + starter_food` (0.2 NEAR; 0.105 demo), read from `config()` | 50 Tgas | return value = token id, `nft_mint` |
| Edit Soul | pets `set_soul(pet_id, prompt)` | 0 | 30 Tgas | `soul_updated { version }` |
| Feed (direct) | pets `feed(pet_id)` | pack amount | 30 Tgas | `fed`; then `POST /orders/:id/direct-tx` |
| Stake (Garden) | pets `stake(pet_id)` | ≥ 1 NEAR | 450 Tgas | `staked` |
| Unstake | pets `unstake(pet_id, amount)` | 0 | 450 Tgas | `unstaked`, show unlock epoch |
| Withdraw | pets `withdraw(pet_id)` | 0 | 450 Tgas | `unstake_withdrawn`; on failure "processing, retry later" |
| Claim shirt | shirts `claim()` | 0.01 NEAR | 30 Tgas | return token id |
| Wallet send (approved) | receiver account: `Transfer(amount)` | amount | | brain verifies via `/approvals/:id/submitted` |
| Wallet stake (approved) | validator pool `deposit_and_stake()` | amount | 100 Tgas | same |
| Transfer pet (stretch, approved) | pets `nft_transfer(receiver_id, token_id)` | 1 yocto | 30 Tgas | `nft_transfer`; disabled while staked (`E_STAKED`) |

Approved wallet actions are built **only** from the approval record fetched from the brain (receiver, amount); the page shows the same values the device showed and has no editable fields.

Gas note: 450 Tgas fits under the 1000 Tgas per-tx limit (S6). If a wallet refuses high gas, show "try Meteor" (tested wallet).

## 3. Error mapping (`lib/errors.ts`)

Parse `E_CODE:` from `FunctionCallError` messages.

| Code | Copy |
|---|---|
| `E_DEPOSIT` | "The amount didn't match. Please try again." |
| `E_NAME` | "Names need 1 to 32 characters." |
| `E_SOUL_SIZE` | "The Soul is too long (1 KB max)." |
| `E_NOT_OWNER` | "Only Mochi's owner can do that." |
| `E_MIN_STAKE` | "Plant at least 1 NEAR in the Brain Garden." |
| `E_POOL_NOT_READY` | "The Brain Garden isn't open yet. Try later." |
| `E_UNSTAKE_PENDING` | "You already have NEAR on its way back." |
| `E_LOCKED` | "Still unlocking. Check back after the time shown." |
| `E_NO_STAKE`, `E_NO_UNSTAKE` | "Nothing to unstake / withdraw." |
| `E_STAKED` | "Take Mochi's NEAR out of the Brain Garden before giving Mochi away." |
| `E_CLAIMED` | "You already have your Nearling shirt." |
| `E_GAS` | "Not enough gas attached. Please retry." |
| wallet rejection | quiet toast "Cancelled" |
| other | "Something went wrong" + tx link |

## 4. Reading chain data

- Pet state comes from the brain (`GET /pets/:petRef/state`) so web and device agree on `display_state` and fuel.
- Direct views from the browser only where the brain adds nothing: `config()` (mint price), `nft_tokens_for_owner` on both pets contracts (pet picker), `get_soul` (Soul editor), `shirts.nft_tokens_for_owner`.
- After any tx: invalidate the pet query; the brain's 5 s cache means the new value shows within a few seconds.
