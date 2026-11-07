# Nearling: Project Plan

An AI pet that lives on NEAR and pays for its own brain. One pet, two bodies: a **website** and a **hardware device**. Both show the same pet, driven by one brain service and one on-chain state.

Deadline: **2026-11-14T23:59Z (Nov 15 07:59 MYT)**. Testnet only. Full technical spec: `CLAUDE.md`.

---

## 1. How the pieces fit

```
                    NEAR testnet
        ┌──────────────────────────────────┐
        │ Pets contract (NFT, budget,      │◄──── NEARON (stake NEAR → AI credit)
        │ stats, stages, items, stake)     │
        └──────────────────────────────────┘
             ▲                ▲                 ▲
             │                │                 │
        Website ──────► Brain service ◄──────── Device (ESP32-S3)
        (NEAR Connect)  (memory, persona,       (touch screen, mic,
                         billing, pings)         own limited key)
                              │
                              ▼
                     NEAR AI Cloud (private models)
```

| Part | Role |
|---|---|
| Pets contract | Source of truth: who owns the pet, its budget, stats, stage, traits, items, stake |
| Brain service | The pet's mind: talks, remembers, bills each thought, sends proactive messages |
| Website | Adopt, care for, chat with and fund the pet; pair the device |
| Device | The pet's physical body on your desk: touch to pet it, talk by voice, alerts you, approves value actions with its own key |
| NEAR AI Cloud | Private (TEE) model inference and speech-to-text |
| NEARON | Turns NEAR staked for a pet into AI credit that feeds it |

---

## 2. Project structure

```
nearling/
├── CLAUDE.md                     # full technical spec for Claude Code
├── PLAN.md                       # this file
├── README.md                     # judge-facing: what, why, try it, limitations
├── .env.example                  # placeholder env var names only
├── package.json                  # pnpm workspace root
├── pnpm-workspace.yaml
│
├── contract/                     # NEAR smart contract (Rust, near-sdk 5.x)
│   ├── Cargo.toml
│   ├── src/
│   │   ├── lib.rs                # contract entry, init, config
│   │   ├── nft.rs                # NEP-171/177/181 via near-contract-standards
│   │   ├── pet.rs                # Pet struct, stats decay, life states, stages, traits
│   │   ├── budget.rs             # feed, charge, credit (credit first, then food)
│   │   ├── stake.rs              # NEARON stake / unstake / withdraw
│   │   ├── play.rs               # play actions (owner or device key)
│   │   ├── device.rs             # register_device, stake_from_food, device caps (signer_account_pk)
│   │   ├── approvals.rs          # propose / approve / cancel pending actions
│   │   ├── items.rs              # shop and accessories
│   │   ├── transfer.rs           # transfer rules (blocked while staked)
│   │   └── events.rs             # NEP-297 events
│   └── tests/                    # near-workspaces integration tests
│
├── brain/                        # Pet brain service (TypeScript, Node 22, Hono)
│   ├── src/
│   │   ├── server.ts             # routes
│   │   ├── auth.ts               # NEP-413 sessions, device tokens
│   │   ├── chat.ts               # chat flow, prompt building
│   │   ├── persona.ts            # personality from stage, traits, mood
│   │   ├── memory.ts             # encrypted memory, summaries
│   │   ├── billing.ts            # cost per reply, charge() calls, spend caps
│   │   ├── scheduler.ts          # proactive messages, CREDIT reconciliation
│   │   ├── nearai.ts             # NEAR AI client (chat, speech-to-text)
│   │   ├── near.ts               # contract view/call client
│   │   ├── pairing.ts            # device pairing codes
│   │   └── actions.ts            # pending actions feed for the device
│   └── test/
│
├── web/                          # Website (Next.js, TypeScript)
│   ├── app/
│   │   ├── page.tsx              # landing
│   │   ├── adopt/page.tsx        # name + mint + hatch
│   │   ├── pet/[id]/page.tsx     # pet home
│   │   ├── pet/[id]/shop/page.tsx
│   │   ├── pet/[id]/device/page.tsx   # pair, AddKey for device, approval mode
│   │   └── p/[id]/page.tsx       # public pet page
│   ├── components/
│   │   ├── PetCanvas.tsx         # animated sprite + item overlays
│   │   ├── StatBars.tsx
│   │   ├── ChatBox.tsx
│   │   ├── Inbox.tsx
│   │   ├── BudgetCard.tsx        # credit + food + days left + self-sustaining badge
│   │   ├── ApprovalBanner.tsx    # "Approve on your Nearling" while an action is pending
│   │   └── WalletButton.tsx      # NEAR Connect
│   └── lib/                      # contract + brain clients
│
├── firmware/                     # Device (ESP32-S3, PlatformIO, Arduino)
│   ├── platformio.ini
│   ├── include/
│   │   └── secrets.example.h     # Wi-Fi + brain URL placeholders (real file gitignored)
│   └── src/
│       ├── main.cpp              # setup + main loop
│       ├── screens.cpp           # state machine per screen
│       ├── sprites.cpp           # sprite drawing from shared sheet
│       ├── touch.cpp             # tap/stroke to pet, hold-to-talk, menu, hold-to-approve
│       ├── audio.cpp             # I2S mic → 16 kHz WAV
│       ├── net.cpp               # Wi-Fi, HTTPS, polling
│       ├── pairing.cpp           # 6-digit code, token storage
│       ├── signer.cpp            # ed25519 key gen + signing (key in encrypted flash)
│       ├── borsh.cpp             # NEAR transaction encoding
│       ├── rpc.cpp               # nonce, block hash, send_tx on testnet RPC
│       └── approvals.cpp         # fetch pending actions, approve screen
│
├── packages/
│   └── shared/                   # TS types shared by brain + web (Pet, Stats, events)
│
├── art/
│   ├── sprites/                  # PNG sprite sheets per stage
│   ├── sprites.json              # frame name → rect, used by web + firmware
│   └── source/                   # editable art files
│
├── scripts/
│   ├── deploy-testnet.sh
│   └── seed-demo.sh              # demo pets in different states
│
└── docs/
    ├── ARCHITECTURE.md
    ├── DEMO.md                   # demo video script
    └── hardware/                 # wiring, parts list, photos
```

---

## 3. Main features

Priority: **P0** = must ship for the submission, **P1** = should ship, **P2** = roadmap.

### 3.1 The pet (shared by website and device)

| Feature | What it does | Priority |
|---|---|---|
| Adopt | Mint a pet NFT, name it, it hatches from an egg | P0 |
| Needs | Fullness, mood and energy change over time | P0 |
| Life states | Happy, hungry, sleepy, starving, dormant (never dies) | P0 |
| Pays for its thoughts | Every reply is real AI inference billed to the pet's budget, cost shown | P0 |
| Feed | Deposit NEAR as food | P0 |
| Stake to live | Stake NEAR via NEARON; yield becomes AI credit; "self-sustaining" badge | P0 |
| Chat with memory | Remembers you and past chats; personality from its traits | P0 |
| Reaches out first | Pings you when hungry, lonely or growing up (max 3/day) | P0 |
| Grows up | Egg → baby → teen → adult, from care and streaks, not money | P0 |
| Personality evolves | Five traits nudged by how you treat it | P1 |
| Accessories | Buy hats, scarves, glasses; shown on web and device | P1 |
| Mini-game | One in-character game (e.g. guess the number) for mood and XP | P1 |
| Battles, visits, breeding | Illia's arena and social play | P2 |
| Earns its own food | Does small paid jobs via Agent Market | P2 |

### 3.2 Website

| Feature | What it does | Priority |
|---|---|---|
| Wallet login | NEAR Connect (HOT, Meteor, MyNearWallet and others), signed-message sign-in | P0 |
| Landing page | What Nearling is, adopt button, a live public pet | P0 |
| Adopt flow | Name, mint, hatching animation | P0 |
| Pet home | Animated pet, stat bars, chat, feed, stake, play, sleep | P0 |
| Budget card | Credit + food, days of food left, cost per reply, self-sustaining badge | P0 |
| Inbox | Messages the pet sent you while you were away | P0 |
| Public pet page | Shareable read-only page | P0 |
| Device pairing | Enter the 6-digit code shown on the device | P0 |
| Shop | Buy accessories | P1 |
| Device key | Wallet AddKey for the device (methods: `play`, `stake_from_food`, `approve_action`); it can never move funds out | P1 |
| Approval mode | Toggle on: Stake / Unstake / Withdraw wait for "Approve on your Nearling" | P1 |
| Gasless onboarding | Sponsored transactions via a relayer | P2 |

### 3.3 Hardware device

| Feature | What it does | Priority |
|---|---|---|
| Live pet on screen | Shows the same pet's sprite, stage, mood and items | P0 |
| State animations | Idle, happy, being-petted, talking, listening, eating, hungry, sleepy, sleeping, dormant | P0 |
| Touch to pet | Tap or stroke the pet on screen: instant purr + hearts; raises mood, counts as care (synced at most once per 5 min) | P0 |
| Hold to talk | Hold the on-screen mic; voice is transcribed; reply scrolls as text | P0 |
| New message alert | Bounces and chimes when the pet reaches out | P0 |
| Pairing | Shows a 6-digit code; links to your pet | P0 |
| Menu | Stats, inbox, Wi-Fi, unpair | P1 |
| Wi-Fi setup portal | Set Wi-Fi from a phone instead of reflashing | P1 |
| Signs its own actions | Device key signs `play` and "Save food" (`stake_from_food`, capped); a stolen device cannot move funds out | P1 |
| Approve on device | Shows the exact action and amount; hold Approve 2 s to sign; a wallet alone cannot approve | P1 |
| Battery + case | Portable, 3D-printed or off-the-shelf case | P2 |

**Suggested parts:** ESP32-S3 board with a capacitive touch colour screen, I2S mic and speaker (M5Stack CoreS3-class; verify specs before ordering); USB-C power. Final choice after the hardware spike.

---

## 4. User flows

**First time**
1. Open the website → connect wallet → adopt → name the egg → it hatches.
2. Chat a little; the budget card shows each reply's cost.
3. Feed it or stake NEAR for it.
4. Pair the device: it shows a code, enter it on the website, the pet appears on the device.

**Daily loop**
1. The device chimes: "I'm getting hungry!" or "Good morning!"
2. Hold the mic and talk to it; it remembers yesterday.
3. Stroke it on the screen; it purrs and mood rises.
4. Check the website: budget, stats, growth; feed or stake if needed.
5. Over days it grows into a teen, then an adult; its personality reflects how you treated it.

**Neglect and revival**
1. Budget hits zero → starving → "zzz... I'm hungry" (no cost).
2. 72 hours later → dormant (curled up).
3. Feed or stake → it wakes up and remembers you.

**Approve on the device (P1)**
1. Turn on approval mode on the device page.
2. On the website, choose Stake 10 NEAR → "Approve on your Nearling".
3. The device shows "Stake 10 NEAR?" → hold Approve 2 s → it signs.
4. The website updates; the stake goes through.

---

## 5. Team and timeline

| Role | Owns |
|---|---|
| 1. Contract | `contract/`, `scripts/`, NEARON integration, device key + approvals |
| 2. Web + brain | `web/`, `brain/`, `packages/shared/` (core pages first; shop is P1) |
| 3. Device: body | Screens, sprites, touch to pet, mic/audio, `art/` |
| 4. Device: link | Wi-Fi, pairing, on-device signing, approve flow, brain `pairing.ts` + `actions.ts`, `docs/hardware/` |

Both device owners must be available Nov 8 to 14, and each needs a board.

| Date | Milestone |
|---|---|
| Nov 7 | Agree interfaces; run spikes (NEAR AI models and cost, NEARON staking, wallet login, ESP32 board) |
| Nov 8 | Mint + pet home + first chat; device shows a sprite |
| Nov 9 | Billing works end to end; device pairing and touch to pet |
| Nov 10 | NEARON stake; persona and memory; device hold-to-talk |
| Nov 11 | Proactive messages on web and device; growth stages; shop; device key + `stake_from_food` |
| Nov 12 | Approval flow end to end; on-device signing; mini-game; polish |
| Nov 13 | Integration, demo pets, README, film device |
| Nov 14 | Final deploy, demo video, X post, submit (human) |

---

## 6. Demo video (about 2 minutes 15 s)

1. **Hook (10 s):** the device chimes on a desk: "I'm hungry, and I'm paying for this thought."
2. **Adopt (20 s):** website, connect, hatch an egg.
3. **It thinks, it pays (25 s):** chat; each reply shows its real cost; the budget drops.
4. **Neglect (15 s):** a pre-seeded starving pet: sleepy, then dormant.
5. **Stake to live (20 s):** stake 10 NEAR; "self-sustaining" badge lights up.
6. **The body (25 s):** stroke it on the screen; talk by voice; it remembers you; it reaches out first.
7. **Approve on the pet (15 s):** stake from the website; the device shows the amount; hold to approve; "a stolen device cannot move funds".
8. **Close (5 s):** "Nearling: a pet that pays for its own mind. Built on NEAR AI, NEARON and NEAR."

---

## 7. Tracks

`games` (main) · `nfts` · `agents` · `privacy` · `security` (device key that cannot move funds out + approve on device). The README names the NEAR tech used for each.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| NEARON is a testnet prototype | Spike first; fallback to staking from the owner's wallet or a labelled simulation |
| Hardware takes longer than planned | Website is a complete product on its own; the device is a second body |
| NEAR AI costs real money even on testnet | Daily spend cap in the brain; cheap private model |
| Other teams build an AI Tamagotchi | Win on the game loop, memory, reaching out first and the hardware body |
| Judges cannot touch the device | Web version fully playable; device shown in the video |
| On-device signing (Borsh + ed25519) is fiddly | Spike S5 early; fallback: brain relays `play`, approvals stay web-only and are labelled |
