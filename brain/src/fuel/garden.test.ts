import { describe, expect, it } from "vitest";
import type { BrainSigners, TxSigner } from "../chain/signer";
import { testDeps } from "../test/deps";
import { SWEEP_MIN_CLAIMABLE, sweepOnce } from "./garden";

function brain(error?: string): TxSigner & { calls: { contract: string; method: string; gas?: number }[] } {
  const calls: { contract: string; method: string; gas?: number }[] = [];
  return {
    accountId: "brain.petto.testnet",
    calls,
    async call(contract, method, _args, opts) {
      calls.push({ contract, method, gas: opts?.gasTgas });
      if (error) throw new Error(error);
      return { txHash: "sweep-tx", events: [], logs: [] };
    },
  };
}

/** The same signer for every contract. */
const only = (s: TxSigner): BrainSigners => ({ forContract: () => s });

function setup(claimable: Record<string, string | null>) {
  const deps = testDeps();
  const views: unknown[] = [];
  deps.chain = {
    ...deps.chain,
    view: async <T,>(contractId: string, method: string, args?: Record<string, unknown>) => {
      views.push({ contractId, method, args });
      const v = claimable[String(args?.account_id)];
      return (v === null ? null : { claimable: v }) as T;
    },
  };
  return { deps, views };
}

describe("Brain Garden sweep", () => {
  it("sweeps only contracts at or above 0.01 CREDIT, at 600 Tgas", async () => {
    const { deps, views } = setup({
      "pets.petto.testnet": SWEEP_MIN_CLAIMABLE.toString(),
      "pets-demo.petto.testnet": (SWEEP_MIN_CLAIMABLE - 1n).toString(),
    });
    const b = brain();
    const out = await sweepOnce(deps, only(b));
    expect(out).toEqual({ "pets.petto.testnet": "swept", "pets-demo.petto.testnet": "below_threshold" });
    expect(b.calls).toEqual([{ contract: "pets.petto.testnet", method: "sweep_credit", gas: 600 }]);
    expect(views[0]).toEqual({ contractId: "mw-pool-1024.testnet", method: "get_account", args: { account_id: "pets.petto.testnet" } });
  });

  it("treats an unknown pool account as zero", async () => {
    const { deps } = setup({ "pets.petto.testnet": null, "pets-demo.petto.testnet": "0" });
    const b = brain();
    expect(Object.values(await sweepOnce(deps, only(b)))).toEqual(["below_threshold", "below_threshold"]);
    expect(b.calls).toHaveLength(0);
  });

  it("ignores Nothing to claim and skips without a signer", async () => {
    const big = (SWEEP_MIN_CLAIMABLE * 5n).toString();
    const { deps } = setup({ "pets.petto.testnet": big, "pets-demo.petto.testnet": big });
    expect(Object.values(await sweepOnce(deps, only(brain("Smart contract panicked: Nothing to claim"))))).toEqual([
      "nothing_to_claim", "nothing_to_claim",
    ]);
    expect(Object.values(await sweepOnce(deps, null))).toEqual(["no_signer", "no_signer"]);
  });
});
