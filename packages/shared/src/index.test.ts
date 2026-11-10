import { describe, expect, it } from "vitest";
import { displayState, formatPetRef, fuelLeft, parsePetRef } from "./index";

describe("petRef", () => {
  it("round-trips", () => {
    const ref = formatPetRef("pets-v8.nearling.testnet", "3");
    expect(parsePetRef(ref)).toEqual({ contract: "pets-v8.nearling.testnet", tokenId: "3" });
  });
  it("rejects bad refs", () => {
    expect(parsePetRef("pets-v8.nearling.testnet")).toBeNull();
    expect(parsePetRef("pets-v8.nearling.testnet:abc")).toBeNull();
    expect(parsePetRef(":3")).toBeNull();
    expect(parsePetRef("Bad Contract:3")).toBeNull();
  });
});

describe("fuelLeft", () => {
  it("counts whole thoughts", () => {
    expect(fuelLeft(19_343, 1_000)).toBe(19);
    expect(fuelLeft(999, 1_000)).toBe(0);
    expect(fuelLeft(5_000, 0)).toBe(0);
  });
});

describe("displayState", () => {
  it("fuel states win over care", () => {
    expect(displayState("Dormant", 100, false)).toBe("dormant");
    expect(displayState("Starving", 100, false)).toBe("starving");
    expect(displayState("Hungry", 100, true)).toBe("hungry");
  });
  it("ignores chain Sad and uses care mood", () => {
    expect(displayState("Sad", 80, false)).toBe("happy");
    expect(displayState("Happy", 20, false)).toBe("sad");
    expect(displayState("Happy", 80, true)).toBe("sleepy");
  });
});
