import type { Deps } from "../deps";

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

export function submitForVerification(_deps: Deps, _input: VerificationInput): void {
  // Implemented by the verification module. Until then every receipt stays "pending".
}
