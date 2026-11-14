import { describe, expect, it } from "vitest";
import { newBattle, type BattleState } from "@petto/battle";
import type { BattlePet } from "@petto/battle/protocol";
import { eventText, initialState, menuOptions, reduce, type ClientState } from "./battle";

const pet = (name: string, traits: number[], level: number): BattlePet =>
  ({ petRef: `pets.petto.testnet:${name}`, name, traits, level, stageIndex: 1, costume: null });
const MOCHI = pet("Mochi", [90, 10, 10, 10, 10], 6);
const BAO = pet("Bao", [10, 10, 10, 10, 90], 3);

function inBattle(): ClientState {
  let s = reduce(initialState(), { type: "room", you: 0, code: "ABC123", pets: [MOCHI, BAO], ready: [true, true] });
  s = reduce(s, { type: "start", state: newBattle(MOCHI, BAO), turnEndsAt: 1 });
  return s;
}

describe("battle client", () => {
  it("opens on the Fight / Run menu with the right prompt", () => {
    const s = inBattle();
    expect(s.screen).toBe("menu");
    expect(s.message).toBe("What will Mochi do?");
    expect(menuOptions(s).map((o) => o.id)).toEqual(["fight", "run"]);
  });

  it("Fight lists Attack, unlocked skills with MP, and locked skills disabled", () => {
    const s = reduce(inBattle(), { type: "choose", screen: "fight" });
    const opts = menuOptions(s);
    expect(opts.map((o) => o.id)).toEqual(["attack", "playful1", "playful2", "playful3", "back"]);
    expect(opts.find((o) => o.id === "playful2")).toMatchObject({ mp: 8, disabled: false });
    expect(opts.find((o) => o.id === "playful3")).toMatchObject({ disabled: true, reason: "Unlocks at Lv 10" });
  });

  it("a skill without enough MP is disabled", () => {
    const s0 = inBattle();
    const low: BattleState = { ...s0.battle!, fighters: [{ ...s0.battle!.fighters[0], mp: 5 }, s0.battle!.fighters[1]] };
    const s = reduce({ ...s0, battle: low }, { type: "choose", screen: "fight" });
    expect(menuOptions(s).find((o) => o.id === "playful2")).toMatchObject({ disabled: true, reason: "Not enough MP" });
  });

  it("a turn queues its events, and the end shows the result until it is saved", () => {
    let s = inBattle();
    const battle = s.battle!;
    s = reduce(s, { type: "turn", events: [{ kind: "move", side: 0, skill: "attack", damage: 5, crit: false, healed: 0 }], state: battle, turnEndsAt: 2 });
    expect(s.screen).toBe("playing");
    expect(s.queue).toHaveLength(1);
    s = reduce(s, { type: "end", winner: 0, reason: "ko", battleId: "b1", xp: [20, 8], levels: [[3, 4], [2, 2]] });
    expect(s.result).toEqual({ won: true, xp: 20, levelUp: 4, saved: "pending" });
    expect(reduce(s, { type: "saved", tx: "TX" }).result).toEqual({ won: true, xp: 20, levelUp: 4, saved: "saved", tx: "TX" });
    expect(reduce(s, { type: "save_failed" }).result?.saved).toBe("failed");
  });

  it("a socket that closes before the end says the battle ended", () => {
    const s = reduce(inBattle(), { type: "closed" });
    expect(s.closedEarly).toBe(true);
    expect(s.message).toBe("This battle ended (the server restarted)");
  });

  it("describes events in plain words", () => {
    const names: [string, string] = ["Mochi", "Bao"];
    expect(eventText({ kind: "move", side: 0, skill: "playful1", damage: 9, crit: true, healed: 0 }, names)).toBe("Mochi used Zoomies! A critical hit!");
    expect(eventText({ kind: "move", side: 1, skill: "kind1", damage: 0, crit: false, healed: 12 }, names)).toBe("Bao used Snack Break! Bao healed 12 HP.");
    expect(eventText({ kind: "faint", side: 1 }, names)).toBe("Bao fainted!");
    expect(eventText({ kind: "run", side: 0 }, names)).toBe("Mochi ran away!");
  });
});
