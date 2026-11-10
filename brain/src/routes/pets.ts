import { Hono } from "hono";
import {
  STAGES,
  displayState,
  fuelLeft,
  parsePetRef,
  type PetState,
} from "@nearling/shared";
import type { Deps, Module } from "../deps";
import { ensureProfile } from "../profiles";

const LOW_FUEL = 5;

export function petRoutes({ chain, cfg, db, now }: Deps) {
  const app = new Hono();
  const allowedContracts = [cfg.PETS_CONTRACT, cfg.DEMO_PETS_CONTRACT];

  app.get("/pets/:petRef/state", async (c) => {
    const ref = parsePetRef(c.req.param("petRef"));
    if (!ref || !allowedContracts.includes(ref.contract)) {
      return c.json({ error: { code: "invalid", message: "Unknown pet reference" } }, 400);
    }
    const [pet, config] = await Promise.all([
      chain.getPet(ref.contract, ref.tokenId),
      chain.getConfig(ref.contract),
    ]);
    if (!pet) return c.json({ error: { code: "not_found", message: "No such pet" } }, 404);

    const p = ensureProfile(db, `${ref.contract}:${ref.tokenId}`, pet.owner, now());
    const sleeping = p.sleeping_until !== null && p.sleeping_until > now();
    const left = fuelLeft(pet.budget_micro, config.fuel_price_micro);
    const state: PetState = {
      pet_ref: `${ref.contract}:${ref.tokenId}`,
      contract: ref.contract,
      token_id: ref.tokenId,
      demo_speed: config.demo_speed,
      name: pet.name,
      owner: pet.owner,
      stage: STAGES[pet.stage] ?? "adult",
      stage_index: pet.stage,
      traits: pet.traits,
      form: p.form,
      display_state: displayState(pet.life_state, p.care_mood, sleeping),
      chain_life_state: pet.life_state,
      fuel: {
        left,
        price_micro: config.fuel_price_micro,
        budget_micro: pet.budget_micro,
        daily_burn_micro: pet.daily_burn_micro,
        low: left < LOW_FUEL || pet.life_state === "Starving" || pet.life_state === "Dormant",
      },
      garden: {
        staked_yocto: pet.staked,
        credit_micro: pet.credit_micro,
        daily_credit_micro: pet.daily_credit_micro,
        self_sustaining: pet.self_sustaining,
        pending_unstake: pet.pending_unstake,
      },
      soul_version: pet.soul_version,
      equipped_shirt: p.equipped_shirt,
      care: { mood: p.care_mood, milestones: { pat: !!p.care_pat, rock: !!p.care_rock, sleep: !!p.care_sleep } },
      device: { paired: false, last_seen_at: null }, // filled by the devices module
      as_of: Date.now(),
    };
    return c.json(state);
  });

  return app;
}

export const petsModule: Module = { name: "pets", routes: petRoutes };
