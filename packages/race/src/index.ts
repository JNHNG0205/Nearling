// Petto Run rules, version 1. Shared by brain (result validation), web (browser racer)
// and firmware (C++ port). Integer maths only so Node and the ESP32 agree bit for bit.
// Spec: "AI-brain architectual/06-race-arena.md". Changing anything here bumps RULES_VERSION.

export const RULES_VERSION = 1;
export const TICKS_PER_SECOND = 30;
export const MAX_TICKS = 120 * TICKS_PER_SECOND; // no crash in 120 s = draw

// Positions are px x 100 on a 240 px tall track.
export const PET_TOP = 200 * 100;
export const PET_HEIGHT = 16 * 100;
export const TRACK_END = 240 * 100;

/** mulberry32, returning a uint32 (no floats). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Ticks between obstacles: 45, shrinking by 1 every 150 ticks, floor 15. */
export function spawnGap(tick: number): number {
  return Math.max(15, 45 - Math.floor(tick / 150));
}

/** Obstacle speed in px x 100 per tick: 2 px, +0.5 px every 300 ticks, cap 6 px. */
export function speed(tick: number): number {
  return Math.min(600, 200 + Math.floor(tick / 300) * 50);
}

export interface Obstacle {
  lane: 0 | 1;
  y: number;
}

export interface RaceState {
  tick: number;
  lane: 0 | 1;
  nextSpawn: number;
  obstacles: Obstacle[];
  crashedAt: number | null;
}

export function initState(): RaceState {
  return { tick: 0, lane: 0, nextSpawn: 0, obstacles: [], crashedAt: null };
}

/**
 * Advance one tick. Order is part of the rules:
 * 1. apply a lane switch scheduled for this tick, 2. spawn, 3. move, 4. collide.
 */
export function step(s: RaceState, rng: () => number, switchNow: boolean): void {
  if (s.crashedAt !== null) return;
  const t = s.tick;
  if (switchNow) s.lane = s.lane === 0 ? 1 : 0;
  if (t >= s.nextSpawn) {
    s.obstacles.push({ lane: (rng() >>> 31) as 0 | 1, y: 0 });
    s.nextSpawn = t + spawnGap(t);
  }
  const v = speed(t);
  for (const o of s.obstacles) o.y += v;
  s.obstacles = s.obstacles.filter((o) => o.y < TRACK_END);
  for (const o of s.obstacles) {
    if (o.lane === s.lane && o.y >= PET_TOP && o.y < PET_TOP + PET_HEIGHT) {
      s.crashedAt = t;
      return;
    }
  }
  s.tick = t + 1;
}

/**
 * Replay a race. `switchTicks` are the ticks at which the player switched lanes
 * (duplicates ignored). Returns the crash tick, or null if alive at maxTicks.
 */
export function simulate(seed: number, switchTicks: number[], maxTicks = MAX_TICKS): number | null {
  const switches = new Set(switchTicks);
  const rng = mulberry32(seed);
  const s = initState();
  while (s.tick < maxTicks) {
    step(s, rng, switches.has(s.tick));
    if (s.crashedAt !== null) return s.crashedAt;
  }
  return null;
}

export type RaceResult =
  | { kind: "winner"; slot: 0 | 1 }
  | { kind: "draw" };

/** First crash loses; same tick or both alive = draw. */
export function decide(crash0: number | null, crash1: number | null): RaceResult {
  if (crash0 === crash1) return { kind: "draw" };
  if (crash0 === null) return { kind: "winner", slot: 0 };
  if (crash1 === null) return { kind: "winner", slot: 1 };
  return crash0 < crash1 ? { kind: "winner", slot: 1 } : { kind: "winner", slot: 0 };
}
