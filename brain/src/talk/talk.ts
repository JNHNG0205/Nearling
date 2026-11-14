import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { STAGES, displayState, fuelLeft, parsePetRef, type Emotion, type PetView, type TalkResponse } from "@petto/shared";
import { createMockNearAi, createNearAi, costNano, NearAiError, type ChatResult, type NearAi } from "../ai/nearai";
import { createTts, clipForVoice, type TtsProvider } from "../ai/tts";
import { ensureAttestation } from "../ai/attestation";
import { submitForVerification } from "../ai/verify";
import { requirePetAccess, type AuthEnv, type Caller } from "../auth/guard";
import type { PetsConfig } from "../chain/near";
import type { Deps, Module } from "../deps";
import { log } from "../log";
import { ensureProfile } from "../profiles";
import { checkAudio, MAX_AUDIO_BYTES } from "./audio";
import { loadMemory, maybeSummarise, noteTurn, SUMMARY_EVERY } from "./memory";
import type { BilledTrigger, FollowUp } from "../proactive/rules";
import type { GenerateProactive } from "../proactive/scheduler";
import { buildMessages, parseEmotion, PROACTIVE_NUDGE, proactiveTask, type Channel } from "./prompt";
import { addSpend, overSpendCap, utcDay } from "./spend";

/**
 * Soul & Verified Talk (AI-brain 03 sections 1, 2, 8). One press = one turn = one reply = one
 * charge job. A retry with the same request_id replays a done turn (no new inference, no new
 * charge) and re-runs a failed one. Chat content is sealed in the DB and never logged.
 */

export const LINES = {
  lowFuel: { reply: "zzz... my brain is out of fuel", emotion: "sleepy" as Emotion },
  notCaught: { reply: "Hm? I didn't catch that", emotion: "curious" as Emotion },
  tangled: { reply: "My brain got tangled, try again?", emotion: "sad" as Emotion },
  resting: { reply: "My brain is resting right now. Let's talk again a bit later!", emotion: "sleepy" as Emotion },
};

const MIN_GAP_MS = 3_000;
const MAX_PER_DAY = 300;
const AUDIO_TTL_MS = 24 * 3600_000;
const RESTING_BACKOFF_MS = 60_000;
const TTS_LOW_CREDITS = 1_000;

interface TurnRow {
  id: string;
  pet_ref: string;
  owner_account: string;
  channel: Channel;
  status: "processing" | "done" | "failed" | "canned";
  user_text_enc: Buffer | null;
  reply_text_enc: Buffer | null;
  emotion: Emotion | null;
  soul_version: number | null;
  stt_ms: number | null;
  audio_key: string | null;
  created_at: number;
}

export interface TalkOverrides {
  ai?: NearAi;
  tts?: TtsProvider | null;
}

export function uuidv7(now: number): string {
  const b = randomBytes(16);
  let ts = BigInt(now);
  for (let i = 5; i >= 0; i--) {
    b[i] = Number(ts & 0xffn);
    ts >>= 8n;
  }
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function localParts(now: number, tz: string | null): { time: string; day: string } {
  const zone = tz ?? "UTC";
  try {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit" }).format(now);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    return { time: `${time} (${zone})`, day };
  } catch {
    return localParts(now, null);
  }
}

const isLowFuel = (pet: PetView, config: PetsConfig) =>
  pet.life_state === "Starving" || pet.life_state === "Dormant" || pet.budget_micro < config.fuel_price_micro;

export interface TurnInput {
  petRef: string;
  contract: string;
  tokenId: string;
  owner: string;
  channel: Channel;
  /** id of the turn row, already inserted with status `processing` */
  turnId: string;
  pet: PetView;
  config: PetsConfig;
  /** the turn's start time (prompt clock, sleep check) */
  at: number;
  ask: { kind: "user"; text: string } | { kind: "proactive"; trigger: BilledTrigger; fact?: string };
}

export interface TurnOutput {
  reply: string;
  emotion: Emotion;
  soul: { version: number; prompt: string };
  res: ChatResult;
  cost: number | null;
}

/**
 * One billed thought, shared by the talk route and proactive messages: Soul + state + memory
 * prompt, attestation, private-model call, then the reply and its charge_job saved in one
 * transaction, verification and memory bookkeeping. Throws on failure; the caller marks the
 * turn failed. Proactive turns do not count as owner turns (`last_owner_turn_at`, summary).
 */
export async function runTurn(deps: Deps, ai: NearAi, input: TurnInput): Promise<TurnOutput> {
  const { cfg, db, chain, sealer, now } = deps;
  const { petRef, contract, tokenId, owner, channel, turnId, pet, config, at: t, ask } = input;
  const left = fuelLeft(pet.budget_micro, config.fuel_price_micro);
  const model = cfg.NEARAI_CHAT_MODEL;
  const price = await ai.checkModel(model);

  let soul: { version: number; prompt: string } = { version: 0, prompt: "" };
  try {
    soul = await chain.getSoul(contract, tokenId);
  } catch {
    log.warn("soul fetch failed; default persona", { pet_ref: petRef });
  }

  const profile = ensureProfile(db, petRef, pet.owner, t);
  // Set by PUT /pets/:petRef/profile; only for the owner who set it (a new owner starts without one).
  const nickRow = db.prepare("SELECT nickname_enc FROM pet_profile WHERE pet_ref = ? AND owner_account = ?").get(petRef, pet.owner) as { nickname_enc: Buffer | null } | undefined;
  let nickname: string | null = null;
  try {
    nickname = nickRow?.nickname_enc ? sealer.open(petRef, nickRow.nickname_enc) : null;
  } catch {
    nickname = null;
  }
  const sleeping = profile.sleeping_until !== null && profile.sleeping_until > t;
  const local = localParts(t, profile.owner_tz);
  const mem = loadMemory(deps, petRef, owner);

  const messages = buildMessages({
    soul: soul.version > 0 ? soul.prompt : null,
    state: {
      name: pet.name,
      stage: STAGES[pet.stage] ?? "adult",
      form: profile.form,
      shirt: profile.equipped_shirt,
      fuelLeft: left,
      displayState: displayState(pet.life_state, profile.care_mood, sleeping),
      nickname,
      ownerLocalTime: local.time,
      channel,
    },
    summary: mem.summary,
    facts: mem.facts,
    today: local.day,
    history: mem.history,
    userText: ask.kind === "user" ? ask.text : PROACTIVE_NUDGE,
    ...(ask.kind === "proactive" ? { task: proactiveTask(ask.trigger, ask.fact) } : {}),
  });

  // Attest before the call (03 section 7). A failure never blocks the turn; the receipt is then unverified.
  if (!cfg.MOCK_AI) {
    try {
      await ensureAttestation(deps, model);
    } catch {
      log.warn("attestation refresh failed", { model });
    }
  }

  const res = await ai.chat(messages, { model });
  const { emotion, text: reply } = parseEmotion(res.text);
  if (!reply) throw new NearAiError("upstream");
  const cost = costNano(res.usage, price);

  let sinceSummary = 0;
  db.transaction(() => {
    db.prepare(
      `UPDATE turn SET status = 'done', reply_text_enc = ?, emotion = ?, soul_version = ?, model = ?, inference_id = ?, chat_id = ?,
         prompt_tokens = ?, completion_tokens = ?, provider_cost_nano = ?, llm_ms = ?, completed_at = ? WHERE id = ?`,
    ).run(
      sealer.seal(petRef, reply), emotion, soul.version, res.model, res.inferenceId, res.chatId,
      res.usage.prompt_tokens, res.usage.completion_tokens, cost, res.ms, now(), turnId,
    );
    db.prepare(
      `INSERT INTO charge_job (turn_id, pet_ref, cost_micro, status, attempts, next_attempt_at, created_at, updated_at)
       VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)`,
    ).run(turnId, petRef, config.fuel_price_micro, now(), now(), now());
    addSpend(db, now(), cost ?? 0);
    if (ask.kind === "user") {
      sinceSummary = noteTurn(db, petRef, owner);
      db.prepare("UPDATE pet_profile SET last_owner_turn_at = ? WHERE pet_ref = ?").run(now(), petRef);
    }
  })();

  try {
    submitForVerification(deps, { turnId, petRef, model: res.model, chatId: res.chatId, rawRequest: res.rawRequest, rawResponse: res.rawResponse });
  } catch (err) {
    log.warn("verify submit failed", { turn_id: turnId, error: err instanceof Error ? err.name : "unknown" });
  }

  if (sinceSummary >= SUMMARY_EVERY) void maybeSummarise(deps, ai, petRef, owner, local.day);

  return { reply, emotion, soul, res, cost };
}

const JsonBody = z.object({
  request_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  text: z.string().trim().min(1).max(500),
  voice: z.union([z.boolean(), z.literal("1"), z.literal("0"), z.literal(1), z.literal(0)]).optional(),
});

type Input = { requestId: string; voice: boolean } & ({ kind: "text"; text: string } | { kind: "audio"; bytes: Uint8Array; mime: string });

type Bad = { status: 400; code: "invalid" | "bad_audio"; message: string };

async function readInput(c: Context): Promise<Input | Bad> {
  const type = c.req.header("Content-Type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    const body = await c.req.parseBody();
    const requestId = typeof body.request_id === "string" ? body.request_id : "";
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) return { status: 400, code: "invalid", message: "request_id required" };
    const voice = body.voice === "1" || body.voice === "true";
    const audio = body.audio;
    if (audio instanceof File) {
      const bytes = new Uint8Array(await audio.arrayBuffer());
      const check = checkAudio(bytes);
      if (!check.ok) return { status: 400, code: "bad_audio", message: `Audio rejected: ${check.reason}` };
      return { requestId, voice, kind: "audio", bytes, mime: check.mime };
    }
    if (typeof body.text === "string" && body.text.trim()) {
      return { requestId, voice, kind: "text", text: body.text.trim().slice(0, 500) };
    }
    return { status: 400, code: "invalid", message: "audio or text required" };
  }
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return { status: 400, code: "invalid", message: "JSON or multipart body required" };
  }
  const p = JsonBody.safeParse(json);
  if (!p.success) return { status: 400, code: "invalid", message: "request_id and text required" };
  const v = p.data.voice;
  return { requestId: p.data.request_id, voice: v === true || v === "1" || v === 1, kind: "text", text: p.data.text };
}

export function createTalk(deps: Deps, overrides: TalkOverrides = {}) {
  const { cfg, db, chain, sealer, now } = deps;
  const ai = overrides.ai ?? (cfg.MOCK_AI ? createMockNearAi() : createNearAi(cfg));
  const tts = overrides.tts !== undefined ? overrides.tts : createTts(cfg);
  const voiceId = cfg.TTS_VOICE_ID ?? "";
  const allowedContracts = [cfg.PETS_CONTRACT, cfg.DEMO_PETS_CONTRACT];
  const locks = new Map<string, Promise<void>>();
  const lastTalk = new Map<string, number>();
  let restingUntil = 0;
  let ttsLow = false;
  let warnedNoKey = false;

  async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const chained = prev.then(() => mine);
    locks.set(key, chained);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(key) === chained) locks.delete(key);
    }
  }

  const receiptUrl = (turnId: string) => `${cfg.PUBLIC_WEB_URL.replace(/\/$/, "")}/receipt/${turnId}`;
  const feedUrl = (petRef: string) => `${cfg.PUBLIC_WEB_URL.replace(/\/$/, "")}/feed/${encodeURIComponent(petRef)}`;

  function audioUrl(key: string | null): string | null {
    if (!key) return null;
    const row = db.prepare("SELECT 1 FROM audio_blob WHERE key = ? AND expires_at > ?").get(key, now());
    return row ? `/audio/${key}` : null;
  }

  function replay(t: TurnRow, pet: PetView, config: PetsConfig): TalkResponse {
    const job = db.prepare("SELECT status FROM charge_job WHERE turn_id = ?").get(t.id) as { status: string } | undefined;
    const res: TalkResponse = {
      turn_id: t.id,
      status: t.status === "done" ? "done" : "canned",
      reply: t.reply_text_enc ? sealer.open(t.pet_ref, t.reply_text_enc) : LINES.notCaught.reply,
      emotion: t.emotion ?? "happy",
      fuel: { left: fuelLeft(pet.budget_micro, config.fuel_price_micro), ...(job ? { charged: job.status === "settled" ? "settled" : "pending" } : {}) },
      audio_url: audioUrl(t.audio_key),
      receipt_url: t.status === "done" ? receiptUrl(t.id) : null,
    };
    if (t.soul_version !== null) res.soul_version = t.soul_version;
    if (t.stt_ms !== null && t.user_text_enc) res.transcript = sealer.open(t.pet_ref, t.user_text_enc);
    return res;
  }

  const canned = (line: { reply: string; emotion: Emotion }, left: number, extra: Partial<TalkResponse> = {}): TalkResponse => ({
    turn_id: null,
    status: "canned",
    reply: line.reply,
    emotion: line.emotion,
    fuel: { left },
    audio_url: null,
    receipt_url: null,
    ...extra,
  });

  async function synth(turnId: string, text: string): Promise<string | null> {
    if (!tts || ttsLow || (tts.name !== "kokoro" && !voiceId)) return null;
    const clipped = clipForVoice(text);
    const t0 = now();
    try {
      const out = await tts.synth(clipped, voiceId);
      const key = randomBytes(16).toString("hex");
      db.transaction(() => {
        db.prepare("INSERT INTO audio_blob (key, turn_id, mime, bytes, expires_at) VALUES (?, ?, ?, ?, ?)").run(
          key, turnId, out.mime, Buffer.from(out.bytes), now() + AUDIO_TTL_MS,
        );
        db.prepare("UPDATE turn SET audio_key = ?, tts_ms = ? WHERE id = ?").run(key, now() - t0, turnId);
        addSpend(db, now(), 0, clipped.length);
      })();
      return key;
    } catch (err) {
      log.warn("tts failed", { turn_id: turnId, provider: tts.name, error: err instanceof Error ? err.message.slice(0, 40) : "unknown" });
      return null;
    }
  }

  async function talk(caller: Caller, petRef: string, contract: string, tokenId: string, input: Input): Promise<{ status: 200 | 429; body: TalkResponse | object }> {
    const existing = db.prepare("SELECT * FROM turn WHERE pet_ref = ? AND request_id = ?").get(petRef, input.requestId) as TurnRow | undefined;
    const [pet, config] = await Promise.all([chain.getPet(contract, tokenId), chain.getConfig(contract)]);
    if (!pet) return { status: 200, body: canned(LINES.lowFuel, 0) }; // guard already checked; pet vanished mid-request

    if (existing && (existing.status === "done" || existing.status === "canned")) {
      return { status: 200, body: replay(existing, pet, config) };
    }

    const left = fuelLeft(pet.budget_micro, config.fuel_price_micro);
    if (isLowFuel(pet, config)) return { status: 200, body: canned(LINES.lowFuel, 0, { feed_url: feedUrl(petRef) }) };

    const t = now();
    const last = lastTalk.get(petRef);
    if (last !== undefined && t - last < MIN_GAP_MS) {
      return { status: 429, body: { error: { code: "rate_limited", message: "One thought at a time", retry_after_s: Math.ceil((MIN_GAP_MS - (t - last)) / 1000) } } };
    }
    const dayStart = Date.parse(`${utcDay(t)}T00:00:00Z`);
    const today = db
      .prepare("SELECT count(*) n FROM turn WHERE pet_ref = ? AND created_at >= ? AND status IN ('done', 'processing')")
      .get(petRef, dayStart) as { n: number };
    if (today.n >= MAX_PER_DAY) {
      return { status: 429, body: { error: { code: "rate_limited", message: "That's enough thinking for today", retry_after_s: Math.ceil((dayStart + 86_400_000 - t) / 1000) } } };
    }

    if (t < restingUntil || overSpendCap(db, t, cfg.GLOBAL_DAILY_SPEND_CAP_USD)) {
      return { status: 200, body: canned(LINES.resting, left) };
    }
    if (!cfg.MOCK_AI && !cfg.NEARAI_API_KEY && !overrides.ai) {
      if (!warnedNoKey) log.warn("NEARAI_API_KEY not set; talk replies are canned");
      warnedNoKey = true;
      return { status: 200, body: canned(LINES.resting, left) };
    }
    lastTalk.set(petRef, t);

    const channel: Channel = caller.kind === "device" ? "device" : "web";
    const owner = caller.account;
    const turnId = existing?.id ?? uuidv7(t);
    const userEnc = input.kind === "text" ? sealer.seal(petRef, input.text) : null;
    if (existing) {
      db.prepare("UPDATE turn SET status = 'processing', user_text_enc = ?, error_code = NULL, channel = ?, device_id = ? WHERE id = ?").run(
        userEnc, channel, caller.kind === "device" ? caller.deviceId : null, turnId,
      );
    } else {
      db.prepare(
        `INSERT INTO turn (id, pet_ref, owner_account, device_id, request_id, channel, status, user_text_enc, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'processing', ?, ?)`,
      ).run(turnId, petRef, owner, caller.kind === "device" ? caller.deviceId : null, input.requestId, channel, userEnc, t);
    }

    const fail = (code: string) =>
      db.prepare("UPDATE turn SET status = 'failed', error_code = ?, completed_at = ? WHERE id = ?").run(code, now(), turnId);

    try {
      let userText: string;
      let sttMs: number | null = null;
      if (input.kind === "audio") {
        const stt = await ai.transcribe(input.bytes, input.mime);
        sttMs = stt.ms;
        userText = stt.text.slice(0, 500);
        if (!userText) {
          db.prepare("UPDATE turn SET status = 'canned', stt_ms = ?, completed_at = ? WHERE id = ?").run(sttMs, now(), turnId);
          log.info("talk canned", { turn_id: turnId, pet_ref: petRef, reason: "empty_transcript", stt_ms: sttMs });
          return { status: 200, body: { ...canned(LINES.notCaught, left), turn_id: turnId } };
        }
        db.prepare("UPDATE turn SET user_text_enc = ?, stt_ms = ? WHERE id = ?").run(sealer.seal(petRef, userText), sttMs, turnId);
      } else {
        userText = input.text;
      }

      const { reply, emotion, soul, res, cost } = await runTurn(deps, ai, {
        petRef, contract, tokenId, owner, channel, turnId, pet, config, at: t, ask: { kind: "user", text: userText },
      });

      const key = input.voice ? await synth(turnId, reply) : null;

      log.info("talk done", {
        turn_id: turnId, pet_ref: petRef, channel, model: res.model, inference_id: res.inferenceId, chat_id: res.chatId,
        prompt_tokens: res.usage.prompt_tokens, completion_tokens: res.usage.completion_tokens, cost_nano: cost,
        stt_ms: sttMs, llm_ms: res.ms, voice: key !== null,
      });

      const body: TalkResponse = {
        turn_id: turnId,
        status: "done",
        reply,
        emotion,
        fuel: { left: Math.max(0, left - 1), charged: "pending" },
        audio_url: key ? `/audio/${key}` : null,
        receipt_url: receiptUrl(turnId),
        soul_version: soul.version,
      };
      if (input.kind === "audio") body.transcript = userText;
      return { status: 200, body };
    } catch (err) {
      const kind = err instanceof NearAiError ? err.kind : "internal";
      fail(kind);
      if (kind === "resting") {
        restingUntil = now() + RESTING_BACKOFF_MS;
        log.alert("nearai out of credit (402); brain resting", { turn_id: turnId });
        return { status: 200, body: { ...canned(LINES.resting, left), turn_id: turnId } };
      }
      if (kind === "not_verifiable") log.alert("chat model is not verifiable; refusing", { model: cfg.NEARAI_CHAT_MODEL });
      log.warn("talk failed", { turn_id: turnId, pet_ref: petRef, error: err instanceof NearAiError ? err.message : kind });
      return {
        status: 200,
        body: { turn_id: turnId, status: "failed", reply: LINES.tangled.reply, emotion: LINES.tangled.emotion, fuel: { left }, audio_url: null, receipt_url: null } satisfies TalkResponse,
      };
    }
  }

  /**
   * Billed proactive message (07 section 3): a real turn with `channel = proactive`, one
   * charge_job and a receipt, no TTS. Null when it cannot run (Low Fuel, NEAR AI not set up,
   * resting, spend cap, failure), so the scheduler sends a free canned line instead.
   */
  async function proactive(
    petRefIn: string,
    trigger: BilledTrigger,
    ctx: { owner: string; followUp?: FollowUp },
  ): Promise<{ text: string; turnId: string } | null> {
    const ref = parsePetRef(petRefIn);
    if (!ref || !allowedContracts.includes(ref.contract)) return null;
    const petRef = `${ref.contract}:${ref.tokenId}`;
    return withLock(petRef, async () => {
      const [pet, config] = await Promise.all([chain.getPet(ref.contract, ref.tokenId), chain.getConfig(ref.contract)]);
      if (!pet || isLowFuel(pet, config)) return null;
      const t = now();
      if (t < restingUntil || overSpendCap(db, t, cfg.GLOBAL_DAILY_SPEND_CAP_USD)) return null;
      if (!cfg.MOCK_AI && !cfg.NEARAI_API_KEY && !overrides.ai) return null;

      const turnId = uuidv7(t);
      db.prepare(
        `INSERT INTO turn (id, pet_ref, owner_account, device_id, request_id, channel, status, user_text_enc, created_at)
         VALUES (?, ?, ?, NULL, ?, 'proactive', 'processing', NULL, ?)`,
      ).run(turnId, petRef, ctx.owner, `proactive-${turnId}`, t);
      try {
        const out = await runTurn(deps, ai, {
          petRef, contract: ref.contract, tokenId: ref.tokenId, owner: ctx.owner, channel: "proactive", turnId, pet, config, at: t,
          ask: { kind: "proactive", trigger, ...(ctx.followUp?.fact ? { fact: ctx.followUp.fact } : {}) },
        });
        log.info("proactive turn done", {
          turn_id: turnId, pet_ref: petRef, trigger, model: out.res.model, inference_id: out.res.inferenceId, chat_id: out.res.chatId,
          prompt_tokens: out.res.usage.prompt_tokens, completion_tokens: out.res.usage.completion_tokens, cost_nano: out.cost, llm_ms: out.res.ms,
        });
        return { text: out.reply, turnId };
      } catch (err) {
        const kind = err instanceof NearAiError ? err.kind : "internal";
        db.prepare("UPDATE turn SET status = 'failed', error_code = ?, completed_at = ? WHERE id = ?").run(kind, now(), turnId);
        if (kind === "resting") {
          restingUntil = now() + RESTING_BACKOFF_MS;
          log.alert("nearai out of credit (402); brain resting", { turn_id: turnId });
        }
        log.warn("proactive turn failed", { turn_id: turnId, pet_ref: petRef, trigger, error: kind });
        return null;
      }
    });
  }

  const app = new Hono<AuthEnv>();

  app.post(
    "/pets/:petRef/talk",
    bodyLimit({
      maxSize: MAX_AUDIO_BYTES + 64 * 1024,
      onError: (c) => c.json({ error: { code: "bad_audio", message: "Upload too large" } }, 413),
    }),
    requirePetAccess(deps),
    async (c) => {
      const petRef = c.req.param("petRef");
      const ref = parsePetRef(petRef);
      if (!ref || !allowedContracts.includes(ref.contract)) {
        return c.json({ error: { code: "invalid", message: "Unknown pet reference" } }, 400);
      }
      const input = await readInput(c);
      if ("code" in input) return c.json({ error: { code: input.code, message: input.message } }, input.status);
      const key = `${ref.contract}:${ref.tokenId}`;
      const out = await withLock(key, () => talk(c.get("caller"), key, ref.contract, ref.tokenId, input));
      return c.json(out.body, out.status);
    },
  );

  app.get("/audio/:key", (c) => {
    const key = c.req.param("key");
    if (!/^[0-9a-f]{32}$/.test(key)) return c.json({ error: { code: "not_found", message: "No such audio" } }, 404);
    const row = db.prepare("SELECT mime, bytes FROM audio_blob WHERE key = ? AND expires_at > ?").get(key, now()) as
      | { mime: string; bytes: Buffer }
      | undefined;
    if (!row) return c.json({ error: { code: "not_found", message: "No such audio" } }, 404);
    return c.body(new Uint8Array(row.bytes), 200, { "Content-Type": row.mime, "Cache-Control": "private, max-age=86400" });
  });

  app.get("/pets/:petRef/turns", requirePetAccess(deps, ["owner"]), (c) => {
    const ref = parsePetRef(c.req.param("petRef"));
    if (!ref) return c.json({ error: { code: "invalid", message: "Unknown pet reference" } }, 400);
    const petRef = `${ref.contract}:${ref.tokenId}`;
    const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 20) || 20));
    const rows = db
      .prepare(
        `SELECT t.*, j.status AS job_status, j.charged_micro, j.source, j.tx_hash, v.status AS verify_status
         FROM turn t LEFT JOIN charge_job j ON j.turn_id = t.id LEFT JOIN verification v ON v.turn_id = t.id
         WHERE t.pet_ref = ? AND t.owner_account = ? AND t.status IN ('done', 'canned')
         ORDER BY t.created_at DESC, t.rowid DESC LIMIT ?`,
      )
      .all(petRef, c.get("caller").account, limit) as (TurnRow & {
      model: string | null;
      job_status: string | null;
      charged_micro: number | null;
      source: string | null;
      tx_hash: string | null;
      verify_status: string | null;
    })[];
    return c.json(
      rows.map((r) => ({
        turn_id: r.id,
        at: r.created_at,
        channel: r.channel,
        status: r.status,
        user_text: r.user_text_enc ? sealer.open(petRef, r.user_text_enc) : null,
        reply: r.reply_text_enc ? sealer.open(petRef, r.reply_text_enc) : null,
        emotion: r.emotion,
        soul_version: r.soul_version,
        model: r.model,
        audio_url: audioUrl(r.audio_key),
        fuel: r.job_status
          ? { status: r.job_status, charged_micro: r.charged_micro, source: r.source, tx_hash: r.tx_hash }
          : null,
        verification: r.status === "done" ? (r.verify_status ?? "pending") : null,
      })),
    );
  });

  function start(): () => void {
    const cleanup = () => db.prepare("DELETE FROM audio_blob WHERE expires_at <= ?").run(now());
    const refreshCredits = async () => {
      if (!tts?.credits) return;
      try {
        const left = await tts.credits();
        if (left === null) return;
        const low = left < TTS_LOW_CREDITS;
        if (low && !ttsLow) log.alert("tts credits low; voice off", { provider: tts.name, credits: left });
        ttsLow = low;
      } catch {
        log.warn("tts credit check failed", { provider: tts.name });
      }
    };
    if (cfg.MOCK_AI) log.warn("MOCK_AI=1: talk uses simulated inference (tests and local dev only)");
    void refreshCredits();
    const timer = setInterval(() => {
      cleanup();
      void refreshCredits();
    }, 3600_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { app, start, ai, proactive };
}

const instances = new WeakMap<Deps, ReturnType<typeof createTalk>>();
const talkFor = (deps: Deps) => {
  let t = instances.get(deps);
  if (!t) instances.set(deps, (t = createTalk(deps)));
  return t;
};

/** Scheduler hook: shares the talk module's NEAR AI client, per-pet lock and resting state. */
export const generateProactive: GenerateProactive = (deps, petRef, trigger, ctx) => talkFor(deps).proactive(petRef, trigger, ctx);

export const talkModule: Module = {
  name: "talk",
  routes: (deps) => talkFor(deps).app as unknown as Hono,
  start: (deps) => talkFor(deps).start(),
};
