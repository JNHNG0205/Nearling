import type { PetView } from "@nearling/shared";
import type { Chain, PetsConfig } from "../chain/near";
import { loadConfig } from "../config";
import { createSealer } from "../crypto";
import { openDb } from "../db/db";
import type { Deps } from "../deps";

export const TEST_PET: PetView = {
  id: "1", owner: "alice.testnet", name: "Mochi", born_at_ns: "1",
  food_yocto: "96715000000000000000000", credit_micro: 0, budget_micro: 19_343,
  fullness: 100, mood: 30, energy: 100, asleep_since_ns: null, xp: 0, stage: 1,
  traits: [62, 6, 36, 88, 17], starving_since_ns: null, life_state: "Sad", staked: "0",
  pending_unstake: null, daily_credit_micro: 0, daily_burn_micro: 1_000,
  self_sustaining: false, items: [], device_pk: null, approval_mode: false, soul_version: 1,
};

export const TEST_CONFIG: PetsConfig = {
  fuel_price_micro: 1_000, near_usd_rate_micro: 200_000, farm_rate_micro_per_near_day: 657, demo_speed: false,
};

/** In-memory deps with a fake chain. Override pets per test: `pets: { "1": {...} }`. */
export function testDeps(opts: { pets?: Record<string, PetView>; now?: () => number } = {}): Deps & { pets: Record<string, PetView> } {
  const pets = opts.pets ?? { "1": TEST_PET };
  const chain: Chain = {
    getPet: async (_contract, id) => pets[id] ?? null,
    getConfig: async () => TEST_CONFIG,
  };
  return {
    cfg: loadConfig({ DB_PATH: ":memory:" }),
    chain,
    db: openDb(":memory:"),
    sealer: createSealer(Buffer.alloc(32, 7)),
    now: opts.now ?? (() => 1_800_000_000_000),
    pets,
  };
}
