import type { Deps } from "../deps";
import { log } from "../log";
import { adjustProviderSpend, utcDay } from "../talk/spend";

/**
 * A5: billing reconcile (AI-brain 03 section 5). Every 5 min, POST `{NEARAI_BASE_URL}/billing/costs`
 * with `{ requestIds }` (the `inference-id` UUIDs of recent turns) and store the billed nano-USD
 * per turn in `turn.billed_cost_nano`. The day's `spend_daily.provider_nano` moves by billed minus
 * the token estimate, so the global spend cap uses the billed cost where known.
 * Unknown ids come back as `costNanoUsd: 0` (usage can lag a few seconds): those are retried on
 * later runs, up to MAX_CHECKS times. Ids, counts and costs only in logs.
 */

type Fetch = typeof fetch;

export const RECONCILE_EVERY_MS = 5 * 60_000;
/** Give usage records time to appear before asking. */
export const RECONCILE_MIN_AGE_MS = 60_000;
const MAX_AGE_MS = 24 * 3600_000;
const MAX_CHECKS = 6;
const BATCH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  id: string;
  inference_id: string;
  provider_cost_nano: number | null;
  created_at: number;
}

export interface ReconcileResult {
  asked: number;
  billed: number;
  pending: number;
}

export async function reconcileBilling(deps: Deps, f: Fetch = fetch): Promise<ReconcileResult> {
  const { cfg, db } = deps;
  const none = { asked: 0, billed: 0, pending: 0 };
  if (cfg.MOCK_AI || !cfg.NEARAI_API_KEY) return none;
  const t = deps.now();
  const rows = (
    db
      .prepare(
        `SELECT id, inference_id, provider_cost_nano, created_at FROM turn
         WHERE billed_cost_nano IS NULL AND inference_id IS NOT NULL AND status = 'done'
           AND billed_checks < ? AND created_at BETWEEN ? AND ?
         ORDER BY created_at LIMIT ?`,
      )
      .all(MAX_CHECKS, t - MAX_AGE_MS, t - RECONCILE_MIN_AGE_MS, BATCH) as Row[]
  ).filter((r) => UUID.test(r.inference_id));
  if (rows.length === 0) return none;

  let json: { requests?: { requestId?: string; costNanoUsd?: number }[] };
  try {
    const res = await f(`${cfg.NEARAI_BASE_URL.replace(/\/$/, "")}/billing/costs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.NEARAI_API_KEY}`, "Content-Type": "application/json", "Accept-Encoding": "identity" },
      body: JSON.stringify({ requestIds: rows.map((r) => r.inference_id) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      log.warn("billing reconcile failed", { status: res.status, asked: rows.length });
      return { ...none, asked: rows.length, pending: rows.length };
    }
    json = (await res.json()) as typeof json;
  } catch (e) {
    log.warn("billing reconcile failed", { error: e instanceof Error ? e.name : "Error", asked: rows.length });
    return { ...none, asked: rows.length, pending: rows.length };
  }

  const cost = new Map<string, number>();
  for (const r of json.requests ?? []) {
    if (typeof r.requestId === "string" && typeof r.costNanoUsd === "number") cost.set(r.requestId.toLowerCase(), r.costNanoUsd);
  }

  let billed = 0;
  db.transaction(() => {
    for (const r of rows) {
      const c = cost.get(r.inference_id.toLowerCase());
      if (c === undefined || c <= 0) {
        db.prepare("UPDATE turn SET billed_checks = billed_checks + 1 WHERE id = ?").run(r.id);
        continue;
      }
      const set = db.prepare("UPDATE turn SET billed_cost_nano = ? WHERE id = ? AND billed_cost_nano IS NULL").run(c, r.id);
      if (set.changes !== 1) continue;
      adjustProviderSpend(db, utcDay(r.created_at), c - (r.provider_cost_nano ?? 0));
      billed++;
    }
  })();
  const out = { asked: rows.length, billed, pending: rows.length - billed };
  log.info("billing reconciled", { ...out });
  return out;
}
