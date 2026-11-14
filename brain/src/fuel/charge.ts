import { isOurEvent, parsePetRef } from "@petto/shared";
import type { BrainSigners, CallResult } from "../chain/signer";
import type { Deps, Module } from "../deps";
import { publish } from "../events";
import { log } from "../log";

/**
 * Charge worker (AI-brain 04 section 2). Sends each queued `charge_job` as one on-chain
 * `charge(pet_id, fuel_price_micro, usage_ref = turn_id, null, 1, 1)` from the brain account.
 * usage_ref is idempotent on chain (last 32 per pet), so a job can be resent blindly.
 */

export const CHARGE_GAS_TGAS = 50;
/** Backoff after the 1st, 2nd, 3rd, 4th failure; every 15 min after that. */
export const BACKOFF_MS = [2_000, 10_000, 60_000, 300_000];
const LATER_MS = 900_000;
const GIVE_UP_MS = 24 * 3600_000;
const BATCH = 8;
const TICK_MS = 1_000;

interface JobRow {
  turn_id: string;
  pet_ref: string;
  cost_micro: number;
  attempts: number;
  created_at: number;
}

export const backoff = (attempts: number) => BACKOFF_MS[attempts - 1] ?? LATER_MS;

/** The `thought` event for this usage_ref, if the tx emitted one. */
export function findThought(res: CallResult, usageRef: string): { cost_micro: number; source: string } | null {
  for (const e of res.events) {
    if (!isOurEvent(e.standard) || e.event !== "thought") continue;
    const items = Array.isArray(e.data) ? e.data : [e.data];
    for (const d of items as { usage_ref?: string; cost_micro?: unknown; source?: unknown }[]) {
      if (d && (d.usage_ref === undefined || d.usage_ref === usageRef)) {
        return { cost_micro: Number(d.cost_micro ?? 0), source: String(d.source ?? "none") };
      }
    }
  }
  return null;
}

export function createChargeWorker(deps: Deps, signers: BrainSigners) {
  const { db, now } = deps;
  let busy = false;

  async function send(job: JobRow): Promise<void> {
    const ref = parsePetRef(job.pet_ref);
    if (!ref) {
      db.prepare("UPDATE charge_job SET status = 'failed', last_error = 'bad_pet_ref', updated_at = ? WHERE turn_id = ?").run(now(), job.turn_id);
      log.alert("charge job has a bad pet_ref", { turn_id: job.turn_id });
      return;
    }
    const signer = signers.forContract(ref.contract);
    if (!signer) {
      // No keys for this contract yet: keep the job queued, check again later (not an attempt).
      db.prepare("UPDATE charge_job SET next_attempt_at = ?, last_error = 'no_signer', updated_at = ? WHERE turn_id = ?").run(
        now() + LATER_MS, now(), job.turn_id,
      );
      log.warn("no brain keys for contract; charge waits", { turn_id: job.turn_id, contract: ref.contract });
      return;
    }
    const attempts = job.attempts + 1;
    db.prepare("UPDATE charge_job SET status = 'sent', attempts = ?, updated_at = ? WHERE turn_id = ?").run(attempts, now(), job.turn_id);
    try {
      const res = await signer.call(
        ref.contract,
        "charge",
        {
          pet_id: ref.tokenId,
          cost_micro_usd: job.cost_micro,
          usage_ref: job.turn_id,
          trait_deltas: null,
          xp_gain: 1,
          mood_delta: 1,
        },
        { gasTgas: CHARGE_GAS_TGAS },
      );
      const thought = findThought(res, job.turn_id);
      if (thought) {
        db.prepare(
          "UPDATE charge_job SET status = 'settled', tx_hash = ?, charged_micro = ?, source = ?, last_error = NULL, updated_at = ? WHERE turn_id = ?",
        ).run(res.txHash, thought.cost_micro, thought.source, now(), job.turn_id);
      } else {
        // No event in a successful tx = this usage_ref was charged earlier. Keep an earlier tx if known.
        db.prepare(
          "UPDATE charge_job SET status = 'settled', tx_hash = COALESCE(tx_hash, ?), last_error = NULL, updated_at = ? WHERE turn_id = ?",
        ).run(res.txHash, now(), job.turn_id);
      }
      log.info("charge settled", { turn_id: job.turn_id, pet_ref: job.pet_ref, tx_hash: res.txHash, cost_micro: thought?.cost_micro ?? null, source: thought?.source ?? "repeat" });
      publish(job.pet_ref, "fuel_charged", {
        turn_id: job.turn_id,
        cost_micro: thought?.cost_micro ?? null,
        source: thought?.source ?? null,
        tx_hash: res.txHash,
      });
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 200);
      if (now() - job.created_at >= GIVE_UP_MS) {
        db.prepare("UPDATE charge_job SET status = 'failed', last_error = ?, updated_at = ? WHERE turn_id = ?").run(msg, now(), job.turn_id);
        log.alert("charge failed for 24 h; giving up", { turn_id: job.turn_id, pet_ref: job.pet_ref, attempts });
        return;
      }
      db.prepare("UPDATE charge_job SET status = 'queued', next_attempt_at = ?, last_error = ?, updated_at = ? WHERE turn_id = ?").run(
        now() + backoff(attempts), msg, now(), job.turn_id,
      );
      log.warn("charge retry scheduled", { turn_id: job.turn_id, attempts, retry_in_ms: backoff(attempts) });
    }
  }

  /** One pass over due jobs (also `sent` ones left by a crash: resending is safe). */
  async function tick(): Promise<number> {
    if (busy) return 0;
    busy = true;
    try {
      const due = db
        .prepare(
          `SELECT turn_id, pet_ref, cost_micro, attempts, created_at FROM charge_job
           WHERE status IN ('queued', 'sent') AND next_attempt_at <= ? ORDER BY created_at LIMIT ?`,
        )
        .all(now(), BATCH) as JobRow[];
      // The signer serialises per key, so parallel sends never clash on nonces.
      await Promise.all(due.map(send));
      return due.length;
    } finally {
      busy = false;
    }
  }

  return { tick };
}

export const chargeModule: Module = {
  name: "charge",
  start(deps) {
    if (!deps.brain) {
      log.warn("brain signers not configured; charge jobs stay queued");
      return () => undefined;
    }
    const worker = createChargeWorker(deps, deps.brain);
    // Crash recovery: a `sent` job may or may not have landed; usage_ref makes resending safe.
    deps.db.prepare("UPDATE charge_job SET status = 'queued' WHERE status = 'sent'").run();
    const timer = setInterval(() => {
      worker.tick().catch((err) => log.error("charge tick failed", { error: err instanceof Error ? err.name : "unknown" }));
    }, TICK_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  },
};
