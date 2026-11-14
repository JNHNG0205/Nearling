# Pet Battle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Petto Run with a live PvP turn-based pet battle (Fight: Attack/Skills, Run; HP/MP; crits) whose battle levels and XP are recorded on chain.

**Architecture:** A pure, deterministic rules package (`packages/battle`) is shared by brain and web. The brain referees each battle in a WebSocket room (simultaneous blind moves, resolved in speed order with a seeded RNG) and, at the end, queues a brain-only `record_battle` call on the pets contract, which owns battle level/XP in its own storage table. The web shows lobby, battle screen and results.

**Tech Stack:** TypeScript (Node 22, Hono, node-ws, better-sqlite3, vitest), Next.js 16 / React 19, Rust near-sdk 5.30 (pets contract), NEAR CLI.

**Spec:** `docs/superpowers/specs/2026-11-14-pet-battle-design.md` (read it first; this plan does not repeat its tables).

## Global Constraints

- Testnet only; contracts `pets.petto.testnet` and `pets-demo.petto.testnet`, deployed **in place** (no state layout change: `Pet` and the `Contract` struct keep their fields).
- Stats, skills, damage, crit, turn order, end rules and XP numbers are exactly spec sections 2.1 to 2.5.
- Integer maths in the rules (floor), so the future firmware port can match bit for bit; RNG is `mulberry32` (copied from `packages/race`).
- Battle XP daily cap: 100 per pet per UTC day (contract). Max 3 XP-earning battles per day between the same two pets (brain). Same pet or same owner on both sides: refused.
- Turn timer 20 s (no move = Attack); disconnect grace 30 s then forfeit; both gone = void, nothing recorded; 30-turn cap.
- Starving or dormant pets cannot join. Battles make no AI calls (no fuel).
- Panic codes start with `E_` (`E_NOT_BRAIN`, `E_UNKNOWN_PET`, new `E_BATTLE`). Events use standard `petto`.
- Docs: no em dashes. Commits: conventional messages ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Original look: our pixel style and names; no copied monster-game assets, names or exact layout.

## Review Focus

1. A player sends two moves in one turn, or a move after the turn resolved: only the first move per turn counts; later ones get `error: already_moved`. (Task 3 test.)
2. A skill the pet cannot afford (MP) or has not unlocked: rejected with `error: illegal_move`, the player can choose again before the timer. (Task 1 `isLegal` test, Task 3 hub test.)
3. The brain restarts mid-battle: the room is gone; the web shows "This battle ended (the server restarted)" on socket close without a result, and nothing is recorded. (Task 4 unit test on the client reducer.)
4. `record_battle` keeps failing (unknown pet, transferred pet, RPC down): the job retries with backoff, marks `failed` after 8 attempts, and the results screen shows "Couldn't save to NEAR" instead of spinning forever. (Task 3 worker test.)
5. Level boundaries: XP landing exactly on `20 × L` levels up once; level 20 keeps XP but never exceeds 20; the daily cap clips a win partially (e.g. 95 + 20 → 100). (Task 1 and Task 2 tests, same values.)

---

### Task 1: Rules package `packages/battle`

**Files:**
- Create: `packages/battle/package.json` (name `@petto/battle`, same shape as `packages/race/package.json`), `packages/battle/tsconfig.json` (copy race's), `packages/battle/src/index.ts`, `packages/battle/src/index.test.ts`, `packages/battle/vectors/turns.json`
- Modify: `pnpm-workspace` needs nothing (globs `packages/*`); add `"@petto/battle": "workspace:*"` to `brain/package.json` and `web/package.json`; add `@petto/battle` to `transpilePackages` in `web/next.config.ts`

**Interfaces (Produces):**
```ts
export const RULES_VERSION = 1;
export const MAX_LEVEL = 20, MAX_TURNS = 30, DAILY_XP_CAP = 100;
export type Family = "playful" | "curious" | "calm" | "sassy" | "kind";
export interface Stats { hp: number; mp: number; atk: number; def: number; spd: number; critPermille: number; healBonus: number }
export interface Skill { id: string; name: string; level: number; mp: number; power: number; ignoreHalfDef?: boolean; guard?: boolean; tauntTurns?: number; healPct?: number }
export type Move = { kind: "attack" } | { kind: "skill"; skill: string } | { kind: "run" };
export interface Fighter { level: number; stats: Stats; hp: number; mp: number; guard: boolean; tauntTurns: number; skills: Skill[] }
export interface BattleState { turn: number; fighters: [Fighter, Fighter]; over: null | { winner: 0 | 1 | null; reason: "ko" | "run" | "turns" } }
export type TurnEvent =
  | { kind: "move"; side: 0 | 1; skill: string; damage: number; crit: boolean; healed: number }
  | { kind: "faint"; side: 0 | 1 } | { kind: "run"; side: 0 | 1 };
export function mulberry32(seed: number): () => number;
export function familyOf(traits: readonly number[]): Family;
export function statsFor(traits: readonly number[], level: number): Stats;
export function skillsFor(traits: readonly number[], level: number): Skill[];      // unlocked, Attack first
export function allSkillsFor(traits: readonly number[]): Skill[];                   // incl. locked (UI)
export function newBattle(a: { traits: readonly number[]; level: number }, b: { traits: readonly number[]; level: number }): BattleState;
export function isLegal(s: BattleState, side: 0 | 1, m: Move): boolean;
export function resolveTurn(s: BattleState, moves: [Move, Move], rng: () => number): { state: BattleState; events: TurnEvent[] };
export function xpFor(result: "win" | "loss" | "draw" | "ran", own: number, opp: number): number;
export function addXp(level: number, xp: number, gain: number): { level: number; xp: number; levelsGained: number };
```
Rules detail: `critPermille = 50 + sassy` (cap 150). Damage `floor(power × atk / (atk + def') × v / 100)` with `v = 85 + rng() % 16`, `def' = ignoreHalfDef ? floor(def/2) : def`, ×1.5 (floor) on crit `rng() % 1000 < critPermille`, min 1; halved (floor) if the target has `guard`; Taunt multiplies the target's atk by 80/100 while `tauntTurns > 0`. Turn order: higher `spd` first, tie → `rng() & 1`. Run resolves before any damage. RNG draws per move, in order: variance, then crit. Skill ids: `attack`, `<family>1`, `<family>2`, `<family>3` (levels 3, 6, 10); names from spec 2.3 (level 6/10 names: pick short original ones, e.g. playful "Big Pounce"/"Tantrum").

- [ ] **Step 1: Write failing tests** in `src/index.test.ts`:
  - `statsFor([0,0,0,0,0],1)` → `{hp:48, mp:13, atk:12, def:10, spd:11, critPermille:50, healBonus:0}`; `statsFor([100,100,100,100,100],20)` → `{hp:230, mp:85, atk:65, def:58, spd:40, critPermille:150, healBonus:20}`.
  - `familyOf([10,80,80,10,10]) === "curious"` (tie → lower index).
  - `skillsFor(traits,2)` ids `["attack"]`; level 3 adds `<family>1`; 6 adds `2`; 10 adds `3`; `allSkillsFor` always 4.
  - `isLegal`: skill not unlocked → false; mp short → false; attack/run → true.
  - `resolveTurn` with `mulberry32(42)`: faster side acts first; a KO stops the slower side's move; Run ends with the other side winner and no damage events; `guard` halves; Taunt lasts its turns; turn 30 with equal HP% → draw.
  - `xpFor("win",1,1)===20`, `xpFor("win",1,5)===40`, `xpFor("win",5,1)===10`, `xpFor("loss",3,3)===8`, `xpFor("draw",3,3)===10`, `xpFor("ran",3,3)===0`.
  - `addXp(1,15,5)` → `{level:2,xp:0,levelsGained:1}`; `addXp(20,0,500)` → level 20; `addXp(1,0,60)` → `{level:3,xp:0,levelsGained:2}` (20 + 40).
  - Golden vectors: 5 fixed `(traitsA, levelA, traitsB, levelB, seed, moves[])` battles; assert the full event lists equal `vectors/turns.json`.
- [ ] **Step 2: Run** `pnpm --filter @petto/battle test` → FAIL (module missing).
- [ ] **Step 3: Implement** `src/index.ts` per the Interfaces and rules detail; generate `vectors/turns.json` once from the implementation and review the numbers by hand against the formulas.
- [ ] **Step 4: Run** `pnpm --filter @petto/battle test && pnpm --filter @petto/battle typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(battle): turn-based battle rules package`.

---

### Task 2: Contract `record_battle` / `get_battle`

**Files:**
- Create: `contract/src/battle.rs`
- Modify: `contract/src/lib.rs` (`mod battle;`, `StorageKey::Battles`, `StorageKey::BattleIds` appended at the end of the enum; tests), `scripts/add-brain-keys.sh` (method list adds `record_battle`), `docs/CONTRACT_INTERFACE.md`, `docs/abi/petto_pets_abi.json` (`cargo near abi`)

**Interfaces (Produces):**
```rust
#[near(serializers = [borsh, json])]
pub struct BattleRecord { pub level: u8, pub xp: u32, pub wins: u32, pub losses: u32, pub draws: u32, pub xp_today: u32, pub day: u32 }
pub fn record_battle(&mut self, winner: TokenId, loser: TokenId, draw: bool, loser_ran: bool, battle_id: String); // brain only
pub fn get_battle(&self, pet_id: TokenId) -> BattleRecord; // default: level 1, zeros
```
Storage: `LookupMap<TokenId, BattleRecord>` and `LookupSet<u64>` (first 8 bytes of sha256(battle_id)), both built on demand from their `StorageKey` (never fields of `Contract`). XP: same table as Task 1 `xpFor` (draw → 10 each, `loser_ran` → loser 0); daily cap 100 (reset when `day != now/DAY_NS`); level up at `20 × L`, cap 20. Event `battle {battle_id, winner, loser, draw, xp:[w,l], level:[w,l]}`; plus `battle_level_up {pet_id, level}` per level gained.

- [ ] **Step 1: Write failing tests** in `lib.rs` tests: non-brain → `E_NOT_BRAIN`; unknown pet → `E_UNKNOWN_PET`; `winner == loser` → `E_BATTLE`; win L1 vs L1 gives winner 20 xp + 1 win, loser 8 xp + 1 loss; draw → 10 each + draws; `loser_ran` → loser 0; repeated `battle_id` → no change, no event; daily cap: 95 + 20 → 100, next day resets; 20 xp at L1 → level 2 and `battle_level_up`; `get_battle` of a fresh pet → level 1, zeros; mint/charge tests still pass (state layout unchanged).
- [ ] **Step 2: Run** `cd contract && cargo test` → new tests FAIL.
- [ ] **Step 3: Implement** `battle.rs`; reuse `require_brain`, `require_known_pet` style helpers and `events::emit`.
- [ ] **Step 4: Run** `cargo test && cargo fmt && cargo clippy --target wasm32-unknown-unknown -- -D warnings` → PASS, clean.
- [ ] **Step 5: Deploy in place and update keys:** `cargo near build non-reproducible-wasm`; `near contract deploy pets.petto.testnet use-file target/near/petto_pets.wasm without-init-call ...` and the same for `pets-demo.petto.testnet`; verify `get_pet` of pet 3 still works and `get_battle` returns defaults. Function-call keys cannot be edited: for each of the 8 brain public keys on `brain.petto.testnet`, delete it and re-add it with the new method list via `scripts/add-brain-keys.sh` (the brain's private keys stay the same). Verify one brain-signed `record_battle` on `pets-demo` with two seed pets succeeds and emits `battle`.
- [ ] **Step 6: Commit** `feat(contract): on-chain battle records (record_battle, get_battle)`; record the deploy txs in `CLAUDE.md` section 14 and `E_BATTLE` in the panic code list.

---

### Task 3: Brain battle rooms

**Files:**
- Create: `brain/src/ws.ts` (move `upgradeWebSocket`/`attachWebSockets` here from `brain/src/race/ws.ts`), `brain/src/battle/hub.ts`, `brain/src/battle/routes.ts`, `brain/src/battle/record.ts`, `brain/src/battle/hub.test.ts`, `brain/src/battle/routes.test.ts`, `brain/src/battle/record.test.ts`, `brain/src/db/migrations/900_battle.sql`
- Modify: `brain/src/modules.ts` (add `battleModule`), `brain/src/server.ts` (import from `./ws`), `brain/src/chain/near.ts` (add `getBattle(contract, tokenId)` view), `brain/src/proactive/scheduler.ts` (`onBattleResult` replacing `onRaceResult`: one canned inbox line per battle, "I won the battle!" / "I lost, but I'll train harder!"), `packages/shared/src/index.ts` (battle message types below)

**Interfaces:**
- Consumes: Task 1 (`newBattle`, `isLegal`, `resolveTurn`, `skillsFor`, `mulberry32`); Task 2 (`record_battle`, `get_battle`).
- Produces (HTTP, session auth like other owner routes):
  - `POST /battle/rooms {pet_ref}` → `{code}`; `POST /battle/rooms/:code/join {pet_ref}` → `{ok:true}`. Errors: 403 `not_owner`, 409 `same_owner` | `full` | `daily_limit`, 422 `pet_unavailable` (starving/dormant), 404 `not_found`.
  - `GET /battle/ws?code=&token=<session JWT>`.
- Produces (WebSocket, in `packages/shared`):
```ts
export type BattleClientMsg = { type: "ready" } | { type: "move"; move: Move };
export type BattleServerMsg =
  | { type: "room"; you: 0 | 1; pets: [BattlePet | null, BattlePet | null] }
  | { type: "start"; state: BattleState; turnEndsAt: number }
  | { type: "turn"; events: TurnEvent[]; state: BattleState; turnEndsAt: number }
  | { type: "end"; winner: 0 | 1 | null; reason: "ko" | "run" | "turns" | "forfeit"; battleId: string; xp: [number, number] }
  | { type: "saved"; tx: string } | { type: "save_failed" }
  | { type: "error"; code: "illegal_move" | "already_moved" | "bad_message" };
export interface BattlePet { petRef: string; name: string; traits: number[]; level: number; stageIndex: number; costume: string | null }
```
- Migration `900_battle.sql`: `battle(id TEXT PK, pet_a TEXT, pet_b TEXT, winner INTEGER NULL, reason TEXT, created_at INTEGER)`; `battle_job(battle_id PK, contract, args TEXT, status CHECK queued|sent|settled|failed, attempts, next_attempt_at, tx_hash, last_error, created_at, updated_at)` mirroring `charge_job`.

- [ ] **Step 1: Write failing hub tests** (fake `Conn`s, injected seed and clock): create + join + both `ready` → `start`; both moves → one `turn` with events; second move in a turn → `already_moved`; locked/expensive skill → `illegal_move` and the player may resend; timer expiry → missing move becomes Attack; `run` → `end` with `reason:"run"`; disconnect > 30 s → `end` `forfeit`; both disconnected → no `end` and nothing queued; the end inserts one `battle` row and one `battle_job`.
- [ ] **Step 2: Write failing route tests:** not the owner → 403; same owner as host → 409 `same_owner`; 4th battle of the same pair today → 409 `daily_limit`; starving pet → 422.
- [ ] **Step 3: Write failing worker test** (`record.ts`, fake signer): sends `record_battle` with the job's args, marks `settled` with `tx_hash` and notifies the room (`saved`); errors back off; after 8 attempts → `failed` and `save_failed`.
- [ ] **Step 4: Run** `pnpm --filter brain test` → new tests FAIL.
- [ ] **Step 5: Implement** hub (room codes as in `RaceHub`), routes, worker (start it where the charge worker starts), `getBattle`, the moved `ws.ts`, `onBattleResult`.
- [ ] **Step 6: Run** `pnpm --filter brain test && pnpm --filter brain typecheck` → PASS (race tests still pass until Task 5).
- [ ] **Step 7: Commit** `feat(brain): battle rooms refereed by the brain, results recorded on chain`.

---

### Task 4: Web battle

**Files:**
- Create: `web/lib/battle.ts` (+ `web/lib/battle.test.ts`), `web/app/battle/page.tsx`, `web/app/battle/[code]/page.tsx`, `web/components/battle/BattleScreen.tsx`, `web/components/battle/StatusPlate.tsx` (name, level, HP and MP bars), `web/components/battle/BattleMenu.tsx`, `web/components/nearling/BattleLine.tsx`
- Move: `web/components/race/RoomQr.tsx` → `web/components/battle/RoomQr.tsx` (update the import in `web/app/device-sim/page.tsx`)
- Modify: `web/components/site/SiteHeader.tsx` (nav "Battle" → `/battle`), `web/lib/flow.ts` (`NEEDS_PET` `/race` → `/battle`, + tests), `web/components/nearling/PetTabs.tsx` (More menu "Race" → "Battle"), `web/components/nearling/PetHome.tsx` (render `BattleLine` under `GrowthLine`), `web/lib/chain.ts` (`getBattle(contract, tokenId)` view + `BattleRecord` type)

**Interfaces:**
- Consumes: Task 1 types/functions, Task 3 HTTP routes and `BattleServerMsg`.
- Produces in `web/lib/battle.ts`:
```ts
export type Screen = "menu" | "fight" | "waiting" | "playing" | "over";
export interface ClientState { screen: Screen; you: 0 | 1 | null; battle: BattleState | null; queue: TurnEvent[]; message: string; result: null | { won: boolean | null; xp: number; saved: "pending" | "saved" | "failed"; tx?: string }; closedEarly: boolean }
export function reduce(s: ClientState, msg: BattleServerMsg | { type: "closed" } | { type: "choose"; screen: Screen }): ClientState;
export function menuOptions(s: ClientState): { id: string; label: string; mp?: number; disabled: boolean; reason?: string }[];
export function eventText(e: TurnEvent, names: [string, string], skills: [Skill[], Skill[]]): string; // "Mochi used Zoomies! A critical hit!"
```

- [ ] **Step 1: Write failing unit tests** (`lib/battle.test.ts`): `menuOptions` on `menu` → Fight, Run; on `fight` → Attack + unlocked skills with MP, a skill with too little MP `disabled` with reason "Not enough MP", locked skills shown disabled "Unlocks at Lv 6"; `reduce` of `turn` queues events and lands on `playing`, then `menu`; `end` → `over` with xp; `saved`/`save_failed` update `result.saved`; `closed` before `end` → `closedEarly` with message "This battle ended (the server restarted)"; `eventText` covers crit, heal, faint, run.
- [ ] **Step 2: Run** `pnpm --filter web test` → FAIL.
- [ ] **Step 3: Implement** `lib/battle.ts`, then the pages and components: lobby (pick your pet from `loadMyPets`, Create → code + QR, Join by code; show route errors in plain words), battle screen (opponent plate top-left, its sprite top-right; your sprite bottom-left from behind is not needed, use the normal sprite; your plate bottom-right with HP/MP numbers; message box "What will <name> do?"; menu Fight/Run, then Attack + skills; 20 s countdown; HP/MP bars animate per event; crit flash), results (won/lost, +XP, "Level up! New skill: X", "Saving to NEAR..." → tx link), `BattleLine` (Lv, XP bar to `20 × L`, W/L) from `getBattle`. Our pixel styles (`pixel-panel`, `pixel-btn`, `font-display`), keyboard usable, reduced motion skips bar animation.
- [ ] **Step 4: Run** `pnpm --filter web test && pnpm --filter web exec tsc --noEmit` → PASS.
- [ ] **Step 5: Manual end-to-end** (two browsers, two different owners with pets on `pets-demo`): create, join, play to a KO, see `saved` and the tx; check `get_battle` on chain shows the XP. Screenshot the battle screen for the README.
- [ ] **Step 6: Commit** `feat(web): battle lobby, battle screen and battle level on the pet page`.

---

### Task 5: Remove Race and update docs

**Files:**
- Delete: `packages/race/`, `brain/src/race/`, `web/app/race/`, `web/components/race/`, `web/e2e/race.spec.ts`
- Modify: `brain/package.json`, `web/package.json` (drop `@petto/race`), `web/next.config.ts` (drop it from `transpilePackages`), `brain/src/modules.ts` (drop `raceModule`), `pnpm-lock.yaml` (`pnpm install`), `README.md` (Petto Run rows → Battle; Try it step 9), `CLAUDE.md` (Race mentions → Battle; battle in 7.2 methods and 7.5 events), `AI-brain architectual/08-api-reference.md` (Race section → Battle routes and messages), `.github/workflows/ci.yml` (nothing race-specific expected; verify)
- Create: `docs/hardware/BATTLE.md` (for the hardware team: Race is gone; the device can join later through `/battle/ws` with the device token; rules and golden vectors in `packages/battle/vectors/turns.json`)
- Keep: migration `400_race.sql` (never drop applied migrations).

- [ ] **Step 1:** Delete the files and references above; `grep -rn "@petto/race\|raceModule\|/race" --exclude-dir=node_modules --exclude-dir=.next .` returns only historical docs.
- [ ] **Step 2: Run** `pnpm install && pnpm -r typecheck && pnpm -r test && (cd contract && cargo test)` → all PASS.
- [ ] **Step 3: Commit** `refactor: remove Petto Run; docs for battle`.
