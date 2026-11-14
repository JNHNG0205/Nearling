import { describe, expect, it } from "vitest";
import { actionSummary, displayState, formatPetRef, fuelLeft, parsePetRef, yoctoToNearText } from "./index";

describe("actionSummary", () => {
  it("writes one short line per pending action", () => {
    expect(yoctoToNearText("1500000000000000000000000")).toBe("1.5");
    expect(yoctoToNearText("2000000000000000000000000")).toBe("2");
    expect(actionSummary({ Stake: { amount: "1000000000000000000000000" } })).toBe("Stake 1 NEAR");
    expect(actionSummary({ Unstake: { amount: "500000000000000000000000" } })).toBe("Unstake 0.5 NEAR");
    expect(actionSummary("Withdraw")).toBe("Collect unstaked NEAR");
    expect(actionSummary({ SetApprovalMode: { on: false } })).toBe("Turn approvals off");
    expect(actionSummary({ Transfer: { receiver_id: "bob.testnet" } }, "Mochi")).toBe("Give Mochi to bob.testnet");
  });
});

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

describe("our event standard", () => {
  it("is petto on new contracts and nearling in the old history; nothing else", async () => {
    const { isOurEvent } = await import("./index");
    expect(isOurEvent("petto")).toBe(true);
    expect(isOurEvent("nearling")).toBe(true);
    expect(isOurEvent("nep171")).toBe(false);
    expect(isOurEvent(undefined)).toBe(false);
  });
});
