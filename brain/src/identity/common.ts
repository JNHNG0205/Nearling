import type { Context, MiddlewareHandler } from "hono";
import { parsePetRef, type BrainErrorCode } from "@petto/shared";
import type { Deps } from "../deps";

type Status = 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429;

export const fail = (c: Context, status: Status, code: BrainErrorCode, message: string) =>
  c.json({ error: { code, message } }, status);

/** Parses a `contract:token_id` pet ref and accepts only contracts this brain serves. */
export function servedPetRef(deps: Deps, raw: string): { contract: string; tokenId: string; petRef: string } | null {
  const ref = parsePetRef(raw);
  if (!ref || ![deps.cfg.PETS_CONTRACT, deps.cfg.DEMO_PETS_CONTRACT].includes(ref.contract)) return null;
  return { ...ref, petRef: `${ref.contract}:${ref.tokenId}` };
}

/** Runs before requirePetAccess on `/pets/:petRef/*`, so foreign contracts are never queried. */
export function servedPet(deps: Deps): MiddlewareHandler {
  return async (c, next) => {
    if (!servedPetRef(deps, c.req.param("petRef") ?? "")) return fail(c, 400, "invalid", "Unknown pet reference");
    await next();
  };
}

/** Reads a JSON body; null if it is missing or not JSON. */
export async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}
