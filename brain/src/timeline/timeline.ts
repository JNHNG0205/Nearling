import { Hono } from "hono";
import { formatPetRef, parsePetRef, type ChainLifeState, type PetView } from "@nearling/shared";
import type { Deps, Module } from "../deps";
import { log } from "../log";
import { listPets } from "../proactive/pets";

/**
 * Public pet timeline (AI-brain architectual/08 `GET /pets/:petRef/timeline`).
 *
 * Source: diff of `get_pet` snapshots every 30 s (the documented fallback), not NearBlocks.
 * NearBlocks testnet v3 answers `/v3/accounts/<id>/txns` and `/v3/txns/<hash>/receipts`, but the
 * listing has no args or logs (one extra call per tx to learn the pet id), ignores `page` and
 * `per_page`, and its keyless rate limit is unknown; a third-party quota failing mid-demo is a
 * worse risk than the diff's limits. Diff limits: no tx hash or payer, amounts are net of the
 * drain since the last snapshot, and two changes of one kind inside 30 s merge into one row.
 */

export interface TimelineItem {
  id: number;
  kind: "fed" | "staked" | "unstaked" | "soul_updated" | "stage_up" | "owner_changed" | "dormant" | "revived";
  actor: string | null;
  /** yocto for fed / staked / unstaked, new version for soul_updated, new stage for stage_up */
  amount: string | null;
  tx_hash: string | null;
  at: number;
}

export interface Snapshot {
  owner: string;
  food_yocto: string;
  staked: string;
  soul_version: number;
  stage: number;
  life_state: ChainLifeState;
}

type Detected = Omit<TimelineItem, "id" | "tx_hash" | "at"> & { raw: Record<string, unknown> };

const TAIL_MS = 30_000;
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

/** One tail pass: snapshot every known pet, record what changed. The first snapshot records nothing. */
export async function runTimelineTail(deps: Deps): Promise<void> {
  for (const p of await listPets(deps)) {
    try {
      const pet = await deps.chain.getPet(p.contract, p.tokenId);
      if (!pet) continue;
      const now = deps.now();
      const prev = deps.db.prepare("SELECT * FROM pet_snapshot WHERE pet_ref = ?").get(p.petRef) as Snapshot | undefined;
      const insert = deps.db.prepare(
        "INSERT INTO pet_event (pet_ref, kind, actor, amount, tx_hash, block_ts, raw) VALUES (?, ?, ?, ?, NULL, ?, ?)",
      );
      deps.db.transaction(() => {
        if (prev) {
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
      log.warn("timeline tail failed", { pet_ref: p.petRef, error: err instanceof Error ? err.name : "unknown" });
    }
  }
}

export function timelineRoutes(deps: Deps) {
  const app = new Hono();
  const allowed = [deps.cfg.PETS_CONTRACT, deps.cfg.DEMO_PETS_CONTRACT];

  app.get("/pets/:petRef/timeline", (c) => {
    const ref = parsePetRef(c.req.param("petRef"));
    if (!ref || !allowed.includes(ref.contract)) {
      return c.json({ error: { code: "invalid", message: "Unknown pet reference" } }, 400);
    }
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 100);
    const rows = deps.db
      .prepare("SELECT id, kind, actor, amount, tx_hash, block_ts FROM pet_event WHERE pet_ref = ? ORDER BY id DESC LIMIT ?")
      .all(formatPetRef(ref.contract, ref.tokenId), limit) as (Omit<TimelineItem, "at"> & { block_ts: number })[];
    return c.json(rows.map(({ block_ts, ...r }): TimelineItem => ({ ...r, at: block_ts })));
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
