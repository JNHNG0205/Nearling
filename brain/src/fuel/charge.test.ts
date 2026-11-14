import { describe, expect, it, vi } from "vitest";
import { createBrainSigners, type BrainSigners, type CallResult, type TxSigner } from "../chain/signer";
import { loadConfig } from "../config";
import { sweepOnce } from "./garden";
import { subscribe } from "../events";
import { testDeps } from "../test/deps";
import { BACKOFF_MS, createChargeWorker } from "./charge";

const PET = "pets.petto.testnet:1";

function seed(deps: ReturnType<typeof testDeps>, turnId = "turn-1", createdAt = deps.now(), pet = PET) {
  deps.db.prepare(
    "INSERT INTO turn (id, pet_ref, owner_account, request_id, channel, status, created_at) VALUES (?, ?, 'alice.testnet', ?, 'web', 'done', ?)",
  ).run(turnId, pet, `r-${turnId}`, createdAt);
  deps.db.prepare(
    "INSERT INTO charge_job (turn_id, pet_ref, cost_micro, status, attempts, next_attempt_at, created_at, updated_at) VALUES (?, ?, 1000, 'queued', 0, ?, ?, ?)",
  ).run(turnId, pet, createdAt, createdAt, createdAt);
}

function fakeSigner(impl: (args: Record<string, unknown>) => Promise<CallResult>) {
  const calls: { contract: string; method: string; args: Record<string, unknown>; gas?: number }[] = [];
  const signer: TxSigner = {
    accountId: "brain.petto.testnet",
    async call(contract, method, args, opts) {
      calls.push({ contract, method, args, gas: opts?.gasTgas });
      return impl(args);
    },
  };
  return { signer, calls };
}

/** The same signer for every contract. */
const only = (s: TxSigner): BrainSigners => ({ forContract: () => s });

const job = (deps: ReturnType<typeof testDeps>) =>
  deps.db.prepare("SELECT * FROM charge_job WHERE turn_id = 'turn-1'").get() as Record<string, unknown>;

describe("charge worker", () => {
  it("sends charge(pet, fuel, usage_ref = turn_id, null, 1, 1) at 50 Tgas and settles from the thought event", async () => {
    const deps = testDeps();
    seed(deps);
    const { signer, calls } = fakeSigner(async (args) => ({
      txHash: "TX1", logs: [],
      events: [{ standard: "nearling", event: "thought", data: [{ pet_id: "1", cost_micro: 1000, usage_ref: args.usage_ref, source: "food" }] }],
    }));
    const seen: unknown[] = [];
    const off = subscribe(PET, (e) => seen.push(e));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await createChargeWorker(deps, only(signer)).tick();
    off();
    expect(calls).toEqual([{
      contract: "pets.petto.testnet", method: "charge", gas: 50,
      args: { pet_id: "1", cost_micro_usd: 1000, usage_ref: "turn-1", trait_deltas: null, xp_gain: 1, mood_delta: 1 },
    }]);
    expect(job(deps)).toMatchObject({ status: "settled", tx_hash: "TX1", charged_micro: 1000, source: "food", attempts: 1 });
    expect(seen).toEqual([{ petRef: PET, type: "fuel_charged", data: { turn_id: "turn-1", cost_micro: 1000, source: "food", tx_hash: "TX1" } }]);
    vi.restoreAllMocks();
  });

  it("no thought event means already charged: settled", async () => {
    const deps = testDeps();
    seed(deps);
    const { signer } = fakeSigner(async () => ({ txHash: "TX2", logs: [], events: [] }));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await createChargeWorker(deps, only(signer)).tick();
    expect(job(deps)).toMatchObject({ status: "settled", tx_hash: "TX2", charged_micro: null });
    vi.restoreAllMocks();
  });

  it("retries with backoff, then gives up after 24 h with an alert", async () => {
    let t = 1_800_000_000_000;
    const deps = testDeps({ now: () => t });
    seed(deps);
    let fail = true;
    const { signer, calls } = fakeSigner(async () => {
      if (fail) throw new Error("rpc down");
      return { txHash: "TX3", logs: [], events: [] };
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const alerts = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const w = createChargeWorker(deps, only(signer));

    await w.tick();
    expect(job(deps)).toMatchObject({ status: "queued", attempts: 1, next_attempt_at: t + BACKOFF_MS[0]! });
    await w.tick(); // not due yet
    expect(calls).toHaveLength(1);
    t += BACKOFF_MS[0]!;
    await w.tick();
    expect(job(deps)).toMatchObject({ attempts: 2, next_attempt_at: t + BACKOFF_MS[1]! });

    fail = false;
    t += BACKOFF_MS[1]!;
    await w.tick();
    expect(job(deps)).toMatchObject({ status: "settled", tx_hash: "TX3" });

    // A second job that keeps failing past 24 h.
    seed(deps, "turn-2", t);
    fail = true;
    t += 24 * 3600_000;
    await w.tick();
    expect((deps.db.prepare("SELECT status FROM charge_job WHERE turn_id = 'turn-2'").get() as { status: string }).status).toBe("failed");
    expect(alerts.mock.calls.some((c) => String(c[0]).includes('"level":"alert"'))).toBe(true);
    vi.restoreAllMocks();
  });
});

describe("brain signers per contract (B4)", () => {
  const DEMO = "pets-demo.petto.testnet";
  const ok = async (): Promise<CallResult> => ({ txHash: "TX", logs: [], events: [] });
  const seedDemo = (deps: ReturnType<typeof testDeps>) => seed(deps, "turn-d", deps.now(), `${DEMO}:1`);

  /** A registry built from config with a fake key-to-signer factory; records every signer made. */
  function registry(env: Record<string, string>) {
    const made: { keys: string[]; calls: { contract: string; method: string }[] }[] = [];
    const cfg = loadConfig({ DB_PATH: ":memory:", ...env });
    const brain = createBrainSigners(cfg, (accountId, keys) => {
      if (keys.length === 0) return null;
      const rec = { keys, calls: [] as { contract: string; method: string }[] };
      made.push(rec);
      return {
        accountId,
        call: async (contract: string, method: string) => {
          rec.calls.push({ contract, method });
          return ok();
        },
      };
    });
    return { brain, made };
  }

  it("signs demo charges with BRAIN_KEYS_DEMO and pets charges with BRAIN_KEYS_PETS", async () => {
    const { brain, made } = registry({ BRAIN_KEYS_PETS: "k-pets", BRAIN_KEYS_DEMO: "k-demo1,k-demo2", BRAIN_KEYS: "k-old" });
    const deps = testDeps();
    seed(deps, "turn-1");
    seedDemo(deps);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await createChargeWorker(deps, brain).tick();
    vi.restoreAllMocks();
    const demo = made.find((m) => m.keys.join() === "k-demo1,k-demo2")!;
    const pets = made.find((m) => m.keys.join() === "k-pets")!;
    expect(demo.calls).toEqual([{ contract: DEMO, method: "charge" }]);
    expect(pets.calls).toEqual([{ contract: "pets.petto.testnet", method: "charge" }]);
    expect(made.some((m) => m.keys.includes("k-old"))).toBe(false);
  });

  it("falls back to BRAIN_KEYS for PETS only; demo jobs wait without keys", async () => {
    const { brain } = registry({ BRAIN_KEYS: "k-old" });
    expect(brain.forContract("pets.petto.testnet")).not.toBeNull();
    expect(brain.forContract(DEMO)).toBeNull();
    expect(brain.forContract("other.testnet")).toBeNull();

    const deps = testDeps();
    seedDemo(deps);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await createChargeWorker(deps, brain).tick();
    vi.restoreAllMocks();
    expect(deps.db.prepare("SELECT status, attempts, last_error FROM charge_job WHERE turn_id = 'turn-d'").get()).toEqual({
      status: "queued", attempts: 0, last_error: "no_signer",
    });
  });

  it("charge worker and garden sweep share one signer (same lanes) per contract", async () => {
    const { brain, made } = registry({ BRAIN_KEYS_PETS: "k-pets", BRAIN_KEYS_DEMO: "k-demo" });
    expect(made).toHaveLength(2); // one signer per contract, built once
    const deps = testDeps();
    deps.brain = brain;
    seed(deps, "turn-1");
    deps.chain = { ...deps.chain, view: async <T,>() => ({ claimable: (10n ** 23n).toString() }) as T };
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await createChargeWorker(deps, deps.brain).tick();
    await sweepOnce(deps, deps.brain);
    vi.restoreAllMocks();
    expect(made).toHaveLength(2); // nothing built a second signer
    const pets = made.find((m) => m.keys.join() === "k-pets")!;
    const demo = made.find((m) => m.keys.join() === "k-demo")!;
    expect(pets.calls.map((c) => c.method)).toEqual(["charge", "sweep_credit"]);
    expect(demo.calls.map((c) => c.method)).toEqual(["sweep_credit"]);
  });
});
