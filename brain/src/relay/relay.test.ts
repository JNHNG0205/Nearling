import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { KeyPair, KeyPairSigner, actions, buildDelegateAction, encodeSignedDelegate, type Action } from "near-api-js";
import { issueSession } from "../auth/guard";
import { createApp } from "../app";
import { testDeps } from "../test/deps";
import { decodeSignedDelegate, innerStatus, relayRefusal, relayRoutes, type Relayer } from "./relay";

const TGAS = 10n ** 12n;
const PETS = "pets-v9.nearling.testnet";
const key = KeyPair.fromRandom("ed25519");

async function signed(o: { sender?: string; receiver?: string; acts?: Action[] } = {}): Promise<string> {
  const delegateAction = buildDelegateAction({
    senderId: o.sender ?? "alice.testnet",
    receiverId: o.receiver ?? PETS,
    actions: o.acts ?? [actions.functionCall("set_soul", { pet_id: "1", prompt: "Brave." }, 30n * TGAS, 0n)],
    nonce: 7n,
    maxBlockHeight: 1_000n,
    publicKey: key.getPublicKey(),
  });
  const { signedDelegate } = await new KeyPairSigner(key).signDelegateAction(delegateAction);
  return Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64");
}

const soul = actions.functionCall("set_soul", { pet_id: "1", prompt: "Brave." }, 30n * TGAS, 0n);
const policy = { account: "alice.testnet", receivers: [PETS, "shirts.petto.testnet"], maxGasTgas: 650n };

describe("decodeSignedDelegate", () => {
  it("reads back sender, receiver and the call", async () => {
    const d = decodeSignedDelegate(await signed());
    expect(d.delegateAction.senderId).toBe("alice.testnet");
    expect(d.delegateAction.receiverId).toBe(PETS);
    expect(d.delegateAction.actions[0]?.functionCall?.methodName).toBe("set_soul");
  });

  it("throws on junk", () => {
    expect(() => decodeSignedDelegate("bm90IGEgZGVsZWdhdGU=")).toThrow();
  });
});

describe("relayRefusal", () => {
  it("refuses attached NEAR: under NEP-366 the relayer, not the user, pays it", async () => {
    const feed = await signed({ acts: [actions.functionCall("feed", { pet_id: "1" }, 30n * TGAS, 10n ** 23n)] });
    expect(relayRefusal(decodeSignedDelegate(feed), policy)).toMatch(/NEAR attached/);
    const transfer1yocto = await signed({ acts: [actions.functionCall("nft_transfer", { receiver_id: "bob.testnet", token_id: "1" }, 30n * TGAS, 1n)] });
    expect(relayRefusal(decodeSignedDelegate(transfer1yocto), policy)).toBeNull();
  });

  it("accepts the signed-in owner calling our contract", async () => {
    expect(relayRefusal(decodeSignedDelegate(await signed({ acts: [soul] })), policy)).toBeNull();
  });

  it("refuses another sender than the session account", async () => {
    expect(relayRefusal(decodeSignedDelegate(await signed({ sender: "mallory.testnet" })), policy)).toMatch(/sender/);
  });

  it("refuses contracts that are not ours", async () => {
    expect(relayRefusal(decodeSignedDelegate(await signed({ receiver: "wrap.testnet" })), policy)).toMatch(/receiver/);
  });

  it("refuses anything but function calls (no transfers, keys or deploys on our gas)", async () => {
    const transfer = await signed({ acts: [actions.transfer(1n)] });
    const addKey = await signed({ receiver: "alice.testnet", acts: [actions.addFullAccessKey(key.getPublicKey())] });
    expect(relayRefusal(decodeSignedDelegate(transfer), policy)).toMatch(/function calls/);
    expect(relayRefusal(decodeSignedDelegate(addKey), policy)).toMatch(/receiver|function calls/);
  });

  it("refuses more gas than the cap", async () => {
    const big = await signed({
      acts: [actions.functionCall("stake", {}, 450n * TGAS, 0n), actions.functionCall("feed", {}, 300n * TGAS, 0n)],
    });
    expect(relayRefusal(decodeSignedDelegate(big), policy)).toMatch(/gas/);
  });
});

// Shape of a real relayed tx (testnet 3srnyfxZ...): tx -> delegate receipt run as the user ->
// first child run as the contract; refunds go to the relayer.
function relayedOutcome(inner: unknown, more: { id: string; executor: string; status: unknown }[] = []) {
  const r = (id: string, executor_id: string, status: unknown, receipt_ids: string[] = []) => ({ id, outcome: { executor_id, status, receipt_ids, logs: [] } });
  return {
    status: { SuccessValue: "" },
    transaction_outcome: { id: "tx", outcome: { status: { SuccessReceiptId: "D" }, receipt_ids: ["D"], logs: [] } },
    receipts_outcome: [
      r("D", "alice.testnet", { SuccessValue: "" }, ["I", "R1"]),
      r("I", PETS, inner, ["R2"]),
      ...more.map((m) => r(m.id, m.executor, m.status)),
      r("R2", "relayer.testnet", { SuccessValue: "" }),
      r("R1", "relayer.testnet", { SuccessValue: "" }),
    ],
  };
}

describe("innerStatus", () => {
  it("reports the contract call's failure that the top-level status hides", () => {
    const failure = { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "E_NOT_OWNER: Only the owner" } } } } };
    expect(innerStatus(relayedOutcome(failure), PETS)).toEqual(failure);
  });

  it("follows promise chains to the final value, like a normal transaction", () => {
    const o = relayedOutcome({ SuccessReceiptId: "CB" }, [{ id: "CB", executor: PETS, status: { SuccessValue: "dHJ1ZQ==" } }]);
    expect(innerStatus(o, PETS)).toEqual({ SuccessValue: "dHJ1ZQ==" });
  });

  it("is null when the shape is not a relayed call", () => {
    expect(innerStatus({ status: { SuccessValue: "" } }, PETS)).toBeNull();
  });
});

describe("POST /relay", () => {
  const post = (body: unknown, token?: string) => ({
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

  function setup(relayer: Relayer | null, perDay = 2) {
    const deps = testDeps();
    deps.cfg.PETS_CONTRACT = PETS;
    const sent: string[] = [];
    const wrapped: Relayer | null = relayer && {
      accountId: relayer.accountId,
      send: async (d) => {
        sent.push(d.delegateAction.senderId);
        return relayer.send(d);
      },
    };
    const app = createApp(deps, [{ name: "relay", routes: (d) => new Hono().route("/", relayRoutes(d, wrapped, { perDay })) }]);
    return { app, deps, sent };
  }
  const outcome = { status: { SuccessValue: "" }, transaction: { hash: "tx1" }, receipts_outcome: [] };
  const relayer: Relayer = { accountId: "relayer.testnet", send: async () => outcome };

  it("needs a session", async () => {
    const { app } = setup(relayer);
    expect((await app.request("/relay", post({ signed_delegate: await signed() }))).status).toBe(401);
  });

  it("returns the inner call's status as the outcome status", async () => {
    const failure = { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "E_NOT_OWNER: Only the owner" } } } } };
    const { app, deps } = setup({ accountId: "relayer.testnet", send: async () => relayedOutcome(failure) });
    const { token } = await issueSession(deps, "alice.testnet");
    const res = await app.request("/relay", post({ signed_delegate: await signed() }, token));
    expect(((await res.json()) as { status: unknown }).status).toEqual(failure);
  });

  it("relays a valid delegate and returns the outcome", async () => {
    const { app, deps, sent } = setup(relayer);
    const { token } = await issueSession(deps, "alice.testnet");
    const res = await app.request("/relay", post({ signed_delegate: await signed() }, token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(outcome);
    expect(sent).toEqual(["alice.testnet"]);
  });

  it("refuses (422 not_relayable) before sending anything", async () => {
    const { app, deps, sent } = setup(relayer);
    const { token } = await issueSession(deps, "alice.testnet");
    const res = await app.request("/relay", post({ signed_delegate: await signed({ sender: "bob.testnet" }) }, token));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_relayable");
    expect(sent).toEqual([]);
  });

  it("caps relays per account per day (429, nothing sent)", async () => {
    const { app, deps, sent } = setup(relayer, 2);
    const { token } = await issueSession(deps, "alice.testnet");
    for (let i = 0; i < 2; i++) await app.request("/relay", post({ signed_delegate: await signed() }, token));
    const res = await app.request("/relay", post({ signed_delegate: await signed() }, token));
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("relay_limit");
    expect(sent).toHaveLength(2);
  });

  it("says relay_off (503) when no relayer is configured", async () => {
    const { app, deps } = setup(null);
    const { token } = await issueSession(deps, "alice.testnet");
    const res = await app.request("/relay", post({ signed_delegate: await signed() }, token));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("relay_off");
  });

  it("stops relaying once the day's total is spent, across accounts (the relayer pays the gas)", async () => {
    const { app, deps, sent } = setup(relayer, 10);
    deps.cfg.RELAY_DAILY_TOTAL = 1;
    const a = await app.request("/relay", post({ signed_delegate: await signed() }, (await issueSession(deps, "alice.testnet")).token));
    expect(a.status).toBe(200);
    const b = await app.request("/relay", post({ signed_delegate: await signed({ sender: "bob.testnet" }) }, (await issueSession(deps, "bob.testnet")).token));
    expect(b.status).toBe(429);
    expect(sent).toEqual(["alice.testnet"]);
  });
});
