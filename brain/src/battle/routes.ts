import { Hono } from "hono";
import type { BattlePet } from "@petto/battle/protocol";
import type { BrainErrorCode } from "@petto/shared";
import { readCaller, requireCaller, type Caller } from "../auth/guard";
import type { Deps, Module } from "../deps";
import { fail, jsonBody, servedPetRef } from "../identity/common";
import { log } from "../log";
import { getProfile } from "../profiles";
import { upgradeWebSocket } from "../ws";
import { BattleHub, type Conn } from "./hub";
import { createBattleWorker } from "./record";

// Battle routes (spec 3.2): signed-in owners create or join a room with one of their pets, then
// play over the WebSocket. Browsers cannot set headers on a WebSocket, so it takes the session
// token as a query parameter.

const MAX_MESSAGE = 4 * 1024;
const PAIR_LIMIT_PER_DAY = 3;
const DAY_MS = 86_400_000;
const TICK_MS = 5_000;

const hubs = new WeakMap<Deps, BattleHub>();
export function battleHubFor(deps: Deps): BattleHub {
  let hub = hubs.get(deps);
  if (!hub) hubs.set(deps, (hub = new BattleHub(deps)));
  return hub;
}

type Entry = { ok: true; pet: BattlePet; xp: number; xpToday: number; day: number } | { ok: false; status: 400 | 403 | 404 | 422; code: BrainErrorCode; message: string };

/** The caller's pet as a battle entrant: owned, awake enough to fight, with its battle level. */
async function entrant(deps: Deps, account: string, rawRef: unknown): Promise<Entry> {
  const ref = typeof rawRef === "string" ? servedPetRef(deps, rawRef) : null;
  if (!ref) return { ok: false, status: 400, code: "invalid", message: "Expected { pet_ref }" };
  const pet = await deps.chain.getPet(ref.contract, ref.tokenId);
  if (!pet) return { ok: false, status: 404, code: "not_found", message: "No such pet" };
  if (pet.owner !== account) return { ok: false, status: 403, code: "not_owner", message: "That pet is not yours" };
  if (pet.life_state === "Starving" || pet.life_state === "Dormant") {
    return { ok: false, status: 422, code: "pet_unavailable", message: `${pet.name} is too hungry to battle. Feed it first.` };
  }
  const record = await deps.chain.view<{ level: number; xp: number; xp_today: number; day: number }>(ref.contract, "get_battle", { pet_id: ref.tokenId });
  return {
    ok: true, xp: record.xp, xpToday: record.xp_today, day: record.day,
    pet: {
      petRef: ref.petRef, name: pet.name, traits: pet.traits, level: record.level, stageIndex: pet.stage,
      costume: getProfile(deps.db, ref.petRef)?.equipped_costume ?? null,
    },
  };
}

export function battleRoutes(deps: Deps) {
  const hub = battleHubFor(deps);
  const app = new Hono<{ Variables: { caller: Caller; battleCode: string; battleSlot: 0 | 1 } }>();
  const owner = requireCaller(deps, ["owner"]);

  app.post("/battle/rooms", owner, async (c) => {
    const body = (await jsonBody(c)) as { pet_ref?: unknown } | null;
    const e = await entrant(deps, c.get("caller").account, body?.pet_ref);
    if (!e.ok) return fail(c, e.status, e.code, e.message);
    if (!hub.release(e.pet.petRef)) return fail(c, 409, "pet_busy", `${e.pet.name} is already in a battle`);
    const code = hub.createRoom({ account: c.get("caller").account, pet: e.pet, xp: e.xp, xpToday: e.xpToday, day: e.day });
    if (!code) return fail(c, 429, "rate_limited", "Too many battles right now");
    return c.json({ code });
  });

  app.post("/battle/rooms/:code/join", owner, async (c) => {
    const body = (await jsonBody(c)) as { pet_ref?: unknown } | null;
    const e = await entrant(deps, c.get("caller").account, body?.pet_ref);
    if (!e.ok) return fail(c, e.status, e.code, e.message);
    const host = hub.petsOf(c.req.param("code"))?.[0];
    if (host && host.petRef !== e.pet.petRef) {
      // a rolling 24 hours: the pair may battle again when its oldest recent battle is a day old
      const recent = deps.db.prepare(
        "SELECT created_at FROM battle WHERE ((pet_a = ? AND pet_b = ?) OR (pet_a = ? AND pet_b = ?)) AND created_at > ? ORDER BY created_at DESC LIMIT ?",
      ).all(host.petRef, e.pet.petRef, e.pet.petRef, host.petRef, deps.now() - DAY_MS, PAIR_LIMIT_PER_DAY) as { created_at: number }[];
      if (recent.length >= PAIR_LIMIT_PER_DAY) {
        const retryAt = recent[PAIR_LIMIT_PER_DAY - 1]!.created_at + DAY_MS;
        return c.json({ error: { code: "daily_limit", message: "These two pets already battled 3 times in the last 24 hours.", retry_at: retryAt } }, 409);
      }
    }
    if (!hub.release(e.pet.petRef, c.req.param("code").toUpperCase())) return fail(c, 409, "pet_busy", `${e.pet.name} is already in a battle`);
    const r = hub.join(c.req.param("code"), { account: c.get("caller").account, pet: e.pet, xp: e.xp, xpToday: e.xpToday, day: e.day });
    if ("error" in r) {
      const copy: Record<typeof r.error, [404 | 409, string]> = {
        not_found: [404, "No battle with that code"],
        full: [409, "That battle already has two pets"],
        same_owner: [409, "You can't battle your own pet. Invite a friend."],
        same_pet: [409, "A pet can't battle itself"],
        other_contract: [409, "Normal and demo speed pets can't battle each other"],
      };
      const [status, message] = copy[r.error];
      return fail(c, status, r.error, message);
    }
    return c.json({ ok: true });
  });

  app.get(
    "/battle/ws",
    async (c, next) => {
      const caller = await readCaller(deps, `Bearer ${c.req.query("token") ?? ""}`);
      const code = (c.req.query("code") ?? "").toUpperCase();
      const slot = caller?.kind === "owner" ? hub.slotOf(code, caller.account) : null;
      if (slot === null) return fail(c, 401, "unauthorized", "Create or join this battle first");
      c.set("battleCode", code);
      c.set("battleSlot", slot);
      await next();
    },
    upgradeWebSocket((c) => {
      const code = c.get("battleCode");
      const slot = c.get("battleSlot");
      let conn: Conn | null = null;
      return {
        onOpen: (_evt, ws) => {
          conn = { send: (d) => ws.send(d), close: (code_, reason) => ws.close(code_, reason) };
          hub.open(code, slot, conn);
        },
        onMessage: (evt, ws) => {
          if (typeof evt.data !== "string" || evt.data.length > MAX_MESSAGE) {
            ws.send(JSON.stringify({ type: "error", code: "bad_message" }));
            return;
          }
          hub.message(code, slot, evt.data);
        },
        onClose: () => {
          if (conn) hub.close(code, slot, conn);
        },
      };
    }),
  );

  return app as unknown as Hono;
}

export const battleModule: Module = {
  name: "battle",
  routes: (deps) => new Hono().route("/", battleRoutes(deps)),
  start(deps) {
    if (!deps.brain) {
      log.warn("brain signers not configured; battle records stay queued");
      return () => undefined;
    }
    const worker = createBattleWorker(deps, deps.brain, (id, tx) => battleHubFor(deps).notifySaved(id, tx));
    deps.db.prepare("UPDATE battle_job SET status = 'queued' WHERE status = 'sent'").run(); // crash recovery; battle_id makes resends safe
    const timer = setInterval(() => {
      worker.tick().catch((err) => log.error("battle record tick failed", { error: err instanceof Error ? err.name : "unknown" }));
    }, TICK_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  },
};
