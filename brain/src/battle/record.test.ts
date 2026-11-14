import { describe, expect, it, vi } from "vitest";
import type { BrainSigners, CallResult } from "../chain/signer";
import { testDeps } from "../test/deps";
import { createBattleWorker, MAX_ATTEMPTS } from "./record";

function seed(deps: ReturnType<typeof testDeps>) {
  deps.db.prepare("INSERT INTO battle (id, pet_a, pet_b, winner, reason, created_at) VALUES ('b1', 'x:1', 'x:2', 0, 'ko', 0)").run();
  deps.db.prepare(
    "INSERT INTO battle_job (battle_id, contract, args, status, next_attempt_at, created_at, updated_at) VALUES ('b1', 'pets.petto.testnet', ?, 'queued', 0, 0, 0)",
  ).run(JSON.stringify({ winner: "1", loser: "2", draw: false, loser_ran: false, battle_id: "b1" }));
}
const signers = (call: (...a: unknown[]) => Promise<CallResult>): BrainSigners =>
  ({ forContract: () => ({ call }) }) as unknown as BrainSigners;

describe("battle record worker", () => {
  it("sends record_battle, settles the job and reports the tx", async () => {
    const deps = testDeps();
    seed(deps);
    const call = vi.fn(async () => ({ success: true, txHash: "TX1", events: [] }) as unknown as CallResult);
    const notify = vi.fn();
    await createBattleWorker(deps, signers(call), notify).tick();
    expect(call).toHaveBeenCalledWith("pets.petto.testnet", "record_battle", { winner: "1", loser: "2", draw: false, loser_ran: false, battle_id: "b1" }, expect.anything());
    expect(deps.db.prepare("SELECT status, tx_hash FROM battle_job").get()).toEqual({ status: "settled", tx_hash: "TX1" });
    expect(notify).toHaveBeenCalledWith("b1", "TX1");
  });

  it("backs off on errors and gives up after the last attempt", async () => {
    const deps = testDeps();
    seed(deps);
    const call = vi.fn(async () => { throw new Error("rpc down"); });
    const notify = vi.fn();
    const worker = createBattleWorker(deps, signers(call), notify);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      deps.db.prepare("UPDATE battle_job SET next_attempt_at = 0").run();
      await worker.tick();
    }
    expect(deps.db.prepare("SELECT status, attempts FROM battle_job").get()).toEqual({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(notify).toHaveBeenCalledWith("b1", null);
  });
});
