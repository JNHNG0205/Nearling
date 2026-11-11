import { Hono } from "hono";
import { requirePetAccess, type AuthEnv } from "../auth/guard";
import type { Deps, Module } from "../deps";
import { publish } from "../events";
import { log } from "../log";
import { ensureProfile } from "../profiles";
import { buildPetState } from "../routes/pets";
import { fail, servedPet, servedPetRef } from "./common";

/**
 * Build Spec 1: the egg hatches when the owner presses the button (device pairing, the adopt
 * page's hatch, or "Hatch" on the pet page). Off chain and once; the contract's xp stages still
 * decide teen and adult.
 */
export function markHatched(deps: Deps, petRef: string, owner: string): boolean {
  ensureProfile(deps.db, petRef, owner, deps.now());
  const r = deps.db
    .prepare("UPDATE pet_profile SET hatched_at = ? WHERE pet_ref = ? AND hatched_at IS NULL")
    .run(deps.now(), petRef);
  if (r.changes > 0) {
    publish(petRef, "hatched", {});
    log.info("pet hatched", { pet_ref: petRef });
  }
  return r.changes > 0;
}

export function hatchRoutes(deps: Deps) {
  const app = new Hono<AuthEnv>();
  app.post("/pets/:petRef/hatch", servedPet(deps), requirePetAccess(deps), async (c) => {
    const ref = servedPetRef(deps, c.req.param("petRef") ?? "");
    if (!ref) return fail(c, 400, "invalid", "Unknown pet reference");
    const hatchedNow = markHatched(deps, ref.petRef, c.get("caller").account);
    const state = await buildPetState(deps, ref.contract, ref.tokenId);
    return c.json({ hatched_now: hatchedNow, state });
  });
  return app;
}

export const hatchModule: Module = { name: "hatch", routes: (deps) => new Hono().route("/", hatchRoutes(deps)) };
