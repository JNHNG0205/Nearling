import { describe, expect, it, vi } from "vitest";
import type { TtsProvider } from "../ai/tts";
import { issueSession } from "../auth/guard";
import { testDeps } from "../test/deps";
import { addSpend } from "./spend";
import { createVoiceRoutes, TTS_CREDIT_FLOOR } from "./voice-route";

const PET = "pets.petto.testnet:1";
const REPLY = "I love the garden today.";

async function setup(opts: { tts?: TtsProvider | null; owner?: string; status?: string } = {}) {
  const deps = testDeps();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  deps.db
    .prepare(
      `INSERT INTO turn (id, pet_ref, owner_account, request_id, channel, status, reply_text_enc, created_at)
       VALUES (?, ?, ?, ?, 'web', ?, ?, ?)`,
    )
    .run("turn-1", PET, opts.owner ?? "alice.testnet", "req-1", opts.status ?? "done", deps.sealer.seal(PET, REPLY), deps.now());
  const synth = vi.fn(async () => ({ mime: "audio/wav", bytes: new Uint8Array([1, 2, 3]) }));
  const tts = opts.tts !== undefined ? opts.tts : ({ name: "kokoro", synth } as TtsProvider);
  const app = createVoiceRoutes(deps, { tts });
  const { token } = await issueSession(deps, "alice.testnet");
  const call = async (turnId = "turn-1", auth: Record<string, string> = { Authorization: `Bearer ${token}` }) => {
    const res = await app.request(`/pets/${encodeURIComponent(PET)}/turns/${turnId}/voice`, { method: "POST", headers: auth });
    return { status: res.status, json: (await res.json()) as { audio_url?: string; error?: { code: string } } };
  };
  return { deps, synth, call };
}

describe("POST /pets/:petRef/turns/:turnId/voice", () => {
  it("synthesises once, stores the audio key on the turn and reuses it", async () => {
    const s = await setup();
    const a = await s.call();
    expect(a.status).toBe(200);
    expect(a.json.audio_url).toMatch(/^\/audio\/[0-9a-f]{32}$/);
    const b = await s.call();
    expect(b.json.audio_url).toBe(a.json.audio_url);
    expect(s.synth).toHaveBeenCalledTimes(1);
    expect(s.synth).toHaveBeenCalledWith(REPLY, "");
    const row = s.deps.db.prepare("SELECT audio_key FROM turn WHERE id = 'turn-1'").get() as { audio_key: string };
    expect(`/audio/${row.audio_key}`).toBe(a.json.audio_url);
  });

  it("needs the owner's session", async () => {
    const s = await setup();
    expect((await s.call("turn-1", {})).status).toBe(401);
  });

  it("hides other owners' turns and unfinished turns", async () => {
    expect((await (await setup({ owner: "old.testnet" })).call()).status).toBe(404);
    expect((await (await setup({ status: "canned" })).call()).status).toBe(404);
    expect((await (await setup()).call("nope")).status).toBe(404);
  });

  it("refuses below the TTS credit floor", async () => {
    const synth = vi.fn();
    const s = await setup({ tts: { name: "kokoro", synth, credits: async () => TTS_CREDIT_FLOOR - 1 } as TtsProvider });
    const r = await s.call();
    expect(r.status).toBe(503);
    expect(r.json.error?.code).toBe("brain_resting");
    expect(synth).not.toHaveBeenCalled();
  });

  it("refuses over the global spend cap and when voice is off", async () => {
    const s = await setup();
    addSpend(s.deps.db, s.deps.now(), s.deps.cfg.GLOBAL_DAILY_SPEND_CAP_USD * 1e9);
    expect((await s.call()).status).toBe(503);
    expect((await (await setup({ tts: null })).call()).status).toBe(503);
  });

  it("reports a provider failure without saving audio", async () => {
    const s = await setup({ tts: { name: "kokoro", synth: async () => { throw new Error("down"); } } });
    const r = await s.call();
    expect(r.status).toBe(502);
    expect(r.json.error?.code).toBe("upstream");
    const row = s.deps.db.prepare("SELECT audio_key FROM turn WHERE id = 'turn-1'").get() as { audio_key: string | null };
    expect(row.audio_key).toBeNull();
  });
});
