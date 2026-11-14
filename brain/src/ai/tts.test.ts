import { describe, expect, it } from "vitest";
import { createTts, pcmToWav } from "./tts";

const CFG = { TTS_PROVIDER: "elevenlabs" as const, TTS_MODEL: "eleven_flash_v2_5", TTS_API_KEY: "k", TTS_BASE_URL: "" };

describe("tts", () => {
  it("wraps 16 kHz PCM in a valid 44-byte WAV header", () => {
    const wav = pcmToWav(new Uint8Array(32_000));
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(v.getUint32(4, true)).toBe(wav.length - 8);
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint32(40, true)).toBe(32_000); // 1 s of 16-bit mono
  });

  it("names the ElevenLabs error code (free plans cannot use library voices)", async () => {
    const body = { detail: { code: "paid_plan_required", message: "Free users cannot use library voices via the API." } };
    const tts = createTts(CFG, (async () => new Response(JSON.stringify(body), { status: 402 })) as unknown as typeof fetch);
    await expect(tts!.synth("hi", "voice")).rejects.toThrow("tts_402_paid_plan_required");
  });

  it("calls Fish Audio with the voice model as reference_id and returns WAV", async () => {
    let req: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      req = { url, init };
      return new Response(new Uint8Array(3200), { status: 200 });
    }) as unknown as typeof fetch;
    const tts = createTts({ ...CFG, TTS_PROVIDER: "fishaudio", FISH_AUDIO_API_KEY: "fk", FISH_AUDIO_MODEL: "s1" }, f);
    const out = await tts!.synth("hello", "a3d61f39b5114be3bffb345159077528");
    expect(req!.url).toBe("https://api.fish.audio/v1/tts");
    expect(req!.init.headers).toMatchObject({ Authorization: "Bearer fk", model: "s1" });
    expect(JSON.parse(req!.init.body as string)).toMatchObject({ reference_id: "a3d61f39b5114be3bffb345159077528", format: "pcm", sample_rate: 16000 });
    expect(out.mime).toBe("audio/wav");
    expect(out.bytes.length).toBe(44 + 3200);
    expect(createTts({ ...CFG, TTS_PROVIDER: "fishaudio" })).toBeNull(); // no key, no voice
  });
});
