import { describe, expect, it } from "vitest";
import { isContractPanic } from "./near";

describe("isContractPanic", () => {
  it("detects contract panics", () => {
    expect(isContractPanic(new Error('HostError(GuestPanic { panic_msg: "E_UNKNOWN_PET: Unknown pet" })'))).toBe(true);
    expect(isContractPanic(new Error("E_NOT_OWNER: Only the owner"))).toBe(true);
  });
  it("treats network errors as retryable", () => {
    expect(isContractPanic(new Error("fetch failed"))).toBe(false);
    expect(isContractPanic(new Error("Server error 503"))).toBe(false);
  });
});
