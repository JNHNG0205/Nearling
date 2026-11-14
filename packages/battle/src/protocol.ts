// Battle WebSocket protocol between the brain (referee) and clients (web; the device later).
// docs/superpowers/specs/2026-11-14-pet-battle-design.md 3.2.
import type { BattleState, Move, TurnEvent } from "./index";

export interface BattlePet {
  petRef: string;
  name: string;
  traits: number[];
  /** battle level from the contract's get_battle */
  level: number;
  /** care stage (0 egg .. 3 adult), for the sprite */
  stageIndex: number;
  costume: string | null;
}

export type BattleClientMsg = { type: "ready" } | { type: "move"; move: Move };

export type EndReason = "ko" | "run" | "turns" | "forfeit";

export type BattleServerMsg =
  | { type: "room"; you: 0 | 1; code: string; pets: [BattlePet | null, BattlePet | null]; ready: [boolean, boolean] }
  | { type: "start"; state: BattleState; turnEndsAt: number }
  | { type: "turn"; events: TurnEvent[]; state: BattleState; turnEndsAt: number }
  | { type: "end"; winner: 0 | 1 | null; reason: EndReason; battleId: string; xp: [number, number] }
  | { type: "saved"; tx: string }
  | { type: "save_failed" }
  | { type: "error"; code: "illegal_move" | "already_moved" | "bad_message" | "not_started" };

/** Turn timer and disconnect grace (spec 3.2). */
export const TURN_MS = 20_000;
export const GRACE_MS = 30_000;
