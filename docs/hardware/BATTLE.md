# Battles on the device (for the hardware team)

Petto Run (the two-lane race) was removed on 2026-11-14. Its replacement is a turn-based pet battle played in the browser: `/battle` on the web app. The firmware needs no change to keep working; drop the race screen and its C++ port when convenient.

## If the device joins battles later

- Rules: `packages/battle/src/index.ts` (integer maths only, the `mulberry32` RNG from the old race). Port `statsFor`, `allSkillsFor`, `newBattle`, `isLegal` and `resolveTurn` to C++ and check them against the golden vectors in `packages/battle/vectors/turns.json` (`pnpm --filter @petto/battle exec tsx scripts/vectors.ts` regenerates them).
- The device does not need to resolve turns itself: the brain referees and sends each turn's `events` and new `state`. Porting the rules is only needed to show which skills are usable and their MP cost.
- Socket: `GET /battle/ws?code=` (protocol in `packages/battle/src/protocol.ts`, summary in `AI-brain architectual/08-api-reference.md` section Battle). Since 2026-11-15 the routes and the socket also accept `Authorization: Device <token>`; a device always plays its bound pet. `firmware/petto` hosts a room from its menu and shows the join QR.
- Screen: two status plates (name, level, HP and MP bars), the two pets, a message box, and the menu Fight / Defend / Dodge / Run (Fight opens Attack, the three family skills, locked ones show "Lv N", and Back). Rules version 2: Defend takes 70% damage and restores 10% MP, Dodge avoids the hit at 30% + 2% per point of speed over the opponent (15% to 60%) and a miss takes 125%; neither twice in a row (`Fighter.rested`). Shell Up takes 25%, Steady Slam 50%. Three buttons map to up, down and select.
