import { BRAIN_URL, BrainRequestError } from "./brain";

// Nearling Run client side: brain routes (AI-brain 08, Race) and the WebSocket protocol (06 section 3).

export type Slot = 0 | 1;

export interface RacePlayer {
  slot: Slot;
  kind: "browser" | "device";
  name: string;
  pet_ref: string | null;
  traits: number[] | null;
  stage: number | null;
  ready: boolean;
  connected: boolean;
  crashed: boolean;
}

export type ServerMsg =
  | { type: "room"; code: string; state: "lobby" | "running" | "finished" | "interrupted"; you: Slot; players: (RacePlayer | null)[] }
  | { type: "pong"; t_client: number; t_server: number }
  | { type: "start"; seed: number; start_at: number; rules_version: number; match_id: string }
  | { type: "opp_lane"; slot: Slot; tick: number; lane: 0 | 1 }
  | { type: "opp_crash"; slot: Slot; tick: number | null }
  | { type: "request_inputs" }
  | {
      type: "result"; match_id: string; winner_slot: Slot | null; draw: boolean;
      crash_ticks: [number | null, number | null]; valid: [boolean, boolean]; reason: "crash" | "same_tick" | "time";
    }
  | { type: "interrupted"; reason: string }
  | { type: "error"; code: string; message: string };

async function post<T>(path: string): Promise<T> {
  const res = await fetch(`${BRAIN_URL}${path}`, { method: "POST" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new BrainRequestError(res.status, body?.error?.code ?? "upstream");
  }
  return (await res.json()) as T;
}

export const createRoom = () => post<{ code: string }>("/race/rooms");

/**
 * One join per room code per tab, even if the page mounts twice before the first join returns
 * (React dev double-mount, fast back/forward). Two joins would take both free slots and the
 * second would get "race is full". A failed join is forgotten so the user can retry.
 */
const joining = new Map<string, Promise<{ race_token: string; slot: Slot }>>();
export function joinRoom(code: string): Promise<{ race_token: string; slot: Slot }> {
  const hit = joining.get(code);
  if (hit) return hit;
  const p = post<{ race_token: string; slot: Slot }>(`/race/rooms/${encodeURIComponent(code)}/join`);
  joining.set(code, p);
  p.catch(() => joining.delete(code));
  return p;
}

/** http(s)://brain -> ws(s)://brain/race/ws?... */
export function raceSocketUrl(code: string, raceToken: string): string {
  const u = new URL("/race/ws", BRAIN_URL);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.searchParams.set("code", code);
  u.searchParams.set("race_token", raceToken);
  return u.toString();
}

/** Room codes: 6 chars, no I, O, 0 or 1 (brain race/hub.ts). */
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);

/** Join token per room, kept for this tab so a reload rejoins the same slot. */
export function savedJoin(code: string): { race_token: string; slot: Slot } | null {
  try {
    const v = sessionStorage.getItem(`nearling.race.${code}`);
    return v ? (JSON.parse(v) as { race_token: string; slot: Slot }) : null;
  } catch {
    return null;
  }
}
export function saveJoin(code: string, j: { race_token: string; slot: Slot } | null): void {
  try {
    if (j) sessionStorage.setItem(`nearling.race.${code}`, JSON.stringify(j));
    else sessionStorage.removeItem(`nearling.race.${code}`);
  } catch {
    // storage blocked: a reload just joins again
  }
}

/**
 * Server clock offset from ping/pong: offset = t_server - (t_client + rtt / 2). Keeps the median of
 * the last 5 samples (06 section 3).
 */
export class ClockSync {
  private samples: number[] = [];
  add(tClient: number, tServer: number, tNow: number): void {
    this.samples.push(tServer - (tClient + (tNow - tClient) / 2));
    if (this.samples.length > 5) this.samples.shift();
  }
  get offset(): number {
    if (this.samples.length === 0) return 0;
    const s = [...this.samples].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
  }
  serverNow(): number {
    return Date.now() + this.offset;
  }
}

/** A stable look for a guest racer with no pet on chain: five 0..100 traits from the name. */
export function traitsFromName(name: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0;
  return Array.from({ length: 5 }, (_, i) => ((h >>> (i * 5)) & 0xff) % 101);
}
