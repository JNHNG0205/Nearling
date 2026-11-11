import type { BrainSigners } from "../chain/signer";
import type { Deps, Module } from "../deps";
import { log } from "../log";

/**
 * Brain Garden sweep (AI-brain 04 section 5, CONTRACT_INTERFACE.md): hourly, for each pets
 * contract, read the NEARON pool's `get_account(pets)` and call `sweep_credit()` (600 Tgas) only
 * when `claimable` >= 0.01 CREDIT. CREDIT has 24 decimals, so the threshold is 1e22.
 * "Nothing to claim" is expected and ignored.
 */

export const SWEEP_MIN_CLAIMABLE = 10n ** 22n;
const HOUR_MS = 3_600_000;

/** [VERIFY] field names of the pool's `get_account` view beyond `claimable`. */
interface PoolAccount {
  claimable?: string;
}

export type SweepResult = "swept" | "below_threshold" | "nothing_to_claim" | "no_signer" | "error";

export async function sweepOnce(deps: Deps, signers: BrainSigners | null): Promise<Record<string, SweepResult>> {
  const contracts = [...new Set([deps.cfg.PETS_CONTRACT, deps.cfg.DEMO_PETS_CONTRACT])];
  const out: Record<string, SweepResult> = {};
  for (const contract of contracts) {
    try {
      const acct = await deps.chain.view<PoolAccount | null>(deps.cfg.NEARON_POOL, "get_account", { account_id: contract });
      const claimable = BigInt(acct?.claimable ?? "0");
      if (claimable < SWEEP_MIN_CLAIMABLE) {
        out[contract] = "below_threshold";
        continue;
      }
      const brain = signers?.forContract(contract) ?? null;
      if (!brain) {
        out[contract] = "no_signer";
        continue;
      }
      const res = await brain.call(contract, "sweep_credit", {}, { gasTgas: 600 });
      log.info("credit swept", { contract, claimable: claimable.toString(), tx_hash: res.txHash });
      out[contract] = "swept";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Nothing to claim")) {
        out[contract] = "nothing_to_claim";
        log.info("sweep: nothing to claim", { contract });
      } else {
        out[contract] = "error";
        log.warn("sweep failed", { contract, error: e instanceof Error ? e.name : "Error" });
      }
    }
  }
  return out;
}

export function gardenModule(over: { brain?: BrainSigners | null } = {}): Module {
  return {
    name: "garden",
    start(deps) {
      // Same signers as the charge worker (deps.brain), so sweeps and charges share nonce lanes.
      const brain = over.brain !== undefined ? over.brain : (deps.brain ?? null);
      if (!brain) log.warn("brain signers not configured; credit sweeps skipped");
      const tick = () => void sweepOnce(deps, brain).catch(() => undefined);
      const first = setTimeout(tick, 60_000);
      const t = setInterval(tick, HOUR_MS);
      return () => {
        clearTimeout(first);
        clearInterval(t);
      };
    },
  };
}
