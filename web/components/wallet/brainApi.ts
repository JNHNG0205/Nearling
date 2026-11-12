// Brain routes used by the wallet and chain pages ("AI-brain architectual/08-api-reference.md").
// Shapes follow the documented fields; optional fields are tolerated while the brain is built.
import { BRAIN_URL, BrainRequestError } from "@/lib/brain";
import { authHeaders } from "@/lib/session";

async function req<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const { auth, headers, ...rest } = init;
  const res = await fetch(`${BRAIN_URL}${path}`, {
    ...rest,
    headers: {
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...(auth ? authHeaders() : {}),
      ...(headers as Record<string, string> | undefined),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new BrainRequestError(res.status, body?.error?.code ?? "upstream");
  }
  return (await res.json()) as T;
}

const enc = encodeURIComponent;
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

// ---------- pairing ----------

export type PairingStatus = "open" | "claimed" | "awaiting_confirm" | "confirmed" | "expired" | "cancelled";
export interface Pairing {
  status: PairingStatus;
  expires_at: number | string;
  pet_ref?: string;
}
export const getPairing = (token: string) => req<Pairing>(`/pairings/${enc(token)}`);
export const claimPairing = (token: string, petRef: string) =>
  req<{ status: PairingStatus }>(`/pairings/${enc(token)}/claim`, { ...post({ pet_ref: petRef }), auth: true });
export const unpair = (petRef: string) => req<{ ok: boolean }>(`/pets/${enc(petRef)}/unpair`, { ...post({}), auth: true });

/** GET /pets/:petRef/device (owner): pairing plus the device key in the brain, on chain and on the owner's account. */
export interface DeviceStatus {
  paired: boolean;
  /** The device's own ed25519 key, sent in /devices/hello; null until its firmware sends one. */
  device_pk: string | null;
  last_seen_at: number | null;
  /** `get_pet.device_pk` */
  chain_device_pk: string | null;
  /** A function-call key with device_pk and receiver = this pet's contract is on the owner's account; null = RPC unknown. */
  key_added: boolean | null;
  approval_mode: boolean;
  /** pets-v9 contract (`feed_from_pantry` goes in the key's method list) */
  pantry_supported: boolean;
}
export const getDeviceStatus = (petRef: string) => req<DeviceStatus>(`/pets/${enc(petRef)}/device`, { auth: true });

// ---------- feed ----------

export type PayMode = "direct" | "live";
export interface Pack {
  id: string;
  name: string;
  fuel: number;
  feed_yocto: string;
  live_price?: string | null;
}
export interface PacksResponse {
  packs: Pack[];
  modes: PayMode[];
}
export type OrderStatus =
  | "created" | "quoted" | "pending" | "settled" | "feeding" | "fed" | "failed" | "refunded" | "expired";
export interface Order {
  id: string;
  pet_ref: string;
  mode: PayMode;
  pack_id: string;
  status: OrderStatus;
  feed_yocto: string;
  fuel?: number;
  feed_tx?: string | null;
  deposit_address?: string | null;
  /** quote deadline, ms (brain returns it at the top level) */
  deadline?: number | null;
  quote?: { origin_asset?: string; amount_in?: string; amount_in_formatted?: string; deadline?: string } | null;
}

export async function getPacks(): Promise<PacksResponse> {
  const r = await req<Partial<PacksResponse> & { enabled_modes?: PayMode[] }>("/feed/packs");
  return {
    packs: r.packs ?? [],
    modes: r.modes ?? r.enabled_modes ?? ["direct"],
  };
}
export const createOrder = (petRef: string, packId: string, mode: PayMode, originAsset?: string) =>
  req<Order>("/orders", post({ pet_ref: petRef, pack_id: packId, mode, origin_asset: originAsset }));
export const getOrder = (id: string) => req<Order>(`/orders/${enc(id)}`);
export const reportDirectTx = (id: string, txHash: string) => req<Order>(`/orders/${enc(id)}/direct-tx`, post({ tx_hash: txHash }));

// ---------- closet ----------

export interface Closet {
  shirts: { token_id: string; title: string }[];
  equipped: string | null;
}
export const getCloset = (petRef: string) => req<Closet>(`/pets/${enc(petRef)}/closet`, { auth: true });
export const equipShirt = (petRef: string, tokenId: string | null) =>
  req<{ equipped: string | null }>(`/pets/${enc(petRef)}/closet/equip`, { ...post({ token_id: tokenId }), auth: true });

// ---------- timeline (Soul history) ----------

export interface TimelineItem {
  kind: string;
  actor?: string | null;
  amount?: string | null;
  tx_hash?: string | null;
  /** event time, ms (brain timeline) */
  at?: number | null;
  block_ts?: number | string | null;
  raw?: { version?: number; prompt?: string } & Record<string, unknown>;
  version?: number;
}
export const getTimeline = (petRef: string) => req<TimelineItem[]>(`/pets/${enc(petRef)}/timeline`);

// ---------- wallet approvals (P1) ----------

export type ApprovalKind = "send" | "stake" | "transfer_pet";
export type ApprovalStatus = "requested" | "approved" | "signed" | "final" | "rejected" | "expired" | "failed";
export interface Approval {
  id: string;
  kind: ApprovalKind;
  network: string;
  account_id: string;
  pet_ref?: string | null;
  receiver_id: string;
  amount_yocto?: string | null;
  token_id?: string | null;
  validator?: string | null;
  status: ApprovalStatus;
  tx_hash?: string | null;
  expires_at: number | string;
}
/** Starts an approval from the phone. Today the brain only lets the device start one (08 "Wallet"). */
export const createApproval = (body: { kind: ApprovalKind; receiver_id: string; token_id?: string; pet_ref?: string }) =>
  req<Approval>("/approvals", { ...post(body), auth: true });
export const getApproval = (id: string) => req<Approval>(`/approvals/${enc(id)}`, { auth: true });
export const reportApprovalTx = (id: string, txHash: string) =>
  req<Approval>(`/approvals/${enc(id)}/submitted`, { ...post({ tx_hash: txHash }), auth: true });

export interface WalletInfo {
  account_id: string;
  liquid_yocto: string;
  staked_yocto: string;
  validator: string | null;
}
export interface Recipient {
  label: string;
  account_id: string;
}
export const getWalletInfo = () => req<WalletInfo>("/wallet", { auth: true });
export const getRecipients = () => req<Recipient[]>("/wallet/recipients", { auth: true });
export const addRecipient = (r: Recipient) => req<Recipient[] | Recipient>("/wallet/recipients", { ...post(r), auth: true });

/** ms timestamp from ns, ms, seconds (number or numeric string) or ISO. */
export function toMs(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : /^\d+$/.test(v) ? Number(v) : null;
  if (n !== null) return n > 1e15 ? Math.floor(n / 1e6) : n < 1e12 ? n * 1000 : n;
  const t = Date.parse(v as string);
  return Number.isNaN(t) ? null : t;
}
