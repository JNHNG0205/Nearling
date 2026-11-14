import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { JsonRpcProvider, KeyType, PublicKey, baseDecode, type Provider } from "near-api-js";
import { verifyMessage } from "near-api-js/nep413";
import { z } from "zod";
import { NEP413_MESSAGE, NEP413_RECIPIENT } from "@petto/shared";
import { issueSession } from "../auth/guard";
import type { Deps, Module } from "../deps";
import { log } from "../log";
import { fail, jsonBody } from "./common";

const NONCE_TTL_MS = 5 * 60_000;

/** Throws unless `signature` is a valid NEP-413 signature by a full access key of `accountId`. */
export type Nep413Verifier = (a: {
  accountId: string;
  publicKey: string;
  signature: Uint8Array;
  nonce: Uint8Array;
}) => Promise<void>;

export function nep413Verifier(provider: Provider): Nep413Verifier {
  return ({ accountId, publicKey, signature, nonce }) =>
    verifyMessage({
      signerAccountId: accountId,
      signerPublicKey: publicKey,
      payload: { message: NEP413_MESSAGE, recipient: NEP413_RECIPIENT, nonce },
      signature,
      provider: isOwnImplicitAccount(accountId, publicKey) ? implicitFallback(provider) : provider,
    });
}

/** True when `accountId` is the implicit account of this ed25519 key (64 hex chars = the key bytes). */
export function isOwnImplicitAccount(accountId: string, publicKey: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(accountId)) return false;
  try {
    const pk = PublicKey.fromString(publicKey);
    return pk.keyType === KeyType.ED25519 && Buffer.from(pk.data).toString("hex") === accountId;
  } catch {
    return false;
  }
}

/**
 * An implicit account (e.g. a Privy social-login wallet) has no on-chain record until funded, so
 * the access-key lookup fails; its own key is then its full access key. Funded accounts still use
 * the chain, so a deleted key stays rejected.
 */
function implicitFallback(provider: Provider): Provider {
  return {
    viewAccessKey: async (args: Parameters<Provider["viewAccessKey"]>[0]) => {
      try {
        return await provider.viewAccessKey(args);
      } catch {
        return { permission: "FullAccess" };
      }
    },
  } as unknown as Provider;
}

/**
 * Access-key lookups over several RPCs: public testnet RPCs rate-limit (HTTP 429) and drop requests,
 * and one failed lookup used to fail the whole sign-in. Two rounds, like chain/near.ts.
 */
export function keyFailover(providers: Pick<Provider, "viewAccessKey">[]): Provider {
  return {
    viewAccessKey: async (args: Parameters<Provider["viewAccessKey"]>[0]) => {
      let last: unknown;
      for (let round = 0; round < 2; round++) {
        if (round > 0) await new Promise((ok) => setTimeout(ok, 300));
        for (const p of providers) {
          try {
            return await p.viewAccessKey(args);
          } catch (err) {
            last = err;
          }
        }
      }
      throw last;
    },
  } as unknown as Provider;
}

const SessionBody = z.object({
  accountId: z.string().regex(/^[a-z0-9._-]{2,64}$/),
  publicKey: z.string().min(1).max(200),
  signature: z.string().min(1).max(400), // base64 (NEAR Connect), `ed25519:<base58>` or hex
  nonce: z.string().min(1).max(100),
});

/**
 * Signature bytes from any format wallets return (D2): `ed25519:<base58>`, hex (128 chars for
 * ed25519), else base64. Null if it does not decode.
 */
export function decodeSignature(s: string): Uint8Array | null {
  try {
    if (s.startsWith("ed25519:")) return baseDecode(s.slice("ed25519:".length));
    if (/^(0x)?[0-9a-fA-F]{128}$/.test(s)) return Buffer.from(s.replace(/^0x/, ""), "hex");
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return null;
    return Buffer.from(s, "base64");
  } catch {
    return null;
  }
}

export function authRoutes(deps: Deps, verifier?: Nep413Verifier) {
  const { db, now } = deps;
  const verify = verifier ?? nep413Verifier(keyFailover(deps.cfg.NEAR_RPC_URLS.map((url) => new JsonRpcProvider({ url }, { retries: 1 }))));
  const app = new Hono();

  app.get("/auth/nonce", (c) => {
    db.prepare("DELETE FROM auth_nonce WHERE expires_at <= ?").run(now());
    const nonce = randomBytes(32).toString("base64");
    db.prepare("INSERT INTO auth_nonce (nonce, expires_at) VALUES (?, ?)").run(nonce, now() + NONCE_TTL_MS);
    return c.json({ nonce, message: NEP413_MESSAGE, recipient: NEP413_RECIPIENT });
  });

  app.post("/session", async (c) => {
    const body = SessionBody.safeParse(await jsonBody(c));
    if (!body.success) return fail(c, 400, "invalid", "Expected accountId, publicKey, signature, nonce");
    const { accountId, publicKey, signature, nonce } = body.data;

    // Consume first (single use, atomic): a failed verify still burns the nonce.
    const used = db.prepare("DELETE FROM auth_nonce WHERE nonce = ? AND expires_at > ?").run(nonce, now());
    if (used.changes !== 1) return fail(c, 401, "expired", "Sign-in expired, try again");

    const nonceBytes = Buffer.from(nonce, "base64");
    if (nonceBytes.length !== 32) return fail(c, 400, "invalid", "Bad nonce");
    const sigBytes = decodeSignature(signature);
    if (!sigBytes || sigBytes.length === 0) return fail(c, 400, "invalid", "Bad signature encoding");
    try {
      await verify({ accountId, publicKey, signature: sigBytes, nonce: nonceBytes });
    } catch (err) {
      log.warn("session_verify_failed", { account: accountId, error: err instanceof Error ? err.name : "unknown" });
      return fail(c, 401, "unauthorized", "Signature check failed");
    }
    const session = await issueSession(deps, accountId);
    log.info("session_issued", { account: accountId });
    return c.json({ token: session.token, accountId, expires_at: session.expires_at });
  });

  return app;
}

export const authModule: Module = { name: "auth", routes: (deps) => authRoutes(deps) };
