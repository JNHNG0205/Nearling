import { Hono } from "hono";
import {
  STAGES,
  displayState,
  fuelLeft,
  parsePetRef,
  type PetState,
} from "@nearling/shared";
import type { Chain } from "../chain/near";

const LOW_FUEL = 5;

/**
 * Off-chain profile defaults until the pet_profile table lands (care sync,
 * evolution, closet, pairing). A new pet starts at care mood 80 (CLAUDE.md 5.3).
 */
const DEFAULT_PROFILE = {
  form: "base" as const,
  careMood: 80,
  sleeping: false,
  milestones: { pat: false, rock: false, sleep: false },
  equippedShirt: null,
  paired: false,
  lastSeenAt: null,
};

export function petRoutes(chain: Chain, allowedContracts: string[]) {
  const app = new Hono();

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

    const p = DEFAULT_PROFILE;
    const left = fuelLeft(pet.budget_micro, config.fuel_price_micro);
    const state: PetState = {
      pet_ref: `${ref.contract}:${ref.tokenId}`,
      contract: ref.contract,
      token_id: ref.tokenId,
      demo_speed: config.demo_speed,
      name: pet.name,
      owner: pet.owner,
      stage: STAGES[pet.stage] ?? "adult",
      form: p.form,
      display_state: displayState(pet.life_state, p.careMood, p.sleeping),
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
      equipped_shirt: p.equippedShirt,
      care: { mood: p.careMood, milestones: p.milestones },
      device: { paired: p.paired, last_seen_at: p.lastSeenAt },
      as_of: Date.now(),
    };
    return c.json(state);
  });

  return app;
}
