import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { issueSession } from "../auth/guard";
import { subscribe } from "../events";
import { TEST_PET, testDeps } from "../test/deps";
import { deviceStatus } from "./devices";

const PET = "pets-v8.nearling.testnet:1";
const json = (method: string, body?: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { "Content-Type": "application/json", ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const secretHeaders = (hw: string, secret: string) => ({ "X-Device-Id": hw, "X-Device-Secret": secret });

function setup() {
  let t = 1_800_000_000_000;
  const deps = testDeps({ now: () => t });
  const app = createApp(deps);
  const session = async (account = "alice.testnet") => `Bearer ${(await issueSession(deps, account)).token}`;
  const hello = async (hw = "hw-1", secret = "s".repeat(32)) =>
    (await app.request("/devices/hello", json("POST", { hw_id: hw, device_secret: secret, fw_version: "0.1" }))).json() as Promise<
      { bound: false; pairing: { token: string; qr_url: string; expires_at: number } } | { bound: true; pet_ref: string }
    >;
  const claim = async (token: string, auth?: string) =>
    app.request(`/pairings/${token}/claim`, json("POST", { pet_ref: PET }, { Authorization: auth ?? (await session()) }));
  const confirm = (hw = "hw-1", secret = "s".repeat(32)) =>
    app.request("/devices/pairing/confirm", json("POST", undefined, secretHeaders(hw, secret)));
  /** Full happy path; returns the device token. */
  const pair = async (hw = "hw-1", secret = "s".repeat(32)) => {
    const h = await hello(hw, secret);
    if (h.bound) throw new Error("already bound");
    expect((await claim(h.pairing.token)).status).toBe(200);
    const res = await confirm(hw, secret);
    expect(res.status).toBe(200);
    return ((await res.json()) as { device_token: string }).device_token;
  };
  return { deps, app, session, hello, claim, confirm, pair, advance: (ms: number) => (t += ms) };
}

describe("Hatch & Pair", () => {
  it("pairs a device end to end", async () => {
    const { deps, app, hello, claim, confirm } = setup();
    const events: string[] = [];
    const stop = subscribe(PET, (e) => events.push(e.type));

    const h = await hello();
    if (h.bound) throw new Error("expected unbound");
    expect(h.pairing.qr_url).toBe(`http://localhost:3000/hatch?t=${h.pairing.token}`);
    expect(Buffer.from(h.pairing.token, "base64url")).toHaveLength(16);
    expect((await hello()).bound).toBe(false); // a reboot reuses the open pairing
    expect(((await hello()) as { pairing: { token: string } }).pairing.token).toBe(h.pairing.token);

    expect(await (await app.request(`/pairings/${h.pairing.token}`)).json()).toMatchObject({ status: "open" });
    const c = await claim(h.pairing.token);
    expect(await c.json()).toEqual({ status: "awaiting_confirm" });

    const poll = await app.request("/devices/pairing", { headers: secretHeaders("hw-1", "s".repeat(32)) });
    expect(await poll.json()).toMatchObject({ status: "awaiting_confirm", pet_name: "Mochi" });

    const res = await confirm();
    expect(res.status).toBe(200);
    const { device_token, pet_ref } = (await res.json()) as { device_token: string; pet_ref: string };
    expect(pet_ref).toBe(PET);
    expect(events).toContain("paired");
    stop();

    // The token works on pet routes, and hello now reports the binding.
    const care = await app.request(`/pets/${PET}/care`, json("POST", { events: [] }, { Authorization: `Device ${device_token}` }));
    expect(care.status).toBe(200);
    expect(await hello()).toEqual({ bound: true, pet_ref: PET });
    expect(deviceStatus(deps.db, PET).paired).toBe(true);
    // Confirming again is rejected: the pairing is single use.
    expect((await confirm()).status).toBe(409);
  });

  it("rejects a wrong device secret", async () => {
    const { app, hello } = setup();
    await hello();
    const res = await app.request("/devices/hello", json("POST", { hw_id: "hw-1", device_secret: "x".repeat(32) }));
    expect(res.status).toBe(401);
    expect((await app.request("/devices/pairing", { headers: secretHeaders("hw-1", "x".repeat(32)) })).status).toBe(401);
  });

  it("never binds with an expired token", async () => {
    const { app, hello, claim, confirm, advance } = setup();
    const h = await hello();
    if (h.bound) throw new Error("expected unbound");
    advance(10 * 60_000);
    expect(await (await app.request(`/pairings/${h.pairing.token}`)).json()).toMatchObject({ status: "expired" });
    expect((await claim(h.pairing.token)).status).toBe(410);
    expect((await confirm()).status).toBe(410);
    // A new hello opens a fresh pairing.
    const again = await hello();
    expect(again.bound === false && again.pairing.token !== h.pairing.token).toBe(true);
  });

  it("expires a claimed pairing that was never confirmed", async () => {
    const { hello, claim, confirm, advance } = setup();
    const h = await hello();
    if (h.bound) throw new Error("expected unbound");
    await claim(h.pairing.token);
    advance(10 * 60_000);
    expect((await confirm()).status).toBe(410);
  });

  it("never binds with a reused token", async () => {
    const { hello, claim, pair, session } = setup();
    const h = await hello();
    if (h.bound) throw new Error("expected unbound");
    await pair();
    expect((await claim(h.pairing.token)).status).toBe(409);
    expect((await claim(h.pairing.token, await session("bob.testnet"))).status).toBe(409);
  });

  it("claims only for the pet's owner", async () => {
    const { hello, claim, session } = setup();
    const h = await hello();
    if (h.bound) throw new Error("expected unbound");
    expect((await claim(h.pairing.token, await session("bob.testnet"))).status).toBe(403);
    expect((await claim(h.pairing.token)).status).toBe(200);
  });

  it("a replacement device revokes the old one", async () => {
    const { app, pair } = setup();
    const oldToken = await pair("hw-old", "o".repeat(32));
    const newToken = await pair("hw-new", "n".repeat(32));
    const care = (token: string) => app.request(`/pets/${PET}/care`, json("POST", { events: [] }, { Authorization: `Device ${token}` }));
    expect((await care(oldToken)).status).toBe(401);
    expect((await care(newToken)).status).toBe(200);
  });

  it("re-pairing a device replaces its previous token", async () => {
    const { app, pair, session } = setup();
    const first = await pair();
    expect((await app.request(`/pets/${PET}/unpair`, json("POST", undefined, { Authorization: await session() }))).status).toBe(200);
    const second = await pair();
    const care = (token: string) => app.request(`/pets/${PET}/care`, json("POST", { events: [] }, { Authorization: `Device ${token}` }));
    expect((await care(first)).status).toBe(401);
    expect((await care(second)).status).toBe(200);
  });

  it("unpair is owner only and revokes the device", async () => {
    const { deps, app, pair, session } = setup();
    const token = await pair();
    const unpair = (auth: string) => app.request(`/pets/${PET}/unpair`, json("POST", undefined, { Authorization: auth }));
    expect((await unpair(`Device ${token}`)).status).toBe(401);
    expect((await unpair(await session("bob.testnet"))).status).toBe(403);
    expect((await unpair(await session())).status).toBe(200);
    expect(deviceStatus(deps.db, PET)).toEqual({ paired: false, last_seen_at: null });
  });

  it("a transferred pet drops the binding on hello", async () => {
    const { deps, hello, pair } = setup();
    await pair();
    deps.pets["1"] = { ...TEST_PET, owner: "bob.testnet" };
    expect((await hello()).bound).toBe(false);
    expect(deviceStatus(deps.db, PET).paired).toBe(false);
  });
});
