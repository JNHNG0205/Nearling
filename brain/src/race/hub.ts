import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { MAX_TICKS, RULES_VERSION, TICKS_PER_SECOND, decide } from "@nearling/race";
import { parsePetRef } from "@nearling/shared";
import type { Deps } from "../deps";
import { publish } from "../events";
import { log } from "../log";
import { parseReport, validate, type Verdict } from "./validate";

// Petto Run rooms ("AI-brain architectual/06-race-arena.md" sections 2 to 4). In memory: one brain
// instance, rooms live minutes. Only finished and interrupted matches are stored (migration 400).

export const COUNTDOWN_MS = 3_000;
export const DISCONNECT_MS = 5_000; // disconnect > 5 s during a race = interrupted
export const SURVIVAL_WAIT_TICKS = 2 * TICKS_PER_SECOND; // ask the survivor 2 s of race clock after the crash
export const REPORT_WAIT_MS = 5_000; // then fall back to the relayed lane ticks
export const ROOM_TTL_MS = 10 * 60_000;
export const LOBBY_SLOT_HOLD_MS = 30_000; // a lobby slot nobody connects to is freed after this
export const MAX_ROOMS = 500;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
const NAME_MAX = 16;

/** A WebSocket as the hub sees it (node-ws in production, fakes in tests). */
export interface Conn {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type Slot = 0 | 1;
type RoomState = "lobby" | "running" | "finished" | "interrupted";

interface Player {
  slot: Slot;
  identity: string; // "token:<race_token>" or "device:<id>"
  kind: "browser" | "device";
  conn: Conn | null;
  helloed: boolean;
  ready: boolean;
  name: string;
  petRef: string | null;
  traits: number[] | null;
  stage: number | null;
  offlineSince: number | null;
  offlineTimer: NodeJS.Timeout | null;
  laneTicks: Set<number>; // switch ticks seen in `lane` messages (fallback inputs)
  reportedTick: number | null;
  verdict: Verdict | null;
}

interface Room {
  code: string;
  createdAt: number;
  state: RoomState;
  players: [Player | null, Player | null];
  seed: number;
  startAt: number;
  timers: NodeJS.Timeout[];
  matchId: string | null;
}

export type Auth = { token: string } | { deviceId: string };
export type JoinResult = { race_token: string; slot: Slot } | { error: "not_found" | "conflict" };
export type ResolveResult = { slot: Slot } | { error: "not_found" | "conflict" | "unauthorized" };

const msAt = (room: Room, tick: number) => room.startAt + Math.ceil((tick * 1000) / TICKS_PER_SECOND);
const other = (s: Slot): Slot => (s === 0 ? 1 : 0);

export class RaceHub {
  private rooms = new Map<string, Room>();
  private tokens = new Map<string, { code: string; slot: Slot; exp: number }>();
  private lastResult = new Map<string, Record<string, unknown>>(); // replayed to a player who reconnects

  /** `seed` is injectable for tests only; production seeds come from crypto. */
  constructor(
    private deps: Deps,
    private newSeed: () => number = () => randomBytes(4).readUInt32BE(0),
  ) {}

  createRoom(): string | null {
    if (this.rooms.size >= MAX_ROOMS) return null;
    let code = "";
    do {
      code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    } while (this.rooms.has(code));
    this.rooms.set(code, {
      code, createdAt: this.deps.now(), state: "lobby", players: [null, null],
      seed: 0, startAt: 0, timers: [], matchId: null,
    });
    return code;
  }

  /** Browser join (no wallet): reserves a slot and returns a race_token for the WebSocket. */
  join(rawCode: string): JoinResult {
    const room = this.rooms.get(rawCode.toUpperCase());
    if (!room) return { error: "not_found" };
    if (room.state !== "lobby") return { error: "conflict" };
    const slot = this.freeSlot(room);
    if (slot === null) return { error: "conflict" };
    const token = randomBytes(18).toString("base64url");
    this.tokens.set(token, { code: room.code, slot, exp: room.createdAt + ROOM_TTL_MS });
    room.players[slot] = this.newPlayer(slot, `token:${token}`, "browser");
    return { race_token: token, slot };
  }

  /** Before upgrading a WebSocket: which slot does this caller play in this room? */
  resolve(rawCode: string, auth: Auth): ResolveResult {
    const room = this.rooms.get(rawCode.toUpperCase());
    if (!room) return { error: "not_found" };
    if ("token" in auth) {
      const t = this.tokens.get(auth.token);
      if (!t || t.code !== room.code || t.exp < this.deps.now()) return { error: "unauthorized" };
      const p = room.players[t.slot];
      if (!p || p.identity !== `token:${auth.token}`) return { error: "conflict" }; // slot was freed
      return { slot: t.slot };
    }
    const identity = `device:${auth.deviceId}`;
    const mine = room.players.find((p) => p?.identity === identity);
    if (mine) return { slot: mine.slot };
    if (room.state !== "lobby") return { error: "conflict" };
    const slot = this.freeSlot(room);
    if (slot === null) return { error: "conflict" };
    room.players[slot] = this.newPlayer(slot, identity, "device");
    return { slot };
  }

  open(code: string, slot: Slot, conn: Conn): void {
    const room = this.rooms.get(code.toUpperCase());
    const p = room?.players[slot];
    if (!room || !p) return conn.close(4004, "gone");
    if (p.conn && p.conn !== conn) p.conn.close(4009, "replaced");
    p.conn = conn;
    p.offlineSince = null;
    if (p.offlineTimer) clearTimeout(p.offlineTimer);
    p.offlineTimer = null;
    // A reconnect mid-race resyncs: the client re-hellos, then gets the room and start again.
  }

  message(code: string, slot: Slot, conn: Conn, raw: string): void {
    const room = this.rooms.get(code.toUpperCase());
    const p = room?.players[slot];
    if (!room || !p || p.conn !== conn) return;
    let msg: Record<string, unknown>;
    try {
      const v: unknown = JSON.parse(raw);
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
      msg = v as Record<string, unknown>;
    } catch {
      return this.err(conn, "bad_message", "Send JSON objects");
    }
    const type = msg.type;

    if (type === "ping") {
      return this.send(conn, { type: "pong", t_client: msg.t_client ?? null, t_server: this.deps.now() });
    }
    if (type === "hello") return this.hello(room, p, msg);
    if (!p.helloed) return this.err(conn, "hello_first", "Say hello first");

    switch (type) {
      case "ready":
        if (room.state !== "lobby") return;
        p.ready = true;
        this.broadcastRoom(room);
        return this.maybeStart(room);
      case "lane":
        return this.lane(room, p, msg);
      case "crash":
        return this.crash(room, p, msg);
      default:
        return this.err(conn, "bad_message", "Unknown message type");
    }
  }

  close(code: string, slot: Slot, conn: Conn): void {
    const room = this.rooms.get(code.toUpperCase());
    const p = room?.players[slot];
    if (!room || !p || p.conn !== conn) return; // an old, replaced connection
    p.conn = null;
    p.offlineSince = this.deps.now();
    if (room.state === "lobby") {
      p.ready = false;
      this.broadcastRoom(room);
    } else if (room.state === "running" && p.verdict === null) {
      // A player whose result is already known may leave; anyone else has 5 s to come back.
      p.offlineTimer = setTimeout(() => this.interrupt(room, "disconnect"), DISCONNECT_MS);
    }
  }

  /** Drop rooms 10 min after creation (never mid-race) and expired tokens. */
  sweep(): void {
    const now = this.deps.now();
    for (const room of this.rooms.values()) {
      if (now - room.createdAt < ROOM_TTL_MS || room.state === "running") continue;
      this.clearTimers(room);
      for (const p of room.players) p?.conn?.close(4010, "room closed");
      this.rooms.delete(room.code);
      this.lastResult.delete(room.code);
    }
    for (const [t, v] of this.tokens) if (v.exp < now || !this.rooms.has(v.code)) this.tokens.delete(t);
  }

  stop(): void {
    for (const room of this.rooms.values()) this.clearTimers(room);
  }

  /** Test and ops view. */
  roomState(code: string): RoomState | null {
    return this.rooms.get(code.toUpperCase())?.state ?? null;
  }

  // ---------- messages ----------

  private hello(room: Room, p: Player, msg: Record<string, unknown>): void {
    if (msg.rules_version !== RULES_VERSION) {
      const conn = p.conn;
      if (room.state === "lobby") room.players[p.slot] = null;
      if (conn) {
        this.err(conn, "rules_version", `This room runs rules v${RULES_VERSION}`, { rules_version: RULES_VERSION });
        conn.close(4001, "rules_version");
      }
      return;
    }
    p.helloed = true;
    if (typeof msg.name === "string" && msg.name.trim()) p.name = msg.name.trim().slice(0, NAME_MAX);
    const ref = typeof msg.pet_ref === "string" ? parsePetRef(msg.pet_ref) : null;
    const allowed = [this.deps.cfg.PETS_CONTRACT, this.deps.cfg.DEMO_PETS_CONTRACT];
    if (ref && allowed.includes(ref.contract) && p.petRef !== `${ref.contract}:${ref.tokenId}`) {
      p.petRef = `${ref.contract}:${ref.tokenId}`;
      // Pet look for the lanes; a failed lookup just keeps the default look.
      this.deps.chain.getPet(ref.contract, ref.tokenId).then(
        (pet) => {
          if (!pet || room.players[p.slot] !== p) return;
          p.traits = pet.traits;
          p.stage = pet.stage;
          this.broadcastRoom(room);
        },
        () => undefined,
      );
    }
    this.broadcastRoom(room);
    if (room.state === "running" && p.conn) {
      this.send(p.conn, this.startMsg(room));
      const opp = room.players[other(p.slot)];
      if (opp?.verdict) this.send(p.conn, { type: "opp_crash", slot: opp.slot, tick: opp.verdict.crash });
    }
    if ((room.state === "finished" || room.state === "interrupted") && p.conn) {
      this.send(p.conn, this.lastResult.get(room.code) ?? { type: "interrupted", reason: "disconnect" });
    }
  }

  private lane(room: Room, p: Player, msg: Record<string, unknown>): void {
    if (room.state !== "running" || p.verdict) return;
    const tick = msg.tick;
    const lane = msg.lane;
    if (!Number.isInteger(tick) || (tick as number) < 0 || (tick as number) >= MAX_TICKS) return;
    if (lane !== 0 && lane !== 1) return;
    p.laneTicks.add(tick as number);
    const opp = room.players[other(p.slot)];
    if (opp?.conn) this.send(opp.conn, { type: "opp_lane", slot: p.slot, tick, lane });
  }

  private crash(room: Room, p: Player, msg: Record<string, unknown>): void {
    if (room.state !== "running" || p.verdict || !p.conn) return;
    const report = parseReport(msg);
    if (!report) return this.err(p.conn, "bad_message", "crash needs tick and inputs");
    p.reportedTick = report.tick;
    this.setVerdict(room, p, validate(room.seed, report));
  }

  private setVerdict(room: Room, p: Player, verdict: Verdict): void {
    p.verdict = verdict;
    if (p.offlineTimer) clearTimeout(p.offlineTimer);
    p.offlineTimer = null;
    const opp = room.players[other(p.slot)];
    if (!opp) return;
    if (opp.verdict) return this.finish(room);
    if (opp.conn) this.send(opp.conn, { type: "opp_crash", slot: p.slot, tick: verdict.crash });
    // The other player is (probably) still running: ask for their inputs once they are 2 s past.
    if (verdict.crash !== null) {
      const at = msAt(room, verdict.crash + SURVIVAL_WAIT_TICKS);
      this.after(room, Math.max(0, at - this.deps.now()), () => this.requestInputs(room, opp));
    }
  }

  private requestInputs(room: Room, p: Player): void {
    if (room.state !== "running" || p.verdict) return;
    if (p.conn) this.send(p.conn, { type: "request_inputs" });
    this.after(room, REPORT_WAIT_MS, () => {
      if (room.state !== "running" || p.verdict) return;
      // No report: replay what the server saw relayed. Marked invalid (not the player's own report).
      const v = validate(room.seed, { tick: null, inputs: [...p.laneTicks] });
      p.reportedTick = null;
      this.setVerdict(room, p, { crash: v.crash, valid: false });
    });
  }

  // ---------- lifecycle ----------

  private maybeStart(room: Room): void {
    const [a, b] = room.players;
    if (!a || !b || !a.conn || !b.conn || !a.helloed || !b.helloed || !a.ready || !b.ready) return;
    room.state = "running";
    room.seed = this.newSeed() >>> 0;
    room.startAt = this.deps.now() + COUNTDOWN_MS;
    room.matchId = randomUUID();
    for (const p of room.players) if (p?.conn) this.send(p.conn, this.startMsg(room));
    this.broadcastRoom(room);
    // 120 s with no result: ask everyone still out for their inputs (both alive = draw).
    const end = msAt(room, MAX_TICKS) + 2_000;
    this.after(room, end - this.deps.now(), () => {
      for (const p of room.players) if (p) this.requestInputs(room, p);
    });
  }

  private finish(room: Room): void {
    const [a, b] = room.players;
    if (!a?.verdict || !b?.verdict || room.state !== "running") return;
    const c0 = a.verdict.crash;
    const c1 = b.verdict.crash;
    const r = decide(c0, c1);
    const reason = r.kind === "winner" ? "crash" : c0 === null ? "time" : "same_tick";
    room.state = "finished";
    this.clearTimers(room);
    const result = {
      type: "result",
      match_id: room.matchId,
      winner_slot: r.kind === "winner" ? r.slot : null,
      draw: r.kind === "draw",
      crash_ticks: [c0, c1],
      valid: [a.verdict.valid, b.verdict.valid],
      reason,
    };
    this.lastResult.set(room.code, result);
    this.store(room, "finished", r.kind === "winner" ? r.slot : null, reason);
    for (const p of room.players) {
      if (p?.conn) this.send(p.conn, result);
      if (p?.petRef) {
        publish(p.petRef, "race_result", {
          match_id: room.matchId, won: r.kind === "winner" && r.slot === p.slot, draw: r.kind === "draw",
        });
      }
    }
    this.broadcastRoom(room);
    log.info("race finished", { code: room.code, match: room.matchId, reason, valid0: a.verdict.valid, valid1: b.verdict.valid });
  }

  private interrupt(room: Room, reason: string): void {
    if (room.state !== "running") return;
    room.state = "interrupted";
    this.clearTimers(room);
    const msg = { type: "interrupted", reason };
    this.lastResult.set(room.code, msg);
    this.store(room, "interrupted", null, reason);
    for (const p of room.players) if (p?.conn) this.send(p.conn, msg);
    this.broadcastRoom(room);
    log.info("race interrupted", { code: room.code, match: room.matchId, reason });
  }

  private store(room: Room, status: "finished" | "interrupted", winner: Slot | null, reason: string): void {
    const db = this.deps.db;
    const id = room.matchId ?? randomUUID();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO match (id, room_code, rules_version, seed, started_at, ended_at, status, winner_slot, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, room.code, RULES_VERSION, room.seed, room.startAt, this.deps.now(), status, winner, reason);
      const ins = db.prepare(
        `INSERT INTO match_player (match_id, slot, kind, name, pet_ref, reported_tick, crash_tick, report_valid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const p of room.players) {
        if (!p) continue;
        ins.run(id, p.slot, p.kind, p.name, p.petRef, p.reportedTick, p.verdict?.crash ?? null,
          p.verdict ? (p.verdict.valid ? 1 : 0) : null);
      }
    })();
  }

  // ---------- helpers ----------

  private freeSlot(room: Room): Slot | null {
    const now = this.deps.now();
    for (const s of [0, 1] as const) {
      const p = room.players[s];
      if (!p) return s;
      if (!p.conn && p.offlineSince !== null && now - p.offlineSince > LOBBY_SLOT_HOLD_MS) return s;
    }
    return null;
  }

  private newPlayer(slot: Slot, identity: string, kind: Player["kind"]): Player {
    return {
      slot, identity, kind, conn: null, helloed: false, ready: false,
      name: kind === "device" ? "Petto" : "Guest", petRef: null, traits: null, stage: null,
      offlineSince: this.deps.now(), offlineTimer: null, laneTicks: new Set(), reportedTick: null, verdict: null,
    };
  }

  private startMsg(room: Room) {
    return { type: "start", seed: room.seed, start_at: room.startAt, rules_version: RULES_VERSION, match_id: room.matchId };
  }

  private broadcastRoom(room: Room): void {
    const players = room.players.map((p) =>
      p
        ? {
            slot: p.slot, kind: p.kind, name: p.name, pet_ref: p.petRef, traits: p.traits, stage: p.stage,
            ready: p.ready, connected: p.conn !== null, crashed: p.verdict !== null,
          }
        : null,
    );
    for (const p of room.players) {
      if (p?.conn) this.send(p.conn, { type: "room", code: room.code, state: room.state, you: p.slot, players });
    }
  }

  private after(room: Room, ms: number, fn: () => void): void {
    room.timers.push(setTimeout(fn, ms));
  }

  private clearTimers(room: Room): void {
    room.timers.forEach(clearTimeout);
    room.timers = [];
    for (const p of room.players) {
      if (p?.offlineTimer) clearTimeout(p.offlineTimer);
      if (p) p.offlineTimer = null;
    }
  }

  private send(conn: Conn, msg: Record<string, unknown>): void {
    try {
      conn.send(JSON.stringify(msg));
    } catch {
      // socket already closing; its close handler cleans up
    }
  }

  private err(conn: Conn, code: string, message: string, extra: Record<string, unknown> = {}): void {
    this.send(conn, { type: "error", code, message, ...extra });
  }
}
