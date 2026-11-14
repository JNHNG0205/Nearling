import { describe, expect, it } from "vitest";
import { SIGN_IN_BLOCKS, signInProgress } from "./signInProgress";

describe("signInProgress", () => {
  it("names each step and counts it out of four", () => {
    expect(signInProgress("open", 0)).toMatchObject({ step: 1, label: "Opening sign-in..." });
    expect(signInProgress("check", 0)).toMatchObject({ step: 2, label: "Checking your login..." });
    expect(signInProgress("sign", 0)).toMatchObject({ step: 3, label: "Signing you in to Petto..." });
    expect(signInProgress("pets", 0)).toMatchObject({ step: 4, label: "Finding your pets..." });
  });

  it("fills a quarter per step and creeps inside the step without reaching the next one", () => {
    const per = SIGN_IN_BLOCKS / 4;
    expect(signInProgress("check", 0).filled).toBe(per + 1);
    expect(signInProgress("check", 60_000).filled).toBe(2 * per);
    expect(signInProgress("pets", 60_000).filled).toBe(SIGN_IN_BLOCKS);
    expect(signInProgress("open", 1_000).filled).toBeGreaterThanOrEqual(signInProgress("open", 0).filled);
  });
});
