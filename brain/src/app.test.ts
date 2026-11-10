import { describe, expect, it } from "vitest";
import type { PetState, PetView } from "@nearling/shared";
import { createApp } from "./app";
import type { Chain } from "./chain/near";
import { loadConfig } from "./config";

const pet: PetView = {
  id: "1", owner: "nearling-seed.testnet", name: "Sunny", born_at_ns: "1",
  food_yocto: "96715000000000000000000", credit_micro: 0, budget_micro: 19_343,
  fullness: 100, mood: 30, energy: 100, asleep_since_ns: null, xp: 0, stage: 0,
  traits: [62, 6, 36, 88, 17], starving_since_ns: null, life_state: "Sad", staked: "0",
  pending_unstake: null, daily_credit_micro: 0, daily_burn_micro: 1_000,
  self_sustaining: false, items: [], device_pk: null, approval_mode: false, soul_version: 1,
};

const chain: Chain = {
  getPet: async (_c, id) => (id === "1" ? pet : null),
  getConfig: async () => ({
    fuel_price_micro: 1_000, near_usd_rate_micro: 200_000,
    farm_rate_micro_per_near_day: 657, demo_speed: false,
  }),
};

const app = createApp(loadConfig({}), chain);

describe("GET /pets/:petRef/state", () => {
  it("maps the chain pet to PetState", async () => {
    const res = await app.request("/pets/pets-v8.nearling.testnet:1/state");
    expect(res.status).toBe(200);
    const s = (await res.json()) as PetState;
    expect(s.fuel.left).toBe(19);
    expect(s.stage).toBe("egg");
    expect(s.chain_life_state).toBe("Sad");
    expect(s.display_state).toBe("happy"); // chain Sad ignored, care mood defaults to 80
  });

  it("rejects contracts we do not serve", async () => {
    const res = await app.request("/pets/evil.testnet:1/state");
    expect(res.status).toBe(400);
  });

  it("404s a missing pet", async () => {
    const res = await app.request("/pets/pets-v8.nearling.testnet:999/state");
    expect(res.status).toBe(404);
  });
});
