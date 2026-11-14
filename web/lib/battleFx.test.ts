import { describe, expect, it } from "vitest";
import { battleFx } from "./battleFx";

const hit = (o: object) => ({ kind: "move" as const, side: 0 as const, skill: "attack", damage: 7, crit: false, healed: 0, ...o });

describe("battleFx", () => {
  it("a hit: the attacker lunges, the target shakes, dizzy, and shows the damage", () => {
    expect(battleFx(hit({}))).toEqual([
      { side: 0, motion: "lunge" },
      { side: 1, motion: "hit", sprite: "dizzy", popup: { text: "-7", tone: "damage" } },
    ]);
  });

  it("a critical hit celebrates and says so", () => {
    expect(battleFx(hit({ crit: true, damage: 10 }))).toEqual([
      { side: 0, motion: "lunge", sprite: "celebrate" },
      { side: 1, motion: "hit", sprite: "dizzy", popup: { text: "CRIT -10", tone: "crit" } },
    ]);
  });

  it("a dodged hit sidesteps with Miss; a failed dodge is a hard hit", () => {
    expect(battleFx(hit({ damage: 0, dodge: "dodged" }))[1]).toEqual({ side: 1, motion: "dodge", popup: { text: "Miss", tone: "info" } });
    expect(battleFx(hit({ damage: 9, dodge: "failed" }))[1]).toEqual({ side: 1, motion: "hit", sprite: "dizzy", popup: { text: "-9 Hard hit", tone: "damage" } });
  });

  it("Defend and Shell Up brace with a shield; Dodge hops; Taunt pulses at the foe", () => {
    expect(battleFx(hit({ skill: "defend", damage: 0 }))).toEqual([{ side: 0, motion: "brace", popup: { text: "Defend", tone: "info", icon: "defence" } }]);
    expect(battleFx(hit({ skill: "calm1", damage: 0 }))).toEqual([{ side: 0, motion: "brace", popup: { text: "Shell Up", tone: "info", icon: "defence" } }]);
    expect(battleFx(hit({ skill: "dodge", damage: 0 }))).toEqual([{ side: 0, motion: "ready" }]);
    expect(battleFx(hit({ skill: "sassy1", damage: 0 }))).toEqual([
      { side: 0, motion: "cast" },
      { side: 1, motion: null, popup: { text: "Taunted", tone: "info" } },
    ]);
  });

  it("a heal floats green; a damaging heal also hits", () => {
    expect(battleFx(hit({ skill: "kind1", damage: 0, healed: 12 }))).toEqual([{ side: 0, motion: "cast", sprite: "eat", popup: { text: "+12", tone: "heal" } }]);
    expect(battleFx(hit({ skill: "kind2", damage: 5, healed: 6 }))).toEqual([
      { side: 0, motion: "lunge", sprite: "eat", popup: { text: "+6", tone: "heal" } },
      { side: 1, motion: "hit", sprite: "dizzy", popup: { text: "-5", tone: "damage" } },
    ]);
  });

  it("faint and run", () => {
    expect(battleFx({ kind: "faint", side: 1 })).toEqual([{ side: 1, motion: "faint" }]);
    expect(battleFx({ kind: "run", side: 0 })).toEqual([{ side: 0, motion: "run" }]);
  });
});
