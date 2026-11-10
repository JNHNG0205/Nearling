import { describe, expect, it } from "vitest";
import type { PetState } from "@nearling/shared";
import { createApp } from "./app";
import { testDeps } from "./test/deps";

describe("GET /pets/:petRef/state", () => {
  it("maps the chain pet and its profile to PetState", async () => {
    const deps = testDeps();
    const res = await createApp(deps).request("/pets/pets-v8.nearling.testnet:1/state");
    expect(res.status).toBe(200);
    const s = (await res.json()) as PetState;
    expect(s.fuel.left).toBe(19);
    expect(s.stage).toBe("baby");
    expect(s.traits).toEqual([62, 6, 36, 88, 17]);
    expect(s.chain_life_state).toBe("Sad");
    expect(s.display_state).toBe("happy"); // chain Sad ignored; new profile care mood is 80
    expect(deps.db.prepare("SELECT owner_account FROM pet_profile").get()).toEqual({ owner_account: "alice.testnet" });
  });

  it("rejects contracts we do not serve", async () => {
    const res = await createApp(testDeps()).request("/pets/evil.testnet:1/state");
    expect(res.status).toBe(400);
  });

  it("404s a missing pet", async () => {
    const res = await createApp(testDeps()).request("/pets/pets-v8.nearling.testnet:999/state");
    expect(res.status).toBe(404);
  });
});

describe("care mood on /state", () => {
  it("decays on read, so a neglected pet shows sad", async () => {
    const deps = testDeps();
    const t0 = deps.now();
    deps.db.prepare(
      "INSERT INTO pet_profile (pet_ref, owner_account, care_mood, care_mood_at, created_at) VALUES (?, ?, 50, ?, ?)",
    ).run("pets-v8.nearling.testnet:1", "alice.testnet", t0 - 10 * 3_600_000, t0);
    const s = (await (await createApp(deps).request("/pets/pets-v8.nearling.testnet:1/state")).json()) as PetState;
    expect(s.care.mood).toBe(30); // 50 - 10 h x 2
    expect(s.display_state).toBe("sad");
  });
});
