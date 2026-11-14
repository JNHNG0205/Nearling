import { describe, expect, it } from "vitest";
import { PETS_CONTRACT, SHIRTS_CONTRACT, tx } from "./chain";
import { relayEligible, relayFallback } from "./relay";

describe("relayEligible", () => {
  it("relays calls to our contracts with no NEAR attached (1 yocto at most)", () => {
    expect(relayEligible(tx.setSoul(PETS_CONTRACT, "1", "Brave."))).toBe(true);
    expect(relayEligible(tx.nftTransfer(PETS_CONTRACT, "bob.testnet", "1"))).toBe(true);
  });

  it("never relays attached NEAR: under NEP-366 the relayer would pay it, so the user signs normally", () => {
    expect(relayEligible(tx.feed(PETS_CONTRACT, "1", 10n ** 23n))).toBe(false);
    expect(relayEligible(tx.stake(PETS_CONTRACT, "1", 10n ** 24n))).toBe(false);
    expect(relayEligible(tx.claimShirt())).toBe(false);
    expect(SHIRTS_CONTRACT).toBe(tx.claimShirt().receiverId);
  });

  it("does not relay transfers, keys or other contracts", () => {
    expect(relayEligible(tx.transfer("bob.testnet", 1n))).toBe(false);
    expect(relayEligible(tx.addDeviceKey("alice.testnet", PETS_CONTRACT, "ed25519:abc", true))).toBe(false);
    expect(relayEligible(tx.validatorStake("pool.testnet", 10n ** 24n))).toBe(false);
  });
});

describe("relayFallback", () => {
  it("falls back to a normal transaction only when the brain refused before sending", () => {
    expect(relayFallback(422)).toBe(true);
    expect(relayFallback(429)).toBe(true);
    expect(relayFallback(503)).toBe(true);
  });

  it("never falls back after the relay may have sent it (no double feed)", () => {
    expect(relayFallback(502)).toBe(false);
    expect(relayFallback(500)).toBe(false);
    expect(relayFallback(401)).toBe(true); // session gone: nothing was sent, sign normally
  });
});
