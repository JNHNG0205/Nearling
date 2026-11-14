import { describe, expect, it } from "vitest";
import { growth } from "./growth";

describe("growth", () => {
  it("an egg grows into a Baby by hatching", () => {
    expect(growth(0, 0)).toEqual({ xp: 0, next: "Baby", at: null, from: 0 });
  });

  it("a hatched Baby counts toward Teen at 100 XP", () => {
    expect(growth(0, 1)).toEqual({ xp: 0, next: "Teen", at: 100, from: 0 });
    expect(growth(42, 1)).toEqual({ xp: 42, next: "Teen", at: 100, from: 0 });
  });

  it("a Teen counts toward Adult at 500 XP", () => {
    expect(growth(120, 2)).toEqual({ xp: 120, next: "Adult", at: 500, from: 100 });
  });

  it("has no next stage once Adult", () => {
    expect(growth(500, 3)).toEqual({ xp: 500, next: null, at: null, from: 500 });
  });
});
