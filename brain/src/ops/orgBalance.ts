import type { Deps } from "../deps";
import { log } from "../log";

/**
 * F6: after each successful credit sweep, read the NEAR AI org balance
 * (`GET {NEARAI_BASE_URL}/organizations/{org_id}/usage/balance`, amounts in nano-USD), store it
 * in `org_balance` and log the change in `remaining` since the last reading.
 * [VERIFY] The docs list `session_token` auth for this route; the brain sends its API key, which
 * may get 401/403 on staging. That is logged and the /ops page shows the last stored value.
 * Org id: `NEARAI_ORG_ID`, else the pets contract `config().org_id` (the CREDIT sweep target).
 */

type Fetch = typeof fetch;

export interface OrgBalanceRow {
  org_id: string;
  remaining_nano: number | null;
  spend_limit_nano: number | null;
  total_spent_nano: number | null;
  fetched_at: number;
}

const ZERO_ORG = "00000000-0000-0000-0000-000000000000";

async function orgId(deps: Deps, contract: string): Promise<string | null> {
  if (deps.cfg.NEARAI_ORG_ID) return deps.cfg.NEARAI_ORG_ID;
  try {
    const c = await deps.chain.view<{ org_id?: string }>(contract, "config", {});
    return c.org_id && c.org_id !== ZERO_ORG ? c.org_id : null;
  } catch {
    return null;
  }
}

export function latestOrgBalance(deps: Deps): OrgBalanceRow | null {
  return (
    (deps.db
      .prepare("SELECT org_id, remaining_nano, spend_limit_nano, total_spent_nano, fetched_at FROM org_balance ORDER BY id DESC LIMIT 1")
      .get() as OrgBalanceRow | undefined) ?? null
  );
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function recordOrgBalance(deps: Deps, contract: string, f: Fetch = fetch): Promise<OrgBalanceRow | null> {
  const { cfg, db } = deps;
  if (!cfg.NEARAI_API_KEY) return null;
  const org = await orgId(deps, contract);
  if (!org) {
    log.warn("org balance skipped: no org id", { contract });
    return null;
  }
  let j: { remaining?: unknown; spend_limit?: unknown; total_spent?: unknown };
  try {
    const res = await f(`${cfg.NEARAI_BASE_URL.replace(/\/$/, "")}/organizations/${encodeURIComponent(org)}/usage/balance`, {
      headers: { Authorization: `Bearer ${cfg.NEARAI_API_KEY}`, "Accept-Encoding": "identity" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log.warn("org balance read failed", { org_id: org, status: res.status });
      return null;
    }
    j = (await res.json()) as typeof j;
  } catch (e) {
    log.warn("org balance read failed", { org_id: org, error: e instanceof Error ? e.name : "Error" });
    return null;
  }
  const prev = latestOrgBalance(deps);
  const row: OrgBalanceRow = {
    org_id: org,
    remaining_nano: num(j.remaining),
    spend_limit_nano: num(j.spend_limit),
    total_spent_nano: num(j.total_spent),
    fetched_at: deps.now(),
  };
  db.prepare(
    "INSERT INTO org_balance (org_id, remaining_nano, spend_limit_nano, total_spent_nano, fetched_at) VALUES (@org_id, @remaining_nano, @spend_limit_nano, @total_spent_nano, @fetched_at)",
  ).run(row);
  const delta =
    prev && prev.org_id === org && prev.remaining_nano !== null && row.remaining_nano !== null
      ? row.remaining_nano - prev.remaining_nano
      : null;
  log.info("org balance", { org_id: org, contract, remaining_nano: row.remaining_nano, delta_nano: delta });
  return row;
}
