import { randomBytes, randomInt } from "node:crypto";
import { addXp, DAILY_XP_CAP, isLegal, mulberry32, newBattle, resolveTurn, xpFor, type BattleState, type Move } from "@petto/battle";
import { GRACE_MS, TURN_MS, type BattlePet, type BattleServerMsg, type EndReason } from "@petto/battle/protocol";
import { parsePetRef } from "@petto/shared";
import type { Deps } from "../deps";
import { publish } from "../events";
import { log } from "../log";
import { uuidv7 } from "../talk/talk";

// Battle rooms refereed by the brain (spec 3.2): both players pick blind, the brain resolves the
// turn with the battle's seeded RNG and broadcasts it; at the end it records one battle row and
// queues one on-chain `record_battle` (record.ts).

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
const ROOM_TTL_MS = 30 * 60_000;
const MAX_ROOMS = 500;

/** A WebSocket as the hub sees it (node-ws in production, fakes in tests). */
export interface Conn {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface Entrant {
  account: string;
  pet: BattlePet;
  /** from `get_battle` when the pet entered: XP toward the next level, XP earned on `day` (UTC day index) */
  xp?: number;
  xpToday?: number;
  day?: number;
}

type Slot = 0 | 1;

interface Player extends Entrant {
  conn: Conn | null;
  ready: boolean;
  goneTimer: NodeJS.Timeout | null;
}

interface Room {
  code: string;
  /** created, started or finished: rooms idle past ROOM_TTL_MS are dropped (never a running battle) */
  touchedAt: number;
  players: [Player, Player | null];
  state: BattleState | null;
  rng: () => number;
  moves: [Move | null, Move | null];
  turnTimer: NodeJS.Timeout | null;
  turnEndsAt: number;
  battleId: string | null;
  done: boolean;
  /** resent to a player who reconnects after the end */
  endMsg: BattleServerMsg | null;
  savedMsg: BattleServerMsg | null;
}

export type JoinResult = { slot: 1 } | { error: "not_found" | "full" | "same_owner" | "same_pet" | "other_contract" };

const other = (s: Slot): Slot => (s === 0 ? 1 : 0);
const DAY_MS = 86_400_000;

export class BattleHub {
  private rooms = new Map<string, Room>();
  private byBattle = new Map<string, Room>();
  private newSeed: () => number;

  constructor(private deps: Deps, opts: { newSeed?: () => number } = {}) {
    this.newSeed = opts.newSeed ?? (() => randomBytes(4).readUInt32BE(0));
  }

  createRoom(host: Entrant): string | null {
    this.sweep();
    if (this.rooms.size >= MAX_ROOMS) return null;
    let code = "";
    do code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    while (this.rooms.has(code));
    this.rooms.set(code, {
      code, touchedAt: this.deps.now(), players: [this.player(host), null], state: null,
      rng: () => 0, moves: [null, null], turnTimer: null, turnEndsAt: 0, battleId: null, done: false,
      endMsg: null, savedMsg: null,
    });
    return code;
  }

  join(rawCode: string, guest: Entrant): JoinResult {
    const room = this.rooms.get(rawCode.toUpperCase());
    if (!room) return { error: "not_found" };
    const host = room.players[0];
    if (host.pet.petRef === guest.pet.petRef) return { error: "same_pet" };
    if (host.account === guest.account) return { error: "same_owner" };
    // record_battle scores both pets on one contract, so both must live on it (normal or demo speed)
    if (parsePetRef(host.pet.petRef)?.contract !== parsePetRef(guest.pet.petRef)?.contract) return { error: "other_contract" };
    const seated = room.players[1];
    if (seated && seated.account !== guest.account) return { error: "full" };
    if (seated && seated.pet.petRef === guest.pet.petRef) {
      this.broadcastRoom(room); // joined again with the same pet: keep the seat and socket
      return { slot: 1 };
    }
    if (room.state) return { error: "full" }; // no swapping pets once the battle started
    // a new guest, or the same guest picking another pet before the start (keeps their socket)
    room.players[1] = seated ? { ...seated, pet: guest.pet, ready: false } : this.player(guest);
    this.broadcastRoom(room);
    return { slot: 1 };
  }

  /** The caller's seat in a room, if they created or joined it. */
  slotOf(rawCode: string, account: string): Slot | null {
    const room = this.rooms.get(rawCode.toUpperCase());
    if (!room) return null;
    if (room.players[0].account === account) return 0;
    return room.players[1]?.account === account ? 1 : null;
  }

  /** The room's two pets (for the daily pair limit check). */
  petsOf(rawCode: string): [BattlePet, BattlePet | null] | null {
    const room = this.rooms.get(rawCode.toUpperCase());
    return room ? [room.players[0].pet, room.players[1]?.pet ?? null] : null;
  }

  open(rawCode: string, slot: Slot, conn: Conn): void {
    const room = this.rooms.get(rawCode.toUpperCase());
    const p = room?.players[slot];
    if (!room || !p) return conn.close(4004, "gone");
    if (p.conn && p.conn !== conn) p.conn.close(4009, "replaced");
    p.conn = conn;
    if (p.goneTimer) clearTimeout(p.goneTimer);
    p.goneTimer = null;
    this.send(p, this.roomMsg(room, slot));
    if (room.state && !room.done) this.send(p, { type: "start", state: room.state, turnEndsAt: room.turnEndsAt });
    if (room.endMsg) this.send(p, room.endMsg);
    if (room.savedMsg) this.send(p, room.savedMsg);
  }

  close(rawCode: string, slot: Slot, conn: Conn): void {
    const room = this.rooms.get(rawCode.toUpperCase());
    const p = room?.players[slot];
    if (!room || !p || p.conn !== conn) return;
    p.conn = null;
    if (!room.state || room.done) return;
    // in a battle: a short grace to come back, then the other pet wins (or void if both are gone)
    p.goneTimer = setTimeout(() => {
      p.goneTimer = null;
      if (room.done) return;
      const foe = room.players[other(slot)];
      if (!foe?.conn) return this.void(room);
      this.finish(room, other(slot), "forfeit", false);
    }, GRACE_MS);
  }

  message(rawCode: string, slot: Slot, raw: string): void {
    const room = this.rooms.get(rawCode.toUpperCase());
    const p = room?.players[slot];
    if (!room || !p) return;
    let msg: { type?: unknown; move?: unknown };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return this.send(p, { type: "error", code: "bad_message" });
    }
    if (msg.type === "ready") {
      p.ready = true;
      if (!room.state && room.players[1]?.ready && room.players[0].ready) this.start(room);
      else this.broadcastRoom(room);
      return;
    }
    if (msg.type !== "move") return this.send(p, { type: "error", code: "bad_message" });
    if (!room.state || room.done) return this.send(p, { type: "error", code: "not_started" });
    const move = parseMove(msg.move);
    if (!move) return this.send(p, { type: "error", code: "bad_message" });
    if (room.moves[slot]) return this.send(p, { type: "error", code: "already_moved" });
    if (!isLegal(room.state, slot, move)) return this.send(p, { type: "error", code: "illegal_move" });
    room.moves[slot] = move;
    if (room.moves[0] && room.moves[1]) this.resolve(room);
  }

  /**
   * Frees a pet for a new room: leaves any waiting room it sits in (a host's room closes, a
   * guest's seat opens). False while it fights in a running battle. `exceptCode`: the room the
   * pet is joining again.
   */
  release(petRef: string, exceptCode?: string): boolean {
    const mine = [...this.rooms.values()].filter(
      (r) => r.code !== exceptCode && !r.done && r.players.some((p) => p?.pet.petRef === petRef),
    );
    if (mine.some((r) => r.state)) return false;
    for (const room of mine) {
      if (room.players[0].pet.petRef === petRef) {
        for (const p of room.players) p?.conn?.close(4004, "gone");
        this.rooms.delete(room.code);
      } else {
        room.players[1]?.conn?.close(4004, "gone");
        room.players[1] = null;
        this.broadcastRoom(room);
      }
    }
    return true;
  }

  /** From the record worker: the battle's chain write landed (tx) or gave up (null). */
  notifySaved(battleId: string, tx: string | null): void {
    const room = this.byBattle.get(battleId);
    if (!room) return;
    room.savedMsg = tx ? { type: "saved", tx } : { type: "save_failed" };
    for (const p of room.players) if (p) this.send(p, room.savedMsg);
  }

  private start(room: Room): void {
    const [a, b] = [room.players[0], room.players[1]!];
    room.state = newBattle(a.pet, b.pet);
    room.rng = mulberry32(this.newSeed());
    room.battleId = uuidv7(this.deps.now());
    room.touchedAt = this.deps.now();
    this.byBattle.set(room.battleId, room);
    this.armTurn(room);
    this.broadcast(room, { type: "start", state: room.state, turnEndsAt: room.turnEndsAt });
  }

  private armTurn(room: Room): void {
    room.moves = [null, null];
    room.turnEndsAt = this.deps.now() + TURN_MS;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnTimer = setTimeout(() => {
      room.turnTimer = null;
      if (room.done || !room.state) return;
      room.moves = [room.moves[0] ?? { kind: "attack" }, room.moves[1] ?? { kind: "attack" }];
      this.resolve(room);
    }, TURN_MS);
  }

  private resolve(room: Room): void {
    if (!room.state || room.done) return;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnTimer = null;
    const { state, events } = resolveTurn(room.state, [room.moves[0]!, room.moves[1]!], room.rng);
    room.state = state;
    if (state.over) {
      this.broadcast(room, { type: "turn", events, state, turnEndsAt: 0 });
      const ran = state.over.reason === "run" && state.over.winner !== null;
      return this.finish(room, state.over.winner, state.over.reason, ran);
    }
    this.armTurn(room);
    this.broadcast(room, { type: "turn", events, state, turnEndsAt: room.turnEndsAt });
  }

  /** Ends the battle: one battle row, one on-chain record job, the `end` message and inbox events. */
  private finish(room: Room, winner: Slot | null, reason: EndReason, loserRan: boolean): void {
    if (room.done) return;
    room.done = true;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    const [a, b] = [room.players[0], room.players[1]!];
    const id = room.battleId!;
    const lv: [number, number] = [a.pet.level, b.pet.level];
    const today = Math.floor(this.deps.now() / DAY_MS);
    const xpOf = (s: Slot): number => {
      const gain = winner === null ? xpFor("draw", lv[s], lv[other(s)])
        : s === winner ? xpFor("win", lv[s], lv[other(s)])
        : xpFor(loserRan ? "ran" : "loss", lv[s], lv[other(s)]);
      const p = room.players[s]!;
      const used = p.day === today ? (p.xpToday ?? 0) : 0;
      return Math.min(gain, Math.max(0, DAILY_XP_CAP - used)); // as record_battle will apply it
    };
    const w = winner ?? 0; // a draw records pet A as "winner" with draw = true
    const now = this.deps.now();
    const winRef = parsePetRef(room.players[w]!.pet.petRef)!;
    const loseRef = parsePetRef(room.players[other(w)]!.pet.petRef)!;
    this.deps.db.transaction(() => {
      this.deps.db.prepare("INSERT INTO battle (id, pet_a, pet_b, winner, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, a.pet.petRef, b.pet.petRef, winner, reason, now);
      this.deps.db.prepare(
        "INSERT INTO battle_job (battle_id, contract, args, status, next_attempt_at, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?, ?)",
      ).run(id, winRef.contract, JSON.stringify({
        winner: winRef.tokenId, loser: loseRef.tokenId, draw: winner === null, loser_ran: loserRan, battle_id: id,
      }), now, now, now);
    })();
    const xp: [number, number] = [xpOf(0), xpOf(1)];
    const levelAfter = (s: Slot) => addXp(lv[s], room.players[s]!.xp ?? 0, xp[s]).level;
    room.endMsg = { type: "end", winner, reason, battleId: id, xp, levels: [[lv[0], levelAfter(0)], [lv[1], levelAfter(1)]] };
    room.touchedAt = now;
    this.broadcast(room, room.endMsg);
    for (const s of [0, 1] as const) {
      publish(room.players[s]!.pet.petRef, "battle_result", { battle_id: id, won: winner === s, draw: winner === null });
    }
    log.info("battle finished", { battle_id: id, reason });
  }

  private void(room: Room): void {
    room.done = true;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    log.info("battle void", { battle_id: room.battleId });
  }

  private player(e: Entrant): Player {
    return { ...e, conn: null, ready: false, goneTimer: null };
  }

  private roomMsg(room: Room, you: Slot): BattleServerMsg {
    return {
      type: "room", you, code: room.code,
      pets: [room.players[0].pet, room.players[1]?.pet ?? null],
      ready: [room.players[0].ready, room.players[1]?.ready ?? false],
    };
  }

  private broadcastRoom(room: Room): void {
    for (const s of [0, 1] as const) {
      const p = room.players[s];
      if (p) this.send(p, this.roomMsg(room, s));
    }
  }

  private broadcast(room: Room, msg: BattleServerMsg): void {
    for (const p of room.players) if (p) this.send(p, msg);
  }

  private send(p: Player, msg: BattleServerMsg): void {
    p.conn?.send(JSON.stringify(msg));
  }

  /** Drops rooms past their lifetime (finished or abandoned). */
  private sweep(): void {
    const cutoff = this.deps.now() - ROOM_TTL_MS;
    for (const [code, room] of this.rooms) {
      if (room.touchedAt >= cutoff || (room.state && !room.done)) continue;
      if (room.turnTimer) clearTimeout(room.turnTimer);
      this.rooms.delete(code);
      if (room.battleId) this.byBattle.delete(room.battleId);
    }
  }
}

function parseMove(raw: unknown): Move | null {
  const m = raw as { kind?: unknown; skill?: unknown } | null;
  if (m?.kind === "attack" || m?.kind === "defend" || m?.kind === "dodge" || m?.kind === "run") return { kind: m.kind };
  if (m?.kind === "skill" && typeof m.skill === "string" && m.skill.length <= 32) return { kind: "skill", skill: m.skill };
  return null;
}
