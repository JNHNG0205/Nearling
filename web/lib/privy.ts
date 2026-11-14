// Social login (email, Google) through Privy, exposed to the app as one more NEAR Connect wallet
// (@peerfolio/privy-near-connect, NEAR docs "social login", path A). Privy holds the key of an
// implicit NEAR account; the /sign popup signs with it. Login itself happens on /login first,
// because the executor closes a /sign popup that does not answer within 30 s.
import type Privy from "@privy-io/js-sdk-core";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
export const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID ?? "";
export const PRIVY_WALLET_ID = "petto-privy";

/** Social login shows only when the Privy app is configured. */
export function privyEnabled(): boolean {
  return PRIVY_APP_ID !== "" && PRIVY_CLIENT_ID !== "";
}

/**
 * NEAR Connect manifest entry. The executor is the reviewed v0.0.8 build served from our own
 * origin (`public/privy-executor.js`), so no third-party URL decides what runs in the selector.
 */
export function privyManifest(origin: string) {
  const sign = `${origin}/sign`;
  return {
    id: PRIVY_WALLET_ID,
    name: "Email or Google",
    icon: `${origin}/wallet-email.svg`,
    description: "Sign in with email or Google. Petto makes you a NEAR testnet account.",
    website: origin,
    version: "0.0.8",
    executor: `${origin}/privy-executor.js`,
    type: "sandbox" as const,
    platform: [] as string[],
    features: {
      signMessage: true,
      signTransaction: false,
      signAndSendTransaction: true,
      signAndSendTransactions: true,
      signInWithoutAddKey: true,
      signInAndSignMessage: true,
      signInWithFunctionCallKey: true,
      signDelegateActions: false,
      mainnet: false,
      testnet: true,
    },
    permissions: { storage: true, allowsOpen: [sign] },
    metadata: { signPageURL: sign, debug: false },
  };
}

interface LinkedAccount {
  type?: string;
  chain_type?: string;
  id?: string | null;
  address?: string;
}

/** The user's Privy NEAR wallet (implicit account id = `address`), ignoring other chains. */
export function findNearWallet(linked: readonly unknown[]): { id: string; address: string } | null {
  for (const a of linked as LinkedAccount[]) {
    if (a.type === "wallet" && a.chain_type === "near" && typeof a.id === "string" && typeof a.address === "string") {
      return { id: a.id, address: a.address };
    }
  }
  return null;
}

const OAUTH_PROVIDERS = ["google"] as const;
type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Privy's OAuth redirect back to /login, or null for a normal visit. */
export function oauthReturn(search: string): { code: string; state: string; provider: OAuthProvider } | null {
  const q = new URLSearchParams(search);
  const code = q.get("privy_oauth_code");
  const state = q.get("privy_oauth_state");
  const provider = q.get("privy_oauth_provider");
  if (!code || !state || !OAUTH_PROVIDERS.includes(provider as OAuthProvider)) return null;
  return { code, state, provider: provider as OAuthProvider };
}

// ---------- browser only ----------

let client: Promise<Privy> | null = null;

/** One Privy client per page, shared by /login and /sign (same LocalStorage session). */
export function getPrivy(): Promise<Privy> {
  client ??= (async () => {
    const { default: PrivyClient, LocalStorage } = await import("@privy-io/js-sdk-core");
    const privy = new PrivyClient({ appId: PRIVY_APP_ID, clientId: PRIVY_CLIENT_ID, storage: new LocalStorage() });
    await privy.initialize();
    return privy;
  })();
  client.catch(() => (client = null));
  return client;
}

/** True when this browser has a Privy session. */
export async function privyLoggedIn(privy: Privy): Promise<boolean> {
  try {
    await privy.user.get();
    return true;
  } catch {
    return false;
  }
}

/** The user's NEAR wallet, created on first login (user-owned, signs through Privy). */
export async function ensureNearWallet(privy: Privy): Promise<{ id: string; address: string }> {
  const { user } = await privy.user.get();
  const found = findNearWallet(user.linked_accounts);
  if (found) return found;
  const { create } = await import("@privy-io/js-sdk-core");
  const w = await create(privy, { request: { chain_type: "near", owner: { user_id: user.id } } });
  await privy.user.refreshUser().catch(() => undefined);
  return { id: w.id, address: w.address };
}
