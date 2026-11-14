import type { PetState } from "@nearling/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { issueSession } from "../auth/guard";
import { TEST_PET, testDeps } from "../test/deps";

const REF = "pets-v8.nearling.testnet:1";
const egg = { ...TEST_PET, stage: 0 };

async function setup() {
  const deps = testDeps({ pets: { "1": egg } });
  const app = createApp(deps);
  const owner = `Bearer ${(await issueSession(deps, "alice.testnet")).token}`;
  const stranger = `Bearer ${(await issueSession(deps, "mallory.testnet")).token}`;
  const state = async () => (await (await app.request(`/pets/${REF}/state`)).json()) as PetState;
  const hatch = (auth: string) => app.request(`/pets/${REF}/hatch`, { method: "POST", headers: { authorization: auth } });
  return { deps, state, hatch, owner, stranger };
}

describe("hatch (Build Spec 1)", () => {
  it("an unhatched egg shows as an egg", async () => {
    const t = await setup();
    expect(await t.state()).toMatchObject({ stage: "egg", stage_index: 0, chain_stage_index: 0, hatched: false });
  });

  it("the owner hatches once; the egg then shows as a baby while the chain still says egg", async () => {
    const t = await setup();
    const r1 = await t.hatch(t.owner);
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ hatched_now: true, state: { stage: "baby", stage_index: 1, chain_stage_index: 0, hatched: true } });
    const r2 = (await (await t.hatch(t.owner)).json()) as { hatched_now: boolean };
    expect(r2.hatched_now).toBe(false);
    expect(await t.state()).toMatchObject({ stage: "baby", stage_index: 1 });
  });

  it("strangers cannot hatch someone else's pet", async () => {
    const t = await setup();
    expect((await t.hatch(t.stranger)).status).toBe(403);
    expect((await t.state()).hatched).toBe(false);
  });

  it("the state carries the pet's on-chain XP (web growth bar)", async () => {
    const t = await setup();
    t.deps.pets["1"] = { ...egg, xp: 42 };
    expect((await t.state()).xp).toBe(42);
  });

  it("chain stages above baby always win", async () => {
    const t = await setup();
    t.deps.pets["1"] = { ...egg, stage: 2 };
    expect(await t.state()).toMatchObject({ stage: "teen", stage_index: 2, chain_stage_index: 2, hatched: true });
  });
});
