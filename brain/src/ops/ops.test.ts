import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNearAi, estimateAudioSeconds, sttCostNano } from "../ai/nearai";
import { createApp } from "../app";
import { openDb } from "../db/db";
import { log, setAlertSink } from "../log";
import { addSpend, configureSpend, overSpendCap, spentToday, ttsNano, utcDay } from "../talk/spend";
import { testDeps } from "../test/deps";
import { createAlertWebhook, MAX_ALERTS_PER_HOUR } from "./alerts";
import { backupOnce, KEEP, lastBackupAt, listBackups } from "./backup";
import { reconcileBilling } from "./billing";
import { errorTxHash } from "./feedRetry";
import { opsModule } from "./ops";
import { latestOrgBalance, recordOrgBalance } from "./orgBalance";

const NOW = 1_800_000_000_000;
const INF = (n: number) => `0000000${n}-1111-4222-8333-444455556666`;

function addTurn(deps: ReturnType<typeof testDeps>, id: string, o: { inf?: string | null; est?: number | null; at?: number; status?: string } = {}) {
  deps.db
    .prepare(
      `INSERT INTO turn (id, pet_ref, owner_account, request_id, channel, status, inference_id, provider_cost_nano, created_at)
       VALUES (?, 'pets.petto.testnet:1', 'alice.testnet', ?, 'web', ?, ?, ?, ?)`,
    )
    .run(id, `req-${id}`, o.status ?? "done", o.inf === undefined ? INF(1) : o.inf, o.est === undefined ? 1000 : o.est, o.at ?? NOW - 120_000);
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  configureSpend({ sttSink: null, ttsUsdPer1kChars: 0.05 });
  setAlertSink(null);
  vi.restoreAllMocks();
});

describe("A6 spend cap counts STT and TTS in dollars", () => {
  it("adds STT nano and prices TTS characters", () => {
    const { db } = testDeps();
    addSpend(db, NOW, 1_000_000_000); // $1 chat
    addSpend(db, NOW, 0, 20_000); // 20k chars at $0.05 / 1k = $1
    addSpend(db, NOW, 0, 0, 500_000_000); // $0.50 STT
    expect(spentToday(db, NOW)).toEqual({ provider_nano: 1_000_000_000, tts_chars: 20_000, stt_nano: 500_000_000 });
    expect(ttsNano(20_000)).toBe(1_000_000_000);
    expect(overSpendCap(db, NOW, 2.5)).toBe(true);
    expect(overSpendCap(db, NOW, 2.6)).toBe(false);
    configureSpend({ ttsUsdPer1kChars: 0.01 });
    expect(overSpendCap(db, NOW, 2.0)).toBe(false); // TTS now $0.20
  });

  it("prices whisper per token from the model list and reports it", async () => {
    const price = { inputNano: 10, outputNano: 10, verifiable: true };
    expect(estimateAudioSeconds(44 + 32_000 * 5, "audio/wav")).toBe(5);
    expect(sttCostNano(price, 5, 40)).toBe(1500 * 10 + 10 * 10);
    expect(sttCostNano(price, 45, 0)).toBe(3000 * 10);
    expect(sttCostNano(null, 5, 40)).toBeNull();

    const seen: number[] = [];
    configureSpend({ sttSink: (n) => seen.push(n) });
    const list = { models: [{ modelId: "openai/whisper-large-v3", inputCostPerToken: { amount: 10, scale: 9 }, outputCostPerToken: { amount: 10, scale: 9 } }] };
    const ai = createNearAi(
      { NEARAI_BASE_URL: "https://ai.test/v1", NEARAI_API_KEY: "k", NEARAI_CHAT_MODEL: "m", NEARAI_STT_MODEL: "openai/whisper-large-v3" },
      { fetch: (async (u: string) => (u.endsWith("/model/list") ? json(list) : json({ text: "hi there", duration: 3 }))) as unknown as typeof fetch },
    );
    expect((await ai.transcribe(new Uint8Array(100), "audio/webm")).text).toBe("hi there");
    expect(seen).toEqual([1500 * 10 + 2 * 10]);
  });
});

describe("A5 billing reconcile", () => {
  it("posts requestIds, stores billed cost, moves spend_daily by the delta, retries unknown ids", async () => {
    const deps = testDeps({ now: () => NOW });
    deps.cfg = { ...deps.cfg, NEARAI_API_KEY: "k", MOCK_AI: false };
    addTurn(deps, "a", { inf: INF(1), est: 1000 });
    addTurn(deps, "b", { inf: INF(2), est: 5000 });
    addTurn(deps, "c", { inf: "mock-inf-1" }); // not a UUID: skipped
    addTurn(deps, "d", { inf: INF(4), at: NOW - 5_000 }); // too fresh
    addSpend(deps.db, NOW - 120_000, 6000);
    let body: { requestIds: string[] } | null = null;
    const f = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://cloud-stg-api.near.ai/v1/billing/costs");
      body = JSON.parse(init.body as string);
      return json({ requests: [{ requestId: INF(1), costNanoUsd: 3000 }, { requestId: INF(2), costNanoUsd: 0 }], warning: "not found" });
    });
    const out = await reconcileBilling(deps, f as unknown as typeof fetch);
    expect(body).toEqual({ requestIds: [INF(1), INF(2)] });
    expect(out).toEqual({ asked: 2, billed: 1, pending: 1 });
    const row = (id: string) => deps.db.prepare("SELECT billed_cost_nano, billed_checks FROM turn WHERE id = ?").get(id);
    expect(row("a")).toEqual({ billed_cost_nano: 3000, billed_checks: 0 });
    expect(row("b")).toEqual({ billed_cost_nano: null, billed_checks: 1 });
    expect(spentToday(deps.db, NOW).provider_nano).toBe(8000); // 6000 + (3000 - 1000)

    // a second run asks only for the still unknown id
    await reconcileBilling(deps, f as unknown as typeof fetch);
    expect(body).toEqual({ requestIds: [INF(2)] });
  });

  it("does nothing without a key or with MOCK_AI", async () => {
    const deps = testDeps({ now: () => NOW });
    addTurn(deps, "a");
    const f = vi.fn();
    expect(await reconcileBilling(deps, f as unknown as typeof fetch)).toEqual({ asked: 0, billed: 0, pending: 0 });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("F6 org balance", () => {
  it("stores the balance and logs the delta", async () => {
    let t = NOW;
    const deps = testDeps({ now: () => t });
    deps.cfg = { ...deps.cfg, NEARAI_API_KEY: "k", NEARAI_ORG_ID: "org-1" };
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
    let remaining = 5_000_000_000;
    const f = vi.fn(async (url: string) => {
      expect(url).toBe("https://cloud-stg-api.near.ai/v1/organizations/org-1/usage/balance");
      return json({ organization_id: "org-1", remaining, spend_limit: 10_000_000_000, total_spent: 1 });
    });
    await recordOrgBalance(deps, "pets.petto.testnet", f as unknown as typeof fetch);
    remaining = 6_500_000_000;
    t += 1000;
    await recordOrgBalance(deps, "pets.petto.testnet", f as unknown as typeof fetch);
    expect(latestOrgBalance(deps)).toMatchObject({ org_id: "org-1", remaining_nano: 6_500_000_000, fetched_at: NOW + 1000 });
    expect(info).toHaveBeenLastCalledWith("org balance", expect.objectContaining({ delta_nano: 1_500_000_000 }));
  });

  it("falls back to the contract org_id and skips the placeholder", async () => {
    const deps = testDeps();
    deps.cfg = { ...deps.cfg, NEARAI_API_KEY: "k" };
    deps.chain.view = (async () => ({ org_id: "00000000-0000-0000-0000-000000000000" })) as typeof deps.chain.view;
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const f = vi.fn();
    expect(await recordOrgBalance(deps, "pets.petto.testnet", f as unknown as typeof fetch)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("O2 SQLite backup", () => {
  it("writes a backup and keeps the newest 7", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nearling-backup-"));
    try {
      const db = openDb(join(dir, "live.db"));
      const out = join(dir, "backups");
      for (let i = 0; i < KEEP + 2; i++) await backupOnce(db, out, NOW + i * 86_400_000);
      const files = listBackups(out);
      expect(files).toHaveLength(KEEP);
      expect(readdirSync(out)).toHaveLength(KEEP);
      expect(lastBackupAt(out)).toBe(Math.floor((NOW + (KEEP + 1) * 86_400_000) / 1000) * 1000);
      const copy = openDb(join(out, files[0]!));
      expect(copy.prepare("SELECT count(*) n FROM _migrations").get()).toMatchObject({ n: expect.any(Number) });
      copy.close();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips in-memory databases", async () => {
    expect(await backupOnce(testDeps().db, "/nonexistent", NOW)).toBeNull();
  });
});

describe("O4 alert webhook", () => {
  it("posts log.alert lines with cleaned fields, rate limited", async () => {
    let t = NOW;
    const posts: { content: string; text: string }[] = [];
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      posts.push(JSON.parse(init.body as string));
      return new Response("");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setAlertSink(createAlertWebhook("https://hooks.test/x", { fetch: f as unknown as typeof fetch, now: () => t }));
    log.alert("feeder balance low", { account: "feeder.petto.testnet", text: "secret chat" });
    log.alert("feeder balance low", { account: "feeder.petto.testnet" }); // same message inside 10 min
    expect(posts).toHaveLength(1);
    expect(posts[0]!.content).toBe(posts[0]!.text);
    expect(posts[0]!.content).toContain("feeder balance low");
    expect(posts[0]!.content).not.toContain("secret chat");
    t += 11 * 60_000;
    log.alert("feeder balance low", {});
    expect(posts).toHaveLength(2);
    for (let i = 0; i < MAX_ALERTS_PER_HOUR + 5; i++) log.alert(`alert ${i}`, {});
    expect(posts).toHaveLength(MAX_ALERTS_PER_HOUR);
  });
});

describe("D7 GET /ops", () => {
  const auth = (u: string, p: string) => ({ Authorization: `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}` });

  it("is 404 when OPS_USER / OPS_PASSWORD are unset", async () => {
    const deps = testDeps();
    const app = createApp(deps, [opsModule()]);
    expect((await app.request("/ops")).status).toBe(404);
  });

  it("needs basic auth and reports spend, queues, orders, feeder, attestation, claimable, org balance, credits", async () => {
    const deps = testDeps({ now: () => NOW });
    deps.cfg = { ...deps.cfg, OPS_USER: "ops", OPS_PASSWORD: "pw", FEEDER_ACCOUNT_ID: "feeder.petto.testnet", BACKUP_DIR: "/nonexistent-nearling" };
    deps.chain.view = (async (_c: string, _m: string, args?: Record<string, unknown>) =>
      ({ claimable: args?.account_id === "pets.petto.testnet" ? "123" : "0" })) as typeof deps.chain.view;
    addSpend(deps.db, NOW, 2_000_000, 1000, 500_000);
    addTurn(deps, "t1", { at: NOW });
    deps.db.prepare(
      "INSERT INTO charge_job (turn_id, pet_ref, cost_micro, status, attempts, next_attempt_at, created_at, updated_at) VALUES ('t1', 'p', 1000, 'queued', 2, ?, ?, ?)",
    ).run(NOW, NOW - 30_000, NOW);
    deps.db.prepare(
      "INSERT INTO feed_order (id, pet_ref, mode, pack_id, status, feed_yocto, created_at, updated_at) VALUES ('o1', 'p', 'simulated', 'snack', 'fed', '1', ?, ?)",
    ).run(NOW, NOW);
    deps.db.prepare("INSERT INTO org_balance (org_id, remaining_nano, fetched_at) VALUES ('org-1', 4000000000, ?)").run(NOW);
    const app = createApp(deps, [
      opsModule({
        rpc: { txStatus: async () => null, viewAccount: async () => ({ amount: "5000000000000000000000000" }) },
        tts: { name: "elevenlabs", synth: async () => ({ mime: "", bytes: new Uint8Array() }), credits: async () => 9000 },
      }),
    ]);
    expect((await app.request("/ops")).status).toBe(401);
    expect((await app.request("/ops", { headers: auth("ops", "nope") })).status).toBe(401);
    const res = await app.request("/ops", { headers: auth("ops", "pw") });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      spend_today: { day: utcDay(NOW), provider_usd: 0.002, stt_usd: 0.0005, tts_chars: 1000, tts_usd: 0.05, total_usd: 0.0525, unbilled_turns: 1 },
      charge_queue: { depth: 1, retrying: 1, failed: 0, oldest_pending_age_s: 30 },
      orders: { by_status: { fed: 1 }, feed_retrying: 0 },
      feeder: { account: "feeder.petto.testnet", balance_yocto: "5000000000000000000000000" },
      nearon_claimable: { "pets.petto.testnet": "123", "pets-demo.petto.testnet": "0" },
      org_balance: { org_id: "org-1", remaining_usd: 4 },
      elevenlabs_credits: 9000,
      backups: { last_at: null, count: 0 },
    });
    expect(body.attestation).toEqual([{ model: deps.cfg.NEARAI_CHAT_MODEL, ok: null, fetched_at: null, reason: null }]);
  });
});

describe("F3 helpers", () => {
  it("reads the tx hash from near-api-js execution errors only", () => {
    const h = "4z9Lq8rB7nVtJbT3oLz2YkWm5sXqFv1hCdEaPgR6uNi";
    expect(errorTxHash(Object.assign(new Error("x"), { txHash: h }))).toBe(h);
    expect(errorTxHash(Object.assign(new Error("x"), { context: { transactionHash: h } }))).toBe(h);
    expect(errorTxHash(Object.assign(new Error("panic"), { transactionResult: { transaction_outcome: { id: h } } }))).toBe(h);
    expect(errorTxHash(new Error("fetch failed"))).toBeNull();
  });
});
