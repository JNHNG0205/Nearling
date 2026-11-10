import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { ensureProfile } from "../profiles";
import { TEST_PET, testDeps } from "../test/deps";
import { diffSnapshot, runTimelineTail, type Snapshot, type TimelineItem } from "./timeline";

const REF = "pets-v8.nearling.testnet:1";
const PREV: Snapshot = { owner: "alice.testnet", food_yocto: "100", staked: "0", soul_version: 1, stage: 1, life_state: "Happy" };

describe("timeline diff", () => {
  it("detects each kind from a get_pet change", () => {
    const pet = { ...TEST_PET, food_yocto: "150", staked: "1000", soul_version: 2, stage: 2, owner: "bob.testnet", life_state: "Happy" as const };
    expect(diffSnapshot(PREV, pet).map((e) => [e.kind, e.actor, e.amount])).toEqual([
      ["owner_changed", "bob.testnet", null],
      ["fed", null, "50"],
      ["staked", "bob.testnet", "1000"],
      ["soul_updated", "bob.testnet", "2"],
      ["stage_up", null, "2"],
    ]);
  });

  it("detects unstake, dormant and revived; drain alone is nothing", () => {
    const base = { ...TEST_PET, owner: "alice.testnet", food_yocto: "90", staked: "0", soul_version: 1, stage: 1 };
    expect(diffSnapshot(PREV, { ...base, life_state: "Happy" })).toEqual([]);
    expect(diffSnapshot({ ...PREV, staked: "5" }, { ...base, life_state: "Happy" }).map((e) => e.kind)).toEqual(["unstaked"]);
    expect(diffSnapshot({ ...PREV, life_state: "Starving" }, { ...base, life_state: "Dormant" }).map((e) => e.kind)).toEqual(["dormant"]);
    expect(diffSnapshot({ ...PREV, life_state: "Dormant" }, { ...base, food_yocto: "500", life_state: "Hungry" }).map((e) => e.kind)).toEqual([
      "fed",
      "revived",
    ]);
  });

  it("tail records changes after the first snapshot and the public route lists them newest first", async () => {
    const deps = testDeps();
    deps.chain.view = async <T>() => [] as T;
    ensureProfile(deps.db, REF, "alice.testnet", 0);
    await runTimelineTail(deps);
    expect(deps.db.prepare("SELECT COUNT(*) AS n FROM pet_event").get()).toEqual({ n: 0 });

    deps.pets["1"] = { ...TEST_PET, food_yocto: (BigInt(TEST_PET.food_yocto) + 10n ** 24n).toString() };
    await runTimelineTail(deps);
    deps.pets["1"] = { ...deps.pets["1"]!, soul_version: 2 };
    await runTimelineTail(deps);
    await runTimelineTail(deps); // no change, no row

    const res = await createApp(deps).request(`/pets/${REF}/timeline`);
    expect(res.status).toBe(200);
    const items = (await res.json()) as TimelineItem[];
    expect(items.map((i) => [i.kind, i.amount, i.tx_hash, i.at])).toEqual([
      ["soul_updated", "2", null, deps.now()],
      ["fed", (10n ** 24n).toString(), null, deps.now()],
    ]);
    expect((await createApp(deps).request("/pets/evil.testnet:1/timeline")).status).toBe(400);
  });
});
