# Web app (phone app): detailed architecture

Owner: Role 2 (web + brain). Written 2026-11-10 for the **hybrid scope** (`CLAUDE.md` 1.1). Supersedes `conceptual/04` for the web. Product and UX follow `docs/Nearling-Hackathon-Build-Spec.md`; chain calls follow `docs/CONTRACT_INTERFACE.md`; brain routes follow `AI-brain architectual/08-api-reference.md`.

The Build Spec calls this the **phone web app**: wallet connection, pet and shirt claims, checkout, verification receipts, wallet signature prompts and transaction status. Because judges cannot touch hardware (`CLAUDE.md` 17), it also carries a **browser Nearling** (simulated device screen) so every feature is playable without a board.

## Files

| File | Content |
|---|---|
| [01-overview.md](01-overview.md) | Goals, tech stack, route map, folder structure, deployment, env |
| [02-wallet-auth-transactions.md](02-wallet-auth-transactions.md) | NEAR Connect + Meteor, NEP-413 session, every transaction the web sends, error mapping |
| [03-pages-and-flows.md](03-pages-and-flows.md) | Each page: Hatch & Pair, pet home, talk, Feed the Brain, receipt, Closet, Brain Garden, Soul editor, Wallet approval, transfer, race, public page |
| [04-components-state-rendering.md](04-components-state-rendering.md) | Component tree, data fetching and SSE, browser Nearling simulator, sprite renderer, audio, race client |
| [05-ux-copy-and-states.md](05-ux-copy-and-states.md) | Display states, labels ("demo speed", "simulated"), error copy for `E_` codes, empty and loading states |
| [06-build-plan.md](06-build-plan.md) | Nov 10 to 14 plan and dependencies |

## Principles

1. **Phone first.** Every device QR lands on a page that works on a phone in Meteor's in-app browser or the system browser.
2. **The chain stays in the background.** Fuel in thoughts ("22 thoughts left"), not micro-USD; wallet popups only for value moves (mint, feed, stake, claim shirt, sign approved wallet actions, transfer).
3. **Every reply has a receipt.** Model verified, Gateway verified or Unverified, Soul version, fuel tx.
4. **Fully playable without hardware.** Browser Nearling: talk by mic, pat / rock / sleep buttons, race.
5. **Honest labels.** "demo speed" on `pets-demo` pets, "simulated" on simulated payments.
