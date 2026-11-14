import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BattlePet, BattleServerMsg } from "@petto/battle/protocol";
import { GRACE_MS, TURN_MS } from "@petto/battle/protocol";
import { testDeps } from "../test/deps";
import { BattleHub, type Entrant } from "./hub";

const pet = (petRef: string, traits = [50, 10, 10, 10, 10], level = 3): BattlePet =>
  ({ petRef, name: petRef, traits, level, stageIndex: 1, costume: null });
const alice: Entrant = { account: "alice.testnet", pet: pet("pets.petto.testnet:1") };
const bob: Entrant = { account: "bob.testnet", pet: pet("pets.petto.testnet:2") };

function conn() {
  const sent: BattleServerMsg[] = [];
  return { sent, send: (d: string) => sent.push(JSON.parse(d) as BattleServerMsg), close: vi.fn(), last: () => sent[sent.length - 1] };
}

function started() {
  const deps = testDeps();
  const hub = new BattleHub(deps, { newSeed: () => 42 });
  const code = hub.createRoom(alice)!;
  expect(hub.join(code, bob)).toEqual({ slot: 1 });
  const a = conn();
  const b = conn();
  hub.open(code, 0, a);
  hub.open(code, 1, b);
  hub.message(code, 0, JSON.stringify({ type: "ready" }));
  hub.message(code, 1, JSON.stringify({ type: "ready" }));
  return { deps, hub, code, a, b };
}
const move = (hub: BattleHub, code: string, slot: 0 | 1, m: object) => hub.message(code, slot, JSON.stringify({ type: "move", move: m }));

describe("BattleHub", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts when both players are ready and resolves a turn once both moved", () => {
    const { hub, code, a, b } = started();
    expect(a.last()?.type).toBe("start");
    move(hub, code, 0, { kind: "attack" });
    expect(a.sent.some((m) => m.type === "turn")).toBe(false);
    move(hub, code, 1, { kind: "attack" });
    const turn = a.last();
    expect(turn?.type).toBe("turn");
    expect(b.last()).toEqual(turn);
  });

  it("counts only the first move of a turn", () => {
    const { hub, code, a } = started();
    move(hub, code, 0, { kind: "attack" });
    move(hub, code, 0, { kind: "run" });
    expect(a.last()).toEqual({ type: "error", code: "already_moved" });
  });

  it("rejects a locked or unaffordable skill and lets the player choose again", () => {
    const { hub, code, a } = started();
    move(hub, code, 0, { kind: "skill", skill: "playful3" }); // unlocks at level 10
    expect(a.last()).toEqual({ type: "error", code: "illegal_move" });
    move(hub, code, 0, { kind: "skill", skill: "playful1" });
    move(hub, code, 1, { kind: "attack" });
    const turn = a.last();
    expect(turn?.type === "turn" && turn.events.some((e) => e.kind === "move" && e.side === 0 && e.skill === "playful1")).toBe(true);
  });

  it("plays Attack for a player who does not move before the timer", () => {
    const { hub, code, a } = started();
    move(hub, code, 0, { kind: "attack" });
    vi.advanceTimersByTime(TURN_MS + 10);
    const turn = a.sent.find((m) => m.type === "turn");
    expect(turn && turn.type === "turn" && turn.events.filter((e) => e.kind === "move").length).toBe(2);
  });

  it("running ends the battle and queues one on-chain record", () => {
    const { deps, hub, code, a } = started();
    move(hub, code, 0, { kind: "run" });
    move(hub, code, 1, { kind: "attack" });
    const end = a.last();
    expect(end).toMatchObject({ type: "end", winner: 1, reason: "run", xp: [0, 20] });
    const job = deps.db.prepare("SELECT * FROM battle_job").all() as { args: string; status: string }[];
    expect(job).toHaveLength(1);
    expect(JSON.parse(job[0]!.args)).toMatchObject({ winner: "2", loser: "1", draw: false, loser_ran: true });
    expect(deps.db.prepare("SELECT COUNT(*) AS n FROM battle").get()).toEqual({ n: 1 });
  });

  it("a player gone longer than the grace period forfeits", () => {
    const { hub, code, a, b } = started();
    hub.close(code, 1, b);
    vi.advanceTimersByTime(GRACE_MS + 10);
    expect(a.sent.find((m) => m.type === "end")).toMatchObject({ winner: 0, reason: "forfeit" });
  });

  it("both players gone: the battle is void and nothing is recorded", () => {
    const { deps, hub, code, a, b } = started();
    hub.close(code, 0, a);
    hub.close(code, 1, b);
    vi.advanceTimersByTime(GRACE_MS + 10);
    expect(deps.db.prepare("SELECT COUNT(*) AS n FROM battle_job").get()).toEqual({ n: 0 });
  });

  it("refuses the same owner, the same pet and a full room", () => {
    const deps = testDeps();
    const hub = new BattleHub(deps);
    const code = hub.createRoom(alice)!;
    expect(hub.join(code, { account: "alice.testnet", pet: pet("pets.petto.testnet:9") })).toEqual({ error: "same_owner" });
    expect(hub.join(code, { account: "carol.testnet", pet: alice.pet })).toEqual({ error: "same_pet" });
    // record_battle writes both pets on one contract: a normal pet cannot meet a demo-speed one
    expect(hub.join(code, { account: "carol.testnet", pet: pet("pets-demo.petto.testnet:2") })).toEqual({ error: "other_contract" });
    hub.join(code, bob);
    expect(hub.join(code, { account: "dave.testnet", pet: pet("pets.petto.testnet:5") })).toEqual({ error: "full" });
    expect(hub.join("NOPE00", bob)).toEqual({ error: "not_found" });
  });

  it("tells both players when the result is saved on chain", () => {
    const { hub, code, a, b } = started();
    move(hub, code, 0, { kind: "run" });
    move(hub, code, 1, { kind: "attack" });
    const end = a.last();
    hub.notifySaved(end && end.type === "end" ? end.battleId : "", "TX123");
    expect(a.last()).toEqual({ type: "saved", tx: "TX123" });
    expect(b.last()).toEqual({ type: "saved", tx: "TX123" });
  });
  it("refuses a guest who rejoins a started battle with another pet", () => {
    const { hub, code } = started();
    expect(hub.join(code, { account: bob.account, pet: pet("pets.petto.testnet:7") })).toEqual({ error: "full" });
  });

  it("keeps the guest's socket when they join again with the same pet before the start", () => {
    const deps = testDeps();
    const hub = new BattleHub(deps);
    const code = hub.createRoom(alice)!;
    hub.join(code, bob);
    const b = conn();
    hub.open(code, 1, b);
    hub.join(code, bob);
    expect(b.last()?.type).toBe("room");
    expect(b.sent.length).toBe(2);
  });

  it("sends the result to a player who reconnects after the battle ended", () => {
    const { hub, code } = started();
    move(hub, code, 0, { kind: "run" });
    move(hub, code, 1, { kind: "attack" });
    const again = conn();
    hub.open(code, 0, again);
    expect(again.sent.map((m) => m.type)).toEqual(["room", "end"]);
  });

  it("keeps a running battle past the room lifetime", () => {
    let t = 1_800_000_000_000;
    const deps = testDeps({ now: () => t });
    const hub = new BattleHub(deps, { newSeed: () => 42 });
    const code = hub.createRoom(alice)!;
    hub.join(code, bob);
    const a = conn();
    hub.open(code, 0, a);
    hub.open(code, 1, conn());
    hub.message(code, 0, JSON.stringify({ type: "ready" }));
    hub.message(code, 1, JSON.stringify({ type: "ready" }));
    t += 31 * 60_000;
    hub.createRoom({ account: "carol.testnet", pet: pet("pets.petto.testnet:3") }); // runs the sweep
    move(hub, code, 0, { kind: "attack" });
    move(hub, code, 1, { kind: "attack" });
    expect(a.last()?.type).toBe("turn");
  });
});
