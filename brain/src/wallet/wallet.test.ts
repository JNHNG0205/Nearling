import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { issueSession, sha256 } from "../auth/guard";
import { subscribe, type PetEvent } from "../events";
import { testDeps } from "../test/deps";
import type { NearRpc, TxStatus } from "./rpc";
import { APPROVAL_TTL_MS, checkApprovalTx, walletModule, type ApprovalRow } from "./wallet";

const C = "pets-v8.nearling.testnet";
const REF = `${C}:1`;
const NEAR = 10n ** 24n;
const H1 = "4z9Lq8rB7nVtJbT3oLz2YkWm5sXqFv1hCdEaPgR6uNi";
const H2 = "5z9Lq8rB7nVtJbT3oLz2YkWm5sXqFv1hCdEaPgR6uNi";
const H3 = "6z9Lq8rB7nVtJbT3oLz2YkWm5sXqFv1hCdEaPgR6uNi";
const VALIDATOR = "stakely_v2.pool.f863973.m0";

const sendTx = (hash: string, o: Partial<{ signer: string; receiver: string; deposit: bigint; success: boolean }> = {}): TxStatus => ({
  hash,
  signerId: o.signer ?? "alice.testnet",
  receiverId: o.receiver ?? "carol.testnet",
  actions: [{ kind: "Transfer", deposit: o.deposit ?? NEAR }],
  success: o.success ?? true,
  events: [],
});

async function setup() {
  const deps = testDeps();
  let now = deps.now();
  deps.now = () => now;
  const txs: Record<string, TxStatus | null> = {};
  const rpc: NearRpc = {
    txStatus: async (h) => txs[h] ?? null,
    viewAccount: async () => ({ amount: (3n * NEAR).toString() }),
  };
  deps.chain = { ...deps.chain, view: async <T,>() => "2000000000000000000000000" as T };
  for (const [id, token] of [["dev1", "tok1"], ["dev2", "tok2"]] as const) {
    deps.db.prepare(
      "INSERT INTO device (id, hw_id, secret_hash, token_hash, pet_ref, owner_account, created_at) VALUES (?, ?, 'x', ?, ?, 'alice.testnet', 0)",
    ).run(id, `hw-${id}`, sha256(token), REF);
  }
  deps.db.prepare("INSERT INTO wallet_recipient VALUES ('alice.testnet', 'carol.testnet', 'Carol', 0)").run();
  const app = createApp(deps, [walletModule({ rpc })]);
  const alice = (await issueSession(deps, "alice.testnet")).token;
  const mallory = (await issueSession(deps, "mallory.testnet")).token;
  const req = (method: string, path: string, auth: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", authorization: auth },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const events: PetEvent[] = [];
  subscribe(REF, (e) => events.push(e));
  const request = async (body: unknown = { kind: "send", receiver_id: "carol.testnet", amount_yocto: NEAR.toString() }) => {
    const res = await req("POST", "/approvals", "Device tok1", body);
    return { res, a: (await res.json()) as ApprovalRow & { tx: { receiverId: string } } };
  };
  return {
    deps, txs, req, request, events,
    dev1: "Device tok1", dev2: "Device tok2", alice: `Bearer ${alice}`, mallory: `Bearer ${mallory}`,
    advance: (ms: number) => (now += ms),
  };
}

describe("wallet balances and recipients", () => {
  it("reads liquid and staked balances", async () => {
    const t = await setup();
    const res = await t.req("GET", "/wallet", t.dev1);
    expect(await res.json()).toEqual({
      account_id: "alice.testnet", liquid_yocto: (3n * NEAR).toString(), staked_yocto: (2n * NEAR).toString(), validator: VALIDATOR,
    });
    expect((await t.req("GET", "/wallet", "")).status).toBe(401);
  });

  it("owners save recipients; devices only read", async () => {
    const t = await setup();
    expect((await t.req("POST", "/wallet/recipients", t.alice, { label: "Dan", account_id: "dan.testnet" })).status).toBe(200);
    expect((await t.req("POST", "/wallet/recipients", t.alice, { label: "Bad", account_id: "Not An Account" })).status).toBe(400);
    expect((await t.req("POST", "/wallet/recipients", t.dev1, { label: "X", account_id: "x.testnet" })).status).toBe(401);
    const list = await (await t.req("GET", "/wallet/recipients", t.dev1)).json();
    expect(list).toEqual([{ account_id: "carol.testnet", label: "Carol" }, { account_id: "dan.testnet", label: "Dan" }]);
  });
});

describe("wallet approvals", () => {
  it("send: request, approve, phone submits the matching tx, final", async () => {
    const t = await setup();
    const { res, a } = await t.request();
    expect(res.status).toBe(201);
    expect(a).toMatchObject({ status: "requested", account_id: "alice.testnet", device_id: "dev1", expires_at: t.deps.now() + APPROVAL_TTL_MS });
    expect(a.tx).toEqual({ receiverId: "carol.testnet", actions: [{ type: "Transfer", params: { deposit: NEAR.toString() } }] });
    // owner cannot submit before the device approves
    expect((await t.req("POST", `/approvals/${a.id}/submitted`, t.alice, { tx_hash: H1 })).status).toBe(409);
    expect(((await (await t.req("POST", `/approvals/${a.id}/approve`, t.dev1)).json()) as ApprovalRow).status).toBe("approved");
    expect(t.events.find((e) => e.type === "approval_ready")?.data).toMatchObject({ id: a.id });
    expect((await t.req("GET", `/approvals/${a.id}`, t.alice)).status).toBe(200);
    expect((await t.req("GET", `/approvals/${a.id}`, t.mallory)).status).toBe(404);
    t.txs[H1] = sendTx(H1);
    const done = await t.req("POST", `/approvals/${a.id}/submitted`, t.alice, { tx_hash: H1 });
    expect(((await done.json()) as ApprovalRow).status).toBe("final");
    expect(t.events.at(-1)).toMatchObject({ type: "approval_status", data: { status: "final" } });
    // repeating the same report is harmless; a second tx is a replay
    expect((await t.req("POST", `/approvals/${a.id}/submitted`, t.alice, { tx_hash: H1 })).status).toBe(200);
    expect((await t.req("POST", `/approvals/${a.id}/submitted`, t.alice, { tx_hash: H2 })).status).toBe(409);
  });

  it("only saved recipients, known validator, and this device's pet", async () => {
    const t = await setup();
    expect((await t.request({ kind: "send", receiver_id: "eve.testnet", amount_yocto: "1" })).res.status).toBe(400);
    expect((await t.request({ kind: "send", receiver_id: "carol.testnet" })).res.status).toBe(400);
    expect((await t.request({ kind: "send", receiver_id: "carol.testnet", amount_yocto: "0" })).res.status).toBe(400);
    expect((await t.request({ kind: "stake", receiver_id: "evil.pool.testnet", amount_yocto: "1" })).res.status).toBe(400);
    expect((await t.request({ kind: "transfer_pet", receiver_id: "carol.testnet", token_id: "2" })).res.status).toBe(400);
    const stake = await t.request({ kind: "stake", receiver_id: VALIDATOR, amount_yocto: NEAR.toString() });
    expect(stake.a).toMatchObject({ validator: VALIDATOR, status: "requested" });
    const pet = await t.request({ kind: "transfer_pet", receiver_id: "carol.testnet" });
    expect(pet.a).toMatchObject({ token_id: "1", tx: { receiverId: C } });
    // the owner session cannot create approvals
    expect((await t.req("POST", "/approvals", t.alice, { kind: "send", receiver_id: "carol.testnet", amount_yocto: "1" })).status).toBe(401);
  });

  it("only the bound device approves or rejects", async () => {
    const t = await setup();
    const { a } = await t.request();
    expect((await t.req("POST", `/approvals/${a.id}/approve`, t.dev2)).status).toBe(404);
    expect((await t.req("GET", `/approvals/${a.id}`, t.dev2)).status).toBe(404);
    expect((await t.req("POST", `/approvals/${a.id}/reject`, t.dev1)).status).toBe(200);
    expect((await t.req("POST", `/approvals/${a.id}/approve`, t.dev1)).status).toBe(409);
  });

  it("expires after 5 minutes", async () => {
    const t = await setup();
    const { a } = await t.request();
    t.advance(APPROVAL_TTL_MS + 1);
    expect((await t.req("POST", `/approvals/${a.id}/approve`, t.dev1)).status).toBe(410);
    const b = (await t.request()).a;
    await t.req("POST", `/approvals/${b.id}/approve`, t.dev1);
    t.advance(APPROVAL_TTL_MS + 1);
    t.txs[H1] = sendTx(H1);
    expect((await t.req("POST", `/approvals/${b.id}/submitted`, t.alice, { tx_hash: H1 })).status).toBe(410);
    expect(((await (await t.req("GET", `/approvals/${b.id}`, t.alice)).json()) as ApprovalRow).status).toBe("expired");
  });

  it("rejects a mismatched tx and a tx reused for another approval", async () => {
    const t = await setup();
    const a = (await t.request()).a;
    await t.req("POST", `/approvals/${a.id}/approve`, t.dev1);
    t.txs[H1] = sendTx(H1, { deposit: 2n * NEAR });
    expect((await t.req("POST", `/approvals/${a.id}/submitted`, t.alice, { tx_hash: H1 })).status).toBe(400);
    expect(((await (await t.req("GET", `/approvals/${a.id}`, t.alice)).json()) as ApprovalRow).status).toBe("failed");

    const b = (await t.request()).a;
    await t.req("POST", `/approvals/${b.id}/approve`, t.dev1);
    expect((await t.req("POST", `/approvals/${b.id}/submitted`, t.alice, { tx_hash: H1 })).status).toBe(409);
    expect((await t.req("POST", `/approvals/${b.id}/submitted`, t.mallory, { tx_hash: H3 })).status).toBe(404);
    // not final yet: stays signed, then settles on the next report
    expect((await t.req("POST", `/approvals/${b.id}/submitted`, t.alice, { tx_hash: H3 })).status).toBe(202);
    t.txs[H3] = sendTx(H3);
    expect(((await (await t.req("POST", `/approvals/${b.id}/submitted`, t.alice, { tx_hash: H3 })).json()) as ApprovalRow).status).toBe("final");
  });
});

describe("checkApprovalTx", () => {
  const base: ApprovalRow = {
    id: "a", kind: "send", network: "testnet", account_id: "alice.testnet", device_id: "dev1", pet_ref: REF,
    receiver_id: "carol.testnet", amount_yocto: NEAR.toString(), token_id: null, validator: null, status: "signed",
    tx_hash: H1, last_error: null, created_at: 0, approved_at: 0, expires_at: 1,
  };
  it("send", () => {
    expect(checkApprovalTx(base, sendTx(H1))).toBeNull();
    expect(checkApprovalTx(base, sendTx(H1, { signer: "eve.testnet" }))).toBe("wrong signer");
    expect(checkApprovalTx(base, sendTx(H1, { receiver: "eve.testnet" }))).toBe("wrong receiver");
  });
  it("stake", () => {
    const a = { ...base, kind: "stake" as const, receiver_id: VALIDATOR, validator: VALIDATOR };
    const tx = (method: string, deposit = NEAR): TxStatus => ({
      ...sendTx(H1, { receiver: VALIDATOR }), actions: [{ kind: "FunctionCall", method, args: {}, deposit }],
    });
    expect(checkApprovalTx(a, tx("deposit_and_stake"))).toBeNull();
    expect(checkApprovalTx(a, tx("unstake_all"))).toBe("wrong stake call");
    expect(checkApprovalTx(a, tx("deposit_and_stake", 1n))).toBe("wrong stake call");
  });
  it("transfer_pet", () => {
    const a = { ...base, kind: "transfer_pet" as const, amount_yocto: null, token_id: "1" };
    const tx = (args: unknown, receiver = C): TxStatus => ({
      ...sendTx(H1, { receiver }), actions: [{ kind: "FunctionCall", method: "nft_transfer", args, deposit: 1n }],
    });
    expect(checkApprovalTx(a, tx({ receiver_id: "carol.testnet", token_id: "1" }))).toBeNull();
    expect(checkApprovalTx(a, tx({ receiver_id: "eve.testnet", token_id: "1" }))).toBe("wrong transfer args");
    expect(checkApprovalTx(a, tx({ receiver_id: "carol.testnet", token_id: "1" }, "evil.testnet"))).toBe("wrong contract");
  });
});
