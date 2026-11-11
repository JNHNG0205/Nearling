import { createSigner, type TxSigner } from "../chain/signer";
import type { Deps, Module } from "../deps";
import { log } from "../log";
import { splitKeys } from "../wallet/rpc";

/**
 * Brain Garden sweep (AI-brain 04 section 5, CONTRACT_INTERFACE.md): hourly, for each pets
 * contract, read the NEARON pool's `get_account(pets)` and call `sweep_credit()` (600 Tgas) only
 * when `claimable` >= 0.01 CREDIT. CREDIT has 24 decimals, so the threshold is 1e22.
 * "Nothing to claim" is expected and ignored.
 */

export const SWEEP_MIN_CLAIMABLE = 10n ** 22n;
const HOUR_MS = 3_600_000;

/**
 * The pool's `get_account` view, as read on testnet 2026-11-11 (all yocto / CREDIT-yocto strings).
 * `unstake_deposit` is what the pool now wants attached to `unstake` (0.00772 NEAR), refunded on withdraw.
 */
interface PoolAccount {
  balance?: string;
  claimable?: string;
  claimed?: string;
  acc_checkpoint?: string;
  unstake_requested?: string;
  matured_withdrawals?: string;
  withdrawable?: string;
  withdrawals?: unknown[];
  owed_mint?: string;
  claim_deposit?: string;
  unstake_deposit?: string;
  unstake_storage_paid?: string;
}

export type SweepResult = "swept" | "below_threshold" | "nothing_to_claim" | "no_signer" | "error";

export async function sweepOnce(deps: Deps, brain: TxSigner | null): Promise<Record<string, SweepResult>> {
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

export function gardenModule(over: { brain?: TxSigner | null } = {}): Module {
  return {
    name: "garden",
    start(deps) {
      // Separate signer instance from the charge queue's: an hourly call, a nonce clash just retries next hour.
      const brain =
        over.brain !== undefined
          ? over.brain
          : createSigner(deps.cfg.BRAIN_ACCOUNT_ID, splitKeys(deps.cfg.BRAIN_KEYS), deps.cfg.NEAR_RPC_URLS[0] ?? "");
      if (!brain) log.warn("brain signer not configured (BRAIN_ACCOUNT_ID, BRAIN_KEYS); credit sweeps skipped");
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
