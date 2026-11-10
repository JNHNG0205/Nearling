import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { JsonRpcProvider, type Provider } from "near-api-js";
import { verifyMessage } from "near-api-js/nep413";
import { z } from "zod";
import { NEP413_MESSAGE, NEP413_RECIPIENT } from "@nearling/shared";
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
      provider,
    });
}

const SessionBody = z.object({
  accountId: z.string().regex(/^[a-z0-9._-]{2,64}$/),
  publicKey: z.string().min(1).max(200),
  signature: z.string().min(1).max(400), // base64, as NEAR Connect returns it
  nonce: z.string().min(1).max(100),
});

export function authRoutes(deps: Deps, verifier?: Nep413Verifier) {
  const { db, now } = deps;
  const verify = verifier ?? nep413Verifier(new JsonRpcProvider({ url: deps.cfg.NEAR_RPC_URLS[0]! }));
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
    try {
      await verify({ accountId, publicKey, signature: Buffer.from(signature, "base64"), nonce: nonceBytes });
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
