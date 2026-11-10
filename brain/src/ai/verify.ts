import { createHash } from "node:crypto";
import { verifyMessage } from "ethers";
import type { Deps } from "../deps";
import { publish } from "../events";
import { log } from "../log";
import { type Attestation, ensureAttestation, getVerifyIo } from "./attestation";

/**
 * Hook between the talk pipeline and TEE verification (AI-brain 03 section 7).
 * The talk area calls `submitForVerification` right after a completion, with the exact bytes
 * sent and received; the verification area implements it (hash, fetch signature, check
 * against attestation, store the result, publish `receipt_ready`). Bytes must not be stored.
 */
export interface VerificationInput {
  turnId: string;
  petRef: string;
  model: string;
  chatId: string;
  rawRequest: string;
  rawResponse: string;
}

export type VerifyStatus = "pending" | "model_verified" | "gateway_verified" | "unverified";

const SIGNATURE_TRIES = 10;
const SIGNATURE_RETRY_MS = 1000;

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Work still running, so tests (and a graceful shutdown) can wait for it. */
const inflight = new Set<Promise<void>>();

export async function settleVerifications(): Promise<void> {
  while (inflight.size) await Promise.all([...inflight]);
}

/**
 * Hashes the bytes at once (they are not kept past this call), stores a `pending` row, then
 * verifies in the background and publishes `receipt_ready { turn_id, status }`.
 */
export function submitForVerification(deps: Deps, input: VerificationInput): void {
  const job: Job = {
    turnId: input.turnId,
    petRef: input.petRef,
    model: input.model,
    chatId: input.chatId,
    reqHash: sha256(input.rawRequest),
    respHash: sha256(input.rawResponse),
  };
  const now = deps.now();
  deps.db
    .prepare(
      `INSERT INTO verification (turn_id, pet_ref, model, status, req_hash, resp_hash, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
       ON CONFLICT (turn_id) DO UPDATE SET status = 'pending', req_hash = excluded.req_hash,
         resp_hash = excluded.resp_hash, model = excluded.model, updated_at = excluded.updated_at`,
    )
    .run(job.turnId, job.petRef, job.model, job.reqHash, job.respHash, now, now);
  const p = run(deps, job).finally(() => inflight.delete(p));
  inflight.add(p);
}

interface Job {
  turnId: string;
  petRef: string;
  model: string;
  chatId: string;
  reqHash: string;
  respHash: string;
}

export interface Outcome {
  status: Exclude<VerifyStatus, "pending">;
  kind: "provider_tee" | "gateway" | null;
  signer: string | null;
  attestationId: string | null;
  reason: string | null;
}

async function run(deps: Deps, job: Job): Promise<void> {
  let out: Outcome;
  try {
    out = await verify(deps, job);
  } catch {
    out = { status: "unverified", kind: null, signer: null, attestationId: null, reason: "verification error" };
  }
  deps.db
    .prepare(
      `UPDATE verification SET status = ?, signature_kind = ?, signer = ?, attestation_id = ?, reason = ?, updated_at = ?
       WHERE turn_id = ?`,
    )
    .run(out.status, out.kind, out.signer, out.attestationId, out.reason, deps.now(), job.turnId);
  log.info("verification done", { turn_id: job.turnId, status: out.status, kind: out.kind, reason: out.reason });
  publish(job.petRef, "receipt_ready", { turn_id: job.turnId, status: out.status });
}

interface SignatureBody {
  text?: string;
  signature?: string;
  signing_address?: string;
  signing_algo?: string;
  signature_kind?: string;
  error_code?: string;
}

async function verify(deps: Deps, job: Job): Promise<Outcome> {
  const fail = (reason: string, extra: Partial<Outcome> = {}): Outcome => ({
    status: "unverified", kind: null, signer: null, attestationId: null, reason, ...extra,
  });
  const att: Attestation = await ensureAttestation(deps, job.model);
  const sig = await fetchSignature(deps, job);
  if (typeof sig === "string") return fail(sig, { attestationId: att.id });
  if (typeof sig.text !== "string" || typeof sig.signature !== "string") {
    return fail("signature response incomplete", { attestationId: att.id });
  }

  // Legacy signatures have no signature_kind; infer from the text (3 parts = model TEE).
  const kind: "provider_tee" | "gateway" =
    sig.signature_kind === "provider_tee" || sig.signature_kind === "gateway"
      ? sig.signature_kind
      : sig.text.split(":").length === 3 ? "provider_tee" : "gateway";
  const expectedText = kind === "provider_tee" ? `${job.model}:${job.reqHash}:${job.respHash}` : `${job.reqHash}:${job.respHash}`;

  let signer: string;
  try {
    signer = verifyMessage(sig.text, sig.signature).toLowerCase(); // EIP-191 personal_sign recovery
  } catch {
    return fail("bad signature", { kind, attestationId: att.id });
  }
  const base = { kind, signer, attestationId: att.id };
  if (sig.text !== expectedText) return fail("signed hashes do not match this exchange", base);

  if (kind === "provider_tee") {
    if (!att.ok) return fail(`attestation not verified: ${att.reason ?? "unknown"}`, base);
    const matches = att.modelSigners.filter((a) => a === signer).length;
    if (matches !== 1) return fail("signer is not an attested model key", base);
    return { status: "model_verified", ...base, reason: null };
  }
  if (!att.gatewaySigner) return fail(`no attested gateway key: ${att.reason ?? "unknown"}`, base);
  if (signer !== att.gatewaySigner) return fail("signer is not the attested gateway key", base);
  return { status: "gateway_verified", ...base, reason: null };
}

/** The signature body, or a reason string if it is unavailable. Retries 404 (and 2xx errors) 10 x 1 s. */
async function fetchSignature(deps: Deps, job: Job): Promise<SignatureBody | string> {
  if (!deps.cfg.NEARAI_API_KEY) return "no NEAR AI API key";
  const io = getVerifyIo();
  const qs = new URLSearchParams({ model: job.model, signing_algo: "ecdsa" });
  const url = `${deps.cfg.NEARAI_BASE_URL}/signature/${encodeURIComponent(job.chatId)}?${qs}`;
  let reason = "signature unavailable";
  for (let attempt = 1; attempt <= SIGNATURE_TRIES; attempt++) {
    if (attempt > 1) await io.sleep(SIGNATURE_RETRY_MS);
    let res: Response;
    try {
      res = await io.fetch(url, {
        headers: { accept: "application/json", Authorization: `Bearer ${deps.cfg.NEARAI_API_KEY}` },
      });
    } catch {
      return "signature fetch failed";
    }
    if (res.status === 404) {
      reason = "signature not found";
      continue;
    }
    if (!res.ok) return `signature http ${res.status}`;
    let body: SignatureBody;
    try {
      body = (await res.json()) as SignatureBody;
    } catch {
      return "signature response not json";
    }
    if (body.error_code) {
      // 2xx with an error (e.g. chat id not cached on this node yet): unavailable, try again.
      reason = "signature unavailable";
      continue;
    }
    return body;
  }
  return reason;
}
