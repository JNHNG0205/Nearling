import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { testDeps } from "../test/deps";
import { issueSession, requirePetAccess, sha256, type AuthEnv } from "./guard";

function app(deps: ReturnType<typeof testDeps>) {
  const a = new Hono<AuthEnv>();
  a.get("/pets/:petRef/x", requirePetAccess(deps), (c) => c.json(c.get("caller")));
  return a;
}
const PATH = "/pets/pets.petto.testnet:1/x";

describe("auth guard", () => {
  it("accepts the owner's session and rejects others", async () => {
    const deps = testDeps();
    const owner = await issueSession(deps, "alice.testnet");
    const other = await issueSession(deps, "bob.testnet");
    expect((await app(deps).request(PATH, { headers: { Authorization: `Bearer ${owner.token}` } })).status).toBe(200);
    expect((await app(deps).request(PATH, { headers: { Authorization: `Bearer ${other.token}` } })).status).toBe(403);
    expect((await app(deps).request(PATH)).status).toBe(401);
    expect((await app(deps).request(PATH, { headers: { Authorization: "Bearer junk" } })).status).toBe(401);
  });

  it("accepts a bound device and revokes it after a transfer", async () => {
    const deps = testDeps();
    deps.db.prepare(
      "INSERT INTO device (id, hw_id, secret_hash, token_hash, pet_ref, owner_account, created_at) VALUES ('d1','hw','x',?,?,?,0)",
    ).run(sha256("tok"), "pets.petto.testnet:1", "alice.testnet");
    const h = { headers: { Authorization: "Device tok" } };
    expect((await app(deps).request(PATH, h)).status).toBe(200);
    deps.pets["1"] = { ...deps.pets["1"]!, owner: "bob.testnet" };
    expect((await app(deps).request(PATH, h)).status).toBe(403);
    expect((await app(deps).request(PATH, h)).status).toBe(401); // revoked now
  });
});
