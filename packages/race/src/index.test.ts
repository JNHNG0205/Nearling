import { describe, expect, it } from "vitest";
import { decide, mulberry32, simulate, spawnGap, speed } from "./index";

// Golden vectors: the firmware C++ port must produce exactly these numbers.
export const GOLDEN = {
  rng42: [2581720956, 1925393290, 3661312704],
  races: [
    { seed: 1, switches: [], crash: 144 },
    { seed: 42, switches: [], crash: 144 },
    { seed: 42, switches: [10, 50, 90], crash: 99 },
    { seed: 123456789, switches: [5, 40, 77, 120, 160], crash: 189 },
    { seed: 4294967295, switches: [0], crash: 99 },
  ],
} as const;

describe("rules v1", () => {
  it("mulberry32 matches golden", () => {
    const r = mulberry32(42);
    expect([r(), r(), r()]).toEqual(GOLDEN.rng42);
  });

  it.each(GOLDEN.races)("seed $seed switches $switches crashes at $crash", ({ seed, switches, crash }) => {
    expect(simulate(seed, [...switches])).toBe(crash);
  });

  it("schedules shrink and speed up within bounds", () => {
    expect(spawnGap(0)).toBe(45);
    expect(spawnGap(100_000)).toBe(15);
    expect(speed(0)).toBe(200);
    expect(speed(100_000)).toBe(600);
  });

  it("decides results", () => {
    expect(decide(100, 120)).toEqual({ kind: "winner", slot: 1 });
    expect(decide(120, 100)).toEqual({ kind: "winner", slot: 0 });
    expect(decide(100, 100)).toEqual({ kind: "draw" });
    expect(decide(null, 100)).toEqual({ kind: "winner", slot: 0 });
    expect(decide(null, null)).toEqual({ kind: "draw" });
  });
});
