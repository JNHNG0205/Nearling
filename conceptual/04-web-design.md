# 04. Web app: deep design

Next.js 16 (App Router), TypeScript strict, Tailwind, TanStack Query, `near-connect-hooks` + `@hot-labs/near-connect`, `near-api-js` v7.

---

## 1. Principles

1. **The game loop never shows a wallet popup.** Chat goes through the brain (pet pays). Pet, play, sleep and wake are signed by a browser session key. Only value moves (adopt, feed, stake, buy, device setup) open the wallet, and each is framed as a game action ("Buy snacks", "Plant a money tree").
2. **Money is shown in pet terms first, chain terms second.** "2.3 days of food" big, "0.46 NEAR + $0.004 credit" small, tx links smaller.
3. **Every thought shows its price and its proof.** Cost chip + TEE badge under each pet message.
4. **Works without the device.** Device features are additive.

---

## 2. Routes

| Route | Render | Auth | Content |
|---|---|---|---|
| `/` | Server shell + client islands | none | Hero line, live public pet (SSR first paint from brain `/state`), "Adopt" CTA, 3-step "how it works", privacy strip |
| `/adopt` | Client | wallet | Name input -> mint -> hatch animation -> redirect `/pet/[id]` |
| `/pet/[id]` | Client | owner session for chat; anyone can view | Pet home (section 5) |
| `/pet/[id]/shop` | Client | owner | Items (P1) |
| `/pet/[id]/device` | Client | owner | Pair, add device key, approval mode |
| `/pet/[id]/timeline` | Client | none | NFT history (nfts track) |
| `/p/[id]` | **Server** (SSR + OG image) | none | Read-only public page, "Feed this pet" button for anyone |
| `/privacy` | Server | none | Live attestation status and what we verify |
| `/my` | Client | wallet | List of my pets (`nft_tokens_for_owner`) |

`app/p/[id]/opengraph-image.tsx` renders the sprite + name + stage + "days of food" for the X demo post.

---

## 3. App structure

```
web/
  app/
    layout.tsx                 # <Providers> (client) wraps children
    providers.tsx              # 'use client': NearProvider(testnet), QueryClientProvider, SessionProvider
    page.tsx, adopt/, pet/[id]/..., p/[id]/, privacy/, my/
  components/
    PetCanvas.tsx              # sprite renderer (section 7)
    StatBars.tsx               # fullness, mood, energy
    BudgetCard.tsx             # credit + food + days left + self-sustaining badge, live ticker
    ChatBox.tsx                # messages, input, cost chip, TEE badge
    ThoughtBadge.tsx           # cost + verify status + drawer
    VerifyDrawer.tsx
    Inbox.tsx                  # bell + list, SSE driven
    CareBar.tsx                # Pet, Play, Sleep/Wake (session key), Feed, Stake (wallet)
    FeedDialog.tsx, StakeDialog.tsx
    ApprovalBanner.tsx         # "Approve on your Nearling"
    WalletButton.tsx
    Timeline.tsx
  lib/
    brain.ts                   # typed fetch client for brain routes (types from packages/shared)
    contract.ts                # method names, gas, deposits, tx builders
    session.ts                 # brain session (NEP-413) in localStorage
    sessionKey.ts              # browser function-call key (section 4)
    format.ts                  # yocto <-> NEAR, micro-USD, "days of food"
    useLiveBudget.ts           # interpolation hook
    usePetStream.ts            # SSE hook
```

Everything wallet related is `'use client'`. Server components only fetch public brain data (landing, `/p/[id]`, OG image).

---

## 4. Wallet, sessions and the no-popup loop

### 4.1 Three credentials in the browser

| Credential | Created | Stored | Used for |
|---|---|---|---|
| Wallet connection | NEAR Connect `connect()` | the wallet | Value transactions (mint, feed, stake, buy, AddKey, register device, propose action) |
| Brain session (JWT) | NEP-413 signed at connect (`signMessageParams`), sent to `POST /session` | `localStorage` | Chat, inbox, pairing, SSE |
| **Session key** (function-call key) | Generated in the browser on the first Pet/Play click, added once via wallet `AddKey` | `localStorage` (per account) | `play(pet_id, "pet" \| "play" \| "sleep" \| "wake")` with no popup |

### 4.2 Session key details

- `KeyPair.fromRandom("ed25519")` in the browser.
- One-time prompt: "Let {name} play with you without pop-ups?" -> wallet `addFunctionCallKey({ publicKey, contractId: PETS, methodNames: ["play"], allowance: 0.25 NEAR })`.
- After that the web signs `play` itself with near-api-js `Account(accountId, provider, KeyPairSigner)` and sends it straight to RPC. About 1 s, no popup.
- Safe by construction: limited to one method on our contract, no deposits possible, small gas allowance. If the user clears storage we just add a new one (old keys can be removed on the device page).
- Why our own key and not NEAR Connect's `signIn: { contractId, methodNames }`: with that option the **wallet** holds the key, and whether it signs without a popup depends on the wallet. Our own key is deterministic across wallets. [VERIFY S3: if the wallet-held key is popup-free in HOT and Meteor, we can drop ours.]
- Does not break the device security model: the contract tells the device apart by `signer_account_pk == pet.device_pk`; the session key is just another owner key and `play` is allowed for any owner key (CLAUDE.md 7.2).

### 4.3 Onboarding friction (S3)

1. Wallet list filtered `features: { signMessage: true, testnet: true }`.
2. Optional Privy (email/social) wallet through `@peerfolio/privy-near-connect` [VERIFY S3]. New Privy accounts have 0 NEAR, so they need the testnet welcome drip (see 07). Without the drip, show "Get testnet NEAR" with a faucet link.
3. Order of prompts for a brand-new user: connect + sign message (1 popup) -> mint 0.2 NEAR (1 popup) -> hatch. Session key prompt only when they first click Pet or Play (CLAUDE.md 9: "add a limited access key only after the user is active").

---

## 5. Pet home `/pet/[id]`

```
+------------------------------------------------------------+
|  Mochi  (Baby, day 3, streak 2)          [bell 2] [wallet] |
|                                                            |
|           [ PetCanvas 256x256, items overlaid ]            |
|           "zzz" / hearts / crumbs particles                |
|                                                            |
|  Fullness ######---- 62   Mood ########-- 81   Energy ...  |
|                                                            |
|  BudgetCard: 2.3 days of food                              |
|     credit $0.0041 (+$0.0066/day from 10 NEAR staked)      |
|     food 0.46 NEAR   ~ $0.00018 per chat   [Self-sustaining]|
|                                                            |
|  CareBar: [Pet] [Play] [Sleep]   [Feed] [Stake]            |
|                                                            |
|  ChatBox                                                   |
|    you: I have an exam on Friday                           |
|    Mochi: Ooh! I'll cheer for you! ...                     |
|      $0.00019 . paid from credit . [Verified in TEE] . tx  |
|  [ Say something to Mochi...                 ] [Send]      |
+------------------------------------------------------------+
```

### 5.1 Data flow

- `useQuery(["pet", id], brain.state)` refetch every 15 s, plus SSE `state` pushes.
- After any wallet tx: wait for the outcome, then `invalidateQueries(["pet", id])`.
- Optimistic UI for session-key `play`: animate immediately, roll back with a toast if the tx fails (cooldown, wrong owner).

### 5.2 Live budget ticker (`useLiveBudget`)

The contract settles lazily, so the view value is exact at block time. Between fetches, interpolate on the client:

```
credit(t) = credit0 + staked_near * farm_rate_micro_per_near_day * dt_days
food(t)   = food0 - metabolism draining (credit first, then food)
```

The credit counter visibly ticks up every second when staked. That is the "stake to live" moment. Re-sync on each fetch so drift never shows.

### 5.3 Days of food

`days = (credit_usd + food_near * near_usd_rate) / daily_burn_usd`, where `daily_burn = metabolism + avg_daily_spend` (both from `get_pet` / `config()`). The brain returns this computed in `/state` so web and device agree.

### 5.4 Chat UX

- Send -> pet sprite switches to `thinking` -> reply arrives -> `sprite_state` from the brain drives the next animation for 3 s.
- Under each pet message, `ThoughtBadge`: cost chip (`$0.00019`, tooltip "paid from credit" or "paid from food"), status `billing... -> paid (tx)`, TEE badge.
- Canned replies (starving) show "free, I'm too hungry to think" instead of a cost. Great demo moment.
- Rate limit: disable Send for `retry_after_s`.
- Approval mode does not affect chat.

### 5.5 Life-state presentation

| State | Visual | Banner |
|---|---|---|
| Happy | idle bounce | none |
| Hungry | hungry sprite, tummy-rumble particles | "Mochi is getting hungry. 0.4 days of food left." [Feed] |
| Sleepy | yawning | none |
| Starving | droopy, grey palette | "Mochi can't think without food." [Feed] [Stake] |
| Dormant | curled up, night background | "Mochi is in a deep sleep. Feed or stake to wake them." |

---

## 6. Transactions

### 6.1 Table

| UI action | Signer | Method | Deposit | Gas | Notes |
|---|---|---|---|---|---|
| Adopt | wallet | `nft_mint_pet(name)` | exactly 0.2 NEAR (from `config()`) | 100 Tgas [VERIFY] | Read token id from the return value; then hatch |
| Feed | wallet | `feed(pet_id)` | presets 0.1 / 0.5 / 1 NEAR | 30 Tgas | Anyone, including on `/p/[id]` |
| Stake | wallet or proposal | `stake(pet_id)` | ≥ 1 NEAR | 450 Tgas (contract requires ≥ 430; max per tx is 1000 Tgas, S6) | Under approval mode -> `propose_action(Stake)` |
| Unstake / Withdraw | wallet or proposal | `unstake(pet_id, amount)` / `withdraw(pet_id)` | 0 (contract attaches the pool's 1 yocto) | 450 Tgas | Show "unlocks in 12 to 24 h" (`pending_unstake.unlock_epoch` = current + 2 epochs) |
| Pet / Play / Sleep / Wake | **session key** | `play(pet_id, action)` | 0 | 30 Tgas | Respect cooldowns client-side (pet 5 min, play 1 min) |
| Buy item (P1) | wallet | `buy_item(pet_id, item_id)` | exact catalog price | 30 Tgas | |
| Add device key + register | wallet | tx 1: `AddKey` to own account (FC key, receiver PETS, methods `play`, `stake_from_food`, `approve_action`, allowance 1 NEAR); tx 2: `register_device(pet_id, pk)` | 0 | | `signAndSendTransactions` = one popup where the wallet supports it |
| Approval mode on | wallet | `set_approval_mode(pet_id, true)` | 0 | 30 Tgas | Needs registered device |
| Transfer | wallet or proposal | `nft_transfer` | 1 yocto | 30 Tgas | Disabled with tooltip while staked, unstaking or a stake is in flight |

Gas and deposits live in `lib/contract.ts` only, read from `config()` where possible.

### 6.2 Approval mode flow

1. User clicks Stake 10 NEAR. Web sees `approval_mode` true -> calls `propose_action(pet_id, { Stake: { amount } })` with the deposit.
2. `ApprovalBanner`: "Approve on your Nearling" with the action, amount and a 10 min countdown; polls `get_pending_actions` every 3 s (or SSE `action_pending` / `action_approved`).
3. When the action disappears and the stake shows up -> success toast. On expiry -> "Expired. Your deposit is refundable." [Cancel = `cancel_action`].

### 6.3 Error handling

Map wallet rejections ("User rejected") to a quiet toast. Parse `FunctionCallError` panic strings from the contract into friendly lines (e.g. "Too soon! Mochi was just petted."). The contract team should prefix panics with stable codes like `E_COOLDOWN:` so the web can map them [ask Role 1].

### 6.4 Verify drawer (privacy track)

Clicking the TEE badge opens:

```
Verified in a Trusted Execution Environment
  [ok] Model: openai/gpt-oss-120b (private, NEAR AI Cloud)
  [ok] GPU attestation (NVIDIA NRAS): pass, nonce matched      (checked 12 min ago)
  [ok] Reply signed by TEE key 0x3f1a...c09 (matches attested key)
  [ok] Signed text covers request hash 9b2e... and response hash 41ac...
  [--] Intel TDX quote: not checked in-app (view on proof.t16z.com)
  Billed: $0.00019 (estimate) / $0.00018 (NEAR AI bill)  .  charge tx 8Fh2...
```

Hashes are shown so a technical judge can re-check with the brain's `/thoughts/:id/verification` JSON.

---

## 7. Sprites (`PetCanvas.tsx`)

- Inputs: `art/sprites.json` (frame name -> rect, per stage and state) and the PNG sheet, both from Role 3. Copy into `web/public/art/` at build time (script) so web and firmware use the same files.
- `<canvas>` with `imageSmoothingEnabled = false`, CSS `image-rendering: pixelated`, scale 64 -> 256 px.
- `requestAnimationFrame` loop at the sheet's fps; state picked from (brain `sprite_state` for 3 s after a reply) else life state.
- Items: overlay frames drawn after the body at anchor points defined in the sprite JSON.
- Particles (hearts, zzz, crumbs) drawn in the same canvas, no extra library.
- Hatch animation on `/adopt`: egg wobble -> crack frames -> baby; CSS shake + canvas frames.

Ask Role 3 for the JSON format early (05-api-contract, section 4).

---

## 8. Device page `/pet/[id]/device`

Steps shown as a checklist:
1. **Pair**: "Enter the 6-digit code on your Nearling" -> `POST /pets/:id/pair { code }` -> brain returns `device_pk`.
2. **Give it a key**: wallet `AddKey` + `register_device(pet_id, device_pk)` (one batch).
3. **Approval mode** (optional): toggle with explanation "Stake, unstake, withdraw and transfer will need a hold-to-approve on the device. A stolen browser wallet alone cannot move your pet's money."
4. Show device status: last seen, token valid, device key allowance left (`getAccessKeyList`), "Unpair" (revoke token; off-chain) and "Remove key" (`deleteKey`).

---

## 9. Timeline `/pet/[id]/timeline` (nfts track)

From brain `GET /pets/:id/timeline`: born, hatched, fed by X (amount), stake added, credit swept, thoughts per day (aggregated, not one row per chat), stage ups, items bought, dormant / revived, owner changed. Each row links to the tx on the testnet explorer. Top summary: "Lifetime: ate 1.2 NEAR, earned $0.08 of credit, spent $0.06 on 312 thoughts, owned by 2 people."

---

## 10. Testing

- Component tests for `format.ts`, `useLiveBudget` (fake timers), state presentation mapping.
- Playwright smoke on a seeded testnet pet: load `/p/[id]`, see stats; owner flow behind a test wallet is manual (wallet popups).
- Manual checklist in `docs/DEMO.md` mirroring the README "do X, see Y".
