# 01. Overview

## 1. Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 App Router, React, TypeScript strict |
| Styling | Tailwind CSS, mobile-first; pixel font for pet UI only |
| Data | TanStack Query (brain REST + chain views), `EventSource` for brain SSE |
| Wallet | `@hot-labs/near-connect` 0.12 + `near-connect-hooks` (`NearProvider`, `useNearWallet`), network `testnet`, filter `features: { signMessage: true, testnet: true }`; Meteor is the primary tested wallet |
| NEAR | `near-api-js` 7 (actions, units, view calls through `provider.callFunction`) |
| Validation | `zod` for brain responses (types from `packages/shared`) |
| Race | `packages/race` (same deterministic rules as brain and firmware) |
| QR | `qrcode` (render), camera scanning not needed (device shows QR, phone camera opens URL) |
| Audio | `MediaRecorder` (WEBM/Opus) for talk; `<audio>` for replies |
| Hosting | Vercel |
| Tests | vitest (units), Playwright smoke |

## 2. Route map

| Route | Who lands here | Purpose | Build Spec |
|---|---|---|---|
| `/` | anyone | What Nearling is, live demo pet, "Try in browser", "Adopt" | |
| `/hatch?t=<token>` | phone scanning the device QR | Hatch & Pair: connect, mint or pick a pet, wait for "Pair Mochi?" on device | 1 |
| `/adopt` | browser without a device | Mint a pet (choose `pets-v8` or demo speed), then go to the browser Nearling | 1 |
| `/pet/[petRef]` | owner | Pet home: browser Nearling, fuel meter, talk, inbox, care buttons, links | 2, 4 |
| `/pet/[petRef]/receipts` | owner | List of replies with verification status | 2 |
| `/receipt/[turnId]` | owner, or anyone if published | One receipt | 2 |
| `/feed/[petRef]` | anyone (device Feed QR, friends) | Feed the Brain checkout | 3 |
| `/order/[orderId]` | payer | Order status (pending, fed, refunded) | 3 |
| `/pet/[petRef]/closet` | owner | Claim the shirt NFT, equip | 5 |
| `/pet/[petRef]/soul` | owner | View and edit the Soul (`set_soul`), version history from events | 2 |
| `/pet/[petRef]/garden` | owner | Brain Garden: stake, unstake, withdraw, credit growing | 9 |
| `/pet/[petRef]/device` | owner | Pairing status, unpair | 1 |
| `/pet/[petRef]/transfer` | owner (stretch) | Start transfer, approve on device, sign | 8 |
| `/approve/[approvalId]` | owner phone (device QR or SSE prompt) | Sign a device-approved wallet action in Meteor | 7 |
| `/wallet` | owner (P1) | Balances, saved recipients | 7 |
| `/race` and `/race/[code]` | anyone | Browser racer: create or join a room | 6 |
| `/p/[petRef]` | public | Read-only pet page, OG image, "Feed this pet" | |
| `/privacy` | public | How verification works, latest attestation | 2 |

`petRef` = `<contract>:<token_id>` URL-encoded; short alias `/p/3` and `/p/demo-3` map to `pets-v8` and `pets-demo`.

## 3. Folder structure

```
web/
  app/
    layout.tsx                  server; fonts, <Providers>
    providers.tsx               'use client': NearProvider(testnet), QueryClient, SessionProvider
    page.tsx                    landing
    hatch/page.tsx  adopt/page.tsx
    pet/[petRef]/page.tsx  .../receipts  .../closet  .../soul  .../garden  .../device  .../transfer
    receipt/[turnId]/page.tsx
    feed/[petRef]/page.tsx  order/[orderId]/page.tsx
    approve/[approvalId]/page.tsx  wallet/page.tsx
    race/page.tsx  race/[code]/page.tsx
    p/[petRef]/page.tsx  p/[petRef]/opengraph-image.tsx
    privacy/page.tsx
  components/
    nearling/   NearlingScreen, SpriteCanvas, FuelMeter, CareButtons, TalkButton, InboxToast
    talk/       ChatLog, ReplyBubble, ReceiptBadge
    wallet/     ConnectButton, TxButton, TxStatus
    feed/       PackPicker, PayModeTabs, DirectPay, IntentsPay, SimulatedPay
    garden/     StakeCard, CreditTicker
    closet/     ShirtCard
    race/       RaceCanvas, Lobby
    common/     Labels (DemoSpeed, Simulated), ErrorText, Countdown
  lib/
    brain.ts         typed client for brain routes
    chain.ts         contract ids, view helpers, tx builders (gas, deposits from CONTRACT_INTERFACE)
    session.ts       NEP-413 sign-in -> brain JWT
    errors.ts        E_ code -> friendly copy
    fuel.ts          fuel and NEAR formatting
    petRef.ts        parse / format
    useStream.ts     SSE hook
    useTalk.ts       recorder + request_id + retry
    useTx.ts         send tx, wait final, parse events
  public/art/        sprite sheet + sprites.json (copied from /art at build)
```

## 4. Deployment and env

Vercel project rooted at `web/`. Env:

```
NEXT_PUBLIC_NEAR_NETWORK=testnet
NEXT_PUBLIC_PETS_CONTRACT=pets-v8.nearling.testnet
NEXT_PUBLIC_DEMO_PETS_CONTRACT=pets-demo.nearling.testnet
NEXT_PUBLIC_SHIRTS_CONTRACT=shirts.nearling.testnet
NEXT_PUBLIC_BRAIN_URL=https://<brain-host>
NEXT_PUBLIC_RPC_URL=https://test.rpc.fastnear.com
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=      # optional
```

Server components only read public brain data (`/`, `/p/[petRef]`, OG image, `/privacy`). Everything wallet related is a client component.
