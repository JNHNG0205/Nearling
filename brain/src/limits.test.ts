import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createLimiter } from "./limits";
import { testDeps } from "./test/deps";

describe("createLimiter", () => {
  it("allows max hits per window, then says when to retry; a new window starts fresh", () => {
    let t = 0;
    const l = createLimiter(() => t);
    for (let i = 0; i < 3; i++) expect(l.take("k", 3, 60_000)).toEqual({ ok: true });
    t = 20_000;
    expect(l.take("k", 3, 60_000)).toEqual({ ok: false, retryAfterS: 40 });
    t = 60_000;
    expect(l.take("k", 3, 60_000)).toEqual({ ok: true });
  });

  it("keys are counted apart", () => {
    const l = createLimiter(() => 0);
    expect(l.take("a", 1, 1000).ok).toBe(true);
    expect(l.take("b", 1, 1000).ok).toBe(true);
    expect(l.take("a", 1, 1000).ok).toBe(false);
  });
});

describe("API limits", () => {
  const from = (ip: string, init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers as object), "X-Forwarded-For": ip } });

  it("refuses the 31st sign-in nonce a minute from one address, with Retry-After; other addresses still pass", async () => {
    const app = createApp(testDeps());
    for (let i = 0; i < 30; i++) expect((await app.request("/auth/nonce", from("1.2.3.4"))).status).toBe(200);
    const res = await app.request("/auth/nonce", from("1.2.3.4"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
    expect((await app.request("/auth/nonce", from("5.6.7.8"))).status).toBe(200);
  });

  it("uses the address the proxy added (the last X-Forwarded-For entry), so a client cannot pick its own", async () => {
    const app = createApp(testDeps());
    for (let i = 0; i < 30; i++) await app.request("/auth/nonce", from(`9.9.9.${i}, 1.2.3.4`));
    expect((await app.request("/auth/nonce", from("8.8.8.8, 1.2.3.4"))).status).toBe(429);
  });

  it("limits only the listed method: polling an order is not counted as creating one", async () => {
    const app = createApp(testDeps());
    for (let i = 0; i < 15; i++) expect((await app.request("/orders/none", from("1.1.1.1"))).status).not.toBe(429);
    const post = { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } };
    for (let i = 0; i < 10; i++) expect((await app.request("/orders", from("1.1.1.1", post))).status).not.toBe(429);
    expect((await app.request("/orders", from("1.1.1.1", post))).status).toBe(429);
  });

  it("refuses a body over 64 KB with 413", async () => {
    const app = createApp(testDeps());
    const res = await app.request("/session", from("2.2.2.2", { method: "POST", body: "x".repeat(70 * 1024), headers: { "Content-Type": "application/json" } }));
    expect(res.status).toBe(413);
  });

  it("never limits /health", async () => {
    const app = createApp(testDeps());
    for (let i = 0; i < 700; i++) await app.request("/health", from("3.3.3.3"));
    expect((await app.request("/health", from("3.3.3.3"))).status).toBe(200);
  });
});
