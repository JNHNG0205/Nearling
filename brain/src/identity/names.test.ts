import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { KeyPair } from "near-api-js";
import { issueSession } from "../auth/guard";
import { createApp } from "../app";
import { testDeps } from "../test/deps";
import { implicitPublicKey, nameRoutes, validNameLabel, type Registrar } from "./names";

const key = KeyPair.fromRandom("ed25519");
const implicit = Buffer.from(key.getPublicKey().data).toString("hex");

describe("validNameLabel", () => {
  it("accepts NEAR account labels", () => {
    for (const ok of ["jun", "hachi-ware", "pet_99", "a1"]) expect(validNameLabel(ok)).toBe(true);
  });
  it("rejects uppercase, dots, edge separators, too short or too long", () => {
    for (const bad of ["Jun", "jun.pet", "-jun", "jun-", "j", "a".repeat(57), "jun--pet", ""]) expect(validNameLabel(bad)).toBe(false);
  });
});

describe("implicitPublicKey", () => {
  it("turns a hex implicit account back into its ed25519 key", () => {
    expect(implicitPublicKey(implicit)).toBe(key.getPublicKey().toString());
  });
  it("is null for named accounts", () => {
    expect(implicitPublicKey("alice.testnet")).toBeNull();
  });
});

describe("/names", () => {
  const post = (body: unknown, token?: string) => ({
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

  function setup(taken = new Set<string>(["bob.testnet"]), ok = true) {
    const deps = testDeps();
    const created: { id: string; pk: string }[] = [];
    const registrar: Registrar = {
      exists: async (id) => taken.has(id),
      create: async (id, pk) => {
        created.push({ id, pk });
        taken.add(id);
        return ok;
      },
    };
    const app = createApp(deps, [{ name: "names", routes: (d) => new Hono().route("/", nameRoutes(d, registrar)) }]);
    return { app, deps, created };
  }

  it("creates name.testnet with the account's own key and remembers it", async () => {
    const { app, deps, created } = setup();
    const { token } = await issueSession(deps, implicit);
    const res = await app.request("/names", post({ name: "hachi" }, token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ account: implicit, name: "hachi.testnet" });
    expect(created).toEqual([{ id: "hachi.testnet", pk: key.getPublicKey().toString() }]);
    const got = await app.request(`/names/${implicit}`);
    expect(await got.json()).toEqual({ account: implicit, name: "hachi.testnet" });
  });

  it("needs a session", async () => {
    const { app } = setup();
    expect((await app.request("/names", post({ name: "hachi" }))).status).toBe(401);
  });

  it("gives one name per account", async () => {
    const { app, deps, created } = setup();
    const { token } = await issueSession(deps, implicit);
    await app.request("/names", post({ name: "hachi" }, token));
    const again = await app.request("/names", post({ name: "other" }, token));
    expect(again.status).toBe(409);
    expect(created).toHaveLength(1);
  });

  it("refuses taken and invalid names without creating anything", async () => {
    const { app, deps, created } = setup();
    const { token } = await issueSession(deps, implicit);
    expect((await app.request("/names", post({ name: "bob" }, token))).status).toBe(409);
    expect((await app.request("/names", post({ name: "Bad.Name" }, token))).status).toBe(400);
    expect(created).toEqual([]);
  });

  it("is only for email or Google (implicit) accounts: named wallets already have a name", async () => {
    const { app, deps } = setup();
    const { token } = await issueSession(deps, "alice.testnet");
    expect((await app.request("/names", post({ name: "alice2" }, token))).status).toBe(400);
  });

  it("does not remember a name the registrar failed to create", async () => {
    const { app, deps } = setup(new Set(), false);
    const { token } = await issueSession(deps, implicit);
    expect((await app.request("/names", post({ name: "hachi" }, token))).status).toBe(502);
    expect((await app.request(`/names/${implicit}`)).status).toBe(404);
  });

  it("stops creating names once the day's total is spent, whoever asks (the registrar pays for each)", async () => {
    const { app, deps, created } = setup();
    deps.cfg.NAMES_DAILY_TOTAL = 1;
    const other = Buffer.from(KeyPair.fromRandom("ed25519").getPublicKey().data).toString("hex");
    expect((await app.request("/names", post({ name: "first" }, (await issueSession(deps, implicit)).token))).status).toBe(200);
    const res = await app.request("/names", post({ name: "second" }, (await issueSession(deps, other)).token));
    expect(res.status).toBe(429);
    expect(created.map((c) => c.id)).toEqual(["first.testnet"]);
  });
});
