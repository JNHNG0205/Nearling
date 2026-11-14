import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULES_VERSION, simulate } from "@petto/race";
import { testDeps } from "../test/deps";
import { COUNTDOWN_MS, DISCONNECT_MS, RaceHub, REPORT_WAIT_MS, type Conn } from "./hub";
import { validate } from "./validate";

// Seed 42 golden vectors (packages/race): no switches crash at 144, [10, 50, 90] at 99.
const SEED = 42;

class FakeConn implements Conn {
  sent: Record<string, unknown>[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(d: string) {
    this.sent.push(JSON.parse(d) as Record<string, unknown>);
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
  last(type: string) {
    return [...this.sent].reverse().find((m) => m.type === type);
  }
}

function setup() {
  const deps = testDeps({ now: () => Date.now() });
  const hub = new RaceHub(deps, () => SEED);
  const code = hub.createRoom()!;
  const players = [0, 1].map(() => {
    const j = hub.join(code);
    if ("error" in j) throw new Error(j.error);
    const conn = new FakeConn();
    hub.open(code, j.slot, conn);
    const say = (m: Record<string, unknown>) => hub.message(code, j.slot, conn, JSON.stringify(m));
    return { slot: j.slot, conn, say };
  });
  const [a, b] = players as [typeof players[0] & {}, typeof players[0] & {}];
  return { deps, hub, code, a, b };
}

function startRace() {
  const s = setup();
  s.a.say({ type: "hello", rules_version: RULES_VERSION, name: "Mochi" });
  s.b.say({ type: "hello", rules_version: RULES_VERSION, name: "Pip" });
  s.a.say({ type: "ready" });
  s.b.say({ type: "ready" });
  return s;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
});
afterEach(() => vi.useRealTimers());

describe("validate", () => {
  it("accepts a matching crash tick and replaces a forged one with the replay", () => {
    expect(validate(SEED, { tick: 99, inputs: [10, 50, 90] })).toEqual({ crash: 99, valid: true });
    expect(validate(SEED, { tick: 300, inputs: [10, 50, 90] })).toEqual({ crash: 99, valid: false });
    expect(validate(SEED, { tick: null, inputs: [] })).toEqual({ crash: 144, valid: true });
  });
});

describe("race rooms", () => {
  it("starts when both players are ready", () => {
    const { a, b, hub, code } = setup();
    a.say({ type: "ready" });
    expect(a.conn.last("error")).toMatchObject({ code: "hello_first" });
    a.say({ type: "hello", rules_version: RULES_VERSION, name: "Mochi" });
    b.say({ type: "hello", rules_version: RULES_VERSION });
    a.say({ type: "ready" });
    expect(a.conn.last("start")).toBeUndefined();
    expect(b.conn.last("room")).toMatchObject({ you: 1, players: [{ name: "Mochi", ready: true }, { name: "Guest", ready: false }] });
    b.say({ type: "ready" });
    for (const p of [a, b]) {
      expect(p.conn.last("start")).toEqual({
        type: "start", seed: SEED, start_at: Date.now() + COUNTDOWN_MS, rules_version: RULES_VERSION,
        match_id: expect.any(String),
      });
    }
    expect(hub.roomState(code)).toBe("running");
    expect(hub.join(code)).toEqual({ error: "conflict" });
  });

  it("answers ping with the server clock", () => {
    const { a } = setup();
    a.say({ type: "ping", t_client: 123 });
    expect(a.conn.last("pong")).toEqual({ type: "pong", t_client: 123, t_server: Date.now() });
  });

  it("rejects a client on another rules version", () => {
    const { a, hub, code } = setup();
    a.say({ type: "hello", rules_version: RULES_VERSION + 1 });
    expect(a.conn.last("error")).toMatchObject({ code: "rules_version", rules_version: RULES_VERSION });
    expect(a.conn.closed).toEqual({ code: 4001, reason: "rules_version" });
    expect("slot" in hub.join(code)).toBe(true); // the slot is free again
  });

  it("relays lanes to the opponent only", () => {
    const { a, b } = startRace();
    a.say({ type: "lane", tick: 10, lane: 1 });
    expect(b.conn.last("opp_lane")).toEqual({ type: "opp_lane", slot: 0, tick: 10, lane: 1 });
    expect(a.conn.last("opp_lane")).toBeUndefined();
  });

  it("validates crashes: first crash loses and the match is stored", () => {
    const { a, b, deps } = startRace();
    a.say({ type: "crash", tick: 99, inputs: [10, 50, 90] });
    expect(b.conn.last("opp_crash")).toEqual({ type: "opp_crash", slot: 0, tick: 99 });
    b.say({ type: "crash", tick: 144, inputs: [] });
    const result = a.conn.last("result");
    expect(result).toMatchObject({ winner_slot: 1, draw: false, crash_ticks: [99, 144], valid: [true, true], reason: "crash" });
    expect(b.conn.last("result")).toEqual(result);
    expect(deps.db.prepare("SELECT status, winner_slot, reason, seed FROM match").get()).toEqual({
      status: "finished", winner_slot: 1, reason: "crash", seed: SEED,
    });
    expect(deps.db.prepare("SELECT slot, crash_tick, report_valid FROM match_player ORDER BY slot").all()).toEqual([
      { slot: 0, crash_tick: 99, report_valid: 1 },
      { slot: 1, crash_tick: 144, report_valid: 1 },
    ]);
  });

  it("replaces a forged crash tick with the server's replay", () => {
    const { a, b } = startRace();
    // Player 0 claims to have lasted until 400, but its inputs crash at 99.
    a.say({ type: "crash", tick: 400, inputs: [10, 50, 90] });
    b.say({ type: "crash", tick: 144, inputs: [] });
    expect(a.conn.last("result")).toMatchObject({ winner_slot: 1, crash_ticks: [99, 144], valid: [false, true] });
  });

  it("calls the same crash tick a draw", () => {
    const { a, b } = startRace();
    a.say({ type: "crash", tick: 144, inputs: [] });
    b.say({ type: "crash", tick: 144, inputs: [] });
    expect(a.conn.last("result")).toMatchObject({ winner_slot: null, draw: true, reason: "same_tick" });
  });

  it("asks the survivor for inputs 2 s after the crash and replays them", () => {
    const { a, b } = startRace();
    a.say({ type: "crash", tick: 99, inputs: [10, 50, 90] });
    // start_at (3 s) + tick 159 at 30 ticks/s = 8.3 s
    vi.advanceTimersByTime(COUNTDOWN_MS + 5_200);
    expect(b.conn.last("request_inputs")).toBeUndefined();
    vi.advanceTimersByTime(200);
    expect(b.conn.last("request_inputs")).toEqual({ type: "request_inputs" });
    b.say({ type: "crash", tick: null, inputs: [] });
    expect(a.conn.last("result")).toMatchObject({ winner_slot: 1, crash_ticks: [99, 144], reason: "crash" });
  });

  it("falls back to the relayed lane ticks when the survivor never reports", () => {
    const { a, b } = startRace();
    b.say({ type: "lane", tick: 10, lane: 1 });
    b.say({ type: "lane", tick: 50, lane: 0 });
    b.say({ type: "lane", tick: 90, lane: 1 });
    a.say({ type: "crash", tick: 144, inputs: [] });
    vi.advanceTimersByTime(COUNTDOWN_MS + 7_000 + REPORT_WAIT_MS);
    // b's relayed switches replay to a crash at 99: b crashed first.
    expect(a.conn.last("result")).toMatchObject({ winner_slot: 0, crash_ticks: [144, simulate(SEED, [10, 50, 90])], valid: [true, false] });
  });

  it("interrupts with no winner after a disconnect longer than 5 s", () => {
    const { a, b, hub, code, deps } = startRace();
    hub.close(code, a.slot, a.conn);
    vi.advanceTimersByTime(DISCONNECT_MS - 1);
    expect(b.conn.last("interrupted")).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(b.conn.last("interrupted")).toEqual({ type: "interrupted", reason: "disconnect" });
    expect(hub.roomState(code)).toBe("interrupted");
    expect(deps.db.prepare("SELECT status, winner_slot FROM match").get()).toEqual({ status: "interrupted", winner_slot: null });
  });

  it("lets a player reconnect within 5 s and resyncs the race", () => {
    const { a, b, hub, code } = startRace();
    hub.close(code, a.slot, a.conn);
    vi.advanceTimersByTime(3_000);
    const again = new FakeConn();
    hub.open(code, a.slot, again);
    hub.message(code, a.slot, again, JSON.stringify({ type: "hello", rules_version: RULES_VERSION }));
    expect(again.last("start")).toMatchObject({ seed: SEED });
    vi.advanceTimersByTime(DISCONNECT_MS);
    expect(b.conn.last("interrupted")).toBeUndefined();
    expect(hub.roomState(code)).toBe("running");
  });

  it("cleans up rooms after 10 min", () => {
    const { hub, code, a } = setup();
    vi.advanceTimersByTime(10 * 60_000);
    hub.sweep();
    expect(hub.roomState(code)).toBeNull();
    expect(a.conn.closed?.code).toBe(4010);
  });

  it("gives a device a slot and keeps it on reconnect", () => {
    const deps = testDeps({ now: () => Date.now() });
    const hub = new RaceHub(deps, () => SEED);
    const code = hub.createRoom()!;
    expect(hub.resolve(code, { deviceId: "d1" })).toEqual({ slot: 0 });
    expect(hub.resolve(code, { deviceId: "d1" })).toEqual({ slot: 0 });
    expect(hub.resolve(code, { token: "nope" })).toEqual({ error: "unauthorized" });
    expect(hub.resolve("ZZZZZZ", { deviceId: "d1" })).toEqual({ error: "not_found" });
    expect("slot" in hub.join(code)).toBe(true);
    expect(hub.resolve(code, { deviceId: "d2" })).toEqual({ error: "conflict" });
  });
});
