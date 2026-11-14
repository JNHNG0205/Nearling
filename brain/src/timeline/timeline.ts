import { Hono } from "hono";
import { formatPetRef, parsePetRef, type ChainLifeState, type PetView, type TimelineItem } from "@petto/shared";
import type { Deps, Module } from "../deps";
import { log } from "../log";
import { listPets } from "../proactive/pets";
import { type Fetch, fetchTxs, latestIndexedMs, listAccountTxs, parseTx } from "./indexer";

/**
 * Public pet timeline (AI-brain architectual/08 `GET /pets/:petRef/timeline`).
 *
 * Source: the pets contracts' own EVENT_JSON logs, read every 30 s from the FastNEAR tx indexer
 * (indexer.ts): real tx hash, actor and amount, idempotent by (tx_hash, receipt_id, log_index, pet_ref).
 * Fallback, per contract and only while the indexer fails or lags: a diff of `get_pet` snapshots
 * (rows marked source "snapshot": no tx hash or payer, amounts net of drain, changes inside 30 s
 * merge). When the indexer recovers it replays from its cursor and the snapshot rows are deleted.
 */

export interface Snapshot {
  owner: string;
  food_yocto: string;
  staked: string;
  soul_version: number;
  stage: number;
  life_state: ChainLifeState;
}

type Detected = Pick<TimelineItem, "kind" | "actor" | "amount"> & { raw: Record<string, unknown> };

const TAIL_MS = 30_000;
/** A tx is read again on every pass until it is this old (callback receipts land a few blocks later). */
const SETTLE_MS = 2 * 60_000;
/** The indexer counts as failed when its newest block is older than this. */
const STALE_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const noFuel = (s: ChainLifeState) => s === "Starving" || s === "Dormant";

/** Events implied by the change from `prev` to `pet`. */
export function diffSnapshot(prev: Snapshot, pet: PetView): Detected[] {
  const out: Detected[] = [];
  const food = BigInt(pet.food_yocto) - BigInt(prev.food_yocto);
  const staked = BigInt(pet.staked) - BigInt(prev.staked);
  if (pet.owner !== prev.owner) {
    out.push({ kind: "owner_changed", actor: pet.owner, amount: null, raw: { from: prev.owner, to: pet.owner } });
  }
  if (food > 0n) out.push({ kind: "fed", actor: null, amount: food.toString(), raw: { from: prev.food_yocto, to: pet.food_yocto } });
  if (staked > 0n) out.push({ kind: "staked", actor: pet.owner, amount: staked.toString(), raw: { from: prev.staked, to: pet.staked } });
  if (staked < 0n) out.push({ kind: "unstaked", actor: pet.owner, amount: (-staked).toString(), raw: { from: prev.staked, to: pet.staked } });
  if (pet.soul_version > prev.soul_version) {
    out.push({ kind: "soul_updated", actor: pet.owner, amount: String(pet.soul_version), raw: { from: prev.soul_version, to: pet.soul_version } });
  }
  if (pet.stage > prev.stage) out.push({ kind: "stage_up", actor: null, amount: String(pet.stage), raw: { from: prev.stage, to: pet.stage } });
  if (pet.life_state === "Dormant" && prev.life_state !== "Dormant") {
    out.push({ kind: "dormant", actor: null, amount: null, raw: { from: prev.life_state } });
  }
  if (noFuel(prev.life_state) && !noFuel(pet.life_state)) {
    out.push({ kind: "revived", actor: null, amount: null, raw: { from: prev.life_state, to: pet.life_state } });
  }
  return out;
}

/**
 * Reads new events of one contract into pet_event. Throws when the indexer fails.
 * The cursor only moves past txs older than SETTLE_MS, so late callback receipts are not missed.
 */
export async function tailContractEvents(deps: Deps, f: Fetch, contract: string): Promise<number> {
  const cur = deps.db.prepare("SELECT height FROM timeline_cursor WHERE contract = ?").get(contract) as
    | { height: number }
    | undefined;
  const txs = await listAccountTxs(f, contract, cur ? cur.height + 1 : 0);
  if (txs.length === 0) return 0;
  const raw = await fetchTxs(f, [...new Set(txs.map((t) => t.transaction_hash))]);
  const events = raw.flatMap((tx) => parseTx(tx, contract));
  const settledBefore = deps.now() - SETTLE_MS;
  const settled = txs
    .filter((t) => Number(BigInt(t.tx_block_timestamp) / 1_000_000n) < settledBefore)
    .reduce((h, t) => Math.max(h, t.tx_block_height), cur?.height ?? 0);
  const insert = deps.db.prepare(
    `INSERT OR IGNORE INTO pet_event (pet_ref, kind, actor, amount, tx_hash, receipt_id, log_index, source, block_ts, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'event', ?, ?)`,
  );
  let added = 0;
  deps.db.transaction(() => {
    for (const e of events) {
      added += insert.run(e.petRef, e.kind, e.actor, e.amount, e.txHash, e.receiptId, e.logIndex, e.blockTs, JSON.stringify(e.raw)).changes;
    }
    deps.db
      .prepare(
        `INSERT INTO timeline_cursor (contract, height, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(contract) DO UPDATE SET height = excluded.height, updated_at = excluded.updated_at`,
      )
      .run(contract, settled, deps.now());
    // Real events cover everything the fallback guessed at.
    deps.db.prepare("DELETE FROM pet_event WHERE source = 'snapshot' AND instr(pet_ref, ? || ':') = 1").run(contract);
  })();
  return added;
}

/**
 * Snapshots every known pet; records diff rows only for pets of contracts in `fallback`.
 * Snapshots stay fresh on every pass so a fallback diff never spans a long gap.
 */
async function snapshotPets(deps: Deps, fallback: Set<string>): Promise<void> {
  for (const p of await listPets(deps)) {
    try {
      const pet = await deps.chain.getPet(p.contract, p.tokenId);
      if (!pet) continue;
      const now = deps.now();
      const prev = deps.db.prepare("SELECT * FROM pet_snapshot WHERE pet_ref = ?").get(p.petRef) as Snapshot | undefined;
      const insert = deps.db.prepare(
        "INSERT INTO pet_event (pet_ref, kind, actor, amount, tx_hash, source, block_ts, raw) VALUES (?, ?, ?, ?, NULL, 'snapshot', ?, ?)",
      );
      deps.db.transaction(() => {
        if (prev && fallback.has(p.contract)) {
          for (const e of diffSnapshot(prev, pet)) insert.run(p.petRef, e.kind, e.actor, e.amount, now, JSON.stringify(e.raw));
        }
        deps.db
          .prepare(
            `INSERT INTO pet_snapshot (pet_ref, owner, food_yocto, staked, soul_version, stage, life_state, taken_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(pet_ref) DO UPDATE SET owner = excluded.owner, food_yocto = excluded.food_yocto,
               staked = excluded.staked, soul_version = excluded.soul_version, stage = excluded.stage,
               life_state = excluded.life_state, taken_at = excluded.taken_at`,
          )
          .run(p.petRef, pet.owner, pet.food_yocto, pet.staked, pet.soul_version, pet.stage, pet.life_state, now);
      })();
    } catch (err) {
      log.warn("timeline snapshot failed", { pet_ref: p.petRef, error: err instanceof Error ? err.name : "unknown" });
    }
  }
}

/** One tail pass: indexer events per contract, snapshot diff for any contract whose indexer read failed. */
export async function runTimelineTail(deps: Deps, f: Fetch = fetch): Promise<void> {
  const contracts = [deps.cfg.PETS_CONTRACT, deps.cfg.DEMO_PETS_CONTRACT];
  const fallback = new Set<string>();
  let fresh = false;
  try {
    fresh = deps.now() - (await latestIndexedMs(f)) < STALE_MS;
    if (!fresh) log.warn("timeline indexer stale");
  } catch (err) {
    log.warn("timeline indexer down", { error: err instanceof Error ? err.message : "unknown" });
  }
  for (const contract of contracts) {
    if (!fresh) {
      fallback.add(contract);
      continue;
    }
    try {
      const added = await tailContractEvents(deps, f, contract);
      if (added > 0) log.info("timeline events", { contract, added });
    } catch (err) {
      fallback.add(contract);
      log.warn("timeline indexer failed", { contract, error: err instanceof Error ? err.message : "unknown" });
    }
  }
  await snapshotPets(deps, fallback);
}

interface EventRow {
  id: number;
  kind: TimelineItem["kind"];
  actor: string | null;
  amount: string | null;
  tx_hash: string | null;
  block_ts: number;
  source: TimelineItem["source"];
}

interface DayRow {
  id: number;
  day: number;
  n: number;
  total: number;
  at: number;
  tx_hash: string | null;
}

/** Newest first; thoughts folded into one `thoughts_day` row per UTC day. */
/**
 * `sinceMs`: the pet's own birth (get_pet born_at_ns). A contract redeployed on the same account
 * reuses token ids, so older events for the same pet_ref belong to a previous pet and are hidden.
 */
export function readTimeline(deps: Deps, contract: string, petRef: string, limit: number, sinceMs = 0): TimelineItem[] {
  const rows = deps.db
    .prepare(
      `SELECT id, kind, actor, amount, tx_hash, block_ts, source FROM pet_event
       WHERE (pet_ref = ? OR pet_ref = ?) AND kind != 'thought' AND block_ts >= ? ORDER BY block_ts DESC, id DESC LIMIT ?`,
    )
    .all(petRef, contract, sinceMs, limit) as EventRow[];
  // SQLite returns the other bare columns from the row holding MAX(block_ts): the day's latest tx.
  const days = deps.db
    .prepare(
      `SELECT MAX(block_ts) AS at, MAX(id) AS id, tx_hash, block_ts / ${DAY_MS} AS day, COUNT(*) AS n,
         SUM(CAST(amount AS INTEGER)) AS total
       FROM pet_event WHERE pet_ref = ? AND kind = 'thought' AND block_ts >= ? GROUP BY day ORDER BY day DESC LIMIT ?`,
    )
    .all(petRef, sinceMs, limit) as DayRow[];
  const items: TimelineItem[] = [
    ...rows.map(({ block_ts, ...r }): TimelineItem => ({ ...r, at: block_ts })),
    ...days.map(
      (d): TimelineItem => ({
        id: d.id,
        kind: "thoughts_day",
        actor: null,
        amount: String(d.total ?? 0),
        tx_hash: d.tx_hash,
        at: d.at,
        source: "event",
        count: d.n,
        day: new Date(d.day * DAY_MS).toISOString().slice(0, 10),
      }),
    ),
  ];
  return items.sort((a, b) => b.at - a.at || b.id - a.id).slice(0, limit);
}

export function timelineRoutes(deps: Deps) {
  const app = new Hono();
  const allowed = [deps.cfg.PETS_CONTRACT, deps.cfg.DEMO_PETS_CONTRACT];

  app.get("/pets/:petRef/timeline", async (c) => {
    const ref = parsePetRef(c.req.param("petRef"));
    if (!ref || !allowed.includes(ref.contract)) {
      return c.json({ error: { code: "invalid", message: "Unknown pet reference" } }, 400);
    }
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 100);
    const pet = await deps.chain.getPet(ref.contract, ref.tokenId);
    if (!pet) return c.json({ error: { code: "not_found", message: "No such pet" } }, 404);
    // 1 s of slack: the mint block's timestamp equals born_at
    const sinceMs = Math.max(0, Math.floor(Number(BigInt(pet.born_at_ns) / 1_000_000n)) - 1000);
    return c.json(readTimeline(deps, ref.contract, formatPetRef(ref.contract, ref.tokenId), limit, sinceMs));
  });

  return app;
}

export const timelineModule: Module = {
  name: "timeline",
  routes: timelineRoutes,
  start(deps) {
    let running = false;
    const tick = async () => {
      if (running) return; // overlap guard
      running = true;
      try {
        await runTimelineTail(deps);
      } catch (err) {
        log.error("timeline tail crashed", { error: err instanceof Error ? err.name : "unknown" });
      } finally {
        running = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), TAIL_MS);
    return () => clearInterval(timer);
  },
};
