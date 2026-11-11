import type { BrainErrorCode, Emotion, PetState, TalkResponse } from "@nearling/shared";

export const BRAIN_URL = process.env.NEXT_PUBLIC_BRAIN_URL ?? "http://localhost:8787";
/** The live demo pet on `pets-demo` (demo speed) shown on the landing page. */
export const DEMO_PET_REF = process.env.NEXT_PUBLIC_DEMO_PET_REF ?? "pets-demo.nearling.testnet:0";
export const EXPLORER_TX = "https://testnet.nearblocks.io/txns/";

export class BrainRequestError extends Error {
  constructor(public status: number, public code: BrainErrorCode | string, public retryAfterS?: number) {
    super(code);
  }
}

const pet = (petRef: string) => `${BRAIN_URL}/pets/${encodeURIComponent(petRef)}`;

/** Resolves a brain-relative path (audio, receipt) to an absolute URL. */
export function brainUrl(path: string): string {
  return /^https?:\/\//.test(path) ? path : `${BRAIN_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { code?: string; retry_after_s?: number } }
      | null;
    throw new BrainRequestError(res.status, body?.error?.code ?? "upstream", body?.error?.retry_after_s);
  }
  return (await res.json()) as T;
}

export async function getPetState(petRef: string, init?: RequestInit): Promise<PetState> {
  return json<PetState>(await fetch(`${pet(petRef)}/state`, init));
}

// ---------- talk ----------

export type TalkInput = { text: string } | { audio: Blob };

export async function postTalk(
  petRef: string,
  requestId: string,
  input: TalkInput,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<TalkResponse> {
  let init: RequestInit;
  if ("text" in input) {
    init = {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId, text: input.text, voice: false }),
      signal,
    };
  } else {
    const form = new FormData();
    form.set("request_id", requestId);
    form.set("audio", input.audio, "talk.webm");
    // No synthesis from the web: ElevenLabs credits (about 130 replies) are kept for the device
    // (AI-brain 03 section 6). Replies still show as text; "Play voice" appears only if the brain sent audio.
    form.set("voice", "0");
    init = { method: "POST", headers, body: form, signal };
  }
  return json<TalkResponse>(await fetch(`${pet(petRef)}/talk`, init));
}

// ---------- turns and receipts ----------

export type VerifyStatus = "pending" | "model_verified" | "gateway_verified" | "unverified";
export type FuelSource = "credit" | "food" | "mixed" | "none";

/** One chat turn as the web shows it. Normalised from `/turns`, `/talk` and SSE. */
export interface Turn {
  turn_id: string;
  at: number;
  user_text: string | null;
  reply: string;
  emotion: Emotion;
  status: "done" | "canned" | "failed" | "processing";
  audio_url: string | null;
  fuel: { status: "pending" | "settled" | "failed" | "none"; tx: string | null; source: FuelSource | null };
  verification: VerifyStatus;
}

const EMOTIONS: Emotion[] = ["happy", "excited", "sleepy", "sad", "hungry", "curious", "silly"];
const asEmotion = (v: unknown): Emotion => (EMOTIONS.includes(v as Emotion) ? (v as Emotion) : "happy");
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

function asVerify(v: unknown): VerifyStatus {
  return v === "model_verified" || v === "gateway_verified" || v === "unverified" ? v : "pending";
}

function asFuelStatus(v: unknown, tx: string | null): Turn["fuel"]["status"] {
  if (tx || v === "settled") return "settled";
  if (v === "failed") return "failed";
  if (v === "none") return "none";
  return "pending";
}

/** Accepts the documented field names and the table column names (02-data-model). */
export function normalizeTurn(raw: unknown): Turn | null {
  const r = obj(raw);
  const id = str(r.turn_id) ?? str(r.id);
  if (!id) return null;
  const fuel = obj(r.fuel);
  const tx = str(fuel.tx) ?? str(fuel.tx_hash) ?? str(r.tx_hash);
  const status = r.status === "canned" || r.status === "failed" || r.status === "processing" ? r.status : "done";
  const v = r.verification;
  return {
    turn_id: id,
    at: typeof r.at === "number" ? r.at : typeof r.created_at === "number" ? r.created_at : Date.now(),
    user_text: str(r.user_text) ?? str(r.transcript) ?? str(r.text),
    reply: str(r.reply) ?? str(r.reply_text) ?? "",
    emotion: asEmotion(r.emotion),
    status,
    audio_url: str(r.audio_url),
    fuel: {
      status: status === "canned" ? "none" : asFuelStatus(fuel.status ?? fuel.charged ?? r.charge_status, tx),
      tx,
      source: (str(fuel.source) as FuelSource | null) ?? null,
    },
    verification: asVerify(typeof v === "string" ? v : obj(v).status),
  };
}

export async function getTurns(petRef: string, headers: Record<string, string>, limit = 20): Promise<Turn[]> {
  const body = await json<unknown>(await fetch(`${pet(petRef)}/turns?limit=${limit}`, { headers }));
  const list = Array.isArray(body) ? body : (obj(body).turns as unknown[] | undefined) ?? [];
  return list.map(normalizeTurn).filter((t): t is Turn => t !== null).sort((a, b) => a.at - b.at);
}

export interface Receipt {
  turn_id: string;
  pet_ref: string;
  at: number | null;
  soul_version: number | null;
  model: string | null;
  verification: {
    status: VerifyStatus;
    signature_kind?: "provider_tee" | "gateway" | string | null;
    signer?: string | null;
    req_hash?: string | null;
    resp_hash?: string | null;
    reason?: string | null;
    public?: boolean;
    attestation?: { fetched_at?: number | null; nras?: string | null; tdx?: string | null; nras_jwt_signature?: string | null } | null;
  };
  fuel: { cost_micro: number | null; source: FuelSource | null; tx: string | null; status?: string | null } | null;
  provider_cost_usd?: number | null;
  voice?: { provider: string; note?: string } | null;
}

export async function getReceipt(turnId: string, init?: RequestInit): Promise<Receipt> {
  return json<Receipt>(await fetch(`${BRAIN_URL}/receipts/${encodeURIComponent(turnId)}`, init));
}

export async function publishReceipt(turnId: string, headers: Record<string, string>): Promise<{ public: boolean }> {
  return json(await fetch(`${BRAIN_URL}/receipts/${encodeURIComponent(turnId)}/publish`, { method: "POST", headers }));
}

/** Receipts the owner published (public, D6). The brain answers 404 before the route exists: no receipts then. */
export async function getPublicReceipts(petRef: string, init?: RequestInit): Promise<Receipt[]> {
  const res = await fetch(`${pet(petRef)}/receipts?public=1`, init);
  if (res.status === 404) return [];
  const body = await json<unknown>(res);
  const list = Array.isArray(body) ? body : (obj(body).receipts as unknown[] | undefined) ?? [];
  return (list as Receipt[]).filter((r) => typeof r?.turn_id === "string" && r.verification?.public !== false);
}

/** Voice for one saved reply, synthesised once on demand ("Hear it", A4). */
export async function requestVoice(petRef: string, turnId: string, headers: Record<string, string>): Promise<string> {
  const r = await json<{ audio_url: string }>(
    await fetch(`${pet(petRef)}/turns/${encodeURIComponent(turnId)}/voice`, { method: "POST", headers }),
  );
  return r.audio_url;
}

// ---------- owner: my pets, profile ----------

/** Pets the signed-in owner holds on both contracts (`GET /me/pets`). */
export async function getMyPets(headers: Record<string, string>): Promise<PetState[]> {
  const body = await json<unknown>(await fetch(`${BRAIN_URL}/me/pets`, { headers, cache: "no-store" }));
  return (Array.isArray(body) ? body : ((obj(body).pets as unknown[] | undefined) ?? [])) as PetState[];
}

export interface Profile {
  nickname?: string | null;
  owner_tz?: string | null;
}

/** Current profile, or null when the brain has no GET route for it. */
export async function getProfile(petRef: string, headers: Record<string, string>): Promise<Profile | null> {
  const res = await fetch(`${pet(petRef)}/profile`, { headers, cache: "no-store" });
  if (res.status === 404 || res.status === 405) return null;
  return json<Profile>(res);
}

export async function putProfile(petRef: string, headers: Record<string, string>, body: Profile): Promise<Profile> {
  return json<Profile>(await fetch(`${pet(petRef)}/profile`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

// ---------- inbox, care, stream ----------

export interface InboxItem {
  id: number;
  text: string;
  trigger: string | null;
  created_at: number;
  /** When the owner read it (acked); null = unread. */
  read_at: number | null;
}

export function normalizeInbox(raw: unknown): InboxItem | null {
  const r = obj(raw);
  const id = typeof r.id === "number" ? r.id : Number(r.id);
  const text = str(r.text);
  if (!Number.isFinite(id) || !text) return null;
  return {
    id,
    text,
    trigger: str(r.trigger),
    created_at: typeof r.created_at === "number" ? r.created_at : Date.now(),
    read_at: typeof r.read_at === "number" ? r.read_at : null,
  };
}

export async function getInbox(petRef: string, headers: Record<string, string>, after?: number): Promise<InboxItem[]> {
  const q = after !== undefined ? `?after=${after}` : "";
  const body = await json<unknown>(await fetch(`${pet(petRef)}/inbox${q}`, { headers }));
  const list = Array.isArray(body) ? body : (obj(body).items as unknown[] | undefined) ?? [];
  return list.map(normalizeInbox).filter((i): i is InboxItem => i !== null);
}

export async function ackInbox(petRef: string, headers: Record<string, string>, upTo: number): Promise<void> {
  await json(await fetch(`${pet(petRef)}/inbox/ack`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ up_to: upTo }),
  }));
}

export type CareKind = "pat" | "rock" | "shake" | "sleep";
export interface CareResult {
  mood: number;
  milestones: { pat: boolean; rock: boolean; sleep: boolean };
  form: "base" | "winged";
  evolved_now: boolean;
}

export async function postCare(
  petRef: string,
  headers: Record<string, string>,
  events: { id: string; kind: CareKind; at: number }[],
): Promise<CareResult> {
  return json(await fetch(`${pet(petRef)}/care`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ events }),
  }));
}

/** EventSource cannot set headers, so the session token goes in `?t=` (04 section 2). */
export function streamUrl(petRef: string, token: string): string {
  return `${pet(petRef)}/stream?t=${encodeURIComponent(token)}`;
}

// ---------- public: timeline, attestation ----------

export interface TimelineItem {
  id: string;
  kind: string;
  actor: string | null;
  amount: string | null;
  tx_hash: string | null;
  at: number;
  turn_id: string | null;
  detail: string | null;
}

export function normalizeTimeline(raw: unknown, i: number): TimelineItem | null {
  const r = obj(raw);
  const kind = str(r.kind) ?? str(r.type);
  if (!kind) return null;
  const at = typeof r.at === "number" ? r.at : typeof r.block_ts === "number" ? r.block_ts : 0;
  return {
    id: str(r.id) ?? String(r.id ?? `${kind}-${at}-${i}`),
    kind,
    actor: str(r.actor),
    amount: str(r.amount) ?? (typeof r.amount === "number" ? String(r.amount) : null),
    tx_hash: str(r.tx_hash),
    at,
    turn_id: str(r.turn_id),
    detail: str(r.detail) ?? (typeof r.version === "number" ? `v${r.version}` : null),
  };
}

export async function getTimeline(petRef: string, init?: RequestInit): Promise<TimelineItem[]> {
  const body = await json<unknown>(await fetch(`${pet(petRef)}/timeline`, init));
  const list = Array.isArray(body) ? body : (obj(body).items as unknown[] | undefined) ?? [];
  return list.map(normalizeTimeline).filter((t): t is TimelineItem => t !== null);
}

export interface AttestationSummary {
  model: string;
  fetched_at: number | null;
  ok: boolean;
  nras: string | null;
  signers: string[];
  gateway_signer: string | null;
}

export function normalizeAttestation(body: unknown): AttestationSummary[] {
  const list: unknown[] = Array.isArray(body)
    ? body
    : Array.isArray(obj(body).models)
      ? (obj(body).models as unknown[])
      : Object.entries(obj(body)).map(([model, v]) => ({ model, ...obj(v) }));
  return list
    .map((raw) => {
      const r = obj(raw);
      const model = str(r.model);
      if (!model) return null;
      const signers = Array.isArray(r.model_signers) ? r.model_signers.filter((s): s is string => typeof s === "string") : [];
      const nras = typeof r.nras === "string" ? r.nras : r.nras ? "pass" : null;
      return {
        model,
        fetched_at: typeof r.fetched_at === "number" ? r.fetched_at : null,
        // brain: { models: [{ model, fetched_at, fresh, nras: "pass"|"fail", ... }] }
        ok: r.ok === true || r.ok === 1 || (nras === "pass" && r.fresh !== false),
        nras,
        signers,
        gateway_signer: str(r.gateway_signer),
      };
    })
    .filter((a): a is AttestationSummary => a !== null);
}

export async function getAttestation(init?: RequestInit): Promise<AttestationSummary[]> {
  return normalizeAttestation(await json<unknown>(await fetch(`${BRAIN_URL}/attestation`, init)));
}

// ---------- helpers for the UI ----------

export const shortHash = (h: string) => (h.length > 12 ? `${h.slice(0, 6)}..${h.slice(-4)}` : h);

export function minutesAgo(ms: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - ms) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/** Friendly copy for brain error codes (05 section 5). */
export function errorCopy(code: string, name: string): string {
  switch (code) {
    case "rate_limited": return `${name} is still thinking. One sec.`;
    case "brain_resting": return `${name}'s brain is resting for today. Care still works.`;
    case "bad_audio": return "I couldn't hear that. Try again a little closer.";
    case "not_owner": return `Only ${name}'s owner can do that.`;
    case "unauthorized": return "Your session ended. Connect your wallet again.";
    case "expired": return "This code has expired.";
    default: return `${name}'s brain got tangled. Try again?`;
  }
}
