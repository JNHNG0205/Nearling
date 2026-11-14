import { Hono } from "hono";
import { z } from "zod";
import {
  STAGES,
  displayState,
  fuelLeft,
  parsePetRef,
  type PetState,
} from "@petto/shared";
import { type AuthEnv, requireCaller, requirePetAccess } from "../auth/guard";
import type { Deps, Module } from "../deps";
import { decay } from "../identity/care";
import { jsonBody } from "../identity/common";
import { deviceStatus } from "../identity/devices";
import { log } from "../log";
import { ensureProfile } from "../profiles";

const LOW_FUEL = 5;
const MAX_OWNED = 50;

/** The `/state` body for one pet, or null if the token does not exist. Shared with `GET /me/pets`. */
export async function buildPetState({ chain, db, now }: Deps, contract: string, tokenId: string): Promise<PetState | null> {
  const [pet, config] = await Promise.all([chain.getPet(contract, tokenId), chain.getConfig(contract)]);
  if (!pet) return null;

  const petRef = `${contract}:${tokenId}`;
  const p = ensureProfile(db, petRef, pet.owner, now());
  const sleeping = p.sleeping_until !== null && p.sleeping_until > now();
  // decay on read so a neglected pet does not look happy until its next care sync
  const careMood = p.care_mood_at === null ? p.care_mood : decay(p.care_mood, p.care_mood_at, now())[0];
  const left = fuelLeft(pet.budget_micro, config.fuel_price_micro);
  // Build Spec 1: a hatched egg shows as at least a baby; teen and adult still come from chain xp.
  const stageIndex = pet.stage === 0 && p.hatched_at !== null ? 1 : pet.stage;
  return {
    pet_ref: petRef,
    contract,
    token_id: tokenId,
    demo_speed: config.demo_speed,
    name: pet.name,
    owner: pet.owner,
    stage: STAGES[stageIndex] ?? "adult",
    stage_index: stageIndex,
    chain_stage_index: pet.stage,
    xp: pet.xp,
    hatched: p.hatched_at !== null || pet.stage > 0,
    traits: pet.traits,
    form: p.form,
    display_state: displayState(pet.life_state, careMood, sleeping),
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
      pantry_yocto: pet.pantry_yocto ?? "0",
      pool_unstake_deposit: config.pool_unstake_deposit ?? null,
    },
    soul_version: pet.soul_version,
    equipped_shirt: p.equipped_shirt,
    equipped_costume: p.equipped_costume ?? null,
    care: { mood: careMood, milestones: { pat: !!p.care_pat, rock: !!p.care_rock, sleep: !!p.care_sleep } },
    device: deviceStatus(db, petRef),
    as_of: Date.now(),
  };
}

/** True for an IANA zone this runtime knows (e.g. "Asia/Kuala_Lumpur"). */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Letters, digits, spaces and a little punctuation: the nickname goes into the prompt.
const Nickname = z.string().max(24).regex(/^[\p{L}\p{N} .'_-]*$/u);
const ProfileBody = z
  .object({ nickname: Nickname.nullable().optional(), owner_tz: z.string().max(64).nullable().optional() })
  .refine((b) => b.nickname !== undefined || b.owner_tz !== undefined);

export function petRoutes(deps: Deps) {
  const { cfg, db, sealer, now } = deps;
  const app = new Hono<AuthEnv>();
  const contracts = [...new Set([cfg.PETS_CONTRACT, cfg.DEMO_PETS_CONTRACT])];

  app.get("/pets/:petRef/state", async (c) => {
    const ref = parsePetRef(c.req.param("petRef"));
    if (!ref || !contracts.includes(ref.contract)) {
      return c.json({ error: { code: "invalid", message: "Unknown pet reference" } }, 400);
    }
    const state = await buildPetState(deps, ref.contract, ref.tokenId);
    if (!state) return c.json({ error: { code: "not_found", message: "No such pet" } }, 404);
    return c.json(state);
  });

  /** A9 + A10: owner nickname (stored encrypted) and timezone. `null` or "" clears a field. */
  app.put("/pets/:petRef/profile", requirePetAccess(deps, ["owner"]), async (c) => {
    const ref = parsePetRef(c.req.param("petRef"));
    if (!ref || !contracts.includes(ref.contract)) {
      return c.json({ error: { code: "invalid", message: "Unknown pet reference" } }, 400);
    }
    const body = ProfileBody.safeParse(await jsonBody(c));
    if (!body.success) {
      return c.json({ error: { code: "invalid", message: "Send nickname (up to 24 letters) and/or owner_tz" } }, 400);
    }
    const { nickname, owner_tz } = body.data;
    if (owner_tz && !isTimeZone(owner_tz)) {
      return c.json({ error: { code: "invalid", message: "Unknown time zone" } }, 400);
    }
    const petRef = `${ref.contract}:${ref.tokenId}`;
    const owner = c.get("caller").account;
    ensureProfile(db, petRef, owner, now());
    // The caller is the current owner (checked on chain), so the profile follows a transfer.
    db.prepare("UPDATE pet_profile SET owner_account = ? WHERE pet_ref = ?").run(owner, petRef);
    if (nickname !== undefined) {
      const nick = nickname?.trim() ? sealer.seal(petRef, nickname.trim()) : null;
      db.prepare("UPDATE pet_profile SET nickname_enc = ? WHERE pet_ref = ?").run(nick, petRef);
    }
    if (owner_tz !== undefined) {
      db.prepare("UPDATE pet_profile SET owner_tz = ? WHERE pet_ref = ?").run(owner_tz || null, petRef);
    }
    const row = db.prepare("SELECT nickname_enc, owner_tz FROM pet_profile WHERE pet_ref = ?").get(petRef) as {
      nickname_enc: Buffer | null;
      owner_tz: string | null;
    };
    log.info("profile updated", { pet_ref: petRef, nickname_set: row.nickname_enc !== null, tz_set: row.owner_tz !== null });
    return c.json({
      pet_ref: petRef,
      nickname: row.nickname_enc ? sealer.open(petRef, row.nickname_enc) : null,
      owner_tz: row.owner_tz,
    });
  });

  /** D8: every pet the session account owns, on both contracts, as PetState. */
  app.get("/me/pets", requireCaller(deps, ["owner"]), async (c) => {
    const account = c.get("caller").account;
    const pets: PetState[] = [];
    for (const contract of contracts) {
      const tokens = await deps.chain.view<{ token_id: string }[]>(contract, "nft_tokens_for_owner", {
        account_id: account,
        from_index: "0",
        limit: MAX_OWNED,
      });
      const states = await Promise.all(tokens.map((t) => buildPetState(deps, contract, t.token_id)));
      for (const s of states) if (s && s.owner === account) pets.push(s);
    }
    return c.json({ pets });
  });

  return app;
}

export const petsModule: Module = { name: "pets", routes: (deps) => new Hono().route("/", petRoutes(deps)) };
