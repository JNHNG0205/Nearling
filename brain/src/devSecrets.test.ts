import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyDevSecrets } from "./devSecrets";

describe("dev secrets", () => {
  it("creates the keys once and reuses them on every start, so saved chats stay readable", () => {
    const dir = mkdtempSync(join(tmpdir(), "petto-"));
    const first: NodeJS.ProcessEnv = { DB_PATH: join(dir, "x.db"), MEMORY_MASTER_KEY: "" };
    expect(applyDevSecrets(first).sort()).toEqual(["MEMORY_MASTER_KEY", "SESSION_JWT_SECRET"]);
    const second: NodeJS.ProcessEnv = { DB_PATH: join(dir, "x.db") };
    applyDevSecrets(second);
    expect(second.MEMORY_MASTER_KEY).toBe(first.MEMORY_MASTER_KEY);
    expect(second.SESSION_JWT_SECRET).toBe(first.SESSION_JWT_SECRET);
    expect(Buffer.from(first.MEMORY_MASTER_KEY!, "base64")).toHaveLength(32);
    expect(readFileSync(join(dir, "dev-secrets.env"), "utf8")).toContain("MEMORY_MASTER_KEY=");
  });

  it("never overrides keys that are set", () => {
    const env: NodeJS.ProcessEnv = { DB_PATH: join(mkdtempSync(join(tmpdir(), "petto-")), "x.db"), MEMORY_MASTER_KEY: "set", SESSION_JWT_SECRET: "set" };
    expect(applyDevSecrets(env)).toEqual([]);
    expect(env.MEMORY_MASTER_KEY).toBe("set");
  });
});
