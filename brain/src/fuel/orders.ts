import { randomUUID } from "node:crypto";
import { type NearRpc, type TxStatus, createRpc, isAccountId } from "../wallet/rpc";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { parsePetRef } from "@nearling/shared";
import type { TxSigner } from "../chain/signer";
import type { Config } from "../config";
import type { Deps, Module } from "../deps";
import { publish } from "../events";
import { log } from "../log";
import { createFeederNonce, errorTxHash, FEED_RETRY_DELAYS_MS, MAX_FEED_TRIES } from "../ops/feedRetry";
import { NEAR_ASSET, createOneClick, type OneClick } from "./intents";

/**
 * Feed the Brain (AI-brain 04 section 3): one order pipeline, three payment modes.
 *   direct    payer's own testnet wallet calls feed(pet); the brain verifies the tx on chain
 *   live      NEAR Intents 1Click on mainnet, then the feeder feeds on testnet
 *   simulated labelled button, then the feeder feeds on testnet
 * Pending, failed, refunded and expired orders never touch fuel. settle_ref and feed_tx are
 * UNIQUE and settled -> feeding is one guarded UPDATE, so duplicates feed once.
 */

const NEAR = 10n ** 24n;

export const PACKS = [
  { id: "snack", name: "Snack", feed_yocto: NEAR / 10n, fuel: 20 },
  { id: "meal", name: "Meal", feed_yocto: NEAR / 2n, fuel: 100 },
  { id: "feast", name: "Feast", feed_yocto: NEAR, fuel: 200 },
] as const;

export type Mode = "direct" | "live" | "simulated";
export type OrderStatus = "created" | "quoted" | "pending" | "settled" | "feeding" | "fed" | "failed" | "refunded" | "expired";

export interface OrderRow {
  id: string;
  pet_ref: string;
  mode: Mode;
  pack_id: string;
  payer_hint: string | null;
  quote: string | null;
  deposit_address: string | null;
  deadline: number | null;
  status: OrderStatus;
  feed_yocto: string;
  feed_tx: string | null;
  settle_ref: string | null;
  feeding_day: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface OrdersIo {
  rpc: NearRpc;
  feeder: TxSigner | null;
  oneclick: OneClick;
  /** F3: feeder access key nonce sum (ops/feedRetry.ts); without it a failure with no tx hash is not retried. */
  feederNonce?: () => Promise<bigint | null>;
}

/** direct always; live needs INTENTS_MODE=live and a settlement account; simulated with live or simulated. */
export function enabledModes(cfg: Config): Mode[] {
  const modes: Mode[] = ["direct"];
  if (cfg.INTENTS_MODE === "live" && cfg.SETTLEMENT_ACCOUNT_MAINNET) modes.push("live");
  if (cfg.INTENTS_MODE === "live" || cfg.INTENTS_MODE === "simulated") modes.push("simulated");
  return modes;
}

const LABELS: Record<Mode, string | null> = {
  direct: null,
  live: "Paid on mainnet, fuel granted on testnet",
  simulated: "simulated",
};

function view(o: OrderRow) {
  const pack = PACKS.find((p) => p.id === o.pack_id);
  return {
    id: o.id,
    pet_ref: o.pet_ref,
    mode: o.mode,
    label: LABELS[o.mode],
    simulated: o.mode === "simulated",
    pack_id: o.pack_id,
    fuel: pack?.fuel ?? 0,
    feed_yocto: o.feed_yocto,
    status: o.status,
    payer: o.payer_hint,
    quote: o.quote ? (JSON.parse(o.quote) as unknown) : null,
    deposit_address: o.deposit_address,
    deadline: o.deadline,
    feed_tx: o.feed_tx,
    created_at: o.created_at,
    updated_at: o.updated_at,
  };
}

const ios = new WeakMap<Deps, OrdersIo>();

function ioFor(deps: Deps, over: Partial<OrdersIo>): OrdersIo {
  let io = ios.get(deps);
  if (!io) {
    const { cfg } = deps;
    io = {
      rpc: over.rpc ?? createRpc(cfg.NEAR_RPC_URLS),
      feeder: over.feeder !== undefined ? over.feeder : (deps.feeder ?? null), // the one shared feeder signer
      oneclick:
        over.oneclick ??
        createOneClick({ baseUrl: cfg.ONECLICK_BASE_URL, jwt: cfg.ONECLICK_JWT, liveConfirmed: cfg.INTENTS_LIVE_CONFIRMED === "1" }),
      feederNonce:
        over.feederNonce ?? (cfg.FEEDER_ACCOUNT_ID ? createFeederNonce(cfg.NEAR_RPC_URLS, cfg.FEEDER_ACCOUNT_ID) : undefined),
    };
    ios.set(deps, io);
  }
  return io;
}

const getOrder = (deps: Deps, id: string) =>
  (deps.db.prepare("SELECT * FROM feed_order WHERE id = ?").get(id) as OrderRow | undefined) ?? null;

const err = (c: Context, status: 400 | 404 | 409 | 502, code: string, message: string) =>
  c.json({ error: { code, message } }, status);

const isUnique = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/.test(e.message);

// ---------- direct tx verification ----------

export type FeedCheck = { ok: true; payer: string } | { ok: false; failed: boolean; reason: string };

function eventPetIds(data: unknown): unknown[] {
  const items = Array.isArray(data) ? data : [data];
  return items.map((d) => (d && typeof d === "object" ? (d as Record<string, unknown>).pet_id : undefined));
}

/** Never trust the client: the tx itself must be exactly feed(pet_id) with the pack deposit. */
export function verifyFeedTx(tx: TxStatus, contract: string, tokenId: string, yocto: bigint): FeedCheck {
  const [a, ...rest] = tx.actions;
  if (tx.receiverId !== contract) return { ok: false, failed: false, reason: "wrong contract" };
  if (!a || rest.length > 0 || a.kind !== "FunctionCall" || a.method !== "feed") {
    return { ok: false, failed: false, reason: "not a single feed call" };
  }
  const args = a.args as { pet_id?: unknown } | null;
  if (!args || args.pet_id !== tokenId) return { ok: false, failed: false, reason: "wrong pet" };
  if (a.deposit !== yocto) return { ok: false, failed: false, reason: "wrong amount" };
  if (!tx.success) return { ok: false, failed: true, reason: "tx failed" };
  // [VERIFY] `fed` data shape; if it carries pet_id it must match.
  const fed = tx.events.some(
    (e) =>
      e.standard === "nearling" &&
      e.event === "fed" &&
      e.executor === contract &&
      eventPetIds(e.data).every((p) => p === undefined || p === tokenId),
  );
  if (!fed) return { ok: false, failed: false, reason: "no fed event" };
  return { ok: true, payer: tx.signerId };
}

function announceFed(o: OrderRow, txHash: string) {
  const pack = PACKS.find((p) => p.id === o.pack_id);
  publish(o.pet_ref, "fuel_added", {
    order_id: o.id,
    celebrate_id: o.id,
    mode: o.mode,
    simulated: o.mode === "simulated",
    pack_id: o.pack_id,
    fuel: pack?.fuel ?? 0,
    feed_yocto: o.feed_yocto,
    payer: o.payer_hint,
    tx_hash: txHash,
  });
}

// ---------- feeder worker ----------

const DAY_MS = 86_400_000;
const LOW_BALANCE = 2n * NEAR;
const GAS_MARGIN = NEAR / 20n; // keep 0.05 NEAR for gas
const warned = new WeakMap<Deps, Map<string, number>>();

/** Logs a warning / alert at most once per `everyMs` for the same key. */
function throttled(deps: Deps, key: string, everyMs: number, fn: () => void) {
  let m = warned.get(deps);
  if (!m) warned.set(deps, (m = new Map()));
  const last = m.get(key);
  if (last !== undefined && deps.now() - last < everyMs) return;
  m.set(key, deps.now());
  fn();
}

const feederRuns = new WeakMap<Deps, Promise<void>>();

/** Retry columns from migration 600_ops.sql (F3). */
interface FeedRetryCols {
  feed_attempts: number;
  feed_retry_at: number | null;
  feed_try_tx: string | null;
  feed_nonce: string | null;
}

/** Feeds settled live / simulated orders. Single flight: a concurrent call joins the running one. */
export function runFeeder(deps: Deps, io: OrdersIo): Promise<void> {
  const running = feederRuns.get(deps);
  if (running) return running;
  const run = feedOnce(deps, io).finally(() => feederRuns.delete(deps));
  feederRuns.set(deps, run);
  return run;
}

async function feedOnce(deps: Deps, io: OrdersIo): Promise<void> {
  const { db } = deps;
  const rows = db
    .prepare(
      `SELECT * FROM feed_order WHERE status = 'settled' AND mode IN ('live', 'simulated')
         AND (feed_retry_at IS NULL OR feed_retry_at <= ?) ORDER BY created_at LIMIT 20`,
    )
    .all(deps.now()) as (OrderRow & FeedRetryCols)[];
  if (rows.length === 0) return;
  const feeder = io.feeder;
  if (!feeder) return; // warned once at start; orders wait in settled

  const day = Math.floor(deps.now() / DAY_MS);
  const cap = BigInt(Math.round(deps.cfg.FEEDER_DAILY_CAP_NEAR * 1000)) * (NEAR / 1000n);
  // Count anything the feeder took today, failures included (a failed call may still have landed).
  let used = (db.prepare("SELECT feed_yocto FROM feed_order WHERE feeding_day = ?").all(day) as { feed_yocto: string }[])
    .reduce((s, r) => s + BigInt(r.feed_yocto), 0n);

  let balance: bigint;
  try {
    balance = BigInt((await io.rpc.viewAccount(feeder.accountId))?.amount ?? "0");
  } catch (e) {
    log.warn("feeder balance check failed", { error: (e as Error).name });
    return;
  }
  if (balance < LOW_BALANCE) {
    throttled(deps, "feeder-low", 3_600_000, () =>
      log.alert("feeder balance low", { account: feeder.accountId, balance_yocto: balance.toString() }),
    );
  }

  const failOrder = (o: OrderRow, reason: string, from: "settled" | "feeding") =>
    db.prepare("UPDATE feed_order SET status = 'failed', last_error = ?, feed_retry_at = NULL, updated_at = ? WHERE id = ? AND status = ?")
      .run(reason.slice(0, 200), deps.now(), o.id, from);
  const markFed = (o: OrderRow, txHash: string, from: "settled" | "feeding", attempts: number) => {
    const r = db.prepare("UPDATE feed_order SET status = 'fed', feed_tx = ?, feed_retry_at = NULL, updated_at = ? WHERE id = ? AND status = ?")
      .run(txHash, deps.now(), o.id, from);
    if (r.changes !== 1) return;
    log.info("order fed", { order_id: o.id, mode: o.mode, tx_hash: txHash, attempts });
    announceFed(o, txHash);
  };
  const readNonce = async () => (io.feederNonce ? await io.feederNonce().catch(() => null) : null);

  for (const o of rows) {
    const amount = BigInt(o.feed_yocto);
    const ref = parsePetRef(o.pet_ref);
    if (!ref) continue;

    // F3: before a retry, prove the earlier try did not feed (ops/feedRetry.ts). Never feed twice.
    if (o.feed_attempts > 0) {
      if (o.feed_try_tx) {
        let tx: TxStatus | null;
        try {
          tx = await io.rpc.txStatus(o.feed_try_tx, feeder.accountId);
        } catch {
          continue; // RPC down: check again next tick
        }
        if (!tx) continue; // not final yet
        if (verifyFeedTx(tx, ref.contract, ref.tokenId, amount).ok) {
          markFed(o, o.feed_try_tx, "settled", o.feed_attempts);
          continue;
        }
        if (tx.success) {
          failOrder(o, "earlier feed try succeeded without a fed event", "settled");
          log.alert("feeder feed outcome unclear; order failed", { order_id: o.id, tx_hash: o.feed_try_tx });
          continue;
        }
      } else {
        const nonce = await readNonce();
        if (nonce === null || o.feed_nonce === null || nonce !== BigInt(o.feed_nonce)) {
          failOrder(o, "earlier feed try outcome unknown", "settled");
          log.alert("feeder feed outcome unknown; order failed, check feeder txs", { order_id: o.id });
          continue;
        }
      }
    }

    const extra = o.feeding_day === day ? 0n : amount; // a retry was already counted today
    if (used + extra > cap) {
      throttled(deps, `cap-${day}`, DAY_MS, () =>
        log.alert("feeder daily cap reached; orders wait in settled", { cap_near: deps.cfg.FEEDER_DAILY_CAP_NEAR }),
      );
      return;
    }
    if (balance < amount + GAS_MARGIN) {
      throttled(deps, "feeder-empty", 600_000, () =>
        log.alert("feeder cannot cover order; waiting in settled", { order_id: o.id }),
      );
      return;
    }
    const nonceBefore = await readNonce();
    const claimed = db
      .prepare(
        `UPDATE feed_order SET status = 'feeding', feeding_day = ?, feed_attempts = feed_attempts + 1, feed_nonce = ?,
           feed_try_tx = NULL, feed_retry_at = NULL, updated_at = ? WHERE id = ? AND status = 'settled'`,
      )
      .run(day, nonceBefore === null ? null : nonceBefore.toString(), deps.now(), o.id);
    if (claimed.changes !== 1) continue; // someone else took it
    used += extra;
    balance -= amount;
    const attempt = o.feed_attempts + 1;
    try {
      const res = await feeder.call(ref.contract, "feed", { pet_id: ref.tokenId }, { gasTgas: 30, depositYocto: amount });
      markFed(o, res.txHash, "feeding", attempt);
    } catch (e) {
      const name = (e as Error).name || "Error";
      const message = String((e as Error).message ?? name).slice(0, 200);
      const hash = errorTxHash(e);
      if (attempt >= MAX_FEED_TRIES || (!hash && nonceBefore === null)) {
        failOrder(o, message, "feeding");
        log.alert("feeder feed failed", { order_id: o.id, error: name, attempts: attempt });
        continue;
      }
      const delay = FEED_RETRY_DELAYS_MS[attempt - 1] ?? FEED_RETRY_DELAYS_MS[FEED_RETRY_DELAYS_MS.length - 1]!;
      db.prepare(
        `UPDATE feed_order SET status = 'settled', last_error = ?, feed_try_tx = ?, feed_retry_at = ?, updated_at = ?
         WHERE id = ? AND status = 'feeding'`,
      ).run(message, hash, deps.now() + delay, deps.now(), o.id);
      log.warn("feeder feed failed; will retry", { order_id: o.id, error: name, attempts: attempt, retry_in_ms: delay, tx_hash: hash });
    }
  }
}

// ---------- live order poller ----------

/** Polls 1Click for live orders that have a deposit address. */
export async function pollLive(deps: Deps, io: OrdersIo): Promise<void> {
  const { db } = deps;
  const rows = db
    .prepare("SELECT * FROM feed_order WHERE mode = 'live' AND status IN ('quoted', 'pending') AND deposit_address IS NOT NULL")
    .all() as OrderRow[];
  const set = (o: OrderRow, to: OrderStatus, from: OrderStatus[], extra: { settle_ref?: string } = {}) => {
    try {
      db.prepare(
        `UPDATE feed_order SET status = ?, settle_ref = COALESCE(?, settle_ref), updated_at = ?
         WHERE id = ? AND status IN (${from.map(() => "?").join(",")})`,
      ).run(to, extra.settle_ref ?? null, deps.now(), o.id, ...from);
    } catch (e) {
      if (!isUnique(e)) throw e;
      log.alert("duplicate live settlement ignored", { order_id: o.id });
    }
  };
  for (const o of rows) {
    let st;
    try {
      st = await io.oneclick.status(o.deposit_address!);
    } catch (e) {
      log.warn("1click status failed", { order_id: o.id, error: (e as Error).name });
      continue;
    }
    switch (st.status) {
      case "PENDING_DEPOSIT":
        if (o.status === "quoted" && o.deadline !== null && deps.now() > o.deadline) set(o, "expired", ["quoted"]);
        break;
      case "KNOWN_DEPOSIT_TX":
      case "PROCESSING":
      case "INCOMPLETE_DEPOSIT":
        set(o, "pending", ["quoted"]);
        break;
      case "SUCCESS":
        set(o, "settled", ["quoted", "pending"], { settle_ref: `1click:${o.deposit_address}` });
        break;
      case "REFUNDED":
        set(o, "refunded", ["quoted", "pending"]);
        break;
      case "FAILED":
        set(o, "failed", ["quoted", "pending"]);
        break;
    }
  }
}

// ---------- routes ----------

const CreateBody = z.object({
  pet_ref: z.string(),
  pack_id: z.string(),
  mode: z.enum(["direct", "live", "simulated"]).default("direct"),
  origin_asset: z.string().min(1).max(200).optional(),
  refund_to: z.string().min(1).max(200).optional(),
});
const DirectBody = z.object({
  tx_hash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/),
  /** Hint to locate the tx (RPC needs the sender); defaults to the pet owner. */
  signer_id: z.string().optional(),
});

export function orderRoutes(deps: Deps, over: Partial<OrdersIo> = {}) {
  const { cfg, db, chain } = deps;
  const app = new Hono();
  const contracts = [cfg.PETS_CONTRACT, cfg.DEMO_PETS_CONTRACT];

  app.get("/feed/packs", (c) =>
    c.json({
      packs: PACKS.map((p) => ({ id: p.id, name: p.name, feed_yocto: p.feed_yocto.toString(), fuel: p.fuel })),
      modes: enabledModes(cfg),
      live_quotes: cfg.INTENTS_LIVE_CONFIRMED === "1" ? "live" : "dry",
    }),
  );

  app.post("/orders", async (c) => {
    const body = CreateBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(c, 400, "invalid", "Bad order");
    const { pet_ref, pack_id, mode, origin_asset, refund_to } = body.data;
    const ref = parsePetRef(pet_ref);
    if (!ref || !contracts.includes(ref.contract)) return err(c, 400, "invalid", "Unknown pet reference");
    const pack = PACKS.find((p) => p.id === pack_id);
    if (!pack) return err(c, 400, "invalid", "Unknown pack");
    if (!enabledModes(cfg).includes(mode)) return err(c, 400, "invalid", "Payment mode not enabled");
    if (!(await chain.getPet(ref.contract, ref.tokenId))) return err(c, 404, "not_found", "No such pet");

    const now = deps.now();
    const row: OrderRow = {
      id: randomUUID(), pet_ref: `${ref.contract}:${ref.tokenId}`, mode, pack_id, payer_hint: null, quote: null,
      deposit_address: null, deadline: null, status: "created", feed_yocto: pack.feed_yocto.toString(),
      feed_tx: null, settle_ref: null, feeding_day: null, last_error: null, created_at: now, updated_at: now,
    };

    if (mode === "live") {
      if (!origin_asset || !refund_to) return err(c, 400, "invalid", "origin_asset and refund_to are needed");
      const dry = cfg.INTENTS_LIVE_CONFIRMED !== "1";
      try {
        // [TBD] live price: the testnet pack amount, delivered as NEAR on mainnet. Check route minimum.
        const q = await ioFor(deps, over).oneclick.quote({
          dry, swapType: "EXACT_OUTPUT", slippageTolerance: 100, originAsset: origin_asset, depositType: "ORIGIN_CHAIN",
          destinationAsset: NEAR_ASSET, amount: pack.feed_yocto.toString(), refundTo: refund_to, refundType: "ORIGIN_CHAIN",
          recipient: cfg.SETTLEMENT_ACCOUNT_MAINNET!, recipientType: "DESTINATION_CHAIN",
          deadline: new Date(now + 30 * 60_000).toISOString(),
        });
        const deadline = q.quote.deadline ? Date.parse(q.quote.deadline) : null;
        row.quote = JSON.stringify({
          dry, origin_asset, amount_in: q.quote.amountIn, amount_in_formatted: q.quote.amountInFormatted ?? null,
          amount_out: q.quote.amountOut, deadline: q.quote.deadline ?? null, quote_ref: q.signature ?? null,
        });
        if (!dry && q.quote.depositAddress) {
          row.status = "quoted";
          row.deposit_address = q.quote.depositAddress;
          row.deadline = Number.isFinite(deadline) ? deadline : null;
        }
      } catch (e) {
        log.warn("1click quote failed", { error: (e as Error).name });
        return err(c, 502, "upstream", "Could not get a quote");
      }
    }

    db.prepare(
      `INSERT INTO feed_order (id, pet_ref, mode, pack_id, payer_hint, quote, deposit_address, deadline, status,
        feed_yocto, feed_tx, settle_ref, feeding_day, last_error, created_at, updated_at)
       VALUES (@id, @pet_ref, @mode, @pack_id, @payer_hint, @quote, @deposit_address, @deadline, @status,
        @feed_yocto, @feed_tx, @settle_ref, @feeding_day, @last_error, @created_at, @updated_at)`,
    ).run(row);
    log.info("order created", { order_id: row.id, mode, pack_id, status: row.status });
    return c.json({ ...view(row), quote_only: mode === "live" && row.status === "created" }, 201);
  });

  app.get("/orders/:id", (c) => {
    const o = getOrder(deps, c.req.param("id"));
    return o ? c.json(view(o)) : err(c, 404, "not_found", "No such order");
  });

  app.post("/orders/:id/direct-tx", async (c) => {
    const id = c.req.param("id");
    const o = getOrder(deps, id);
    if (!o) return err(c, 404, "not_found", "No such order");
    if (o.mode !== "direct") return err(c, 409, "conflict", "Not a direct order");
    const body = DirectBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(c, 400, "invalid", "Bad tx hash");
    const { tx_hash } = body.data;

    if (o.settle_ref === tx_hash && o.status === "fed") return c.json(view(o)); // repeat report
    if (o.status === "created") {
      try {
        db.prepare("UPDATE feed_order SET status = 'pending', settle_ref = ?, updated_at = ? WHERE id = ? AND status = 'created'")
          .run(tx_hash, deps.now(), id);
      } catch (e) {
        if (isUnique(e)) return err(c, 409, "conflict", "That transaction already fed another order");
        throw e;
      }
    }
    const cur = getOrder(deps, id)!;
    if (cur.status !== "pending" || cur.settle_ref !== tx_hash) {
      return cur.status === "fed" && cur.settle_ref === tx_hash ? c.json(view(cur)) : err(c, 409, "conflict", "Order is not waiting for this tx");
    }

    const ref = parsePetRef(cur.pet_ref)!;
    let sender = body.data.signer_id;
    if (!sender || !isAccountId(sender)) sender = (await chain.getPet(ref.contract, ref.tokenId))?.owner;
    if (!sender) return err(c, 404, "not_found", "No such pet");

    let tx: TxStatus | null;
    try {
      tx = await ioFor(deps, over).rpc.txStatus(tx_hash, sender);
    } catch (e) {
      log.warn("direct tx lookup failed", { order_id: id, error: (e as Error).name });
      return err(c, 502, "upstream", "Could not check the transaction; try again");
    }
    if (!tx) return c.json(view(cur), 202); // not final yet: report again later

    const check = verifyFeedTx(tx, ref.contract, ref.tokenId, BigInt(cur.feed_yocto));
    if (!check.ok) {
      if (check.failed) {
        db.prepare("UPDATE feed_order SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
          .run(check.reason, deps.now(), id);
        return c.json(view(getOrder(deps, id)!));
      }
      // A tx that is not this order's feed: forget it, the order can still be paid properly.
      db.prepare("UPDATE feed_order SET status = 'created', settle_ref = NULL, updated_at = ? WHERE id = ? AND status = 'pending' AND settle_ref = ?")
        .run(deps.now(), id, tx_hash);
      log.warn("direct tx rejected", { order_id: id, reason: check.reason });
      return err(c, 400, "invalid", `Transaction does not match this order (${check.reason})`);
    }

    const done = db.transaction(() => {
      const s = db.prepare("UPDATE feed_order SET status = 'settled', payer_hint = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
        .run(check.payer, deps.now(), id);
      if (s.changes !== 1) return false;
      db.prepare("UPDATE feed_order SET status = 'fed', feed_tx = ?, updated_at = ? WHERE id = ? AND status = 'settled'")
        .run(tx_hash, deps.now(), id);
      return true;
    })();
    const fed = getOrder(deps, id)!;
    if (done) {
      log.info("order fed", { order_id: id, mode: "direct", tx_hash });
      announceFed(fed, tx_hash);
    }
    return c.json(view(fed));
  });

  app.post("/orders/:id/simulate-pay", (c) => {
    if (!enabledModes(cfg).includes("simulated")) return err(c, 404, "not_found", "Simulated payments are off");
    const id = c.req.param("id");
    const o = getOrder(deps, id);
    if (!o) return err(c, 404, "not_found", "No such order");
    if (o.mode !== "simulated") return err(c, 409, "conflict", "Not a simulated order");
    db.prepare("UPDATE feed_order SET status = 'settled', settle_ref = ?, updated_at = ? WHERE id = ? AND status = 'created'")
      .run(`sim:${id}`, deps.now(), id);
    void runFeeder(deps, ioFor(deps, over)).catch(() => undefined); // feed now instead of on the next tick
    return c.json(view(getOrder(deps, id)!));
  });

  return app;
}

export function startOrders(deps: Deps, over: Partial<OrdersIo> = {}): () => void {
  const io = ioFor(deps, over);
  if (!io.feeder) log.warn("feeder not configured (FEEDER_ACCOUNT_ID, FEEDER_KEY); live and simulated orders wait in settled");
  const feed = setInterval(() => void runFeeder(deps, io).catch(() => undefined), 5_000);
  const poll = enabledModes(deps.cfg).includes("live")
    ? setInterval(() => void pollLive(deps, io).catch(() => undefined), 10_000)
    : null;
  return () => {
    clearInterval(feed);
    if (poll) clearInterval(poll);
  };
}

export function ordersModule(over: Partial<OrdersIo> = {}): Module {
  return { name: "orders", routes: (deps) => orderRoutes(deps, over), start: (deps) => startOrders(deps, over) };
}
