import { isCostume } from "@nearling/sprites";
import { Hono } from "hono";
import { requirePetAccess, type AuthEnv } from "../auth/guard";
import type { Deps, Module } from "../deps";
import { publish } from "../events";
import { ensureProfile } from "../profiles";
import { fail, jsonBody, servedPet, servedPetRef } from "./common";

// Closet (AI-brain architectual/05 section 4). Ownership is read from the shirts contract on each sync.
// Costume tokens (shirts contract `buy(costume)`) carry `extra: {"costume":"<key>"}`.

interface ShirtToken {
  token_id: string;
  metadata?: { title?: string | null; extra?: string | null } | null;
}

/** The costume key in a token's `extra`, or null for a plain shirt (or anything unreadable). */
function costumeOf(t: ShirtToken): string | null {
  try {
    const key = (JSON.parse(t.metadata?.extra ?? "null") as { costume?: unknown } | null)?.costume;
    return typeof key === "string" && isCostume(key) ? key : null;
  } catch {
    return null;
  }
}

export function closetRoutes(deps: Deps) {
  const { db, now, chain, cfg } = deps;
  const app = new Hono<AuthEnv>();

  /** Shirts the pet's owner holds now; clears `equipped_shirt` if it left the wallet (transfer). */
  async function sync(petRef: string, owner: string) {
    const tokens = await chain.view<ShirtToken[]>(cfg.SHIRTS_CONTRACT, "nft_tokens_for_owner", {
      account_id: owner,
      from_index: "0",
      limit: 100,
    });
    const shirts = tokens.map((t) => ({ token_id: t.token_id, title: t.metadata?.title ?? "Petto Shirt", costume: costumeOf(t) }));
    let equipped = ensureProfile(db, petRef, owner, now()).equipped_shirt;
    if (equipped !== null && !shirts.some((s) => s.token_id === equipped)) {
      db.prepare("UPDATE pet_profile SET equipped_shirt = NULL, equipped_costume = NULL WHERE pet_ref = ?").run(petRef);
      equipped = null;
    }
    return { shirts, equipped };
  }

  app.get("/pets/:petRef/closet", servedPet(deps), requirePetAccess(deps), async (c) => {
    const ref = servedPetRef(deps, c.req.param("petRef"))!;
    return c.json(await sync(ref.petRef, c.get("caller").account)); // the guard checked caller owns the pet
  });

  app.post("/pets/:petRef/closet/equip", servedPet(deps), requirePetAccess(deps), async (c) => {
    const ref = servedPetRef(deps, c.req.param("petRef"))!;
    const body = (await jsonBody(c)) as { token_id?: unknown } | null;
    const tokenId = body?.token_id;
    if (tokenId !== null && typeof tokenId !== "string") return fail(c, 400, "invalid", "Expected { token_id: string | null }");
    const { shirts } = await sync(ref.petRef, c.get("caller").account);
    const token = shirts.find((s) => s.token_id === tokenId);
    if (tokenId !== null && !token) return fail(c, 403, "not_owner", "That shirt is not in your closet");
    const costume = token?.costume ?? null;
    db.prepare("UPDATE pet_profile SET equipped_shirt = ?, equipped_costume = ? WHERE pet_ref = ?").run(tokenId, costume, ref.petRef);
    publish(ref.petRef, "closet_equipped", { equipped: tokenId, costume });
    return c.json({ equipped: tokenId, costume });
  });

  return app;
}

export const closetModule: Module = { name: "closet", routes: (deps) => new Hono().route("/", closetRoutes(deps)) };
