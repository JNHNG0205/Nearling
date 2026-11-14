// Shared by the bench scripts: sign in to the brain as the test player (NEP-413, like the wallet).
import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";
import { signMessage } from "near-api-js/nep413";

export const BRAIN = process.env.BRAIN_URL ?? "http://localhost:8787";

export async function benchSession(): Promise<Record<string, string>> {
  const id = process.env.E2E_PLAYER_ID;
  const key = process.env.E2E_PLAYER_KEY;
  if (!id || !key) throw new Error("Set E2E_PLAYER_ID and E2E_PLAYER_KEY (brain/data/testnet-accounts.env)");
  const n = (await (await fetch(`${BRAIN}/auth/nonce`)).json()) as { nonce: string; message: string; recipient: string };
  const provider = new JsonRpcProvider({ url: "https://rpc.testnet.near.org" });
  const account = new Account(id, provider, KeyPairSigner.fromSecretKey(key as `ed25519:${string}`));
  const signed = await signMessage({
    signerAccount: account,
    payload: { message: n.message, recipient: n.recipient, nonce: Buffer.from(n.nonce, "base64") },
  });
  const r = await fetch(`${BRAIN}/session`, {
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
  return { Authorization: `Bearer ${((await r.json()) as { token: string }).token}` };
}

/** One text turn through the real talk route. */
export async function talk(auth: Record<string, string>, pet: string, text: string, voice = false) {
  const t0 = performance.now();
  const res = await fetch(`${BRAIN}/pets/${encodeURIComponent(pet)}/talk`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: crypto.randomUUID(), text, voice }),
  });
  const ms = Math.round(performance.now() - t0);
  const body = (await res.json().catch(() => ({}))) as { status?: string; reply?: string; emotion?: string; audio_url?: string | null; error?: { code?: string } };
  return { ok: res.ok, httpStatus: res.status, ms, ...body };
}

export const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
