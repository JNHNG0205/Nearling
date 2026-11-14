import type { BrainSigners } from "../chain/signer";
import type { Deps } from "../deps";
import { isOurEvent } from "@petto/shared";
import { log } from "../log";

// Writes finished battles on chain: one `record_battle` per battle_job, like the charge queue.
// The contract ignores a battle_id it has seen, so a retry after an unclear failure is safe.

export const MAX_ATTEMPTS = 8;
/** Waits after failed attempts 1..7: about 2 minutes in all, so the players still see the outcome. */
const RETRY_MS = [2_000, 5_000, 10_000, 15_000, 20_000, 30_000, 30_000];
const BATCH = 10;

interface Job { battle_id: string; contract: string; args: string; attempts: number; tx_hash: string | null }

/** `notify(battleId, tx | null)`: saved (tx hash) or given up (null). */
export function createBattleWorker(deps: Deps, signers: BrainSigners, notify: (battleId: string, tx: string | null) => void) {
  const { db, now } = deps;

  async function send(job: Job): Promise<void> {
    const attempts = job.attempts + 1;
    db.prepare("UPDATE battle_job SET status = 'sent', attempts = ?, updated_at = ? WHERE battle_id = ?").run(attempts, now(), job.battle_id);
    try {
      const signer = signers.forContract(job.contract);
      if (!signer) throw new Error("no_signer");
      const res = await signer.call(job.contract, "record_battle", JSON.parse(job.args) as Record<string, unknown>, { gasTgas: 30 });
      // no `battle` event = the contract had this battle_id already (a resend after a crash): the
      // first tx is the one that recorded it
      const recorded = res.events.some((e) => isOurEvent(e.standard) && e.event === "battle");
      const tx = recorded ? res.txHash : (job.tx_hash ?? res.txHash);
      db.prepare("UPDATE battle_job SET status = 'settled', tx_hash = ?, last_error = NULL, updated_at = ? WHERE battle_id = ?")
        .run(tx, now(), job.battle_id);
      notify(job.battle_id, tx);
    } catch (err) {
      const error = err instanceof Error ? err.message.slice(0, 200) : "unknown";
      if (attempts >= MAX_ATTEMPTS) {
        db.prepare("UPDATE battle_job SET status = 'failed', last_error = ?, updated_at = ? WHERE battle_id = ?").run(error, now(), job.battle_id);
        log.warn("battle record failed", { battle_id: job.battle_id });
        notify(job.battle_id, null);
        return;
      }
      db.prepare("UPDATE battle_job SET status = 'queued', next_attempt_at = ?, last_error = ?, updated_at = ? WHERE battle_id = ?")
        .run(now() + (RETRY_MS[attempts - 1] ?? 30_000), error, now(), job.battle_id);
    }
  }

  let busy = false;
  return {
    async tick(): Promise<void> {
      if (busy) return; // a slow RPC must not let the next tick resend the same jobs
      busy = true;
      try {
        await run();
      } finally {
        busy = false;
      }
    },
  };

  async function run(): Promise<void> {
    {
      const due = db.prepare(
        "SELECT battle_id, contract, args, attempts, tx_hash FROM battle_job WHERE status = 'queued' AND next_attempt_at <= ? ORDER BY created_at LIMIT ?",
      ).all(now(), BATCH) as Job[];
      for (const job of due) await send(job);
    }
  }
}
