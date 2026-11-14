import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RULES_VERSION } from "@petto/race";
import { createApp } from "../app";
import { sha256 } from "../auth/guard";
import { testDeps } from "../test/deps";
import { attachWebSockets } from "./ws";

// HTTP routes plus one real WebSocket round trip through @hono/node-ws on a Node server.

const deps = testDeps({ now: () => Date.now() });
const app = createApp(deps);
let base = "";
let server: ReturnType<typeof serve>;

beforeAll(async () => {
  deps.db.prepare(
    "INSERT INTO device (id, hw_id, secret_hash, token_hash, pet_ref, owner_account, created_at) VALUES ('d1','hw','x',?,?,?,0)",
  ).run(sha256("devtok"), "pets-v8.nearling.testnet:1", "alice.testnet");
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, () => resolve());
  });
  attachWebSockets(server, app);
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

const post = (path: string) => fetch(`http://${base}${path}`, { method: "POST" });

function client(url: string, headers?: Record<string, string>) {
  // Node 22's WebSocket (undici) accepts non-standard `headers`, like the firmware's client does.
  const ws = new WebSocket(url, headers ? { headers } as never : undefined);
  const inbox: Record<string, unknown>[] = [];
  const waiters: (() => void)[] = [];
  ws.addEventListener("message", (e) => {
    inbox.push(JSON.parse(String(e.data)) as Record<string, unknown>);
    waiters.splice(0).forEach((w) => w());
  });
  const opened = new Promise<void>((res, rej) => {
    ws.addEventListener("open", () => res());
    ws.addEventListener("error", () => rej(new Error("ws error")));
  });
  async function next(type: string): Promise<Record<string, unknown>> {
    for (;;) {
      const i = inbox.findIndex((m) => m.type === type);
      if (i >= 0) return inbox.splice(i, 1)[0]!;
      await new Promise<void>((r) => waiters.push(r));
    }
  }
  return { ws, opened, next, say: (m: Record<string, unknown>) => ws.send(JSON.stringify(m)) };
}

describe("race routes", () => {
  it("creates a room, hands out two slots, then refuses a third", async () => {
    const { code } = (await (await post("/race/rooms")).json()) as { code: string };
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(await (await post(`/race/rooms/${code.toLowerCase()}/join`)).json()).toMatchObject({ slot: 0, race_token: expect.any(String) });
    expect(await (await post(`/race/rooms/${code}/join`)).json()).toMatchObject({ slot: 1 });
    expect((await post(`/race/rooms/${code}/join`)).status).toBe(409);
    expect((await post("/race/rooms/ZZZZZZ/join")).status).toBe(404);
  });

  it("refuses a WebSocket without a race token or device token", async () => {
    const { code } = (await (await post("/race/rooms")).json()) as { code: string };
    const h = { headers: { Upgrade: "websocket" } };
    expect((await app.request(`/race/ws?code=${code}`, h)).status).toBe(401);
    expect((await app.request(`/race/ws?code=${code}&race_token=nope`, h)).status).toBe(401);
    expect((await app.request(`/race/ws?code=${code}`, { headers: { ...h.headers, Authorization: "Device junk" } })).status).toBe(401);
    expect((await app.request("/race/ws?code=ZZZZZZ&race_token=x", h)).status).toBe(404);
  });

  it("runs a browser and a device through hello, ready and start over real sockets", async () => {
    const { code } = (await (await post("/race/rooms")).json()) as { code: string };
    const { race_token } = (await (await post(`/race/rooms/${code}/join`)).json()) as { race_token: string };
    const browser = client(`ws://${base}/race/ws?code=${code}&race_token=${race_token}`);
    const device = client(`ws://${base}/race/ws?code=${code}`, { Authorization: "Device devtok" });
    await Promise.all([browser.opened, device.opened]);
    browser.say({ type: "hello", rules_version: RULES_VERSION, name: "Tab" });
    device.say({ type: "hello", rules_version: RULES_VERSION, name: "Mochi", pet_ref: "pets-v8.nearling.testnet:1" });
    browser.say({ type: "ready" });
    device.say({ type: "ready" });
    const start = await browser.next("start");
    expect(start).toMatchObject({ rules_version: RULES_VERSION, seed: expect.any(Number) });
    expect(await device.next("start")).toEqual(start);
    browser.say({ type: "crash", tick: 5, inputs: [] }); // forged: replay decides
    device.say({ type: "crash", tick: null, inputs: [] });
    const result = await device.next("result");
    expect(result).toMatchObject({ valid: [false, true] });
    const match = await (await fetch(`http://${base}/race/matches/${String(result.match_id)}`)).json();
    expect(match).toMatchObject({ status: "finished", players: [{ kind: "browser", name: "Tab" }, { kind: "device", pet_ref: "pets-v8.nearling.testnet:1" }] });
    browser.ws.close();
    device.ws.close();
  });
});
