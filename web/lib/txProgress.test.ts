import { describe, expect, it } from "vitest";
import { txProgress, TX_BLOCKS } from "./txProgress";

describe("txProgress", () => {
  it("starts with one block and asks for the wallet", () => {
    expect(txProgress(0)).toEqual({ filled: 1, label: "Waiting for your wallet..." });
  });

  it("moves on to sending, then confirming, as time passes", () => {
    expect(txProgress(3_000).label).toBe("Sending to NEAR testnet...");
    expect(txProgress(8_000).label).toBe("NEAR is confirming. This takes a few seconds...");
  });

  it("fills fast, then slows, and never reaches the end before the transaction is done", () => {
    const at = (s: number) => txProgress(s * 1_000).filled;
    expect(at(2)).toBeGreaterThan(at(0));
    expect(at(6)).toBeGreaterThan(at(2));
    expect(at(60)).toBe(TX_BLOCKS - 1);
    expect(at(600)).toBe(TX_BLOCKS - 1);
  });
});
