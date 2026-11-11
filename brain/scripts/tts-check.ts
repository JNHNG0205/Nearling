/**
 * Live check of ElevenLabs TTS (ai/tts.ts): one short synth, the WAV header, and the credits call.
 *   pnpm --filter brain exec tsx --env-file-if-exists=../.env scripts/tts-check.ts [out.wav]
 * Costs about 40 characters of credit per run. Prints sizes, header fields and credits only.
 */
import { writeFileSync } from "node:fs";
import { createTts } from "../src/ai/tts";

if (!process.env.TTS_API_KEY || !process.env.TTS_VOICE_ID) {
  console.log("tts-check: TTS_API_KEY or TTS_VOICE_ID not set; nothing to do.");
  process.exit(0);
}
const tts = createTts({
  TTS_PROVIDER: "elevenlabs",
  TTS_MODEL: process.env.TTS_MODEL || "eleven_flash_v2_5",
  TTS_API_KEY: process.env.TTS_API_KEY,
  TTS_BASE_URL: "",
});
if (!tts?.credits) throw new Error("no elevenlabs provider");

const before = await tts.credits();
console.log(`credits before: ${before}`);
const t0 = Date.now();
const { mime, bytes } = await tts.synth("Hello! I am your Nearling. Nice to meet you.", process.env.TTS_VOICE_ID);
const ms = Date.now() - t0;
const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const tag = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4));
const rate = v.getUint32(24, true);
const dataLen = v.getUint32(40, true);
console.log(
  `synth ${ms} ms, ${mime}, ${bytes.length} bytes, header ${tag(0)}/${tag(8)}/${tag(12)}/${tag(36)}, ` +
    `format ${v.getUint16(20, true)}, channels ${v.getUint16(22, true)}, rate ${rate}, bits ${v.getUint16(34, true)}, ` +
    `riff size ok ${v.getUint32(4, true) === bytes.length - 8}, duration ${(dataLen / (rate * 2)).toFixed(2)} s`,
);
if (process.argv[2]) writeFileSync(process.argv[2], bytes);
console.log(`credits after: ${await tts.credits()}`);
