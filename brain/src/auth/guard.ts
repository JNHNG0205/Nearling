import { createHash } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { SignJWT, jwtVerify } from "jose";
import { parsePetRef } from "@nearling/shared";
import type { Deps } from "../deps";

/**
 * Who is calling (AI-brain architectual/08 "Auth"):
 *   owner  = phone/web with `Authorization: Bearer <session JWT>` (issued by POST /session)
 *   device = Nearling with `Authorization: Device <token>` (issued by pairing confirm)
 */
export type Caller =
  | { kind: "owner"; account: string }
  | { kind: "device"; deviceId: string; account: string; petRef: string };

export type AuthEnv = { Variables: { caller: Caller } };

const SESSION_TTL_S = 7 * 24 * 3600;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function issueSession(deps: Deps, account: string): Promise<{ token: string; expires_at: number }> {
  const exp = Math.floor(deps.now() / 1000) + SESSION_TTL_S;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(account)
    .setIssuedAt(Math.floor(deps.now() / 1000))
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(deps.cfg.SESSION_JWT_SECRET));
  return { token, expires_at: exp * 1000 };
}

async function readCaller(deps: Deps, header: string | undefined): Promise<Caller | null> {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (!value) return null;
  if (scheme === "Bearer") {
    try {
      const { payload } = await jwtVerify(value, new TextEncoder().encode(deps.cfg.SESSION_JWT_SECRET), {
        currentDate: new Date(deps.now()),
      });
      return payload.sub ? { kind: "owner", account: payload.sub } : null;
    } catch {
      return null;
    }
  }
  if (scheme === "Device") {
    const row = deps.db
      .prepare("SELECT id, pet_ref, owner_account FROM device WHERE token_hash = ? AND revoked_at IS NULL AND pet_ref IS NOT NULL")
      .get(sha256(value)) as { id: string; pet_ref: string; owner_account: string } | undefined;
    if (!row) return null;
    deps.db.prepare("UPDATE device SET last_seen_at = ? WHERE id = ?").run(deps.now(), row.id);
    return { kind: "device", deviceId: row.id, account: row.owner_account, petRef: row.pet_ref };
  }
  return null;
}

const deny = (c: Context, status: 401 | 403, code: string, message: string) =>
  c.json({ error: { code, message } }, status);

/** Any authenticated caller. */
export function requireCaller(deps: Deps, allow: Caller["kind"][] = ["owner", "device"]): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const caller = await readCaller(deps, c.req.header("Authorization"));
    if (!caller || !allow.includes(caller.kind)) return deny(c, 401, "unauthorized", "Sign in first");
    c.set("caller", caller);
    await next();
  };
}

/**
 * For `/pets/:petRef/*` routes: the caller must own the pet right now (fresh owner check, so a
 * transfer revokes access at once). A device must also be bound to this pet. Revokes the device
 * if the pet changed hands.
 */
export function requirePetAccess(deps: Deps, allow: Caller["kind"][] = ["owner", "device"]): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const caller = await readCaller(deps, c.req.header("Authorization"));
    if (!caller || !allow.includes(caller.kind)) return deny(c, 401, "unauthorized", "Sign in first");
    const ref = parsePetRef(c.req.param("petRef") ?? "");
    if (!ref) return c.json({ error: { code: "invalid", message: "Unknown pet reference" } }, 400);
    const pet = await deps.chain.getPet(ref.contract, ref.tokenId);
    if (!pet) return c.json({ error: { code: "not_found", message: "No such pet" } }, 404);
    if (caller.kind === "device") {
      if (caller.petRef !== `${ref.contract}:${ref.tokenId}`) return deny(c, 403, "not_owner", "Not this device's pet");
      if (pet.owner !== caller.account) {
        deps.db.prepare("UPDATE device SET revoked_at = ? WHERE id = ?").run(deps.now(), caller.deviceId);
        return deny(c, 403, "not_owner", "The pet has a new owner");
      }
    } else if (pet.owner !== caller.account) {
      return deny(c, 403, "not_owner", "Only the pet's owner can do that");
    }
    c.set("caller", caller);
    await next();
  };
}
