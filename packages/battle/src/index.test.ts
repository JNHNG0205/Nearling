import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addXp, allSkillsFor, familyOf, isLegal, mulberry32, newBattle, resolveTurn, skillsFor, statsFor, xpFor,
  type BattleState, type Move,
} from "./index";

const ZERO = [0, 0, 0, 0, 0];
const ATTACK: Move = { kind: "attack" };
const ids = (traits: number[], level: number) => skillsFor(traits, level).map((s) => s.id);

describe("stats", () => {
  it("follow the spec formulas", () => {
    expect(statsFor(ZERO, 1)).toEqual({ hp: 48, mp: 13, atk: 12, def: 10, spd: 11, critPermille: 50, healBonus: 0 });
    expect(statsFor([100, 100, 100, 100, 100], 20)).toEqual({ hp: 230, mp: 85, atk: 65, def: 58, spd: 40, critPermille: 150, healBonus: 20 });
  });

  it("family is the highest trait, ties to the lower index", () => {
    expect(familyOf([10, 80, 80, 10, 10])).toBe("curious");
    expect(familyOf([0, 0, 0, 0, 90])).toBe("kind");
  });
});

describe("skills", () => {
  it("unlock at levels 3, 6 and 10 from the family", () => {
    const sassy = [0, 0, 0, 90, 0];
    expect(ids(sassy, 2)).toEqual(["attack"]);
    expect(ids(sassy, 3)).toEqual(["attack", "sassy1"]);
    expect(ids(sassy, 6)).toEqual(["attack", "sassy1", "sassy2"]);
    expect(ids(sassy, 10)).toEqual(["attack", "sassy1", "sassy2", "sassy3"]);
    expect(allSkillsFor(sassy)).toHaveLength(4);
  });

  it("isLegal rejects locked skills and skills without enough MP", () => {
    const s = newBattle({ traits: [90, 0, 0, 0, 0], level: 3 }, { traits: ZERO, level: 1 });
    expect(isLegal(s, 0, { kind: "skill", skill: "playful1" })).toBe(true);
    expect(isLegal(s, 0, { kind: "skill", skill: "playful2" })).toBe(false); // locked
    expect(isLegal(s, 1, { kind: "skill", skill: "playful1" })).toBe(false); // not its skill
    const broke: BattleState = { ...s, fighters: [{ ...s.fighters[0], mp: 3 }, s.fighters[1]] };
    expect(isLegal(broke, 0, { kind: "skill", skill: "playful1" })).toBe(false); // 4 MP
    expect(isLegal(broke, 0, ATTACK)).toBe(true);
    expect(isLegal(broke, 0, { kind: "run" })).toBe(true);
  });
});

describe("turns", () => {
  it("the faster pet acts first and a knockout stops the slower one", () => {
    const fast = { traits: [100, 100, 0, 0, 0], level: 20 };
    const slow = { traits: ZERO, level: 1 };
    const start = newBattle(slow, fast);
    const lowHp: BattleState = { ...start, fighters: [{ ...start.fighters[0], hp: 3 }, start.fighters[1]] };
    const { state, events } = resolveTurn(lowHp, [ATTACK, ATTACK], mulberry32(42));
    expect(events[0]).toMatchObject({ kind: "move", side: 1 });
    expect(events.some((e) => e.kind === "faint" && e.side === 0)).toBe(true);
    expect(events.filter((e) => e.kind === "move")).toHaveLength(1);
    expect(state.over).toEqual({ winner: 1, reason: "ko" });
  });

  it("running ends the battle at once: the other pet wins, no damage", () => {
    const s = newBattle({ traits: ZERO, level: 1 }, { traits: ZERO, level: 1 });
    const { state, events } = resolveTurn(s, [{ kind: "run" }, ATTACK], mulberry32(1));
    expect(events).toEqual([{ kind: "run", side: 0 }]);
    expect(state.over).toEqual({ winner: 1, reason: "run" });
    expect(state.fighters[0].hp).toBe(s.fighters[0].hp);
  });

  it("damage stays inside the formula's bounds and crits are x1.5", () => {
    const s = newBattle({ traits: ZERO, level: 5 }, { traits: ZERO, level: 5 });
    for (let seed = 1; seed < 200; seed++) {
      const { events } = resolveTurn(s, [ATTACK, ATTACK], mulberry32(seed));
      for (const e of events) {
        if (e.kind !== "move") continue;
        // power 10, atk 20, def 18: base 10*20/38 = 5.26 -> 4..5, crit 6..7
        expect(e.damage).toBeGreaterThanOrEqual(e.crit ? 6 : 4);
        expect(e.damage).toBeLessThanOrEqual(e.crit ? 7 : 5);
      }
    }
  });

  it("Shell Up halves the damage taken in the same turn, even when slower", () => {
    const calm = { traits: [0, 0, 90, 0, 0], level: 3 };
    const hitter = { traits: [100, 100, 0, 0, 0], level: 3 };
    const plain = resolveTurn(newBattle(calm, hitter), [ATTACK, ATTACK], mulberry32(7)).events.find((e) => e.kind === "move" && e.side === 1);
    const guarded = resolveTurn(newBattle(calm, hitter), [{ kind: "skill", skill: "calm1" }, ATTACK], mulberry32(7)).events.find((e) => e.kind === "move" && e.side === 1);
    expect(guarded && plain && guarded.kind === "move" && plain.kind === "move" && guarded.damage).toBe(Math.max(1, Math.floor((plain as { damage: number }).damage / 2)));
  });

  it("Snack Break heals 30% of max HP plus the heal bonus, never above max", () => {
    const kind = { traits: [0, 0, 0, 0, 100], level: 3 };
    const s = newBattle(kind, { traits: ZERO, level: 1 });
    const hurt: BattleState = { ...s, fighters: [{ ...s.fighters[0], hp: 10 }, s.fighters[1]] };
    const { events, state } = resolveTurn(hurt, [{ kind: "skill", skill: "kind1" }, ATTACK], mulberry32(3));
    const heal = events.find((e) => e.kind === "move" && e.side === 0);
    const max = s.fighters[0].stats.hp;
    expect(heal).toMatchObject({ healed: Math.floor((max * 30) / 100) + 20 });
    expect(state.fighters[0].mp).toBe(s.fighters[0].mp - 4);
  });

  it("after 30 turns the higher HP percentage wins; equal is a draw", () => {
    const calm = { traits: [0, 0, 90, 0, 0], level: 3 };
    const at29: BattleState = { ...newBattle(calm, calm), turn: 29 };
    const guard: Move = { kind: "skill", skill: "calm1" };
    const tie = resolveTurn(at29, [guard, guard], mulberry32(5));
    expect(tie.state.turn).toBe(30);
    expect(tie.state.over).toEqual({ winner: null, reason: "turns" });
    const hurt: BattleState = { ...at29, fighters: [{ ...at29.fighters[0], hp: 5 }, at29.fighters[1]] };
    expect(resolveTurn(hurt, [guard, guard], mulberry32(5)).state.over).toEqual({ winner: 1, reason: "turns" });
  });
});

describe("xp and levels", () => {
  it("rewards per spec 2.5", () => {
    expect(xpFor("win", 1, 1)).toBe(20);
    expect(xpFor("win", 1, 5)).toBe(40);
    expect(xpFor("win", 5, 1)).toBe(10);
    expect(xpFor("loss", 3, 3)).toBe(8);
    expect(xpFor("draw", 3, 3)).toBe(10);
    expect(xpFor("ran", 3, 3)).toBe(0);
  });

  it("levels up at 20 x L and stops at 20", () => {
    expect(addXp(1, 15, 5)).toEqual({ level: 2, xp: 0, levelsGained: 1 });
    expect(addXp(1, 0, 60)).toEqual({ level: 3, xp: 0, levelsGained: 2 });
    expect(addXp(20, 0, 500).level).toBe(20);
  });
});

describe("golden vectors (firmware must match)", () => {
  it("replays every vector exactly", () => {
    const vectors = JSON.parse(readFileSync(new URL("../vectors/turns.json", import.meta.url), "utf8")) as {
      a: { traits: number[]; level: number }; b: { traits: number[]; level: number }; seed: number; moves: [Move, Move][]; events: unknown[];
    }[];
    expect(vectors.length).toBe(5);
    for (const v of vectors) {
      let s = newBattle(v.a, v.b);
      const rng = mulberry32(v.seed);
      const events: unknown[] = [];
      for (const m of v.moves) {
        const r = resolveTurn(s, m, rng);
        s = r.state;
        events.push(r.events);
        if (s.over) break;
      }
      expect(events).toEqual(v.events);
    }
  });
});
