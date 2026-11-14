// Regenerates vectors/turns.json (golden battles for the firmware port). Review the numbers by
// hand against the spec formulas before committing a change; tests replay this file exactly.
// Usage: pnpm --filter @petto/battle exec tsx scripts/vectors.ts
import { writeFileSync } from "node:fs";
import { mulberry32, newBattle, resolveTurn, type Move, type TurnEvent } from "../src/index";

const A: Move = { kind: "attack" };
const S = (skill: string): Move => ({ kind: "skill", skill });
const cases: { a: { traits: number[]; level: number }; b: { traits: number[]; level: number }; seed: number; moves: [Move, Move][] }[] = [
  { a: { traits: [60, 20, 30, 10, 10], level: 1 }, b: { traits: [10, 20, 60, 30, 10], level: 1 }, seed: 1, moves: Array.from({ length: 30 }, () => [A, A] as [Move, Move]) },
  { a: { traits: [90, 10, 10, 10, 10], level: 6 }, b: { traits: [10, 90, 10, 10, 10], level: 6 }, seed: 42, moves: [[S("playful2"), S("curious2")], [S("playful1"), S("curious1")], [A, A], [S("playful2"), S("curious2")], [A, A], [A, A], [A, A], [A, A], [A, A], [A, A]] },
  { a: { traits: [10, 10, 90, 10, 10], level: 3 }, b: { traits: [10, 10, 10, 90, 10], level: 3 }, seed: 123456789, moves: [[S("calm1"), S("sassy1")], [A, A], [S("calm1"), A], ...Array.from({ length: 12 }, () => [A, A] as [Move, Move])] },
  { a: { traits: [10, 10, 10, 10, 95], level: 10 }, b: { traits: [95, 10, 10, 10, 10], level: 10 }, seed: 4294967295, moves: [[A, S("playful3")], [S("kind1"), S("playful2")], [S("kind3"), A], ...Array.from({ length: 12 }, () => [A, A] as [Move, Move])] },
  { a: { traits: [50, 50, 50, 50, 50], level: 4 }, b: { traits: [50, 50, 50, 50, 50], level: 4 }, seed: 7, moves: [[A, A], [{ kind: "run" }, A]] },
  // rules v2: Defend, Dodge (one dodge hits, one misses at this seed) and Shell Up
  { a: { traits: [20, 80, 30, 10, 10], level: 4 }, b: { traits: [10, 10, 90, 10, 10], level: 4 }, seed: 1, moves: [[A, { kind: "defend" }], [{ kind: "dodge" }, A], [S("curious1"), S("calm1")], [{ kind: "dodge" }, { kind: "defend" }], [A, A], [{ kind: "dodge" }, A], [{ kind: "defend" }, A], ...Array.from({ length: 12 }, () => [A, A] as [Move, Move])] },
];

const out = cases.map((c) => {
  let s = newBattle(c.a, c.b);
  const rng = mulberry32(c.seed);
  const events: TurnEvent[][] = [];
  for (const m of c.moves) {
    const r = resolveTurn(s, m, rng);
    s = r.state;
    events.push(r.events);
    if (s.over) break;
  }
  return { ...c, events, over: s.over };
});
writeFileSync(new URL("../vectors/turns.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(out.map((o) => `${o.events.length} turns -> ${JSON.stringify(o.over)}`).join("\n"));
