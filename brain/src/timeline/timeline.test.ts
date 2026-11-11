import type { TimelineItem } from "@nearling/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { ensureProfile } from "../profiles";
import { TEST_PET, testDeps } from "../test/deps";
import { type Fetch, parseTx, type RawTx } from "./indexer";
import { diffSnapshot, runTimelineTail, type Snapshot } from "./timeline";

const C = "pets-v8.nearling.testnet";
const REF = `${C}:1`;
const NOW = 1_800_000_000_000; // testDeps clock (ms)
const ns = (ms: number) => (BigInt(ms) * 1_000_000n).toString();
const PREV: Snapshot = { owner: "alice.testnet", food_yocto: "100", staked: "0", soul_version: 1, stage: 1, life_state: "Happy" };

const log = (standard: string, event: string, data: unknown[]) =>
  `EVENT_JSON:${JSON.stringify({ standard, version: "1.0.0", event, data })}`;

function tx(hash: string, signer: string, atMs: number, receipts: { id: string; executor?: string; logs: string[]; ok?: boolean }[]): RawTx {
  return {
    transaction: { hash, signer_id: signer },
    receipts: receipts.map((r) => ({
      execution_outcome: {
        id: r.id,
        block_timestamp: Number(ns(atMs)),
        outcome: {
          logs: r.logs,
          executor_id: r.executor ?? C,
          status: r.ok === false ? { Failure: {} } : { SuccessValue: "" },
        },
      },
    })),
  };
}

const OLD = NOW - 3_600_000; // settled
const TXS: RawTx[] = [
  tx("MINT", "alice.testnet", OLD, [{ id: "r1", logs: [log("nep171", "nft_mint", [{ owner_id: "alice.testnet", token_ids: ["1"] }]), log("nearling", "soul_updated", [{ pet_id: "1", version: 1, prompt: "secret-ish soul" }])] }]),
  tx("FEED", "bob.testnet", OLD + 1000, [{ id: "r2", logs: [log("nearling", "fed", [{ pet_id: "1", by: "bob.testnet", amount: "500000000000000000000000" }])] }]),
  tx("CHARGE1", "brain.nearling.testnet", OLD + 2000, [{ id: "r3", logs: [log("nearling", "thought", [{ pet_id: "1", cost_micro: 1000, usage_ref: "u1", source: "food" }])] }]),
  tx("CHARGE2", "brain.nearling.testnet", OLD + 3000, [{ id: "r4", logs: [log("nearling", "thought", [{ pet_id: "1", cost_micro: 1000, usage_ref: "u2", source: "food" }])] }]),
  // stake: the event is in the callback receipt; the pool receipt and a failed receipt are ignored
  tx("STAKE", "alice.testnet", OLD + 4000, [
    { id: "r5", logs: [] },
    { id: "r6", executor: "mw-pool-1024.testnet", logs: [log("nearling", "staked", [{ pet_id: "1", owner: "evil", amount: "1" }])] },
    { id: "r7", logs: [log("nearling", "staked", [{ pet_id: "1", owner: "alice.testnet", amount: "1000000000000000000000000" }])] },
    { id: "r8", ok: false, logs: [log("nearling", "fed", [{ pet_id: "1", by: "x", amount: "9" }])] },
  ]),
];

/** Fake FastNEAR: serves TXS for C; `down` makes every call fail. */
function fakeIndexer(state: { down: boolean; txs: RawTx[] }): Fetch {
  return async (url, init) => {
    if (state.down) throw new Error("ECONNREFUSED");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    if (url.endsWith("/v0/blocks")) return json({ blocks: [{ block_timestamp: ns(NOW - 2000) }] });
    if (url.endsWith("/v0/account")) {
      const from = Number(body.from_tx_block_height ?? 0);
      const list = body.account_id === C ? state.txs : [];
      return json({
        account_txs: list
          .map((t, i) => ({ transaction_hash: t.transaction.hash, tx_block_height: 100 + i, tx_block_timestamp: ns(Number(t.receipts[0]!.execution_outcome.block_timestamp) / 1e6) }))
          .filter((t) => t.tx_block_height >= from),
      });
    }
    if (url.endsWith("/v0/transactions")) {
      const want = body.tx_hashes as string[];
      return json({ transactions: state.txs.filter((t) => want.includes(t.transaction.hash)) });
    }
    return new Response("{}", { status: 404 });
  };
}

describe("timeline event parsing", () => {
  it("parses nearling and nep171 events from successful receipts of the contract only", () => {
    const rows = TXS.flatMap((t) => parseTx(t, C)).map((e) => [e.kind, e.petRef, e.actor, e.amount, e.txHash, e.receiptId, e.logIndex]);
    expect(rows).toEqual([
      ["minted", REF, "alice.testnet", null, "MINT", "r1", 0],
      ["soul_updated", REF, "alice.testnet", "1", "MINT", "r1", 1],
      ["fed", REF, "bob.testnet", "500000000000000000000000", "FEED", "r2", 0],
      ["thought", REF, "brain.nearling.testnet", "1000", "CHARGE1", "r3", 0],
      ["thought", REF, "brain.nearling.testnet", "1000", "CHARGE2", "r4", 0],
      ["staked", REF, "alice.testnet", "1000000000000000000000000", "STAKE", "r7", 0],
    ]);
    expect(JSON.stringify(parseTx(TXS[0]!, C))).not.toContain("secret-ish soul");
  });

  it("maps a transfer and a contract-wide credit sweep", () => {
    const t = tx("X", "alice.testnet", OLD, [{ id: "r", logs: [
      log("nep171", "nft_transfer", [{ old_owner_id: "alice.testnet", new_owner_id: "bob.testnet", token_ids: ["1"] }]),
      log("nearling", "credit_swept", [{ org_id: "org", result: "" }]),
      log("nearling", "played", [{ pet_id: "1", action: "pet" }]),
      "not an event",
    ] }]);
    expect(parseTx(t, C).map((e) => [e.kind, e.petRef, e.actor, e.raw])).toEqual([
      ["owner_changed", REF, "bob.testnet", { from: "alice.testnet", to: "bob.testnet" }],
      ["credit_swept", C, "alice.testnet", {}],
    ]);
  });
});

describe("timeline tail", () => {
  it("records real events once, folds thoughts per day, and serves the public route", async () => {
    const deps = testDeps();
    deps.chain.view = async <T>() => [] as T;
    const f = fakeIndexer({ down: false, txs: TXS });
    await runTimelineTail(deps, f);
    await runTimelineTail(deps, f); // idempotent
    expect(deps.db.prepare("SELECT COUNT(*) AS n FROM pet_event").get()).toEqual({ n: 6 });
    expect(deps.db.prepare("SELECT height FROM timeline_cursor WHERE contract = ?").get(C)).toEqual({ height: 104 });

    const res = await createApp(deps).request(`/pets/${REF}/timeline`);
    expect(res.status).toBe(200);
    const items = (await res.json()) as TimelineItem[];
    expect(items.map((i) => [i.kind, i.actor, i.amount, i.tx_hash, i.source, i.at])).toEqual([
      ["staked", "alice.testnet", "1000000000000000000000000", "STAKE", "event", OLD + 4000],
      ["thoughts_day", null, "2000", "CHARGE2", "event", OLD + 3000],
      ["fed", "bob.testnet", "500000000000000000000000", "FEED", "event", OLD + 1000],
      ["soul_updated", "alice.testnet", "1", "MINT", "event", OLD], // same block: later log first
      ["minted", "alice.testnet", null, "MINT", "event", OLD],
    ]);
    const day = items.find((i) => i.kind === "thoughts_day")!;
    expect([day.count, day.day]).toEqual([2, new Date(OLD).toISOString().slice(0, 10)]);
    expect((await createApp(deps).request("/pets/evil.testnet:1/timeline")).status).toBe(400);
  });

  it("does not move the cursor past txs that are not settled yet", async () => {
    const deps = testDeps();
    deps.chain.view = async <T>() => [] as T;
    const fresh = tx("NEW", "bob.testnet", NOW - 10_000, [{ id: "rn", logs: [log("nearling", "fed", [{ pet_id: "1", by: "bob.testnet", amount: "7" }])] }]);
    const f = fakeIndexer({ down: false, txs: [...TXS, fresh] });
    await runTimelineTail(deps, f);
    await runTimelineTail(deps, f); // the unsettled tx is read again, still one row
    expect(deps.db.prepare("SELECT height FROM timeline_cursor").get()).toEqual({ height: 104 });
    expect(deps.db.prepare("SELECT COUNT(*) AS n FROM pet_event WHERE tx_hash = 'NEW'").get()).toEqual({ n: 1 });
  });

  it("falls back to snapshot diffs while the indexer is down, then replaces them with events", async () => {
    const deps = testDeps();
    deps.chain.view = async <T>() => [] as T;
    ensureProfile(deps.db, REF, "alice.testnet", 0);
    const state = { down: true, txs: TXS };
    const f = fakeIndexer(state);
    await runTimelineTail(deps, f); // first snapshot records nothing
    expect(deps.db.prepare("SELECT COUNT(*) AS n FROM pet_event").get()).toEqual({ n: 0 });
    deps.pets["1"] = { ...TEST_PET, food_yocto: (BigInt(TEST_PET.food_yocto) + 10n ** 24n).toString() };
    await runTimelineTail(deps, f);
    let items = (await (await createApp(deps).request(`/pets/${REF}/timeline`)).json()) as TimelineItem[];
    expect(items.map((i) => [i.kind, i.amount, i.tx_hash, i.source])).toEqual([["fed", (10n ** 24n).toString(), null, "snapshot"]]);

    state.down = false;
    await runTimelineTail(deps, f);
    items = (await (await createApp(deps).request(`/pets/${REF}/timeline`)).json()) as TimelineItem[];
    expect(items.every((i) => i.source === "event")).toBe(true);
    expect(items).toHaveLength(5);
  });
});

describe("timeline snapshot diff", () => {
  it("detects each kind from a get_pet change", () => {
    const pet = { ...TEST_PET, food_yocto: "150", staked: "1000", soul_version: 2, stage: 2, owner: "bob.testnet", life_state: "Happy" as const };
    expect(diffSnapshot(PREV, pet).map((e) => [e.kind, e.actor, e.amount])).toEqual([
      ["owner_changed", "bob.testnet", null],
      ["fed", null, "50"],
      ["staked", "bob.testnet", "1000"],
      ["soul_updated", "bob.testnet", "2"],
      ["stage_up", null, "2"],
    ]);
  });

  it("detects unstake, dormant and revived; drain alone is nothing", () => {
    const base = { ...TEST_PET, owner: "alice.testnet", food_yocto: "90", staked: "0", soul_version: 1, stage: 1 };
    expect(diffSnapshot(PREV, { ...base, life_state: "Happy" })).toEqual([]);
    expect(diffSnapshot({ ...PREV, staked: "5" }, { ...base, life_state: "Happy" }).map((e) => e.kind)).toEqual(["unstaked"]);
    expect(diffSnapshot({ ...PREV, life_state: "Starving" }, { ...base, life_state: "Dormant" }).map((e) => e.kind)).toEqual(["dormant"]);
    expect(diffSnapshot({ ...PREV, life_state: "Dormant" }, { ...base, food_yocto: "500", life_state: "Hungry" }).map((e) => e.kind)).toEqual([
      "fed",
      "revived",
    ]);
  });
});
