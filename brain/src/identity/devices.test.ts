import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { issueSession } from "../auth/guard";
import { subscribe } from "../events";
import { TEST_PET, testDeps } from "../test/deps";
import { deviceStatus, isEd25519Pk, pollPendingActions } from "./devices";

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

describe("Device key and pending actions", () => {
  const PK = "ed25519:BXWkER31HSLP1kSVvMduQHsJxyAopCrTkUfWbuLJ7AvH";
  const NS = (ms: number) => (BigInt(ms) * 1_000_000n).toString();

  it("validates device_pk on hello", async () => {
    const { app } = setup();
    expect(isEd25519Pk(PK)).toBe(true);
    expect(isEd25519Pk("ed25519:abc")).toBe(false);
    expect(isEd25519Pk("secp256k1:BXWkER31HSLP1kSVvMduQHsJxyAopCrTkUfWbuLJ7AvH")).toBe(false);
    const bad = await app.request("/devices/hello", json("POST", { hw_id: "hw-1", device_secret: "s".repeat(32), device_pk: "ed25519:0OIl" }));
    expect(bad.status).toBe(400);
  });

  it("GET /pets/:petRef/device reports pairing, key on chain and the owner's access key", async () => {
    const { deps, app, session, pair } = setup();
    const status = async (auth?: string) => app.request(`/pets/${PET}/device`, { headers: { Authorization: auth ?? (await session()) } });

    expect(await (await status()).json()).toEqual({
      paired: false, device_pk: null, last_seen_at: null, chain_device_pk: null, key_added: false, approval_mode: false, pantry_supported: false,
    });
    expect((await status(await session("bob.testnet"))).status).toBe(403);

    await app.request("/devices/hello", json("POST", { hw_id: "hw-1", device_secret: "s".repeat(32), device_pk: PK }));
    await pair();
    let asked: string | null = null;
    deps.chain.accessKeys = async (account) => {
      asked = account;
      return [
        { public_key: PK, access_key: { permission: { FunctionCall: { receiver_id: "pets-v8.nearling.testnet", method_names: ["play"] } } } },
      ];
    };
    deps.pets["1"] = { ...TEST_PET, device_pk: PK, approval_mode: true, pantry_yocto: "0" };
    const body = (await (await status()).json()) as Record<string, unknown>;
    expect(asked).toBe("alice.testnet");
    expect(body).toMatchObject({ paired: true, device_pk: PK, chain_device_pk: PK, key_added: true, approval_mode: true, pantry_supported: true });

    // A key for another contract does not count.
    deps.chain.accessKeys = async () => [
      { public_key: PK, access_key: { permission: { FunctionCall: { receiver_id: "pets-v7.nearling.testnet", method_names: [] } } } },
    ];
    expect(((await (await status()).json()) as { key_added: boolean }).key_added).toBe(false);
    deps.chain.accessKeys = async () => {
      throw new Error("fetch failed");
    };
    expect(((await (await status()).json()) as { key_added: boolean | null }).key_added).toBeNull();
  });

  it("GET /devices/actions returns live pending actions with a summary line", async () => {
    const { deps, app, pair } = setup();
    const token = await pair();
    const now = deps.now();
    let asked: unknown;
    deps.chain.view = (async (contract: string, method: string, args: unknown) => {
      asked = { contract, method, args };
      return [
        { id: "7", pet_id: "1", action: { Stake: { amount: "1000000000000000000000000" } }, deposit: "1000000000000000000000000", proposer_pk: "ed25519:x", expires_at_ns: NS(now + 60_000) },
        { id: "6", pet_id: "1", action: "Withdraw", deposit: "0", proposer_pk: "ed25519:x", expires_at_ns: NS(now - 1) },
      ];
    }) as typeof deps.chain.view;
    const res = await app.request("/devices/actions", { headers: { Authorization: `Device ${token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { actions: { id: string; summary: string; expires_at: number }[]; key_registered: boolean };
    expect(asked).toEqual({ contract: "pets-v8.nearling.testnet", method: "get_pending_actions", args: { pet_id: "1" } });
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0]).toMatchObject({ id: "7", summary: "Stake 1 NEAR", expires_at: now + 60_000 });
    expect(body.key_registered).toBe(false);

    // Owner sessions cannot use the device route; a transferred pet revokes the device.
    expect((await app.request("/devices/actions", { headers: { Authorization: "Bearer x" } })).status).toBe(401);
    deps.pets["1"] = { ...TEST_PET, owner: "bob.testnet" };
    expect((await app.request("/devices/actions", { headers: { Authorization: `Device ${token}` } })).status).toBe(403);
    expect(deviceStatus(deps.db, PET).paired).toBe(false);
  });

  it("publishes action_pending only when the list changes", async () => {
    const { deps, pair } = setup();
    await pair();
    let list: unknown[] = [];
    deps.chain.view = (async () => list) as typeof deps.chain.view;
    const seen: unknown[] = [];
    const stop = subscribe(PET, (e) => {
      if (e.type === "action_pending") seen.push(e.data);
    });
    const last = new Map<string, string>();

    await pollPendingActions(deps, last);
    expect(seen).toHaveLength(0); // nothing pending, nothing to say
    list = [
      { id: "1", pet_id: "1", action: { SetApprovalMode: { on: false } }, deposit: "0", proposer_pk: "ed25519:x", expires_at_ns: NS(deps.now() + 60_000) },
    ];
    await pollPendingActions(deps, last);
    await pollPendingActions(deps, last);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ actions: [{ id: "1", summary: "Turn approvals off" }] });
    list = [];
    await pollPendingActions(deps, last);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({ actions: [] });
    stop();
  });
});
