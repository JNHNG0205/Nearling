import { Hono } from "hono";
import { z } from "zod";
import { requirePetAccess, type AuthEnv } from "../auth/guard";
import type { Deps, Module } from "../deps";
import { publish } from "../events";
import { log } from "../log";
import { ensureProfile, getProfile } from "../profiles";
import { fail, jsonBody, servedPet, servedPetRef } from "./common";

// Offline care sync and evolution (AI-brain architectual/05 section 3). No chain writes (hybrid 1.1).

const HOUR_MS = 3_600_000;
const DECAY_PER_HOUR = 2;
const SLEEP_MS = 30 * 60_000;
const EFFECT = { pat: 5, rock: 3, shake: -2, sleep: 0 } as const;

const clamp = (n: number) => Math.max(0, Math.min(100, n));

const CareBody = z.object({
  events: z
    .array(z.object({ id: z.string().min(1).max(64), kind: z.enum(["pat", "rock", "shake", "sleep"]), at: z.number().int().nonnegative() }))
    .max(500),
});

/** Decays mood by whole hours only, advancing the as-of time by the hours used (no rounding loss). */
/** Care mood decayed to `to` (2 per whole hour); also used by /state so reads match the next sync. */
export function decay(mood: number, moodAt: number, to: number): [number, number] {
  if (to <= moodAt) return [mood, moodAt];
  const hours = Math.floor((to - moodAt) / HOUR_MS);
  return [clamp(mood - hours * DECAY_PER_HOUR), moodAt + hours * HOUR_MS];
}

export function careRoutes(deps: Deps) {
  const { db, now } = deps;
  const app = new Hono<AuthEnv>();

  app.post("/pets/:petRef/care", servedPet(deps), requirePetAccess(deps), async (c) => {
    const ref = servedPetRef(deps, c.req.param("petRef"))!;
    const body = CareBody.safeParse(await jsonBody(c));
    if (!body.success) return fail(c, 400, "invalid", "Expected events [{ id, kind, at }]");
    const caller = c.get("caller");
    const deviceId = caller.kind === "device" ? caller.deviceId : null; // null = web simulator
    const t = now();
    ensureProfile(db, ref.petRef, caller.account, t); // the guard checked caller.account owns the pet

    const result = db.transaction(() => {
      const insert = db.prepare(
        "INSERT OR IGNORE INTO care_event (id, pet_ref, device_id, kind, at, received_at) VALUES (?, ?, ?, ?, ?, ?)",
      );
      // Clock skew: a device cannot log care in the future.
      const fresh = body.data.events
        .map((e) => ({ ...e, at: Math.min(e.at, t) }))
        .filter((e) => insert.run(e.id, ref.petRef, deviceId, e.kind, e.at, t).changes === 1)
        .sort((a, b) => a.at - b.at);

      const p = getProfile(db, ref.petRef)!;
      let mood = p.care_mood;
      let moodAt = p.care_mood_at ?? fresh[0]?.at ?? t;
      let sleepingUntil = p.sleeping_until;
      const seen = { pat: !!p.care_pat, rock: !!p.care_rock, sleep: !!p.care_sleep };
      for (const e of fresh) {
        [mood, moodAt] = decay(mood, moodAt, e.at); // late events older than moodAt apply without decay
        mood = clamp(mood + EFFECT[e.kind]);
        if (e.kind === "sleep") sleepingUntil = Math.max(sleepingUntil ?? 0, e.at + SLEEP_MS);
        if (e.kind !== "shake") seen[e.kind] = true;
      }
      [mood, moodAt] = decay(mood, moodAt, t);

      db.prepare(
        "UPDATE pet_profile SET care_mood = ?, care_mood_at = ?, sleeping_until = ?, care_pat = ?, care_rock = ?, care_sleep = ? WHERE pet_ref = ?",
      ).run(mood, moodAt, sleepingUntil, +seen.pat, +seen.rock, +seen.sleep, ref.petRef);

      // Evolution happens once: the WHERE form = 'base' guard makes a second sync a no-op.
      const evolvedNow =
        seen.pat && seen.rock && seen.sleep &&
        db.prepare("UPDATE pet_profile SET form = 'winged', evolved_at = ? WHERE pet_ref = ? AND form = 'base'").run(t, ref.petRef)
          .changes === 1;
      return { mood, milestones: seen, form: getProfile(db, ref.petRef)!.form, evolved_now: evolvedNow, added: fresh.length };
    })();

    if (result.evolved_now) publish(ref.petRef, "evolved", { form: "winged" });
    log.info("care_synced", { pet_ref: ref.petRef, added: result.added, evolved: result.evolved_now });
    const { added: _added, ...response } = result;
    return c.json(response);
  });

  return app;
}

export const careModule: Module = { name: "care", routes: (deps) => new Hono().route("/", careRoutes(deps)) };
