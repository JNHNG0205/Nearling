import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("treats a blank NAME= line in .env as unset, so the default applies", () => {
    const cfg = loadConfig({ SESSION_JWT_SECRET: "", BRAIN_ACCOUNT_ID: "  ", FEEDER_KEY: "" });
    expect(cfg.SESSION_JWT_SECRET).toBe(loadConfig({}).SESSION_JWT_SECRET);
    expect(cfg.SESSION_JWT_SECRET.length).toBeGreaterThan(0);
    expect(cfg.BRAIN_ACCOUNT_ID).toBe("brain.petto.testnet");
    expect(cfg.FEEDER_KEY).toBe("");
  });

  it("keeps values that are set", () => {
    expect(loadConfig({ BRAIN_ACCOUNT_ID: "other.testnet" }).BRAIN_ACCOUNT_ID).toBe("other.testnet");
  });
});
