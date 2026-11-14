import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { issueSession } from "../auth/guard";
import type { Chain } from "../chain/near";
import { TEST_PET, testDeps } from "../test/deps";
import { battleHubFor } from "./routes";

const P = (id: string) => `pets.petto.testnet:${id}`;

function setup(owners: Record<string, string> = { "1": "alice.testnet", "2": "bob.testnet", "3": "alice.testnet" }) {
  const deps = testDeps({ pets: Object.fromEntries(Object.entries(owners).map(([id, owner]) => [id, { ...TEST_PET, id, owner }])) });
  deps.chain.view = (async (_c: string, method: string) => {
    if (method === "get_battle") return { level: 3, xp: 0, wins: 0, losses: 0, draws: 0, xp_today: 0, day: 0 };
    throw new Error(`unexpected view ${method}`);
  }) as Chain["view"];
  const app = createApp(deps);
  const post = async (account: string, path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${(await issueSession(deps, account)).token}` },
      body: JSON.stringify(body),
    });
  return { deps, post };
}

describe("battle routes", () => {
  it("creates a room for the owner's pet and lets another owner join", async () => {
    const { post } = setup();
    const created = await post("alice.testnet", "/battle/rooms", { pet_ref: P("1") });
    expect(created.status).toBe(200);
    const { code } = (await created.json()) as { code: string };
    expect((await post("bob.testnet", `/battle/rooms/${code}/join`, { pet_ref: P("2") })).status).toBe(200);
  });

  it("refuses a pet the caller does not own", async () => {
    const { post } = setup();
    const res = await post("bob.testnet", "/battle/rooms", { pet_ref: P("1") });
    expect(res.status).toBe(403);
  });

  it("refuses a second pet of the same owner", async () => {
    const { post } = setup();
    const { code } = (await (await post("alice.testnet", "/battle/rooms", { pet_ref: P("1") })).json()) as { code: string };
    const res = await post("alice.testnet", `/battle/rooms/${code}/join`, { pet_ref: P("3") });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("same_owner");
  });

  it("refuses a 4th battle of the same two pets on one day", async () => {
    const { deps, post } = setup();
    const hour = 3_600_000;
    for (let i = 0; i < 3; i++) {
      deps.db.prepare("INSERT INTO battle (id, pet_a, pet_b, winner, reason, created_at) VALUES (?, ?, ?, 0, 'ko', ?)").run(`b${i}`, P("2"), P("1"), deps.now() - (5 - i) * hour);
    }
    const { code } = (await (await post("alice.testnet", "/battle/rooms", { pet_ref: P("1") })).json()) as { code: string };
    const res = await post("bob.testnet", `/battle/rooms/${code}/join`, { pet_ref: P("2") });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string; retry_at: number } };
    expect(body.error.code).toBe("daily_limit");
    // a rolling 24 hours: the oldest of the three battles (5 h ago) frees a slot 19 h from now
    expect(body.error.retry_at).toBe(deps.now() + 19 * hour);
    expect(body.error.message).toBe("These two pets already battled 3 times in the last 24 hours.");
  });

  it("refuses a starving or dormant pet", async () => {
    const { deps, post } = setup();
    (deps as unknown as { pets: Record<string, typeof TEST_PET> }).pets["1"] = { ...TEST_PET, id: "1", owner: "alice.testnet", life_state: "Starving" };
    const res = await post("alice.testnet", "/battle/rooms", { pet_ref: P("1") });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("pet_unavailable");
  });
  it("answers 502 when the battle record cannot be read", async () => {
    const { deps, post } = setup();
    deps.chain.view = (async () => { throw new Error("rpc down"); }) as Chain["view"];
    const res = await post("alice.testnet", "/battle/rooms", { pet_ref: P("1") });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("upstream");
  });

  it("refuses a pet that is already in a battle", async () => {
    const { deps, post } = setup({ "1": "alice.testnet", "2": "bob.testnet", "4": "carol.testnet" });
    const { code } = (await (await post("alice.testnet", "/battle/rooms", { pet_ref: P("1") })).json()) as { code: string };
    await post("bob.testnet", `/battle/rooms/${code}/join`, { pet_ref: P("2") });
    const hub = battleHubFor(deps);
    const fake = { send: () => undefined, close: () => undefined };
    hub.open(code, 0, fake);
    hub.open(code, 1, fake);
    hub.message(code, 0, JSON.stringify({ type: "ready" }));
    hub.message(code, 1, JSON.stringify({ type: "ready" }));
    const res = await post("bob.testnet", "/battle/rooms", { pet_ref: P("2") });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("pet_busy");
  });
  it("lets a pet that left its own waiting room join someone else's", async () => {
    const { post } = setup();
    const mine = (await (await post("alice.testnet", "/battle/rooms", { pet_ref: P("1") })).json()) as { code: string };
    const theirs = (await (await post("bob.testnet", "/battle/rooms", { pet_ref: P("2") })).json()) as { code: string };
    const res = await post("alice.testnet", `/battle/rooms/${theirs.code}/join`, { pet_ref: P("1") });
    expect(res.status).toBe(200);
    expect(mine.code).not.toBe(theirs.code);
  });
});
