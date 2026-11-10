import type { Config } from "../config";

/**
 * Text to speech (AI-brain 03 section 6). ElevenLabs Flash v2.5 by default when enabled, Kokoro
 * as a self-hosted fallback, `none` for text only. Output is WAV so the ESP32 plays it without an
 * MP3 decoder. A TTS failure never fails a turn (the caller catches).
 */
export interface TtsProvider {
  name: "elevenlabs" | "kokoro";
  synth(text: string, voice: string): Promise<{ mime: string; bytes: Uint8Array }>;
  /** Remaining provider credits, or null if the provider does not report them. */
  credits?(): Promise<number | null>;
}

/** Never voice more than this many characters (credit budget). */
export const TTS_MAX_CHARS = 200;

type Fetch = typeof fetch;

/** Wraps raw signed 16-bit little-endian mono PCM in a 44-byte WAV header. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 16_000): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/** Cuts text to the voice cap at a sentence or word boundary. */
export function clipForVoice(text: string, max = TTS_MAX_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (sentence > max / 2) return cut.slice(0, sentence + 1);
  const space = cut.lastIndexOf(" ");
  return space > 0 ? cut.slice(0, space) : cut;
}

export function createTts(
  cfg: Pick<Config, "TTS_PROVIDER" | "TTS_MODEL" | "TTS_API_KEY" | "TTS_BASE_URL">,
  f: Fetch = fetch,
): TtsProvider | null {
  if (cfg.TTS_PROVIDER === "elevenlabs") {
    if (!cfg.TTS_API_KEY) return null;
    const key = cfg.TTS_API_KEY;
    return {
      name: "elevenlabs",
      async synth(text, voice) {
        const res = await f(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=pcm_16000`,
          {
            method: "POST",
            headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/pcm" },
            body: JSON.stringify({ text, model_id: cfg.TTS_MODEL }),
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!res.ok) throw new Error(`tts_${res.status}`);
        return { mime: "audio/wav", bytes: pcmToWav(new Uint8Array(await res.arrayBuffer()), 16_000) };
      },
      async credits() {
        const res = await f("https://api.elevenlabs.io/v1/user/subscription", {
          headers: { "xi-api-key": key },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return null;
        const j = (await res.json()) as { character_count?: number; character_limit?: number };
        if (typeof j.character_count !== "number" || typeof j.character_limit !== "number") return null;
        return j.character_limit - j.character_count;
      },
    };
  }
  if (cfg.TTS_PROVIDER === "kokoro") {
    const base = cfg.TTS_BASE_URL.replace(/\/$/, "");
    return {
      name: "kokoro",
      async synth(text, voice) {
        // Kokoro-FastAPI, OpenAI-compatible speech route.
        const res = await f(`${base}/audio/speech`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "kokoro", input: text, voice: voice || "af_heart", response_format: "wav" }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`tts_${res.status}`);
        return { mime: "audio/wav", bytes: new Uint8Array(await res.arrayBuffer()) };
      },
    };
  }
  return null;
}
