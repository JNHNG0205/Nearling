/**
 * Upload checks for hold-to-talk audio (AI-brain 03 section 4): device WAV (16 kHz mono 16-bit,
 * at most 12 s) or browser WEBM, both at most 1 MB. Bytes are passed to whisper and dropped.
 */
export const MAX_AUDIO_BYTES = 1024 * 1024;
export const MAX_WAV_SECONDS = 12;

export type AudioCheck = { ok: true; mime: "audio/wav" | "audio/webm"; seconds: number | null } | { ok: false; reason: string };

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

export function checkAudio(bytes: Uint8Array): AudioCheck {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > MAX_AUDIO_BYTES) return { ok: false, reason: "too_large" };

  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { ok: true, mime: "audio/webm", seconds: null };
  }

  if (bytes.length < 44 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    return { ok: false, reason: "not_wav_or_webm" };
  }
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 12;
  let byteRate = 0;
  let dataSize: number | null = null;
  while (off + 8 <= bytes.length) {
    const id = ascii(bytes, off, 4);
    const size = v.getUint32(off + 4, true);
    if (id === "fmt " && off + 16 <= bytes.length) {
      byteRate = v.getUint32(off + 16, true);
    } else if (id === "data") {
      const rest = bytes.length - (off + 8);
      // Streaming writers leave the size as 0 or 0xFFFFFFFF: use what actually arrived.
      dataSize = size === 0 || size > rest ? rest : size;
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (!byteRate || dataSize === null) return { ok: false, reason: "bad_wav_header" };
  const seconds = dataSize / byteRate;
  if (seconds > MAX_WAV_SECONDS + 0.5) return { ok: false, reason: "too_long" };
  return { ok: true, mime: "audio/wav", seconds };
}
