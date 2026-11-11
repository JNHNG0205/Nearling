/**
 * Live check of the attestation path (refreshAttestation) against NEAR AI staging and NVIDIA NRAS.
 *   pnpm --filter brain exec tsx --env-file-if-exists=../.env scripts/attest-check.ts [model ...]
 * Prints ok, signer counts, NRAS results and timing. The report endpoint is public; no key needed.
 */
import { refreshAttestation } from "../src/ai/attestation";
import { openDb } from "../src/db/db";
import type { Deps } from "../src/deps";

const models = process.argv.slice(2).length ? process.argv.slice(2) : ["z-ai/glm-5.3-flash", "openai/gpt-oss-120b"];
const deps = {
  cfg: {
    NEARAI_BASE_URL: (process.env.NEARAI_BASE_URL ?? "https://cloud-stg-api.near.ai/v1").replace(/\/$/, ""),
    NEARAI_API_KEY: process.env.NEARAI_API_KEY,
  },
  db: openDb(":memory:"),
  now: Date.now,
} as unknown as Deps;

for (const model of models) {
  const t0 = Date.now();
  const a = await refreshAttestation(deps, model);
  const nras = a.nras.map((r) => ({ pass: r.pass, reason: r.reason }));
  console.log(
    `${model}: ok ${a.ok} in ${Date.now() - t0} ms, model signers ${a.modelSigners.length}, ` +
      `gateway signer ${a.gatewaySigner ? "yes" : "no"}, nras ${JSON.stringify(nras)}, reason ${a.reason}`,
  );
}
