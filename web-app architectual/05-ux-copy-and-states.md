# 05. UX copy and states

## 1. Display states (from the brain `display_state`)

| State | Sprite | Banner / copy | Primary action |
|---|---|---|---|
| happy | idle bounce | none | Talk |
| sad | droopy | "Mochi wants some attention." | Pat |
| hungry | rumbling tummy | "Running low: 4 thoughts left." | Feed |
| sleepy | yawning | "Shh, Mochi is sleepy." | Lights on |
| starving | grey, zzz | "Low Fuel. Mochi can't think until someone feeds the brain." | Feed |
| dormant | curled up, night | "Mochi is in a deep sleep. Feed or plant NEAR to wake them." | Feed, Garden |

## 2. Fuel copy

- Meter: "22 thoughts" (fuel left). Tooltip: "1 thought = 1 private AI reply = $0.001, paid from Mochi's own budget on NEAR."
- Per reply chip: "1 thought . paid from food" / "from Garden credit" / "mixed".
- Garden: "Credit growing: +6.6 thoughts per day". Self-sustaining badge: "Mochi's Garden pays for every thought."

## 3. Labels (`CLAUDE.md` rule 5)

| Condition | Label |
|---|---|
| Pet on `pets-demo` | "demo speed" pill on every page of that pet |
| Simulated payment | "simulated" on the button, order page and fed message |
| Live Intents order | "Paid on mainnet, fuel granted on testnet" |
| Unverified receipt | "Unverified" + reason, never hidden |
| Voice via ElevenLabs | note on the receipt |

## 4. Loading and empty states

| Place | Loading | Empty |
|---|---|---|
| Pet home | skeleton screen + egg sprite | n/a |
| Chat log | none | "Say hi to Mochi! Hold the button and talk." |
| Receipts | spinner | "No replies yet." |
| Closet | spinner | "Claim your free shirt." |
| Garden | spinner | "Plant NEAR so Mochi's brain grows its own fuel." |
| My pets | spinner | "No pets yet. Hatch one." |

## 5. Errors

Contract `E_` codes: see 02 section 3. Brain error codes:

| Code | Copy |
|---|---|
| `rate_limited` | "Mochi is still thinking. One sec." (button disabled for `retry_after_s`) |
| `brain_resting` | "Mochi's brain is resting for today. Care still works." (global cap or NEAR AI out of credit) |
| `bad_audio` | "I couldn't hear that. Try again a little closer." |
| `not_owner` | "Only Mochi's owner can do that." |
| `expired` | "This code has expired." |
| `upstream` | "Mochi's brain got tangled. Try again?" |
