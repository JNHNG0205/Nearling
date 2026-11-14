# Pet Battle: design

Date: 2026-11-14. Status: approved in conversation, pending spec review.
Replaces Petto Run (the two-lane race) everywhere.

## 1. Goal

A turn-based pet battle between two players' pets, live, in the style of classic monster-battle RPGs but with our own pixel art, names and layout. Each pet has HP and MP, picks **Fight** (Attack or a Skill) or **Run** (concede), and grows a **battle level** that raises HP and MP and unlocks skills. Critical hits add luck. Battle progress is stored **on chain**.

Decisions taken (owner):

| Question | Decision |
|---|---|
| Opponent | Another player's pet, live (PvP rooms, like Race) |
| Battle XP storage | On chain from the start (separate table, in-place contract update, no re-mint) |
| Race and the device | Replace Race everywhere; hardware team gets a note |
| What differs between pets | On-chain traits shape stats and skills; level raises HP/MP and unlocks skills |
| Turn model | Simultaneous turns, brain referees (blind picks, resolved in speed order) |

Out of scope: AI or wild opponents, wagers or prizes, items/bag, switching pets mid-battle, device battle client (later, from the shared rules).

## 2. Game rules (`packages/battle`)

All numbers are starting values, tuned in one place.

### 2.1 Stats

Traits are the pet's on-chain `traits` (0 to 100): playful, curious, calm, sassy, kind. `L` is the battle level (1 to 20).

| Stat | Formula (rounded down) |
|---|---|
| HP | `40 + calm × 0.3 + 8 × L` |
| MP | `10 + curious × 0.15 + 3 × L` |
| Attack | `10 + playful × 0.15 + 2 × L` |
| Defence | `8 + calm × 0.1 + 2 × L` |
| Speed | `10 + (playful + curious) / 20 + L` |
| Crit rate | `5% + sassy × 0.1%` (5% to 15%); a crit deals ×1.5 |
| Heal bonus | `kind × 0.2` added to healing |

HP and MP are full at the start of every battle. MP does not regenerate during a battle.

### 2.2 Moves

- **Fight → Attack**: power 10, 0 MP.
- **Fight → Skills**: the pet's unlocked skills (2.3), each with an MP cost.
- **Run**: concede immediately; the opponent wins.

Damage = `power × Attack / (Attack + Defence) × variance`, `variance` uniform in 0.85 to 1.0 from the battle's seeded RNG, ×1.5 on a crit, at least 1.

Turn order: both moves are chosen blind; the faster pet's move resolves first (ties: seeded coin flip). A pet at 0 HP does not act.

### 2.3 Skills

A pet's **family** is its highest trait (ties: lower trait index, as in `personalityFromTraits`). Every pet has Attack plus three skills from its family:

| Level | Slot | playful | curious | calm | sassy | kind |
|---|---|---|---|---|---|---|
| 3 | Trait skill (4 MP) | Zoomies: power 16 | Spark: power 14, ignores half Defence | Shell Up: halve damage taken this turn | Taunt: target Attack −20% for 2 turns | Snack Break: heal 30% max HP + heal bonus |
| 6 | Big move (8 MP) | power 26 | power 24, ignores half Defence | power 22, then halve damage taken this turn | power 24, Taunt for 1 turn | power 20, heal 15% |
| 10 | Finisher (14 MP) | power 38 | power 36, ignores half Defence | power 34 | power 36 | power 30, heal 20% |

Skill names for levels 6 and 10 are chosen in implementation (short, kid-friendly, original).

### 2.4 End of battle

- A pet reaches 0 HP: the other wins.
- A player runs: the other wins.
- 30 turns pass: the higher HP percentage wins; equal = draw.

### 2.5 Battle XP and levels

- XP to reach the next level: `20 × L`. Level cap 20.
- Win: `20 + 5 × (opponent level − own level)`, clamped to 10 to 40.
- Loss: 8. Running away: 0 for the runner; the opponent gets a win.
- Draw: 10 each.

Anti-farming:
- Contract: at most 100 battle XP per pet per UTC day.
- Brain: at most 3 XP-earning battles per day between the same two pets; a pet cannot battle itself or another pet of the same owner.

Entry rules: starving or dormant pets cannot join; battles make no AI calls and cost no fuel. Costumes are cosmetic.

### 2.6 Determinism

`resolveTurn(state, moveA, moveB, rng)` is pure; the RNG is seeded per battle by the brain. Same seed and moves give the same result in brain, web and (later) firmware. Golden test vectors are committed for the C++ port.

## 3. Architecture

| Part | Responsibility |
|---|---|
| `packages/battle` (new) | Stats, skills, `resolveTurn`, XP, seeded RNG; pure and tested |
| Pets contract (in-place update) | On-chain battle table, `record_battle`, `get_battle` |
| `brain/src/battle` (replaces `brain/src/race`) | Rooms, join codes, WebSocket, turn timer, referee, chain write queue |
| `web/app/battle` + `web/components/battle` (replace race) | Lobby, battle screen, results, battle stats on the pet page |
| Removed | `packages/race`, `brain/src/race`, `web/app/race`, `web/components/race`, their tests and docs |

### 3.1 Contract

New table in its own storage prefix (not a field of `Pet` or of the contract struct, so existing state still loads; deployed in place to `pets` and `pets-demo`):

```
BattleRecord { level: u8, xp: u32, wins: u32, losses: u32, draws: u32, xp_today: u32, day: u32 }
```

- `record_battle(winner: TokenId, loser: TokenId, draw: bool, battle_id: String)`: brain only (`E_NOT_BRAIN`). Computes XP from 2.5 using both pets' levels, applies the daily cap, levels up, updates wins/losses/draws. A `battle_id` already recorded is a no-op (like `charge`'s `usage_ref`). Emits `battle { battle_id, winner, loser, draw, xp: [w, l], level: [w, l] }` and `battle_level_up` where it applies. Unknown pets: `E_UNKNOWN_PET`. Same pet twice: `E_BATTLE`.
- `get_battle(pet_id) -> BattleRecord` (level 1, zeros when the pet never battled).
- Brain function-call keys add `record_battle` (`scripts/add-brain-keys.sh`, run for both contracts; the hosted brain's keys too).

The XP formula lives in the contract (authoritative) and in `packages/battle` (preview); tests pin both to the same values.

### 3.2 Brain

- `POST /battle/rooms` (session): create a room with `pet_ref`; returns a code.
- `POST /battle/rooms/:code/join` (session): join with `pet_ref`.
- `GET /battle/ws` (WebSocket, session): `ready`, `move { kind: "attack" | "skill" | "run", skill? }`; server sends `start`, `turn { events, hp, mp }`, `end { result, battle_id }`, `saved { tx }`.
- Turn timer 20 s; no move = Attack. Disconnect grace 30 s, then forfeit; both gone = void, nothing recorded.
- Validates every move against the pet's unlocked skills and MP.
- Stats come from `get_pet` (traits) and `get_battle` (level) at battle start.
- At the end, queues `record_battle` (retrying, idempotent by `battle_id`), then sends `saved` with the tx hash.

### 3.3 Web

- Navbar "Race" becomes "Battle" (still behind the setup guard).
- `/battle`: pick your pet, create a room (code + QR) or join one.
- `/battle/[code]`: the battle screen in our pixel style: both pets (your pet at the front), name + level plates, HP and MP bars, a message box ("What will Mochi do?"), the **Fight / Run** menu, then **Attack** and the skill list with MP costs; locked skills show their unlock level. Turn playback animates messages, crits and HP drain. Results screen: win/lose, XP gained, level up and new skills, "saving to NEAR..." until `saved`, then the tx link.
- Pet page: battle level, XP bar, wins/losses from `get_battle`.

## 4. Errors and edge cases

| Case | Behaviour |
|---|---|
| Player disconnects | 30 s grace to reconnect, then the other pet wins |
| Both disconnect | Battle void, no XP |
| Illegal move (locked skill, not enough MP) | Rejected by the brain; never offered by the web |
| `record_battle` fails | Retried from the queue; idempotent by `battle_id`; results screen keeps "saving" |
| Cheating attempt | Only the brain resolves turns and rolls crits; only the brain calls `record_battle`; contract caps XP per day |
| Same pet / same owner / starving pet | Join refused with a clear message |

## 5. Testing

| Where | What |
|---|---|
| `packages/battle` | Stat formulas, family choice, skill unlocks, damage and crit with fixed seeds, speed order and ties, Run, 30-turn cap, XP and levels; golden vectors |
| Contract | brain only, daily cap, level ups, repeated `battle_id` no-op, events, `get_battle` defaults, `E_BATTLE` |
| Brain | room flow, ready, turn resolution, timeout auto-attack, disconnect forfeit, illegal moves, chain queue and `saved` |
| Web | menu and skill-list logic (unit), one two-tab end-to-end battle |

## 6. Delivery order

1. `packages/battle` with tests.
2. Contract `record_battle` / `get_battle`, tests, in-place deploy to `pets` and `pets-demo`, brain keys updated.
3. Brain battle rooms (replacing race).
4. Web battle screen, pet page battle stats, "Battle" nav.
5. Remove Race; update README, `CLAUDE.md`, `docs/CONTRACT_INTERFACE.md`, and `docs/hardware/BATTLE.md` for the hardware team.

Steps 1 to 4 make a complete feature; step 5 is cleanup.
