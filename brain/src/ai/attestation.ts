import { randomBytes, randomUUID } from "node:crypto";
import { decodeJwt } from "jose";
import type { Deps } from "../deps";
import { log } from "../log";

/**
 * Attestation cache (AI-brain 03 section 7, conceptual/01 section 2.3).
 * Per model: fresh 32-byte nonce -> `GET {base}/attestation/report` -> nonce echoed ->
 * each `nvidia_payload` checked by NVIDIA NRAS -> signing addresses that passed are stored.
 *
 * Honest limits, shown in the receipt panel:
 * - The NRAS JWT is decoded, not signature-checked, in the app (we trust the TLS connection to
 *   NVIDIA, as the official example does).
 * - The Intel TDX quote is not checked in the app (`tdx: "not checked in app"`).
 * - The gateway signer comes from the report's `gateway_attestation`; its quote is not checked either.
 */

export const NRAS_URL = "https://nras.attestation.nvidia.com/v3/attest/gpu";
export const ATTESTATION_TTL_MS = 30 * 60 * 1000;
/** After a failed refresh, wait this long before trying again on demand. */
const FAILED_RETRY_MS = 60 * 1000;

/** Network and timing, injectable so tests run on fixtures. */
export interface VerifyIo {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

const defaultIo: VerifyIo = {
  fetch: (...a) => fetch(...a),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};
let io: VerifyIo = defaultIo;

export function getVerifyIo(): VerifyIo {
  return io;
}

/** Tests only: swap fetch and sleep. Pass nothing to restore the real ones. */
export function setVerifyIo(next?: Partial<VerifyIo>): void {
  io = { ...defaultIo, ...next };
}

export interface NrasResult {
  signer: string | null;
  pass: boolean;
  reason?: string;
}

export interface AttestationRow {
  id: string;
  model: string;
  nonce: string;
  fetched_at: number;
  ok: number;
  model_signers: string;
  gateway_signer: string | null;
  nras: string;
  tdx: string;
  reason: string | null;
}

export interface Attestation {
  id: string;
  model: string;
  fetchedAt: number;
  ok: boolean;
  modelSigners: string[];
  gatewaySigner: string | null;
  nras: NrasResult[];
  reason: string | null;
}

export function toAttestation(r: AttestationRow): Attestation {
  return {
    id: r.id,
    model: r.model,
    fetchedAt: r.fetched_at,
    ok: r.ok === 1,
    modelSigners: JSON.parse(r.model_signers) as string[],
    gatewaySigner: r.gateway_signer,
    nras: JSON.parse(r.nras) as NrasResult[],
    reason: r.reason,
  };
}

export function latestAttestation(deps: Deps, model: string): Attestation | null {
  const row = deps.db
    .prepare("SELECT * FROM attestation WHERE model = ? ORDER BY fetched_at DESC, rowid DESC LIMIT 1")
    .get(model) as AttestationRow | undefined;
  return row ? toAttestation(row) : null;
}

/** Cached attestation for the model, refreshed when older than 30 min (or 1 min after a failure). */
export async function ensureAttestation(deps: Deps, model: string): Promise<Attestation> {
  const last = latestAttestation(deps, model);
  const age = last ? deps.now() - last.fetchedAt : Infinity;
  if (last && age < (last.ok ? ATTESTATION_TTL_MS : FAILED_RETRY_MS)) return last;
  return refreshAttestation(deps, model);
}

interface ModelAttestation {
  signing_address?: string;
  nvidia_payload?: unknown;
  request_nonce?: string;
}
interface Report {
  request_nonce?: string;
  model_attestations?: ModelAttestation[];
  gateway_attestation?: { signing_address?: string; request_nonce?: string };
}

const lower = (s: string) => s.toLowerCase();

/** Fetch, check and store a new attestation. Never throws: failures become an `ok = 0` row. */
export async function refreshAttestation(deps: Deps, model: string): Promise<Attestation> {
  const nonce = randomBytes(32).toString("hex");
  const row: AttestationRow = {
    id: randomUUID(),
    model,
    nonce,
    fetched_at: deps.now(),
    ok: 0,
    model_signers: "[]",
    gateway_signer: null,
    nras: "[]",
    tdx: "not checked in app",
    reason: null,
  };
  try {
    const report = await fetchReport(deps, model, nonce);
    const echoes = [report.request_nonce, report.gateway_attestation?.request_nonce]
      .concat((report.model_attestations ?? []).map((m) => m.request_nonce))
      .filter((n): n is string => typeof n === "string");
    if (echoes.length === 0 || echoes.some((n) => lower(n) !== nonce)) {
      row.reason = "nonce not echoed";
    } else {
      const gw = report.gateway_attestation?.signing_address;
      row.gateway_signer = gw ? lower(gw) : null;
      const results: NrasResult[] = [];
      for (const ma of report.model_attestations ?? []) results.push(await checkGpu(ma, nonce));
      const signers = [...new Set(results.filter((r) => r.pass && r.signer).map((r) => r.signer as string))];
      row.nras = JSON.stringify(results);
      row.model_signers = JSON.stringify(signers);
      row.ok = signers.length > 0 ? 1 : 0;
      if (!row.ok) row.reason = results.length ? "no model attestation passed NRAS" : "no model attestations";
    }
  } catch (e) {
    row.reason = e instanceof Error ? e.message.slice(0, 200) : "attestation failed";
  }
  deps.db
    .prepare(
      `INSERT INTO attestation (id, model, nonce, fetched_at, ok, model_signers, gateway_signer, nras, tdx, reason)
       VALUES (@id, @model, @nonce, @fetched_at, @ok, @model_signers, @gateway_signer, @nras, @tdx, @reason)`,
    )
    .run(row);
  const fn = row.ok ? log.info : log.warn;
  fn("attestation refreshed", { model, attestation_id: row.id, ok: row.ok === 1, reason: row.reason });
  return toAttestation(row);
}

async function fetchReport(deps: Deps, model: string, nonce: string): Promise<Report> {
  if (!deps.cfg.NEARAI_API_KEY) throw new Error("no NEAR AI API key");
  const qs = new URLSearchParams({ model, signing_algo: "ecdsa", nonce });
  const res = await io.fetch(`${deps.cfg.NEARAI_BASE_URL}/attestation/report?${qs}`, {
    headers: { accept: "application/json", Authorization: `Bearer ${deps.cfg.NEARAI_API_KEY}` },
  });
  if (!res.ok) throw new Error(`attestation report http ${res.status}`);
  return (await res.json()) as Report;
}

/** NRAS check of one model attestation: overall result true and eat_nonce == our nonce. */
async function checkGpu(ma: ModelAttestation, nonce: string): Promise<NrasResult> {
  const signer = ma.signing_address ? lower(ma.signing_address) : null;
  if (!signer) return { signer, pass: false, reason: "no signing address" };
  if (ma.nvidia_payload === undefined) return { signer, pass: false, reason: "no nvidia payload" };
  try {
    const body = typeof ma.nvidia_payload === "string" ? ma.nvidia_payload : JSON.stringify(ma.nvidia_payload);
    const res = await io.fetch(NRAS_URL, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body,
    });
    if (!res.ok) return { signer, pass: false, reason: `nras http ${res.status}` };
    const out = (await res.json()) as unknown;
    // Shape: [["JWT", "<overall>"], { "GPU-0": "<jwt>", ... }]. Decoded only (see file header).
    const first = Array.isArray(out) ? out[0] : null;
    const jwt = Array.isArray(first) && typeof first[1] === "string" ? first[1] : null;
    if (!jwt) return { signer, pass: false, reason: "nras response has no overall JWT" };
    const claims = decodeJwt(jwt) as Record<string, unknown>;
    if (claims["x-nvidia-overall-att-result"] !== true) return { signer, pass: false, reason: "nras overall result false" };
    if (typeof claims.eat_nonce !== "string" || lower(claims.eat_nonce) !== nonce) {
      return { signer, pass: false, reason: "nras nonce mismatch" };
    }
    return { signer, pass: true };
  } catch {
    return { signer, pass: false, reason: "nras check failed" };
  }
}

/** Models to keep warm: every model attested in the last 24 h. */
export function knownModels(deps: Deps): string[] {
  const since = deps.now() - 24 * 3600 * 1000;
  return (deps.db.prepare("SELECT DISTINCT model FROM attestation WHERE fetched_at > ?").all(since) as { model: string }[])
    .map((r) => r.model);
}
