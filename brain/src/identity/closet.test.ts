import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { issueSession } from "../auth/guard";
import type { Chain } from "../chain/near";
import { getProfile } from "../profiles";
import { testDeps } from "../test/deps";

const PET = "pets-v8.nearling.testnet:1";

function setup() {
  const deps = testDeps();
  let owned = ["0"];
  const calls: unknown[][] = [];
  deps.chain.view = (async (contract: string, method: string, args: unknown) => {
    calls.push([contract, method, args]);
    return owned.map((token_id) =>
      token_id === "4"
        ? { token_id, owner_id: "alice.testnet", metadata: { title: "Petto costume: wizard_hat", extra: '{"costume":"wizard_hat"}' } }
        : { token_id, owner_id: "alice.testnet", metadata: { title: "Petto Shirt" } },
    );
  }) as Chain["view"];
  const app = createApp(deps);
  const req = async (path: string, body?: unknown) =>
    app.request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${(await issueSession(deps, "alice.testnet")).token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { deps, req, calls, setOwned: (ids: string[]) => (owned = ids) };
}

describe("Closet", () => {
  it("lists the owner's shirts from the shirts contract", async () => {
    const { req, calls } = setup();
    const res = await req(`/pets/${PET}/closet`);
    expect(await res.json()).toEqual({ shirts: [{ token_id: "0", title: "Petto Shirt", costume: null }], equipped: null });
    expect(calls[0]).toEqual(["shirts.nearling.testnet", "nft_tokens_for_owner", { account_id: "alice.testnet", from_index: "0", limit: 100 }]);
  });

  it("equips only an owned shirt, and null unequips", async () => {
    const { req } = setup();
    expect((await req(`/pets/${PET}/closet/equip`, { token_id: "7" })).status).toBe(403);
    expect(await (await req(`/pets/${PET}/closet/equip`, { token_id: "0" })).json()).toEqual({ equipped: "0", costume: null });
    expect(await (await req(`/pets/${PET}/closet/equip`, { token_id: null })).json()).toEqual({ equipped: null, costume: null });
    expect((await req(`/pets/${PET}/closet/equip`, {})).status).toBe(400);
  });

  it("reads costume tokens from metadata.extra and shows the worn costume in the pet state", async () => {
    const { deps, req, setOwned } = setup();
    setOwned(["0", "4"]);
    const list = (await (await req(`/pets/${PET}/closet`)).json()) as { shirts: unknown[] };
    expect(list.shirts).toContainEqual({ token_id: "4", title: "Petto costume: wizard_hat", costume: "wizard_hat" });
    expect(await (await req(`/pets/${PET}/closet/equip`, { token_id: "4" })).json()).toEqual({ equipped: "4", costume: "wizard_hat" });
    expect(getProfile(deps.db, PET)!.equipped_costume).toBe("wizard_hat");
    await req(`/pets/${PET}/closet/equip`, { token_id: "0" });
    expect(getProfile(deps.db, PET)!.equipped_costume).toBeNull();
    await req(`/pets/${PET}/closet/equip`, { token_id: "4" });
    setOwned(["0"]);
    await req(`/pets/${PET}/closet`);
    expect(getProfile(deps.db, PET)!.equipped_costume).toBeNull();
  });

  it("clears a shirt the owner transferred away", async () => {
    const { deps, req, setOwned } = setup();
    await req(`/pets/${PET}/closet/equip`, { token_id: "0" });
    setOwned([]);
    expect(await (await req(`/pets/${PET}/closet`)).json()).toEqual({ shirts: [], equipped: null });
    expect(getProfile(deps.db, PET)!.equipped_shirt).toBeNull();
  });
});
