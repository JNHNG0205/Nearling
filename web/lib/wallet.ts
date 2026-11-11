"use client";

// Wallet context (NEAR Connect, testnet) and the brain sign-in (NEP-413 -> POST /session).
// The provider lives in components/wallet/WalletProvider.tsx; pages use `useWallet` and `useSignIn`.
import { createContext, useCallback, useContext, useState } from "react";
import type { NearConnector, SignedMessage } from "@hot-labs/near-connect";
import { NEP413_MESSAGE, NEP413_RECIPIENT } from "@nearling/shared";
import { BRAIN_URL, BrainRequestError } from "./brain";
import type { Outcome, TxRequest } from "./chain";
import { brainErrorCopy, CANCELLED, errorText, GENERIC_ERROR, isWalletRejection } from "./errors";
import { clearSession, setSession, useSession, type Session } from "./session";

export interface SignMessageInput {
  message: string;
  recipient: string;
  nonce: Uint8Array;
}

export interface WalletApi {
  /** false until the connector has loaded and restored any previous connection (client only). */
  ready: boolean;
  accountId: string | null;
  connector: NearConnector | null;
  /** Opens the wallet picker. With `signMessage`, only wallets that sign in and sign in one step are listed. */
  connect(opts?: { signMessage?: SignMessageInput }): Promise<{ accountId: string; signed: SignedMessage | null }>;
  disconnect(): Promise<void>;
  signMessage(input: SignMessageInput): Promise<SignedMessage>;
  signAndSendTransaction(req: TxRequest): Promise<Outcome>;
  /** Several transactions in one wallet prompt (e.g. AddKey on the owner account + register_device). */
  signAndSendTransactions(reqs: TxRequest[]): Promise<Outcome[]>;
}

const notReady = async (): Promise<never> => {
  throw new Error("Wallet is still loading");
};

export const WalletContext = createContext<WalletApi>({
  ready: false,
  accountId: null,
  connector: null,
  connect: notReady,
  disconnect: notReady,
  signMessage: notReady,
  signAndSendTransaction: notReady,
  signAndSendTransactions: notReady,
});

export function useWallet(): WalletApi {
  return useContext(WalletContext);
}

// ---------- brain session ----------

interface NonceResponse {
  nonce: string;
  message?: string;
  recipient?: string;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function brainJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BRAIN_URL}${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new BrainRequestError(res.status, body?.error?.code ?? "upstream");
  }
  return (await res.json()) as T;
}

async function fetchNonce(): Promise<{ b64: string; input: SignMessageInput }> {
  const r = await brainJson<NonceResponse>("/auth/nonce");
  const nonce = base64ToBytes(r.nonce);
  if (nonce.length !== 32) throw new BrainRequestError(500, "invalid");
  // message and recipient are fixed by packages/shared; the brain verifies against the same constants
  return { b64: r.nonce, input: { message: NEP413_MESSAGE, recipient: NEP413_RECIPIENT, nonce } };
}

/** Accepts ms, seconds or an ISO string; defaults to 7 days. */
function expiryMs(v: unknown): number {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return Date.now() + 7 * 24 * 3600 * 1000;
}

async function createSession(signed: SignedMessage, nonceB64: string): Promise<Session> {
  const r = await brainJson<{ token: string; accountId: string; expires_at: unknown }>("/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: signed.accountId,
      publicKey: signed.publicKey,
      signature: signed.signature,
      nonce: nonceB64,
    }),
  });
  const s: Session = { account: r.accountId, token: r.token, expires_at: expiryMs(r.expires_at) };
  setSession(s);
  return s;
}

function friendly(err: unknown): string {
  if (isWalletRejection(err)) return CANCELLED;
  if (err instanceof BrainRequestError) return brainErrorCopy(err.code);
  return /no wallet|not found/i.test(errorText(err)) ? "No wallet found for this step. Try Meteor." : GENERIC_ERROR;
}

export interface SignInState {
  wallet: WalletApi;
  /** Session for the connected account (null if signed out or for another account). */
  session: Session | null;
  busy: boolean;
  error: string | null;
  /** Connect and sign in with one popup when the wallet supports it. `anyWallet` lists every wallet and signs after connect. */
  signIn(opts?: { anyWallet?: boolean }): Promise<Session | null>;
  signOut(): Promise<void>;
}

export function useSignIn(): SignInState {
  const wallet = useWallet();
  const stored = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = stored && wallet.accountId && stored.account === wallet.accountId ? stored : null;

  const signIn = useCallback(
    async (opts?: { anyWallet?: boolean }) => {
      setBusy(true);
      setError(null);
      try {
        const nonce = await fetchNonce();
        let signed: SignedMessage | null = null;
        if (!wallet.accountId) {
          const r = await wallet.connect(opts?.anyWallet ? undefined : { signMessage: nonce.input });
          signed = r.signed;
          if (!signed) {
            // wallet connected without signing: second popup (02 section 1 fallback)
            const fresh = await fetchNonce();
            signed = await wallet.signMessage(fresh.input);
            return await createSession(signed, fresh.b64);
          }
          return await createSession(signed, nonce.b64);
        }
        signed = await wallet.signMessage(nonce.input);
        return await createSession(signed, nonce.b64);
      } catch (err) {
        setError(friendly(err));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [wallet],
  );

  const signOut = useCallback(async () => {
    clearSession();
    await wallet.disconnect().catch(() => undefined);
  }, [wallet]);

  return { wallet, session, busy, error, signIn, signOut };
}
