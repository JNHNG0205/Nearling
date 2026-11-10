# 06. Build plan (web), Nov 10 to 14

Runs in parallel with the brain plan (`AI-brain architectual/10-build-plan.md`). Same person, so each day pairs the brain route with its page.

| Day | Steps | Verify |
|---|---|---|
| Nov 10 | Next.js app, providers (NEAR Connect testnet), `lib/chain.ts` from `docs/CONTRACT_INTERFACE.md`, sign-in + session; `/adopt` mint on `pets-demo`; pet home skeleton with placeholder sprite and fuel meter | Mint works in Meteor; pet home shows fuel from the brain |
| Nov 11 | Talk (mic + text, retry with same `request_id`), chat log, audio playback, care buttons + evolution, `/hatch` flow against the brain pairing routes | Voice reply plays; same request twice shows one reply; three care actions show wings |
| Nov 12 | `/feed` (direct + simulated), `/order`, receipts page and badge, Closet claim + equip, Soul editor | Direct feed raises fuel once; receipt shows Model verified |
| Nov 13 | Garden, `/race` browser racer, `/approve` + `/wallet` (P1), public page + OG image, landing; real sprites | Browser vs device race result matches; testnet send signed after device approval |
| Nov 14 | Polish, labels audit, README web sections, screenshots, demo video support | Fresh phone runs the README steps |

Cut order if late: transfer (stretch) -> wallet page (P1) -> live Intents tab -> race lobby polish -> landing animations. Never cut: Hatch & Pair, talk with receipts, Feed (direct), browser Nearling, public page.

## Dependencies

| Need | From | By |
|---|---|---|
| Brain routes live (pairing, state, talk) | me (brain) | Nov 10 evening |
| `sprites.png` + `sprites.json`, shirt and wing layers | Art owner (Q4) | Nov 12 (placeholders until then) |
| Device QR URL format `PUBLIC_WEB_URL/hatch?t=`, `/feed/<petRef>`, `/approve/<id>` | Hardware teammates (firmware shows them) | Nov 10 |
| Meteor testnet on the demo phone | team | Nov 10 |
