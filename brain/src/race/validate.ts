import { MAX_TICKS, simulate } from "@nearling/race";

/** A player's own account of the race: crash tick (null = still alive) and every lane switch tick. */
export interface Report {
  tick: number | null;
  inputs: number[];
}

export interface Verdict {
  /** The crash tick the server accepts (null = alive at the end of the replay). */
  crash: number | null;
  /** False when the reported tick did not match the server's replay of the inputs. */
  valid: boolean;
}

const isTick = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < MAX_TICKS;

/** Parse an untrusted `crash` message. Returns null if it is malformed. */
export function parseReport(msg: { tick?: unknown; inputs?: unknown }): Report | null {
  const tick = msg.tick === null || msg.tick === undefined ? null : msg.tick;
  if (tick !== null && !isTick(tick)) return null;
  if (!Array.isArray(msg.inputs) || msg.inputs.length > MAX_TICKS) return null;
  if (!msg.inputs.every(isTick)) return null;
  return { tick, inputs: msg.inputs as number[] };
}

/**
 * 06 section 4. A reported crash is replayed with `simulate(seed, inputs, tick + 1)`; a mismatch makes
 * the report invalid and the server's full replay of the same inputs stands instead. "Still alive"
 * reports are always replayed in full: the inputs decide, never the claim.
 */
export function validate(seed: number, report: Report): Verdict {
  if (report.tick !== null && simulate(seed, report.inputs, report.tick + 1) === report.tick) {
    return { crash: report.tick, valid: true };
  }
  const replay = simulate(seed, report.inputs, MAX_TICKS);
  return { crash: replay, valid: report.tick === null };
}
