import { existsSync, readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";

export const BRAIN_URL = process.env.E2E_BRAIN_URL ?? "http://localhost:8788";
export const DEMO_PET = process.env.E2E_DEMO_PET ?? process.env.NEXT_PUBLIC_DEMO_PET_REF ?? "pets-v9.nearling.testnet:4"; // same default as web/lib/brain.ts DEMO_PET_REF
export const DEMO_PET_PATH = encodeURIComponent(DEMO_PET);

/** Count of non-transparent pixels on a canvas (the pet sprites are 32x32). */
export async function inkedPixels(canvas: Locator): Promise<number> {
  return canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext("2d");
    if (!ctx) return 0;
    const d = ctx.getImageData(0, 0, el.width, el.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n += 1;
    return n;
  });
}

/** Raw RGBA of a canvas, for frame-to-frame diffs. */
export async function canvasBytes(canvas: Locator): Promise<string> {
  return canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext("2d");
    if (!ctx) return "";
    return Array.from(ctx.getImageData(0, 0, el.width, el.height).data).join(",");
  });
}

/** Samples the canvas `samples` times over `ms` and returns the number of distinct frames seen. */
export async function distinctFrames(page: Page, canvas: Locator, ms = 2_000, samples = 12): Promise<number> {
  const seen = new Set<string>();
  for (let i = 0; i < samples; i += 1) {
    seen.add(await canvasBytes(canvas));
    await page.waitForTimeout(ms / samples);
  }
  return seen.size;
}

/**
 * A real testnet account with a full-access key, created by another engineer for e2e only.
 * `brain/data/testnet-accounts.env` (gitignored): E2E_PLAYER_ID, E2E_PLAYER_KEY (ed25519:...),
 * optional E2E_PLAYER_PET (a pet ref that account owns).
 */
export interface E2EAccount {
  id: string;
  key: string;
  pet: string | null;
}

export function e2eAccount(): E2EAccount | null {
  const file = process.env.E2E_ACCOUNTS_FILE ?? "/home/zhijian/Nearling/brain/data/testnet-accounts.env";
  const env: Record<string, string> = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line);
      if (m) env[m[1]!] = m[2]!;
    }
  }
  const id = process.env.E2E_PLAYER_ID ?? env.E2E_PLAYER_ID;
  const key = process.env.E2E_PLAYER_KEY ?? env.E2E_PLAYER_KEY;
  if (!id || !key) return null;
  return { id, key, pet: process.env.E2E_PLAYER_PET ?? env.E2E_PLAYER_PET ?? null };
}

export interface BrainSession {
  account: string;
  token: string;
  expires_at: number;
}

/**
 * Signs the brain's NEP-413 sign-in message with the account's full-access key (what a wallet
 * does in the popup) and exchanges it for a session, exactly like `web/lib/wallet.ts`.
 */
export async function brainSession(acct: E2EAccount): Promise<BrainSession> {
  const { Account, JsonRpcProvider, KeyPairSigner } = await import("near-api-js");
  const { signMessage } = await import("near-api-js/nep413");
  const n = (await (await fetch(`${BRAIN_URL}/auth/nonce`)).json()) as { nonce: string; message: string; recipient: string };
  const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
  const signer = KeyPairSigner.fromSecretKey(acct.key as `ed25519:${string}`);
  const account = new Account(acct.id, provider, signer);
  const signed = await signMessage({
    signerAccount: account,
    payload: { message: n.message, recipient: n.recipient, nonce: Buffer.from(n.nonce, "base64") },
  });
  const r = await fetch(`${BRAIN_URL}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: signed.accountId,
      publicKey: signed.publicKey.toString(),
      signature: Buffer.from(signed.signature).toString("base64"),
      nonce: n.nonce,
    }),
  });
  if (!r.ok) throw new Error(`POST /session ${r.status}`);
  const s = (await r.json()) as { token: string; accountId: string; expires_at: number | string };
  const exp = typeof s.expires_at === "number" ? (s.expires_at < 1e12 ? s.expires_at * 1000 : s.expires_at) : Date.parse(s.expires_at);
  return { account: s.accountId, token: s.token, expires_at: exp };
}
