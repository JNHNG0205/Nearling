import { describe, expect, it } from "vitest";
import { MOVE_RESERVE, moveplan, validNameLabel } from "./nearName";

const NEAR = 10n ** 24n;

describe("validNameLabel", () => {
  it("matches the brain's rule for name.testnet", () => {
    expect(validNameLabel("hachi")).toBe(true);
    expect(validNameLabel("pet_99")).toBe(true);
    expect(validNameLabel("Hachi")).toBe(false);
    expect(validNameLabel("a")).toBe(false);
    expect(validNameLabel("x.y")).toBe(false);
  });
});

describe("moveplan", () => {
  const pet = (tokenId: string, staked = "0", pending = false) => ({ contract: "pets-v9.nearling.testnet", tokenId, name: `P${tokenId}`, staked, pending });

  it("moves pets with nothing planted and the NEAR above the reserve", () => {
    const plan = moveplan([pet("1"), pet("2", "1000"), pet("3", "0", true)], 10n * NEAR);
    expect(plan.move.map((p) => p.tokenId)).toEqual(["1"]);
    expect(plan.keep.map((p) => p.tokenId)).toEqual(["2", "3"]);
    expect(plan.nearYocto).toBe(10n * NEAR - MOVE_RESERVE);
  });

  it("moves no NEAR when there is less than the reserve", () => {
    expect(moveplan([], MOVE_RESERVE - 1n).nearYocto).toBe(0n);
  });

  it("is empty when the old account holds nothing worth moving", () => {
    const plan = moveplan([], 0n);
    expect(plan.move).toEqual([]);
    expect(plan.nearYocto).toBe(0n);
  });
});
