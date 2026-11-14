import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { parsePetRef } from "@nearling/shared";
import { clipForVoice, createTts, type TtsProvider } from "../ai/tts";
import { requirePetAccess, type AuthEnv } from "../auth/guard";
import type { Deps, Module } from "../deps";
import { log } from "../log";
import { addSpend, overSpendCap } from "./spend";

/**
 * "Hear it" on the web (LIMITATIONS A4): the owner asks for the voice of one saved reply. The
 * reply is synthesised at most once while its clip lives (24 h, same as talk audio); later calls
 * return the same `audio_url`. Refused below the TTS credit floor or over the global spend cap.
 */

const AUDIO_TTL_MS = 24 * 3600_000;
/** Same floor as talk.ts: below this many provider credits, voice is off. */
export const TTS_CREDIT_FLOOR = 1_000;
const CREDITS_CHECK_MS = 10 * 60_000;

interface TurnRow {
  pet_ref: string;
  owner_account: string;
  status: string;
  reply_text_enc: Buffer | null;
  audio_key: string | null;
}

const err = (code: string, message: string) => ({ error: { code, message } });

export function createVoiceRoutes(deps: Deps, overrides: { tts?: TtsProvider | null } = {}) {
  const { cfg, db, sealer, now } = deps;
  const tts = overrides.tts !== undefined ? overrides.tts : createTts(cfg);
  const voiceId = cfg.TTS_VOICE_ID ?? "";
  const inFlight = new Map<string, Promise<string | null>>();
  let credits: { left: number | null; at: number } | null = null;

  async function belowFloor(): Promise<boolean> {
    if (!tts?.credits) return false;
    if (!credits || now() - credits.at > CREDITS_CHECK_MS) {
      const left = await tts.credits().catch(() => null);
      credits = { left, at: now() };
    }
    return credits.left !== null && credits.left < TTS_CREDIT_FLOOR;
  }

  const liveKey = (key: string | null) =>
    key && db.prepare("SELECT 1 FROM audio_blob WHERE key = ? AND expires_at > ?").get(key, now()) ? key : null;

  async function synth(turnId: string, petRef: string, enc: Buffer): Promise<string | null> {
    const text = clipForVoice(sealer.open(petRef, enc));
    const t0 = now();
    try {
      const out = await tts!.synth(text, voiceId);
      const key = randomBytes(16).toString("hex");
      db.transaction(() => {
        db.prepare("INSERT INTO audio_blob (key, turn_id, mime, bytes, expires_at) VALUES (?, ?, ?, ?, ?)").run(
          key, turnId, out.mime, Buffer.from(out.bytes), now() + AUDIO_TTL_MS,
        );
        db.prepare("UPDATE turn SET audio_key = ?, tts_ms = ? WHERE id = ?").run(key, now() - t0, turnId);
        addSpend(db, now(), 0, text.length);
      })();
      log.info("voice on demand", { turn_id: turnId, provider: tts!.name, chars: text.length, tts_ms: now() - t0 });
      return key;
    } catch (e) {
      log.warn("voice on demand failed", { turn_id: turnId, provider: tts!.name, error: e instanceof Error ? e.message.slice(0, 40) : "unknown" });
      return null;
    }
  }

  const app = new Hono<AuthEnv>();

  app.post("/pets/:petRef/turns/:turnId/voice", requirePetAccess(deps, ["owner"]), async (c) => {
    const ref = parsePetRef(c.req.param("petRef"));
    if (!ref) return c.json(err("invalid", "Unknown pet reference"), 400);
    const petRef = `${ref.contract}:${ref.tokenId}`;
    const turnId = c.req.param("turnId");
    const t = db.prepare("SELECT pet_ref, owner_account, status, reply_text_enc, audio_key FROM turn WHERE id = ?").get(turnId) as
      | TurnRow
      | undefined;
    // Only this owner's finished replies (a new owner never hears the old owner's chats).
    if (!t || t.pet_ref !== petRef || t.owner_account !== c.get("caller").account || t.status !== "done" || !t.reply_text_enc) {
      return c.json(err("not_found", "No such reply"), 404);
    }

    const existing = liveKey(t.audio_key);
    if (existing) return c.json({ audio_url: `/audio/${existing}` });

    if (!tts || (tts.name !== "kokoro" && !voiceId)) return c.json(err("brain_resting", "Voice is off"), 503);
    if (overSpendCap(db, now(), cfg.GLOBAL_DAILY_SPEND_CAP_USD) || (await belowFloor())) {
      return c.json(err("brain_resting", "Voice is resting for today"), 503);
    }

    let job = inFlight.get(turnId);
    if (!job) {
      job = synth(turnId, petRef, t.reply_text_enc).finally(() => inFlight.delete(turnId));
      inFlight.set(turnId, job);
    }
    const key = await job;
    if (!key) return c.json(err("upstream", "Voice failed"), 502);
    return c.json({ audio_url: `/audio/${key}` });
  });

  return new Hono().route("/", app);
}

export const voiceModule: Module = { name: "voice", routes: (deps) => createVoiceRoutes(deps) };
