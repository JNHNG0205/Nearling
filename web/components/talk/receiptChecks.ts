import { minutesAgo, shortHash, type Receipt } from "@/lib/brain";

export type Check = { state: "ok" | "fail" | "not_checked"; text: string };

/** What the receipt proves and what it does not (03-pages section 5, AI-brain 03 section 7). */
export function receiptChecks(r: Receipt, now = Date.now()): Check[] {
  const v = r.verification;
  const att = v.attestation;
  const checks: Check[] = [];
  if (att?.nras === "pass") {
    checks.push({ state: "ok", text: `GPU attestation (NVIDIA), fresh nonce${att.fetched_at != null ? `,${minutesAgo(att.fetched_at, now)}` : ""}` });
  } else {
    checks.push({ state: "fail", text: "GPU attestation (NVIDIA): no fresh passing report for this reply" });
  }
  if (v.status === "model_verified") {
    checks.push({ state: "ok", text: `Reply signed inside the TEE by ${v.signer ? shortHash(v.signer) : "the model key"}` });
  } else if (v.status === "gateway_verified") {
    checks.push({ state: "ok", text: `Reply signed by the NEAR AI gateway${v.signer ? ` ${shortHash(v.signer)}` : ""}, not by the model's own key` });
  } else if (v.status === "pending") {
    checks.push({ state: "not_checked", text: "Signature: still checking" });
  } else {
    checks.push({ state: "fail", text: `Signature did not check out${v.reason ? `: ${v.reason}` : ""}` });
  }
  if (v.req_hash && v.resp_hash && (v.status === "model_verified" || v.status === "gateway_verified")) {
    checks.push({ state: "ok", text: `Signature covers request hash ${shortHash(v.req_hash)} and response hash ${shortHash(v.resp_hash)}` });
  }
  checks.push({ state: "not_checked", text: `Intel TDX quote: ${att?.tdx ?? "not checked in app"}` });
  checks.push({ state: "not_checked", text: "The prompt and reply bytes are not kept, only their hashes" });
  return checks;
}
