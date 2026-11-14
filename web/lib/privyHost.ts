// `window.pettoPrivy`: the "Email or Google" wallet's signing, on the Petto page itself. NEAR
// Connect's sandbox (public/privy-executor.js) forwards each wallet call here. We sign with the
// user's Privy NEAR wallet (implicit account) through a hidden Privy iframe, after the user
// approves in PrivyConfirm. Signer pattern from @peerfolio/privy-near-connect (MIT).
import type Privy from "@privy-io/js-sdk-core";
import { Account, JsonRpcProvider, PublicKey, Signer, actions, baseEncode, encodeSignedDelegate, type Action } from "near-api-js";
import { signMessage as signNep413 } from "near-api-js/nep413";
import { DEMO_PETS_CONTRACT, formatNear, PETS_CONTRACT, RPC_URL, SHIRTS_CONTRACT, type TxAction, type TxRequest } from "./chain";
import { ensureNearWallet, getPrivy, privyLoggedIn, privyLogout } from "./privy";

// ---------- pure helpers (tested) ----------

/** Our NEAR Connect action shape to a near-api-js action. */
export function toNearAction(a: TxAction): Action {
  switch (a.type) {
    case "FunctionCall":
      return actions.functionCall(a.params.methodName, a.params.args, BigInt(a.params.gas), BigInt(a.params.deposit));
    case "Transfer":
      return actions.transfer(BigInt(a.params.deposit));
    case "AddKey": {
      const p = a.params.accessKey.permission;
      return actions.addFunctionCallAccessKey(PublicKey.fromString(a.params.publicKey), p.receiverId, p.methodNames, BigInt(p.allowance));
    }
    case "DeleteKey":
      return actions.deleteKey(PublicKey.fromString(a.params.publicKey));
  }
}

export type HostMethod =
  | "signIn" | "signInAndSignMessage" | "signOut" | "getAccounts"
  | "signMessage" | "signAndSendTransaction" | "signAndSendTransactions" | "signDelegateActions";

export interface ConfirmView {
  title: string;
  lines: string[];
  /** A relayed call: Petto pays the gas (lib/relay.ts). */
  gasless: boolean;
}

function describeTx(t: TxRequest): string[] {
  return t.actions.map((a) => {
    switch (a.type) {
      case "FunctionCall": {
        const dep = BigInt(a.params.deposit);
        return `${a.params.methodName} on ${t.receiverId}${dep > 1n ? `, attach ${formatNear(dep)} NEAR` : ""}`;
      }
      case "Transfer":
        return `Send ${formatNear(a.params.deposit)} NEAR to ${t.receiverId}`;
      case "AddKey":
        return `Add a limited key for ${a.params.accessKey.permission.receiverId} on ${t.receiverId}`;
      case "DeleteKey":
        return `Remove a key from ${t.receiverId}`;
    }
  });
}

/** What the confirm modal shows for one wallet call. */
export function describeRequest(method: HostMethod, params: Record<string, unknown>): ConfirmView {
  switch (method) {
    case "signIn":
    case "signInAndSignMessage": {
      const msg = (params.messageParams as { message?: string } | undefined)?.message;
      return { title: "Connect to Petto", lines: msg ? [`Sign the message: ${msg}`] : ["Share your NEAR account with Petto"], gasless: false };
    }
    case "signMessage":
      return { title: "Sign a message", lines: [String(params.message ?? "")], gasless: false };
    case "signDelegateActions":
      return { title: "Approve", lines: (params.delegateActions as TxRequest[]).flatMap(describeTx), gasless: true };
    case "signAndSendTransaction":
      return { title: "Approve", lines: describeTx(params as unknown as TxRequest), gasless: false };
    default:
      return { title: "Approve", lines: ((params.transactions as TxRequest[]) ?? []).flatMap(describeTx), gasless: false };
  }
}

const OUR_CONTRACTS = [PETS_CONTRACT, DEMO_PETS_CONTRACT, SHIRTS_CONTRACT];

/**
 * No modal for connecting, the sign-in message, and any call to our own contracts: the Petto
 * button the user just pressed already named the action and its NEAR ("Plant 1 NEAR"). Plain
 * NEAR transfers, key changes and other contracts still ask.
 */
export function autoApprove(method: HostMethod, request: object): boolean {
  const params = request as Record<string, unknown>;
  const safe = (t: TxRequest) =>
    OUR_CONTRACTS.includes(t.receiverId) &&
    t.actions.every((a) => a.type === "FunctionCall");
  switch (method) {
    case "signIn":
    case "signInAndSignMessage":
    case "signMessage":
      return true;
    case "signAndSendTransaction":
      return safe(params as unknown as TxRequest);
    case "signAndSendTransactions":
      return ((params.transactions as TxRequest[]) ?? []).every(safe);
    case "signDelegateActions":
      return ((params.delegateActions as TxRequest[]) ?? []).every(safe);
    default:
      return false;
  }
}

// ---------- confirm modal store (components/wallet/PrivyConfirm.tsx renders it) ----------

export interface PendingConfirm extends ConfirmView {
  approve(): void;
  reject(): void;
}

let pending: PendingConfirm | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const confirmStore = {
  get: () => pending,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Resolves when approved; rejects with a wallet-style "User rejected" (lib/errors isWalletRejection). */
function askUser(view: ConfirmView): Promise<void> {
  pending?.reject();
  return new Promise((resolve, reject) => {
    pending = {
      ...view,
      approve: () => ((pending = null), notify(), resolve()),
      reject: () => ((pending = null), notify(), reject(new Error("User rejected the request"))),
    };
    notify();
  });
}

/** The modal, unless the request is one the user never needs to see (autoApprove). */
function approve(method: HostMethod, params: Record<string, unknown>): Promise<void> {
  return autoApprove(method, params) ? Promise.resolve() : askUser(describeRequest(method, params));
}

// ---------- signing (browser only) ----------

const ACCOUNT_KEY = "petto.privy.account";

class PrivySigner extends Signer {
  constructor(private privy: Privy, private wallet: { id: string; address: string }) {
    super();
  }
  async getPublicKey(): Promise<PublicKey> {
    return PublicKey.fromString(`ed25519:${baseEncode(hexToBytes(this.wallet.address))}`);
  }
  /** near-api-js passes the sha256 hash of the transaction, delegate or NEP-413 payload. */
  protected async signBytes(hash: Uint8Array): Promise<Uint8Array> {
    const { rawSign } = await import("@privy-io/js-sdk-core");
    const { data } = await rawSign(this.privy, (o) => this.privy.embeddedWallet.signWithUserSigner(o), {
      wallet_id: this.wallet.id,
      params: { hash: `0x${bytesToHex(hash)}` },
    });
    return hexToBytes(data.signature.replace(/^0x/, ""));
  }
}

const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/.{2}/g) ?? [], (b) => parseInt(b, 16));
const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

let iframeReady: Promise<void> | null = null;

/** Privy signs through its embedded-wallet iframe; mount it once, hidden. */
function mountPrivyIframe(privy: Privy): Promise<void> {
  iframeReady ??= new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.src = privy.embeddedWallet.getURL();
    iframe.style.display = "none";
    window.addEventListener("message", (e) => {
      if (e.source === iframe.contentWindow) privy.embeddedWallet.onMessage(e.data);
    });
    iframe.addEventListener(
      "load",
      () => {
        privy.setMessagePoster({
          postMessage: (msg, origin, transfer) => iframe.contentWindow!.postMessage(msg, origin, transfer ? [transfer] : undefined),
          reload: () => (iframe.src = privy.embeddedWallet.getURL()),
        });
        resolve();
      },
      { once: true },
    );
    document.body.appendChild(iframe);
  });
  return iframeReady;
}

/** The signed-in user's Privy NEAR account; sends people to /login when there is no Privy session. */
async function privyAccount(): Promise<{ account: Account; signer: PrivySigner; address: string }> {
  const privy = await getPrivy();
  if (!(await privyLoggedIn(privy))) {
    const back = window.location.pathname === "/" ? "/go" : window.location.pathname; // landing: route by pets
    window.location.assign(`/login?next=${encodeURIComponent(back)}`);
    throw new Error("Sign in with email or Google first");
  }
  const wallet = await ensureNearWallet(privy);
  await mountPrivyIframe(privy);
  const signer = new PrivySigner(privy, wallet);
  return { account: new Account(wallet.address, new JsonRpcProvider({ url: RPC_URL }), signer), signer, address: wallet.address };
}

async function signedMessage(account: Account, p: { message: string; recipient: string; nonce: Uint8Array; callbackUrl?: string }) {
  const s = await signNep413({ signerAccount: account, payload: { ...p, nonce: Uint8Array.from(p.nonce) } });
  return { accountId: s.accountId, publicKey: s.publicKey.toString(), signature: toBase64(s.signature) };
}

type Params = Record<string, unknown>;

/** The object NEAR Connect's sandbox calls (`external: ["pettoPrivy"]`). Results must be cloneable. */
const host: Record<HostMethod, (p: Params) => Promise<unknown>> = {
  async getAccounts() {
    const id = window.localStorage.getItem(ACCOUNT_KEY);
    return id ? [{ accountId: id }] : [];
  },
  async signOut() {
    // Petto's "Sign out" also ends the Privy login, so the next sign-in can be another account
    window.localStorage.removeItem(ACCOUNT_KEY);
    await privyLogout();
  },
  async signIn(p) {
    const { signer, address } = await privyAccount();
    await approve("signIn", p);
    window.localStorage.setItem(ACCOUNT_KEY, address);
    return [{ accountId: address, publicKey: (await signer.getPublicKey()).toString() }];
  },
  async signInAndSignMessage(p) {
    const { account, signer, address } = await privyAccount();
    await approve("signInAndSignMessage", p);
    const signed = await signedMessage(account, p.messageParams as Parameters<typeof signedMessage>[1]);
    window.localStorage.setItem(ACCOUNT_KEY, address);
    return [{ accountId: address, publicKey: (await signer.getPublicKey()).toString(), signedMessage: signed }];
  },
  async signMessage(p) {
    const { account } = await privyAccount();
    await approve("signMessage", p);
    return signedMessage(account, p as unknown as Parameters<typeof signedMessage>[1]);
  },
  async signAndSendTransaction(p) {
    const { account } = await privyAccount();
    await approve("signAndSendTransaction", p);
    const t = p as unknown as TxRequest;
    return account.signAndSendTransaction({ receiverId: t.receiverId, actions: t.actions.map(toNearAction), throwOnFailure: false });
  },
  async signAndSendTransactions(p) {
    const { account } = await privyAccount();
    await approve("signAndSendTransactions", p);
    const out = [];
    for (const t of p.transactions as TxRequest[]) {
      out.push(await account.signAndSendTransaction({ receiverId: t.receiverId, actions: t.actions.map(toNearAction), throwOnFailure: false }));
    }
    return out;
  },
  async signDelegateActions(p) {
    const { account } = await privyAccount();
    await approve("signDelegateActions", p);
    const signedDelegateActions = [];
    for (const d of p.delegateActions as TxRequest[]) {
      // one at a time: each delegate takes the next access-key nonce
      const { signedDelegate } = await account.createSignedMetaTransaction({ receiverId: d.receiverId, actions: d.actions.map(toNearAction) });
      signedDelegateActions.push(toBase64(encodeSignedDelegate(signedDelegate)));
    }
    return { signedDelegateActions };
  },
};

/** Exposes `window.pettoPrivy` for the "Email or Google" wallet's executor. */
export function installPrivyHost(): void {
  (window as unknown as { pettoPrivy: typeof host }).pettoPrivy = host;
}
