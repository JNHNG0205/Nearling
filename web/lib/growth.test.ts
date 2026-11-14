import { describe, expect, it } from "vitest";
import { growth } from "./growth";

describe("growth", () => {
  it("counts toward the next stage from the contract's thresholds (10, 100, 500 XP)", () => {
    expect(growth(0)).toEqual({ xp: 0, next: "Baby", at: 10, from: 0 });
    expect(growth(12)).toEqual({ xp: 12, next: "Teen", at: 100, from: 10 });
    expect(growth(120)).toEqual({ xp: 120, next: "Adult", at: 500, from: 100 });
  });

  it("has no next stage once Adult", () => {
    expect(growth(500)).toEqual({ xp: 500, next: null, at: 500, from: 500 });
  });
});
