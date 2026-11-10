/**
 * Spikes S1 / S2 (conceptual/07-plan-and-risks.md section 2) against the NEAR AI staging API.
 *
 *   NEARAI_API_KEY=... pnpm --filter brain exec tsx --env-file-if-exists=../.env scripts/spike-nearai.ts
 *   optional: SPIKE_MODELS="z-ai/glm-5.3-flash,openai/gpt-oss-120b" SPIKE_RUNS=20
 *
 * Prints latency p50 / p95, token usage, inference-id and chat id presence, billing costs,
 * attestation and signature availability, and whether json_schema output works.
 * Never prints chat content (CLAUDE.md rule 4): only ids, sizes, statuses, costs and timings.
 */
import { createHash, randomBytes } from "node:crypto";
import { costNano, createNearAi, type ChatMessage, type ChatResult } from "../src/ai/nearai";

const KEY = process.env.NEARAI_API_KEY;
if (!KEY) {
  console.log("spike-nearai: NEARAI_API_KEY is not set; nothing to do.");
  process.exit(0);
}
const BASE = (process.env.NEARAI_BASE_URL ?? "https://cloud-stg-api.near.ai/v1").replace(/\/$/, "");
const MODELS = (process.env.SPIKE_MODELS ?? "z-ai/glm-5.3-flash,openai/gpt-oss-120b").split(",").map((s) => s.trim()).filter(Boolean);
const RUNS = Number(process.env.SPIKE_RUNS ?? 20);
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const auth = { Authorization: `Bearer ${KEY}`, "Accept-Encoding": "identity" };

// About 800 tokens of persona, like a real talk prompt.
const persona = [
  "You are a Nearling, a friendly virtual pet. Be kind and suitable for children. Reply in at most 2 short sentences, starting with one tag like [happy].",
  ...Array.from({ length: 40 }, (_, i) => `Memory ${i}: the owner enjoys gardens, gentle music, puzzles and long walks on sunny afternoons.`),
].join("\n");
const messages: ChatMessage[] = [
  { role: "system", content: persona },
  { role: "user", content: "How are you today?" },
];

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? NaN;
};

async function getJson(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { ...auth, ...(init.headers as Record<string, string>) } });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json };
}

const keysOf = (j: unknown) => (j && typeof j === "object" ? Object.keys(j as object).join(",") : String(j));

async function main() {
  const ai = createNearAi({ NEARAI_BASE_URL: BASE, NEARAI_API_KEY: KEY, NEARAI_CHAT_MODEL: MODELS[0]!, NEARAI_STT_MODEL: "openai/whisper-large-v3" });
  const prices = await ai.modelPrices().catch((e) => (console.log("model/list failed:", (e as Error).message), new Map()));
  console.log(`model/list: ${prices.size} models`);

  for (const model of MODELS) {
    const price = prices.get(model) ?? null;
    console.log(`\n=== ${model} ===`);
    console.log("price nano/token:", price ? `in ${price.inputNano} out ${price.outputNano} verifiable ${price.verifiable}` : "not listed");
    const results: ChatResult[] = [];
    let errors = 0;
    for (let i = 0; i < RUNS; i++) {
      try {
        results.push(await ai.chat(messages, { model }));
      } catch (e) {
        errors++;
        console.log(`run ${i}: error ${(e as Error).message}`);
      }
    }
    if (!results.length) continue;
    const ms = results.map((r) => r.ms);
    const mean = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
    const reasoning = results.map((r) => {
      try {
        const u = (JSON.parse(r.rawResponse) as { usage?: { completion_tokens_details?: { reasoning_tokens?: number } } }).usage;
        return u?.completion_tokens_details?.reasoning_tokens ?? 0;
      } catch {
        return 0;
      }
    });
    const costs = results.map((r) => costNano(r.usage, price) ?? 0);
    console.log(`runs ok ${results.length}, errors ${errors}`);
    console.log(`latency ms p50 ${pct(ms, 50)} p95 ${pct(ms, 95)}`);
    console.log(`tokens mean in ${mean(results.map((r) => r.usage.prompt_tokens))} out ${mean(results.map((r) => r.usage.completion_tokens))} reasoning ${mean(reasoning)}`);
    console.log(`estimated cost per reply: $${(mean(costs) / 1e9).toFixed(7)}`);
    console.log(`inference-id header present: ${results.filter((r) => r.inferenceId).length}/${results.length}`);
    console.log(`reply starts with a tag: ${results.filter((r) => /^\s*\[\w+\]/.test(r.text)).length}/${results.length}`);

    console.log("waiting 10 s for billing...");
    await new Promise((r) => setTimeout(r, 10_000));
    const ids = results.map((r) => r.inferenceId).filter(Boolean);
    const billing = await getJson(`${BASE}/billing/costs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_ids: ids }),
    });
    console.log(`billing/costs: HTTP ${billing.status}, keys ${keysOf(billing.json)}`);
    if (billing.status === 200) console.log("billing body:", JSON.stringify(billing.json).slice(0, 600));

    const nonce = randomBytes(32).toString("hex");
    const att = await getJson(`${BASE}/attestation/report?model=${encodeURIComponent(model)}&signing_algo=ecdsa&nonce=${nonce}`);
    const report = att.json as { request_nonce?: string; model_attestations?: unknown[] } | null;
    console.log(`attestation: HTTP ${att.status}, nonce echoed ${report?.request_nonce === nonce}, model attestations ${report?.model_attestations?.length ?? 0}`);

    const first = results[0]!;
    const sig = await getJson(`${BASE}/signature/${encodeURIComponent(first.chatId)}?model=${encodeURIComponent(model)}&signing_algo=ecdsa`);
    const s = sig.json as { text?: string; signature?: string; signing_address?: string } | null;
    const reqH = sha(first.rawRequest);
    const resH = sha(first.rawResponse);
    console.log(`signature: HTTP ${sig.status}, keys ${keysOf(sig.json)}`);
    if (s?.text) {
      console.log(`  provider_tee form (model:req:resp) matches: ${s.text === `${model}:${reqH}:${resH}`}`);
      console.log(`  gateway form (req:resp) matches: ${s.text === `${reqH}:${resH}`}`);
      console.log(`  signer ${s.signing_address ?? "?"}`);
    }

    try {
      const body = JSON.stringify({
        model,
        messages,
        max_tokens: 160,
        response_format: {
          type: "json_schema",
          json_schema: { name: "reply", schema: { type: "object", properties: { emotion: { type: "string" }, reply: { type: "string" } }, required: ["emotion", "reply"] } },
        },
      });
      const res = await fetch(`${BASE}/chat/completions`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body });
      const raw = await res.text();
      let parsedOk = false;
      try {
        const content = (JSON.parse(raw) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
        parsedOk = typeof JSON.parse(content) === "object";
      } catch {
        parsedOk = false;
      }
      console.log(`json_schema: HTTP ${res.status}, valid JSON content ${parsedOk}`);
    } catch (e) {
      console.log("json_schema: error", (e as Error).message);
    }
  }
}

main().catch((e) => {
  console.error("spike failed:", (e as Error).message);
  process.exit(1);
});
