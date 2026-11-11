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
});
