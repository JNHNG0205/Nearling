# Battles on the device (for the hardware team)

Petto Run (the two-lane race) was removed on 2026-11-14. Its replacement is a turn-based pet battle played in the browser: `/battle` on the web app. The firmware needs no change to keep working; drop the race screen and its C++ port when convenient.

## If the device joins battles later

- Rules: `packages/battle/src/index.ts` (integer maths only, the `mulberry32` RNG from the old race). Port `statsFor`, `allSkillsFor`, `newBattle`, `isLegal` and `resolveTurn` to C++ and check them against the golden vectors in `packages/battle/vectors/turns.json` (`pnpm --filter @petto/battle exec tsx scripts/vectors.ts` regenerates them).
- The device does not need to resolve turns itself: the brain referees and sends each turn's `events` and new `state`. Porting the rules is only needed to show which skills are usable and their MP cost.
- Socket: `GET /battle/ws?code=` (protocol in `packages/battle/src/protocol.ts`, summary in `AI-brain architectual/08-api-reference.md` section Battle). The routes accept a web session today; accepting `Authorization: Device <token>` is a small brain change (Role 2).
- Screen: two status plates (name, level, HP and MP bars), the two pets, a message box, and the menu Fight / Run, then Attack, the three family skills (locked ones show "Lv N") and Back. Three buttons map to up, down and select.
