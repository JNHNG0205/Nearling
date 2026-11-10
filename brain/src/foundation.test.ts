import { describe, expect, it } from "vitest";
import { createSealer } from "./crypto";
import { clean } from "./log";
import { openDb } from "./db/db";

describe("crypto", () => {
  it("round-trips and binds to the pet", () => {
    const s = createSealer(Buffer.alloc(32, 1));
    const blob = s.seal("pets-v8.nearling.testnet:1", "my exam is friday");
    expect(s.open("pets-v8.nearling.testnet:1", blob)).toBe("my exam is friday");
    expect(() => s.open("pets-v8.nearling.testnet:2", blob)).toThrow();
  });
});

describe("log", () => {
  it("never prints content fields", () => {
    expect(clean({ turn_id: "t1", text: "secret chat", reply: "x", cost_nano: 5 })).toEqual({
      turn_id: "t1", text: "[redacted]", reply: "[redacted]", cost_nano: 5,
    });
  });
});

describe("db", () => {
  it("applies migrations once", () => {
    const db = openDb(":memory:");
    const n = db.prepare("SELECT count(*) n FROM _migrations").get() as { n: number };
    expect(n.n).toBeGreaterThanOrEqual(1);
  });
});
