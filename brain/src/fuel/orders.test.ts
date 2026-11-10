import { describe, expect, it, vi } from "vitest";
import type { TxSigner } from "../chain/signer";
import { createApp } from "../app";
import { subscribe, type PetEvent } from "../events";
import { log } from "../log";
import { testDeps } from "../test/deps";
import type { NearRpc, TxStatus } from "../wallet/rpc";
import { parseTxStatus } from "../wallet/rpc";
import { createOneClick, type OneClick, type StatusResponse } from "./intents";
import { ordersModule, pollLive, runFeeder, type OrderRow, type OrdersIo } from "./orders";

const C = "pets-v8.nearling.testnet";
const REF = `${C}:1`;
const NEAR = 10n ** 24n;
const SNACK = NEAR / 10n;
const HASH = "4z9Lq8rB7nVtJbT3oLz2YkWm5sXqFv1hCdEaPgR6uNi";
const HASH2 = "5z9Lq8rB7nVtJbT3oLz2YkWm5sXqFv1hCdEaPgR6uNi";

function feedTx(o: Partial<{ hash: string; receiver: string; method: string; pet: unknown; deposit: bigint; success: boolean; fed: boolean; extra: boolean }> = {}): TxStatus {
  const receiver = o.receiver ?? C;
  return {
    hash: o.hash ?? HASH,
    signerId: "bob.testnet",
    receiverId: receiver,
    actions: [
      { kind: "FunctionCall", method: o.method ?? "feed", args: { pet_id: o.pet ?? "1" }, deposit: o.deposit ?? SNACK },
      ...(o.extra ? [{ kind: "Transfer" as const, deposit: 1n }] : []),
    ],
    success: o.success ?? true,
    events: o.fed === false ? [] : [{ executor: receiver, standard: "nearling", event: "fed", data: { pet_id: String(o.pet ?? "1") } }],
  };
}

function fakeRpc(txs: Record<string, TxStatus | null> = {}, balance = 10n * NEAR): NearRpc & { lookups: string[] } {
  const lookups: string[] = [];
  return {
    lookups,
    txStatus: async (h, sender) => {
      lookups.push(`${h}@${sender}`);
      return txs[h] ?? null;
    },
    viewAccount: async () => ({ amount: balance.toString() }),
  };
}

function fakeFeeder(fail = false): TxSigner & { calls: { contract: string; method: string; args: unknown; deposit?: bigint; gas?: number }[] } {
  const calls: { contract: string; method: string; args: unknown; deposit?: bigint; gas?: number }[] = [];
  return {
    accountId: "feeder.nearling.testnet",
    calls,
    async call(contract, method, args, opts) {
      calls.push({ contract, method, args, deposit: opts?.depositYocto, gas: opts?.gasTgas });
      if (fail) throw new Error("NotEnoughBalance");
      return { txHash: `feed-tx-${calls.length}`, events: [], logs: [] };
    },
  };
}

const noOneClick: OneClick = {
  tokens: async () => [],
  quote: async () => {
    throw new Error("unused");
  },
  status: async () => {
    throw new Error("unused");
  },
};

function setup(opts: { mode?: "direct" | "live" | "simulated"; io?: Partial<OrdersIo>; cap?: number } = {}) {
  const deps = testDeps();
  deps.cfg = {
    ...deps.cfg,
    INTENTS_MODE: opts.mode ?? "direct",
    SETTLEMENT_ACCOUNT_MAINNET: "nearling.near",
    FEEDER_DAILY_CAP_NEAR: opts.cap ?? 10,
  };
  const io: OrdersIo = { rpc: fakeRpc(), feeder: fakeFeeder(), oneclick: noOneClick, ...opts.io };
  const app = createApp(deps, [ordersModule(io)]);
  const events: PetEvent[] = [];
  subscribe(REF, (e) => events.push(e));
  const post = (path: string, body?: unknown) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const create = async (mode = "direct", pack_id = "snack") => {
    const res = await post("/orders", { pet_ref: REF, pack_id, mode });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; status: string };
  };
  const row = (id: string) => deps.db.prepare("SELECT * FROM feed_order WHERE id = ?").get(id) as OrderRow;
  return { deps, io, app, post, create, row, events, fuelAdded: () => events.filter((e) => e.type === "fuel_added") };
}

describe("GET /feed/packs", () => {
  it("lists packs and only direct by default", async () => {
    const { app } = setup();
    const body = (await (await app.request("/feed/packs")).json()) as { packs: { id: string; feed_yocto: string; fuel: number }[]; modes: string[]; live_quotes: string };
    expect(body.packs).toEqual([
      { id: "snack", name: "Snack", feed_yocto: SNACK.toString(), fuel: 20 },
      { id: "meal", name: "Meal", feed_yocto: (NEAR / 2n).toString(), fuel: 100 },
      { id: "feast", name: "Feast", feed_yocto: NEAR.toString(), fuel: 200 },
    ]);
    expect(body.modes).toEqual(["direct"]);
    expect(body.live_quotes).toBe("dry");
  });

  it("live mode also enables simulated", async () => {
    const { app } = setup({ mode: "live" });
    const body = (await (await app.request("/feed/packs")).json()) as { modes: string[] };
    expect(body.modes).toEqual(["direct", "live", "simulated"]);
  });
});

describe("POST /orders", () => {
  it("rejects disabled modes, unknown packs, foreign contracts, missing pets", async () => {
    const { post } = setup();
    expect((await post("/orders", { pet_ref: REF, pack_id: "snack", mode: "simulated" })).status).toBe(400);
    expect((await post("/orders", { pet_ref: REF, pack_id: "banquet" })).status).toBe(400);
    expect((await post("/orders", { pet_ref: "evil.testnet:1", pack_id: "snack" })).status).toBe(400);
    expect((await post("/orders", { pet_ref: `${C}:99`, pack_id: "snack" })).status).toBe(404);
  });
});

describe("direct orders", () => {
  it("verifies the tx on chain and feeds once", async () => {
    const rpc = fakeRpc({ [HASH]: feedTx() });
    const t = setup({ io: { rpc } });
    const o = await t.create();
    const res = await t.post(`/orders/${o.id}/direct-tx`, { tx_hash: HASH, signer_id: "bob.testnet" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; feed_tx: string; payer: string; label: null };
    expect(body).toMatchObject({ status: "fed", feed_tx: HASH, payer: "bob.testnet", label: null });
    expect(rpc.lookups).toEqual([`${HASH}@bob.testnet`]);
    // duplicate report: same answer, no second fuel_added
    expect((await (await t.post(`/orders/${o.id}/direct-tx`, { tx_hash: HASH })).json()) as { status: string }).toMatchObject({ status: "fed" });
    expect(t.fuelAdded()).toHaveLength(1);
    expect(t.fuelAdded()[0]!.data).toMatchObject({ order_id: o.id, fuel: 20, celebrate_id: o.id });
    // the same tx cannot pay a second order
    const o2 = await t.create();
    expect((await t.post(`/orders/${o2.id}/direct-tx`, { tx_hash: HASH })).status).toBe(409);
    expect(t.row(o2.id).status).toBe("created");
  });

  it("uses the pet owner as sender when no hint is given", async () => {
    const rpc = fakeRpc({ [HASH]: feedTx() });
    const t = setup({ io: { rpc } });
    const o = await t.create();
    await t.post(`/orders/${o.id}/direct-tx`, { tx_hash: HASH });
    expect(rpc.lookups).toEqual([`${HASH}@alice.testnet`]);
  });

  it.each([
    ["wrong pet", feedTx({ pet: "2" })],
    ["numeric pet id", feedTx({ pet: 1 })],
    ["wrong amount", feedTx({ deposit: SNACK - 1n })],
    ["wrong method", feedTx({ method: "nft_transfer" })],
    ["wrong contract", feedTx({ receiver: "evil.testnet" })],
    ["extra action", feedTx({ extra: true })],
    ["no fed event", feedTx({ fed: false })],
  ])("rejects a forged tx: %s", async (_name, tx) => {
    const t = setup({ io: { rpc: fakeRpc({ [HASH]: tx }) } });
    const o = await t.create();
    const res = await t.post(`/orders/${o.id}/direct-tx`, { tx_hash: HASH });
    expect(res.status).toBe(400);
    expect(t.row(o.id)).toMatchObject({ status: "created", settle_ref: null, feed_tx: null });
    expect(t.fuelAdded()).toHaveLength(0);
  });

  it("a failed feed tx fails the order", async () => {
    const t = setup({ io: { rpc: fakeRpc({ [HASH]: feedTx({ success: false }) }) } });
    const o = await t.create();
    const res = await t.post(`/orders/${o.id}/direct-tx`, { tx_hash: HASH });
    expect(((await res.json()) as { status: string }).status).toBe("failed");
    expect(t.fuelAdded()).toHaveLength(0);
  });

  it("stays pending until the tx is final, then settles", async () => {
    const txs: Record<string, TxStatus | null> = {};
    const t = setup({ io: { rpc: fakeRpc(txs) } });
    const o = await t.create();
    const first = await t.post(`/orders/${o.id}/direct-tx`, { tx_hash: HASH });
    expect(first.status).toBe(202);
    expect(t.row(o.id).status).toBe("pending");
    // a different hash while pending is refused
    expect((await t.post(`/orders/${o.id}/direct-tx`, { tx_hash: HASH2 })).status).toBe(409);
    txs[HASH] = feedTx();
    expect(((await (await t.post(`/orders/${o.id}/direct-tx`, { tx_hash: HASH })).json()) as { status: string }).status).toBe("fed");
  });

  it("rejects a malformed hash and non-direct orders", async () => {
    const t = setup({ mode: "simulated" });
    const o = await t.create();
    expect((await t.post(`/orders/${o.id}/direct-tx`, { tx_hash: "nope" })).status).toBe(400);
    const s = await t.create("simulated");
    expect((await t.post(`/orders/${s.id}/direct-tx`, { tx_hash: HASH })).status).toBe(409);
  });

  it("parses a raw RPC tx result", () => {
    const raw = {
      transaction: {
        hash: HASH, signer_id: "bob.testnet", receiver_id: C,
        actions: [{ FunctionCall: { method_name: "feed", args: Buffer.from('{"pet_id":"1"}').toString("base64"), gas: 30e12, deposit: SNACK.toString() } }],
      },
      status: { SuccessValue: "" },
      receipts_outcome: [{ outcome: { executor_id: C, logs: ['EVENT_JSON:{"standard":"nearling","version":"1.0.0","event":"fed","data":{"pet_id":"1"}}'] } }],
    };
    const tx = parseTxStatus(raw)!;
    expect(tx).toMatchObject({ signerId: "bob.testnet", receiverId: C, success: true });
    expect(tx.actions[0]).toEqual({ kind: "FunctionCall", method: "feed", args: { pet_id: "1" }, deposit: SNACK });
    expect(tx.events[0]).toMatchObject({ executor: C, event: "fed" });
    expect(parseTxStatus({ ...raw, status: "Started" })).toBeNull();
  });
});

describe("simulated orders and the feeder", () => {
  it("is off unless enabled", async () => {
    const t = setup({ mode: "direct" });
    const o = await t.create();
    expect((await t.post(`/orders/${o.id}/simulate-pay`)).status).toBe(404);
  });

  it("settles, feeds once with the pack amount, labels simulated", async () => {
    const feeder = fakeFeeder();
    const t = setup({ mode: "simulated", io: { feeder } });
    const o = await t.create("simulated", "meal");
    const res = await t.post(`/orders/${o.id}/simulate-pay`);
    expect(((await res.json()) as { label: string; simulated: boolean })).toMatchObject({ label: "simulated", simulated: true });
    // duplicate settlement notifications and concurrent worker ticks
    await t.post(`/orders/${o.id}/simulate-pay`);
    await Promise.all([runFeeder(t.deps, t.io), runFeeder(t.deps, t.io)]);
    await runFeeder(t.deps, t.io);
    expect(feeder.calls).toEqual([{ contract: C, method: "feed", args: { pet_id: "1" }, deposit: NEAR / 2n, gas: 30 }]);
    expect(t.row(o.id)).toMatchObject({ status: "fed", feed_tx: "feed-tx-1", settle_ref: `sim:${o.id}` });
    expect(t.fuelAdded()).toHaveLength(1);
  });

  it("waits in settled without a feeder", async () => {
    const t = setup({ mode: "simulated", io: { feeder: null } });
    const o = await t.create("simulated");
    await t.post(`/orders/${o.id}/simulate-pay`);
    await runFeeder(t.deps, t.io);
    expect(t.row(o.id).status).toBe("settled");
  });

  it("enforces the daily cap", async () => {
    const feeder = fakeFeeder();
    const t = setup({ mode: "simulated", cap: 1, io: { feeder } });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const o = await t.create("simulated", "meal");
      ids.push(o.id);
      t.deps.db.prepare("UPDATE feed_order SET status = 'settled', settle_ref = ? WHERE id = ?").run(`sim:${o.id}`, o.id);
    }
    const alert = vi.spyOn(log, "alert").mockImplementation(() => undefined);
    await runFeeder(t.deps, t.io);
    await runFeeder(t.deps, t.io);
    expect(feeder.calls).toHaveLength(2);
    expect(ids.map((id) => t.row(id).status)).toEqual(["fed", "fed", "settled"]);
    expect(alert).toHaveBeenCalledWith(expect.stringContaining("daily cap"), expect.anything());
    // next UTC day the cap resets
    t.deps.now = () => 1_800_000_000_000 + 86_400_000;
    await runFeeder(t.deps, t.io);
    expect(t.row(ids[2]!).status).toBe("fed");
    alert.mockRestore();
  });

  it("alerts on low balance and waits when the feeder cannot pay", async () => {
    const feeder = fakeFeeder();
    const t = setup({ mode: "simulated", io: { feeder, rpc: fakeRpc({}, NEAR / 2n) } });
    const alert = vi.spyOn(log, "alert").mockImplementation(() => undefined);
    const o = await t.create("simulated", "feast");
    await t.post(`/orders/${o.id}/simulate-pay`);
    await runFeeder(t.deps, t.io);
    expect(feeder.calls).toHaveLength(0);
    expect(t.row(o.id).status).toBe("settled");
    expect(alert).toHaveBeenCalledWith("feeder balance low", expect.anything());
    alert.mockRestore();
  });

  it("a failed feeder call fails the order and is not retried", async () => {
    const feeder = fakeFeeder(true);
    const t = setup({ mode: "simulated", io: { feeder } });
    const alert = vi.spyOn(log, "alert").mockImplementation(() => undefined);
    const o = await t.create("simulated");
    await t.post(`/orders/${o.id}/simulate-pay`);
    await runFeeder(t.deps, t.io);
    await runFeeder(t.deps, t.io);
    expect(feeder.calls).toHaveLength(1);
    expect(t.row(o.id).status).toBe("failed");
    expect(t.fuelAdded()).toHaveLength(0);
    alert.mockRestore();
  });
});

describe("live orders", () => {
  it("only asks 1Click for dry quotes without human confirmation", async () => {
    const quote = vi.fn(async () => ({ quote: { amountIn: "123", amountOut: SNACK.toString(), deadline: "2027-01-01T00:00:00Z" }, signature: "sig" }));
    const t = setup({ mode: "live", io: { oneclick: { ...noOneClick, quote } } });
    const res = await t.post("/orders", { pet_ref: REF, pack_id: "snack", mode: "live", origin_asset: "nep141:sol.omft.near", refund_to: "SoLAddr" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; quote_only: boolean; label: string; deposit_address: null };
    expect(body).toMatchObject({ status: "created", quote_only: true, deposit_address: null, label: "Paid on mainnet, fuel granted on testnet" });
    expect(quote).toHaveBeenCalledWith(expect.objectContaining({ dry: true, recipient: "nearling.near", amount: SNACK.toString() }));
    expect((await t.post("/orders", { pet_ref: REF, pack_id: "snack", mode: "live" })).status).toBe(400);
  });

  it("the client refuses non-dry quotes unless INTENTS_LIVE_CONFIRMED", async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const oc = createOneClick({ baseUrl: "https://1click.example", liveConfirmed: false, fetch });
    await expect(oc.quote({ dry: false } as never)).rejects.toThrow(/INTENTS_LIVE_CONFIRMED/);
    expect(fetch).not.toHaveBeenCalled();
    await oc.quote({ dry: true } as never);
    expect(fetch).toHaveBeenCalledWith("https://1click.example/v0/quote", expect.objectContaining({ method: "POST" }));
    await oc.status("abc");
    expect(fetch).toHaveBeenLastCalledWith("https://1click.example/v0/status?depositAddress=abc", expect.anything());
  });

  it("follows 1Click status; expired, refunded and failed never feed; success feeds once", async () => {
    const statuses: Record<string, StatusResponse["status"]> = {};
    const feeder = fakeFeeder();
    const t = setup({
      mode: "live",
      io: { feeder, oneclick: { ...noOneClick, status: async (addr) => ({ status: statuses[addr]! }) } },
    });
    const now = t.deps.now();
    const mk = (id: string, deadline: number) =>
      t.deps.db.prepare(
        `INSERT INTO feed_order (id, pet_ref, mode, pack_id, status, feed_yocto, deposit_address, deadline, created_at, updated_at)
         VALUES (?, ?, 'live', 'snack', 'quoted', ?, ?, ?, ?, ?)`,
      ).run(id, REF, SNACK.toString(), `addr-${id}`, deadline, now, now);
    mk("exp", now - 1);
    mk("ref", now + 60_000);
    mk("fail", now + 60_000);
    mk("ok", now + 60_000);
    statuses["addr-exp"] = "PENDING_DEPOSIT";
    statuses["addr-ref"] = "KNOWN_DEPOSIT_TX";
    statuses["addr-fail"] = "PROCESSING";
    statuses["addr-ok"] = "PROCESSING";
    await pollLive(t.deps, t.io);
    expect(["exp", "ref", "fail", "ok"].map((id) => t.row(id).status)).toEqual(["expired", "pending", "pending", "pending"]);
    statuses["addr-ref"] = "REFUNDED";
    statuses["addr-fail"] = "FAILED";
    statuses["addr-ok"] = "SUCCESS";
    await pollLive(t.deps, t.io);
    await pollLive(t.deps, t.io); // duplicate SUCCESS notification
    await runFeeder(t.deps, t.io);
    await pollLive(t.deps, t.io);
    await runFeeder(t.deps, t.io);
    expect(["exp", "ref", "fail", "ok"].map((id) => t.row(id).status)).toEqual(["expired", "refunded", "failed", "fed"]);
    expect(t.row("ok").settle_ref).toBe("1click:addr-ok");
    expect(feeder.calls).toHaveLength(1);
    expect(t.fuelAdded()).toHaveLength(1);
  });
});
