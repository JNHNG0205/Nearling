import type { Config } from "../config";
import { log } from "../log";

/**
 * NEAR AI Cloud client (AI-brain 03 section 5). Raw fetch, not the OpenAI SDK: verification needs
 * the exact request bytes we sent and the exact response bytes we got (`rawRequest`, `rawResponse`).
 * Never log message content; ids, statuses, tokens and timings only.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  text: string;
  model: string;
  /** Response `id`, used for `GET /signature/{chat_id}`. */
  chatId: string;
  /** `inference-id` response header, used for billing reconciliation. */
  inferenceId: string | null;
  rawRequest: string;
  rawResponse: string;
  usage: { prompt_tokens: number; completion_tokens: number };
  ms: number;
}

export interface ModelPrice {
  /** nano-USD per token */
  inputNano: number;
  outputNano: number;
  /** `metadata.verifiable`; null when the list did not say */
  verifiable: boolean | null;
}

export type NearAiErrorKind = "resting" | "rate_limited" | "upstream" | "not_verifiable" | "not_configured";

export class NearAiError extends Error {
  constructor(
    public kind: NearAiErrorKind,
    public status?: number,
  ) {
    super(`nearai_${kind}${status ? `_${status}` : ""}`);
    this.name = "NearAiError";
  }
}

export interface NearAi {
  chat(messages: ChatMessage[], opts?: { model?: string; maxTokens?: number; temperature?: number }): Promise<ChatResult>;
  transcribe(audio: Uint8Array, mime: string): Promise<{ text: string; ms: number }>;
  modelPrices(): Promise<Map<string, ModelPrice>>;
  /** Price of the model, or null if unknown. Throws `not_verifiable` if the list marks it not verifiable. */
  checkModel(model: string): Promise<ModelPrice | null>;
}

type Fetch = typeof fetch;

const PRICE_TTL_MS = 3600_000;
const CHAT_TIMEOUT_MS = 20_000;
const STT_TIMEOUT_MS = 15_000;

export function costNano(usage: ChatResult["usage"], price: ModelPrice | null): number | null {
  if (!price) return null;
  return Math.round(usage.prompt_tokens * price.inputNano + usage.completion_tokens * price.outputNano);
}

/** `{ amount, scale }` means amount / 10^scale USD per token; returns nano-USD per token. */
function nanoPerToken(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    const o = v as { amount?: unknown; scale?: unknown };
    const amount = Number(o.amount ?? 0);
    const scale = Number(o.scale ?? 9);
    if (Number.isFinite(amount) && Number.isFinite(scale)) return amount * 10 ** (9 - scale);
  }
  return 0;
}

/** Defensive parse of `GET /model/list` [VERIFY S1 against staging]. */
export function parseModelList(json: unknown): Map<string, ModelPrice> {
  const out = new Map<string, ModelPrice>();
  const root = json as { models?: unknown[]; data?: unknown[] } | unknown[];
  const list = Array.isArray(root) ? root : (root?.models ?? root?.data ?? []);
  for (const m of list as Record<string, unknown>[]) {
    const id = (m.modelId ?? m.model_id ?? m.id) as string | undefined;
    if (!id) continue;
    const meta = (m.metadata ?? {}) as { verifiable?: unknown };
    out.set(id, {
      inputNano: nanoPerToken(m.inputCostPerToken),
      outputNano: nanoPerToken(m.outputCostPerToken),
      verifiable: typeof meta.verifiable === "boolean" ? meta.verifiable : null,
    });
  }
  return out;
}

export function createNearAi(
  cfg: Pick<Config, "NEARAI_BASE_URL" | "NEARAI_API_KEY" | "NEARAI_CHAT_MODEL" | "NEARAI_STT_MODEL">,
  opts: { fetch?: Fetch; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): NearAi {
  const f = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const base = cfg.NEARAI_BASE_URL.replace(/\/$/, "");
  let prices: { at: number; value: Map<string, ModelPrice> } | null = null;
  const warnedUnknown = new Set<string>();

  const auth = () => {
    if (!cfg.NEARAI_API_KEY) throw new NearAiError("not_configured");
    return `Bearer ${cfg.NEARAI_API_KEY}`;
  };

  /** One retry on 429 after 1 s; 402 / "Out of credit" means the whole brain is resting. */
  async function send(make: () => Promise<Response>): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await make();
      } catch {
        throw new NearAiError("upstream");
      }
      if (res.status === 429 && attempt === 0) {
        await res.body?.cancel().catch(() => undefined);
        await sleep(1000);
        continue;
      }
      if (res.ok) return res;
      const errText = await res.text().catch(() => "");
      if (res.status === 402 || /out of credit/i.test(errText)) throw new NearAiError("resting", res.status);
      if (res.status === 429) throw new NearAiError("rate_limited", 429);
      throw new NearAiError("upstream", res.status);
    }
  }

  const client: NearAi = {
    async chat(messages, o = {}) {
      const model = o.model ?? cfg.NEARAI_CHAT_MODEL;
      // Built once: these exact bytes are what the TEE signs over.
      const rawRequest = JSON.stringify({
        model,
        messages,
        max_tokens: o.maxTokens ?? 160,
        temperature: o.temperature ?? 0.8,
      });
      const headers = {
        Authorization: auth(),
        "Content-Type": "application/json",
        "Accept-Encoding": "identity",
        "x-no-aliasing": "true",
      };
      const t0 = now();
      const res = await send(() =>
        f(`${base}/chat/completions`, { method: "POST", headers, body: rawRequest, signal: AbortSignal.timeout(CHAT_TIMEOUT_MS) }),
      );
      const rawResponse = await res.text();
      const ms = now() - t0;
      let json: {
        id?: string;
        model?: string;
        choices?: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      try {
        json = JSON.parse(rawResponse);
      } catch {
        throw new NearAiError("upstream", res.status);
      }
      const text = json.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim() || !json.id) throw new NearAiError("upstream", res.status);
      return {
        text,
        model,
        chatId: json.id,
        inferenceId: res.headers.get("inference-id") ?? res.headers.get("x-inference-id"),
        rawRequest,
        rawResponse,
        usage: { prompt_tokens: json.usage?.prompt_tokens ?? 0, completion_tokens: json.usage?.completion_tokens ?? 0 },
        ms,
      };
    },

    async transcribe(audio, mime) {
      const form = new FormData();
      const ext = mime.includes("webm") ? "webm" : "wav";
      form.append("file", new Blob([audio], { type: mime }), `audio.${ext}`);
      form.append("model", cfg.NEARAI_STT_MODEL);
      form.append("language", "en");
      form.append("response_format", "json");
      const t0 = now();
      const res = await send(() =>
        f(`${base}/audio/transcriptions`, {
          method: "POST",
          headers: { Authorization: auth(), "Accept-Encoding": "identity" },
          body: form,
          signal: AbortSignal.timeout(STT_TIMEOUT_MS),
        }),
      );
      const raw = await res.text();
      try {
        const json = JSON.parse(raw) as { text?: unknown };
        return { text: typeof json.text === "string" ? json.text.trim() : "", ms: now() - t0 };
      } catch {
        throw new NearAiError("upstream", res.status);
      }
    },

    async modelPrices() {
      if (prices && now() - prices.at < PRICE_TTL_MS) return prices.value;
      const res = await send(() =>
        f(`${base}/model/list`, { headers: { Authorization: auth(), "Accept-Encoding": "identity" }, signal: AbortSignal.timeout(10_000) }),
      );
      const value = parseModelList(JSON.parse(await res.text()));
      prices = { at: now(), value };
      return value;
    },

    async checkModel(model) {
      let list: Map<string, ModelPrice>;
      try {
        list = await client.modelPrices();
      } catch (err) {
        if (err instanceof NearAiError && err.kind === "not_configured") throw err;
        log.warn("nearai model list unavailable", { model, error: err instanceof NearAiError ? err.message : "fetch" });
        return null;
      }
      const p = list.get(model) ?? null;
      if (p?.verifiable === false) throw new NearAiError("not_verifiable");
      if (!p && !warnedUnknown.has(model)) {
        warnedUnknown.add(model);
        log.warn("nearai model not in model list; cost unknown", { model });
      }
      return p;
    },
  };
  return client;
}

/**
 * Fake inference for tests only (MOCK_AI=1, CLAUDE.md rule 5). Never the demo path:
 * server.ts logs a warning when it is on, and every reply says it is a mock.
 */
export function createMockNearAi(): NearAi {
  let n = 0;
  return {
    async chat(messages, o = {}) {
      n++;
      const rawRequest = JSON.stringify({ model: o.model ?? "mock", messages });
      const rawResponse = JSON.stringify({ id: `mock-chat-${n}`, choices: [{ message: { content: "[happy] (mock reply, simulated)" } }] });
      const summary = messages[0]?.content.startsWith("You summarise");
      return {
        text: summary ? '{"summary":"(mock summary)","facts":[]}' : "[happy] (mock reply, simulated)",
        model: o.model ?? "mock",
        chatId: `mock-chat-${n}`,
        inferenceId: `mock-inf-${n}`,
        rawRequest,
        rawResponse,
        usage: { prompt_tokens: 0, completion_tokens: 0 },
        ms: 0,
      };
    },
    async transcribe() {
      return { text: "hello (mock transcript)", ms: 0 };
    },
    async modelPrices() {
      return new Map();
    },
    async checkModel() {
      return null;
    },
  };
}
