import { describe, expect, it, vi } from "vitest";
import { createNearAi, NearAiError, parseModelList } from "./nearai";

const CFG = {
  NEARAI_BASE_URL: "https://ai.test/v1",
  NEARAI_API_KEY: "k",
  NEARAI_CHAT_MODEL: "z-ai/glm-5.3-flash",
  NEARAI_STT_MODEL: "openai/whisper-large-v3",
};

const RAW = '{"id":"chatcmpl-1","choices":[{"message":{"content":"[happy] hi"}}],"usage":{"prompt_tokens":10,"completion_tokens":2}}';

describe("nearai client", () => {
  it("sends the exact body once with the required headers and keeps raw bytes", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const f = vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(RAW, { status: 200, headers: { "inference-id": "inf-9" } });
    });
    const ai = createNearAi(CFG, { fetch: f as unknown as typeof fetch });
    const r = await ai.chat([{ role: "user", content: "hello" }]);
    const h = seen[0]!.init.headers as Record<string, string>;
    expect(seen[0]!.url).toBe("https://ai.test/v1/chat/completions");
    expect(h["Accept-Encoding"]).toBe("identity");
    expect(h["x-no-aliasing"]).toBe("true");
    expect(h.Authorization).toBe("Bearer k");
    expect(seen[0]!.init.body).toBe(r.rawRequest);
    expect(r.rawResponse).toBe(RAW);
    expect(r).toMatchObject({ text: "[happy] hi", chatId: "chatcmpl-1", inferenceId: "inf-9", usage: { prompt_tokens: 10, completion_tokens: 2 } });
  });

  it("maps 402 to resting and retries a 429 once", async () => {
    const ai402 = createNearAi(CFG, { fetch: (async () => new Response("Out of credit", { status: 402 })) as unknown as typeof fetch });
    await expect(ai402.chat([])).rejects.toMatchObject({ kind: "resting" });

    let n = 0;
    const sleeps: number[] = [];
    const ai429 = createNearAi(CFG, {
      fetch: (async () => (++n === 1 ? new Response("slow down", { status: 429 }) : new Response(RAW))) as unknown as typeof fetch,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect((await ai429.chat([])).chatId).toBe("chatcmpl-1");
    expect(sleeps).toEqual([1000]);

    const always429 = createNearAi(CFG, { fetch: (async () => new Response("", { status: 429 })) as unknown as typeof fetch, sleep: async () => undefined });
    await expect(always429.chat([])).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("refuses to run without an API key", async () => {
    const ai = createNearAi({ ...CFG, NEARAI_API_KEY: undefined }, { fetch: (async () => new Response(RAW)) as unknown as typeof fetch });
    await expect(ai.chat([])).rejects.toBeInstanceOf(NearAiError);
  });

  it("parses model prices (scale 9 = nano-USD) and refuses non-verifiable models", async () => {
    const list = {
      models: [
        { modelId: "z-ai/glm-5.3-flash", inputCostPerToken: { amount: 75, scale: 9 }, outputCostPerToken: { amount: 250, scale: 9 }, metadata: { verifiable: true } },
        { modelId: "open/model", inputCostPerToken: { amount: 1, scale: 6 }, outputCostPerToken: { amount: 2, scale: 6 }, metadata: { verifiable: false } },
      ],
    };
    expect(parseModelList(list).get("open/model")).toEqual({ inputNano: 1000, outputNano: 2000, verifiable: false });
    let calls = 0;
    const ai = createNearAi(CFG, { fetch: (async () => (calls++, new Response(JSON.stringify(list)))) as unknown as typeof fetch });
    expect(await ai.checkModel("z-ai/glm-5.3-flash")).toEqual({ inputNano: 75, outputNano: 250, verifiable: true });
    await expect(ai.checkModel("open/model")).rejects.toMatchObject({ kind: "not_verifiable" });
    expect(calls).toBe(1); // cached for an hour
  });

  it("transcribes via multipart with the whisper model", async () => {
    let form: FormData | null = null;
    const ai = createNearAi(CFG, {
      fetch: (async (_u: string, init: RequestInit) => {
        form = init.body as FormData;
        return new Response('{"text":" hello "}');
      }) as unknown as typeof fetch,
    });
    expect((await ai.transcribe(new Uint8Array([1, 2]), "audio/wav")).text).toBe("hello");
    expect(form!.get("model")).toBe("openai/whisper-large-v3");
    expect(form!.get("file")).toBeInstanceOf(Blob);
    expect((form!.get("file") as File).name).toBe("audio.wav");
    expect(form!.get("language")).toBe("en");
    await ai.transcribe(new Uint8Array([1]), "audio/mp4");
    expect((form!.get("file") as File).name).toBe("audio.m4a");
  });
});
