import { describe, expect, it, vi } from "vitest";
import type { CallResult, TxSigner } from "../chain/signer";
import { subscribe } from "../events";
import { testDeps } from "../test/deps";
import { BACKOFF_MS, createChargeWorker } from "./charge";

const PET = "pets-v8.nearling.testnet:1";

function seed(deps: ReturnType<typeof testDeps>, turnId = "turn-1", createdAt = deps.now()) {
  deps.db.prepare(
    "INSERT INTO turn (id, pet_ref, owner_account, request_id, channel, status, created_at) VALUES (?, ?, 'alice.testnet', ?, 'web', 'done', ?)",
  ).run(turnId, PET, `r-${turnId}`, createdAt);
  deps.db.prepare(
    "INSERT INTO charge_job (turn_id, pet_ref, cost_micro, status, attempts, next_attempt_at, created_at, updated_at) VALUES (?, ?, 1000, 'queued', 0, ?, ?, ?)",
  ).run(turnId, PET, createdAt, createdAt, createdAt);
}

function fakeSigner(impl: (args: Record<string, unknown>) => Promise<CallResult>) {
  const calls: { contract: string; method: string; args: Record<string, unknown>; gas?: number }[] = [];
  const signer: TxSigner = {
    accountId: "brain.nearling.testnet",
    async call(contract, method, args, opts) {
      calls.push({ contract, method, args, gas: opts?.gasTgas });
      return impl(args);
    },
  };
  return { signer, calls };
}

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
    await createChargeWorker(deps, signer).tick();
    off();
    expect(calls).toEqual([{
      contract: "pets-v8.nearling.testnet", method: "charge", gas: 50,
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
    await createChargeWorker(deps, signer).tick();
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
    const w = createChargeWorker(deps, signer);

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
