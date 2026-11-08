# 06. Track strategy: what judges should see from web + brain

Target tracks: **games** (main), **nfts**, **privacy**. One feature can score in several tracks; this table is the checklist for what the web and brain must make visible.

## 1. games: "judged on the game loop, bonus if players never notice the chain"

| Loop | What the player does | Built by |
|---|---|---|
| Every 30 s | Chat, pet, play: pet reacts, mood moves, a fraction of a cent is spent | Chat (brain), session-key `play` (no popup) |
| Every 5 min | Watch budget tick, play a mini-game (P1), check inbox | `useLiveBudget`, inbox |
| Every session | Feed or stake, see growth (xp bar, stage), pet greets you and remembers last time | Proactive `morning` / `follow_up`, memory |
| Over days | Baby -> Teen -> Adult, traits shift, streak, self-sustaining badge | Contract stats, persona from traits |

"Never notice the chain" checklist:
- [ ] Zero popups for chat, pet, play, sleep (session key + brain pays gas).
- [ ] Money in pet words ("2.3 days of food") before NEAR numbers.
- [ ] Social login option (Privy) + testnet welcome drip, if S3 passes.
- [ ] Wallet appears only for adopt, feed, stake, buy, device setup.

Demo moment: the pet messages you first ("You said your exam was today. How did it go?").

## 2. nfts: "NFTs as accounts that own money"

| Judge question | Our answer on screen |
|---|---|
| Does the NFT own money? | BudgetCard: food balance, staked NEAR, credit accrued, all per token |
| Does it do something? | It spends its own money on every thought; each `thought` event is a real on-chain charge with tx link |
| What happens on transfer? | Blocked while staked (tooltip says why); device key cleared; old owner's memories archived; the pet greets the new owner as a stranger. README explains it, timeline shows `owner_changed` |
| History per NFT? | `/pet/[id]/timeline`: earned, ate, spent, owners |
| Dynamic? | Stage, traits, items, mood change the sprite and OG image |

## 3. privacy: "private AI, TEE, NEAR AI Cloud"

| Feature | Where |
|---|---|
| Only private (TEE) models for chat and STT | `cfg` refuses any model whose `/v1/model/list` entry has `verifiable=false` (boot check) |
| Fresh-nonce attestation, NRAS GPU check | `verify.ts` every 30 min, `/privacy` page |
| Per-reply signature verified against the attested key | TEE badge on every message + drawer |
| Memory encrypted at rest, never logged | `crypto.ts`, `log.ts` deny-list, README section |
| Honest limits | `/privacy` and README list what is not verified (TDX quote in-app, gateway TLS binding) and that the brain operator can read memories |
| Roadmap | E2EE to the model, brain inside OutLayer TEE |

Demo moment: click the green badge, see each check pass, open the hash in the JSON endpoint.

## 4. Bonus tracks (cheap wins, already in the design)

- **agents**: the pet pays for its own compute; billing ledger and `thought` events prove it.
- **security**: brain uses only function-call keys; browser session key limited to `play`; device approvals (Role 1 + 4).

## 5. README sections web + brain must supply

1. Try it on testnet (do X, see Y), using the demo-speed contract for starving.
2. Privacy: what is verified, how to re-check one reply with curl.
3. Cost table: model price, average tokens, average cost per thought, measured in S1/S2.
4. Libraries used (rule from HACKATHON.md): Next.js, Hono, near-api-js, NEAR Connect, near-connect-hooks, drizzle, better-sqlite3, zod, ethers (signature recovery), TanStack Query, Tailwind.
