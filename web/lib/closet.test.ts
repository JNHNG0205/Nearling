import { describe, expect, it } from "vitest";
import { closetItems, costumeLabel, ownedCostumes, shopCostumes } from "./closet";

const shirt = { token_id: "0", owner_id: "a.testnet", metadata: { title: "Petto Shirt" } };
const hat = { token_id: "4", owner_id: "a.testnet", metadata: { title: "Petto costume: wizard_hat", extra: '{"costume":"wizard_hat"}' } };
const junk = { token_id: "5", owner_id: "a.testnet", metadata: { title: "x", extra: "not json" } };

describe("closet", () => {
  it("reads the costume key from each token's extra; plain shirts and bad extras have none", () => {
    expect(closetItems([shirt, hat, junk])).toEqual([
      { tokenId: "0", title: "Petto Shirt", costume: null },
      { tokenId: "4", title: "Wizard hat", costume: "wizard_hat" },
      { tokenId: "5", title: "x", costume: null },
    ]);
  });

  it("the shop lists every costume the owner does not have yet", () => {
    const shop = shopCostumes(closetItems([shirt, hat]));
    expect(shop).toHaveLength(35);
    expect(shop).not.toContain("wizard_hat");
    expect(shop[0]).toBe("cap");
  });

  it("labels keys for people", () => {
    expect(costumeLabel("ice_cube")).toBe("Ice cube");
    expect(costumeLabel("cap")).toBe("Cap");
  });

  it("maps each owned costume to one of its tokens (the first one bought)", () => {
    const again = { ...hat, token_id: "9" };
    expect(ownedCostumes(closetItems([shirt, hat, again]))).toEqual(new Map([["wizard_hat", "4"]]));
  });
});
