import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { knownModels, latestAttestation } from "../ai/attestation";
import { createTts, type TtsProvider } from "../ai/tts";
import type { Deps, Module } from "../deps";
import { log, setAlertSink } from "../log";
import { configureSpend, addSpend, spentToday, totalSpendNano, ttsNano, utcDay } from "../talk/spend";
import { createRpc, type NearRpc } from "../wallet/rpc";
import { createAlertWebhook } from "./alerts";
import { BACKUP_EVERY_MS, backupOnce, lastBackupAt, listBackups } from "./backup";
import { RECONCILE_EVERY_MS, reconcileBilling } from "./billing";
import { latestOrgBalance } from "./orgBalance";

/**
 * Team operations (AI-brain 09 section 3).
 *   GET /ops   basic auth (OPS_USER / OPS_PASSWORD), 404 when unset. JSON only, ids and numbers,
 *              never chat content.
 *   jobs       billing reconcile every 5 min (A5), daily SQLite backup (O2), STT and TTS priced into
 *              the spend cap (A6), alert webhook (O4).
 */

export interface OpsIo {
  rpc: NearRpc;
  tts: TtsProvider | null;
  fetch: typeof fetch;
}

const CREDITS_TTL_MS = 3600_000;

const digest = (s: string) => createHash("sha256").update(s).digest();

/** HTTP basic auth check, constant time on the credentials. */
export function basicOk(header: string | undefined, user: string, password: string): boolean {
  const m = header?.match(/^Basic\s+(.+)$/i);
  if (!m) return false;
  const given = Buffer.from(m[1]!, "base64").toString("utf8");
  return timingSafeEqual(digest(given), digest(`${user}:${password}`));
}
const nano2usd = (n: number) => Math.round(n) / 1e9;

export function opsRoutes(deps: Deps, over: Partial<OpsIo> = {}) {
  const { cfg, db } = deps;
  const app = new Hono();
  const user = cfg.OPS_USER;
  const password = cfg.OPS_PASSWORD;
  if (!user || !password) {
    app.get("/ops", (c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));
    return app;
  }
  const rpc = over.rpc ?? createRpc(cfg.NEAR_RPC_URLS);
  const tts = over.tts !== undefined ? over.tts : createTts(cfg);
  let credits: { at: number; value: number | null } | null = null;

  async function ttsCredits(): Promise<number | null> {
    if (!tts?.credits) return null;
    if (credits && deps.now() - credits.at < CREDITS_TTL_MS) return credits.value;
    const value = await tts.credits().catch(() => null);
    credits = { at: deps.now(), value };
    return value;
  }

  async function claimable(contract: string): Promise<string | null> {
    try {
      const acct = await deps.chain.view<{ claimable?: string } | null>(cfg.NEARON_POOL, "get_account", { account_id: contract });
      return acct?.claimable ?? "0";
    } catch {
      return null;
    }
  }

  async function feeder() {
    if (!cfg.FEEDER_ACCOUNT_ID) return { account: null, balance_yocto: null };
    try {
      const a = await rpc.viewAccount(cfg.FEEDER_ACCOUNT_ID);
      return { account: cfg.FEEDER_ACCOUNT_ID, balance_yocto: a?.amount ?? null };
    } catch {
      return { account: cfg.FEEDER_ACCOUNT_ID, balance_yocto: null, error: "rpc" };
    }
  }

  app.get("/ops", async (c) => {
    if (!basicOk(c.req.header("Authorization"), user, password)) {
      c.header("WWW-Authenticate", 'Basic realm="nearling ops"');
      return c.json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    }
    const now = deps.now();
    const s = spentToday(db, now);
    const dayStart = Date.parse(`${utcDay(now)}T00:00:00Z`);
    const billing = db
      .prepare(
        `SELECT count(billed_cost_nano) billed, sum(CASE WHEN billed_cost_nano IS NULL THEN 1 ELSE 0 END) unbilled
         FROM turn WHERE status = 'done' AND created_at >= ?`,
      )
      .get(dayStart) as { billed: number; unbilled: number | null };
    const charges = Object.fromEntries(
      (db.prepare("SELECT status, count(*) n FROM charge_job GROUP BY status").all() as { status: string; n: number }[]).map((r) => [r.status, r.n]),
    );
    const oldest = db
      .prepare("SELECT min(created_at) t FROM charge_job WHERE status IN ('queued', 'sent')")
      .get() as { t: number | null };
    const failingCharges = db
      .prepare("SELECT count(*) n FROM charge_job WHERE status IN ('queued', 'sent') AND attempts > 0")
      .get() as { n: number };
    const orders = Object.fromEntries(
      (db.prepare("SELECT status, count(*) n FROM feed_order GROUP BY status").all() as { status: string; n: number }[]).map((r) => [r.status, r.n]),
    );
    const retrying = db
      .prepare("SELECT count(*) n FROM feed_order WHERE status = 'settled' AND feed_attempts > 0")
      .get() as { n: number };
    const models = [...new Set([cfg.NEARAI_CHAT_MODEL, ...knownModels(deps)])];
    const contracts = [...new Set([cfg.PETS_CONTRACT, cfg.DEMO_PETS_CONTRACT])];
    const [feederInfo, claim, ttsLeft] = await Promise.all([
      feeder(),
      Promise.all(contracts.map(async (k) => [k, await claimable(k)] as const)),
      ttsCredits(),
    ]);
    const org = latestOrgBalance(deps);
    return c.json({
      at: now,
      spend_today: {
        day: utcDay(now),
        provider_usd: nano2usd(s.provider_nano),
        stt_usd: nano2usd(s.stt_nano),
        tts_chars: s.tts_chars,
        tts_usd: nano2usd(ttsNano(s.tts_chars)),
        total_usd: nano2usd(totalSpendNano(s)),
        cap_usd: cfg.GLOBAL_DAILY_SPEND_CAP_USD,
        billed_turns: billing.billed,
        unbilled_turns: billing.unbilled ?? 0,
      },
      charge_queue: {
        depth: (charges.queued ?? 0) + (charges.sent ?? 0),
        retrying: failingCharges.n,
        failed: charges.failed ?? 0,
        settled: charges.settled ?? 0,
        oldest_pending_age_s: oldest.t === null ? null : Math.round((now - oldest.t) / 1000),
      },
      orders: { by_status: orders, feed_retrying: retrying.n },
      feeder: feederInfo,
      attestation: models.map((m) => {
        const a = latestAttestation(deps, m);
        return { model: m, ok: a?.ok ?? null, fetched_at: a?.fetchedAt ?? null, reason: a?.reason ?? null };
      }),
      nearon_claimable: Object.fromEntries(claim),
      org_balance: org
        ? {
            org_id: org.org_id,
            remaining_usd: org.remaining_nano === null ? null : nano2usd(org.remaining_nano),
            total_spent_usd: org.total_spent_nano === null ? null : nano2usd(org.total_spent_nano),
            fetched_at: org.fetched_at,
          }
        : null,
      elevenlabs_credits: ttsLeft,
      backups: { last_at: lastBackupAt(cfg.BACKUP_DIR), count: listBackups(cfg.BACKUP_DIR).length },
    });
  });
  return app;
}

/** Starts the ops jobs and process-wide hooks. Returns a stop function. */
export function startOps(deps: Deps, over: Partial<OpsIo> = {}): () => void {
  const { cfg } = deps;
  const f = over.fetch ?? fetch;
  configureSpend({
    ttsUsdPer1kChars: cfg.TTS_USD_PER_1K_CHARS,
    sttSink: (nano) => addSpend(deps.db, deps.now(), 0, 0, nano),
  });
  if (cfg.ALERT_WEBHOOK_URL) setAlertSink(createAlertWebhook(cfg.ALERT_WEBHOOK_URL, { fetch: f }));

  const reconcile = setInterval(() => void reconcileBilling(deps, f).catch(() => undefined), RECONCILE_EVERY_MS);
  const backupTick = () => {
    const last = lastBackupAt(cfg.BACKUP_DIR);
    if (last === null || Date.now() - last >= BACKUP_EVERY_MS) void backupOnce(deps.db, cfg.BACKUP_DIR, Date.now());
  };
  const firstBackup = setTimeout(backupTick, 60_000);
  const backup = setInterval(backupTick, 3600_000);
  if (!cfg.OPS_USER || !cfg.OPS_PASSWORD) log.info("ops page off (OPS_USER, OPS_PASSWORD unset)");
  return () => {
    clearInterval(reconcile);
    clearTimeout(firstBackup);
    clearInterval(backup);
    configureSpend({ sttSink: null });
    setAlertSink(null);
  };
}

export function opsModule(over: Partial<OpsIo> = {}): Module {
  return { name: "ops", routes: (deps) => opsRoutes(deps, over), start: (deps) => startOps(deps, over) };
}
