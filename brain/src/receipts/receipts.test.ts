import { createHash } from "node:crypto";
import { Wallet } from "ethers";
import { afterEach, describe, expect, it } from "vitest";
import { latestAttestation, NRAS_URL, refreshAttestation, setVerifyIo } from "../ai/attestation";
import { settleVerifications, submitForVerification } from "../ai/verify";
import { createApp } from "../app";
import { issueSession } from "../auth/guard";
import { subscribe } from "../events";
import { testDeps } from "../test/deps";
import { receiptsModule } from "./receipts";

const MODEL = "openai/gpt-oss-120b";
const PET = "pets.petto.testnet:1";
const BASE = "https://cloud-stg-api.near.ai/v1";
// Recorded-style exchange; these exact strings must never reach the DB.
const RAW_REQ = '{"model":"openai/gpt-oss-120b","messages":[{"role":"user","content":"SECRET-REQ-hello Mochi"}]}';
const RAW_RES = '{"id":"chatcmpl-abc","choices":[{"message":{"role":"assistant","content":"SECRET-RES-hi!"}}]}';
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const REQ_H = sha(RAW_REQ);
const RES_H = sha(RAW_RES);

const modelKey = Wallet.createRandom();
const gatewayKey = Wallet.createRandom();
const strangerKey = Wallet.createRandom();

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: object) => `${b64({ alg: "ES384" })}.${b64(claims)}.c2ln`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface FakeOpts {
  echoNonce?: (nonce: string) => string;
  nrasNonce?: (nonce: string) => string;
  signature?: () => Promise<object> | object;
  notFoundTimes?: number;
}

/** Fake NEAR AI + NRAS. Records how many signature calls were made. */
function fakeNet(opts: FakeOpts) {
  const calls = { signature: 0, sleeps: 0 };
  let nonce = "";
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.href.startsWith(`${BASE}/attestation/report`)) {
      nonce = url.searchParams.get("nonce") ?? "";
      const echo = opts.echoNonce ? opts.echoNonce(nonce) : nonce;
      return json({
        request_nonce: echo,
        gateway_attestation: { signing_address: gatewayKey.address, intel_quote: "q" },
        model_attestations: [{ signing_address: modelKey.address, nvidia_payload: { nonce }, intel_quote: "q" }],
      });
    }
    if (url.href === NRAS_URL) {
      const n = opts.nrasNonce ? opts.nrasNonce(nonce) : nonce;
      return json([["JWT", jwt({ "x-nvidia-overall-att-result": true, eat_nonce: n })], { "GPU-0": jwt({}) }]);
    }
    if (url.href.startsWith(`${BASE}/signature/`)) {
      calls.signature++;
      if (calls.signature <= (opts.notFoundTimes ?? 0)) return json({ error: "Chat id not found or expired" }, 404);
      return json(await (opts.signature ?? (() => ({})))());
    }
    return json({}, 500);
  }) as typeof fetch;
  setVerifyIo({ fetch: fetchFn, sleep: async () => void calls.sleeps++ });
  return calls;
}

const signed = async (key: { address: string; signMessage: (m: string) => Promise<string> }, text: string, kind: string) => ({
  text, signature: await key.signMessage(text), signing_address: key.address, signing_algo: "ecdsa", signature_kind: kind,
});

function setup() {
  const deps = testDeps();
  deps.cfg.NEARAI_API_KEY = "test-key";
  return deps;
}

async function verifyOnce(deps: ReturnType<typeof setup>, turnId = "t1") {
  const events: unknown[] = [];
  const off = subscribe(PET, (e) => events.push(e));
  submitForVerification(deps, { turnId, petRef: PET, model: MODEL, chatId: "chatcmpl-abc", rawRequest: RAW_REQ, rawResponse: RAW_RES });
  await settleVerifications();
  off();
  const row = deps.db.prepare("SELECT * FROM verification WHERE turn_id = ?").get(turnId) as Record<string, unknown>;
  return { row, events };
}

afterEach(() => setVerifyIo());

describe("verification", () => {
  it("model_verified for a provider_tee signature from an attested model key", async () => {
    fakeNet({ signature: () => signed(modelKey, `${MODEL}:${REQ_H}:${RES_H}`, "provider_tee") });
    const deps = setup();
    const { row, events } = await verifyOnce(deps);
    expect(row.status).toBe("model_verified");
    expect(row.signature_kind).toBe("provider_tee");
    expect(row.signer).toBe(modelKey.address.toLowerCase());
    expect(row.req_hash).toBe(REQ_H);
    expect(row.resp_hash).toBe(RES_H);
    expect(row.attestation_id).toBeTruthy();
    expect(events).toEqual([{ petRef: PET, type: "receipt_ready", data: { turn_id: "t1", status: "model_verified" } }]);
  });

  it("gateway_verified for a gateway signature from the attested gateway key", async () => {
    fakeNet({ signature: () => signed(gatewayKey, `${REQ_H}:${RES_H}`, "gateway") });
    const { row } = await verifyOnce(setup());
    expect(row.status).toBe("gateway_verified");
    expect(row.signer).toBe(gatewayKey.address.toLowerCase());
  });

  it("unverified when the signed hash does not match the exchange", async () => {
    fakeNet({ signature: () => signed(modelKey, `${MODEL}:${sha("other request")}:${RES_H}`, "provider_tee") });
    const { row } = await verifyOnce(setup());
    expect(row.status).toBe("unverified");
    expect(row.reason).toMatch(/do not match/);
  });

  it("unverified when the signer is not attested", async () => {
    fakeNet({ signature: () => signed(strangerKey, `${MODEL}:${REQ_H}:${RES_H}`, "provider_tee") });
    const { row } = await verifyOnce(setup());
    expect(row.status).toBe("unverified");
    expect(row.reason).toMatch(/not an attested model key/);
  });

  it("a model key cannot pass as the gateway", async () => {
    fakeNet({ signature: () => signed(modelKey, `${REQ_H}:${RES_H}`, "gateway") });
    const { row } = await verifyOnce(setup());
    expect(row.status).toBe("unverified");
  });

  it("retries 404 then succeeds", async () => {
    const calls = fakeNet({ notFoundTimes: 3, signature: () => signed(modelKey, `${MODEL}:${REQ_H}:${RES_H}`, "provider_tee") });
    const { row } = await verifyOnce(setup());
    expect(row.status).toBe("model_verified");
    expect(calls.signature).toBe(4);
    expect(calls.sleeps).toBe(3);
  });

  it("gives up after 10 tries", async () => {
    const calls = fakeNet({ notFoundTimes: 99 });
    const { row } = await verifyOnce(setup());
    expect(row.status).toBe("unverified");
    expect(row.reason).toBe("signature not found");
    expect(calls.signature).toBe(10);
  });

  it("treats a 2xx with error_code as unavailable", async () => {
    fakeNet({ signature: () => ({ error_code: "not_found" }) });
    const { row } = await verifyOnce(setup());
    expect(row.status).toBe("unverified");
    expect(row.reason).toBe("signature unavailable");
  });

  it("never persists the request or response bytes", async () => {
    fakeNet({ signature: () => signed(modelKey, `${MODEL}:${REQ_H}:${RES_H}`, "provider_tee") });
    const deps = setup();
    await verifyOnce(deps);
    const tables = deps.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    for (const { name } of tables) {
      for (const r of deps.db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[]) {
        for (const v of Object.values(r)) {
          const s = String(v);
          expect(s).not.toContain("SECRET-REQ");
          expect(s).not.toContain("SECRET-RES");
        }
      }
    }
  });
});

describe("attestation", () => {
  it("stores verified signers when nonces match", async () => {
    fakeNet({});
    const deps = setup();
    const a = await refreshAttestation(deps, MODEL);
    expect(a.ok).toBe(true);
    expect(a.modelSigners).toEqual([modelKey.address.toLowerCase()]);
    expect(a.gatewaySigner).toBe(gatewayKey.address.toLowerCase());
  });

  it("rejects a report that does not echo our nonce", async () => {
    fakeNet({ echoNonce: () => "00".repeat(32) });
    const a = await refreshAttestation(setup(), MODEL);
    expect(a.ok).toBe(false);
    expect(a.modelSigners).toEqual([]);
    expect(a.gatewaySigner).toBeNull();
    expect(a.reason).toBe("nonce not echoed");
  });

  it("rejects a model attestation whose NRAS eat_nonce differs, so its signatures stay unverified", async () => {
    fakeNet({ nrasNonce: () => "11".repeat(32), signature: () => signed(modelKey, `${MODEL}:${REQ_H}:${RES_H}`, "provider_tee") });
    const deps = setup();
    const { row } = await verifyOnce(deps);
    expect(latestAttestation(deps, MODEL)?.nras[0]?.reason).toBe("nras nonce mismatch");
    expect(row.status).toBe("unverified");
  });
});

describe("receipt routes", () => {
  it("owner reads the receipt, stranger cannot until published, then anyone can", async () => {
    fakeNet({ signature: () => signed(modelKey, `${MODEL}:${REQ_H}:${RES_H}`, "provider_tee") });
    const deps = setup();
    await verifyOnce(deps);
    const app = createApp(deps, [receiptsModule]);
    const owner = await issueSession(deps, "alice.testnet");
    const bob = await issueSession(deps, "bob.testnet");
    const as = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });

    const r = await app.request("/receipts/t1", as(owner.token));
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, any>;
    expect(body.turn_id).toBe("t1");
    expect(body.pet_ref).toBe(PET);
    expect(body.verification.status).toBe("model_verified");
    expect(body.verification.attestation.nras).toBe("pass");
    expect(body.verification.attestation.tdx).toBe("not checked in app");
    expect(body.fuel).toBeNull(); // no charge_job table in this module's tests

    expect((await app.request("/receipts/t1")).status).toBe(401);
    expect((await app.request("/receipts/t1", as(bob.token))).status).toBe(403);
    expect((await app.request("/receipts/t1/publish", { method: "POST", ...as(bob.token) })).status).toBe(403);
    const pub = await app.request("/receipts/t1/publish", { method: "POST", ...as(owner.token) });
    expect(await pub.json()).toEqual({ public: true });
    expect((await app.request("/receipts/t1")).status).toBe(200);
    expect((await app.request("/receipts/nope", as(owner.token))).status).toBe(404);
  });

  it("lists a pet's published receipts publicly, newest first, at most 20 (D6)", async () => {
    const deps = testDeps();
    const add = deps.db.prepare(
      "INSERT INTO verification (turn_id, pet_ref, model, status, public, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)",
    );
    for (let i = 0; i < 22; i++) add.run(`pub-${i}`, PET, MODEL, 1, 1000 + i, 1000 + i);
    add.run("private-1", PET, MODEL, 0, 5000, 5000);
    add.run("other-pet", "pets.petto.testnet:2", MODEL, 1, 6000, 6000);
    const app = createApp(deps, [receiptsModule]);

    const res = await app.request(`/pets/${PET}/receipts?public=1`);
    expect(res.status).toBe(200);
    const { receipts } = (await res.json()) as { receipts: { turn_id: string; verification: { public: boolean } }[] };
    expect(receipts).toHaveLength(20);
    expect(receipts[0]!.turn_id).toBe("pub-21");
    expect(receipts[19]!.turn_id).toBe("pub-2");
    expect(receipts.every((r) => r.verification.public)).toBe(true);

    // Without public=1 only the owner may list, and sees unpublished ones too.
    expect((await app.request(`/pets/${PET}/receipts`)).status).toBe(401);
    const owner = await issueSession(deps, "alice.testnet");
    const all = (await (await app.request(`/pets/${PET}/receipts`, { headers: { Authorization: `Bearer ${owner.token}` } })).json()) as {
      receipts: { turn_id: string }[];
    };
    expect(all.receipts[0]!.turn_id).toBe("private-1");
    expect((await app.request("/pets/elsewhere.testnet:1/receipts?public=1")).status).toBe(400);
  });

  it("joins turn and charge_job when those tables exist", async () => {
    fakeNet({ signature: () => signed(modelKey, `${MODEL}:${REQ_H}:${RES_H}`, "provider_tee") });
    const deps = setup();
    // turn and charge_job come from the talk migrations (200, 202).
    deps.db.prepare(
      `INSERT INTO turn (id, pet_ref, owner_account, request_id, channel, status, soul_version, model, provider_cost_nano, audio_key, created_at)
       VALUES ('t1', ?, 'alice.testnet', 'r1', 'web', 'done', 2, ?, 71000, 'k', 1762740000000)`,
    ).run(PET, MODEL);
    deps.db.prepare(
      `INSERT INTO charge_job (turn_id, pet_ref, cost_micro, status, attempts, next_attempt_at, tx_hash, charged_micro, source, created_at, updated_at)
       VALUES ('t1', ?, 1000, 'settled', 1, 0, '8Fh2', 1000, 'food', 0, 0)`,
    ).run(PET);
    await verifyOnce(deps);
    const owner = await issueSession(deps, "alice.testnet");
    const res = await createApp(deps, [receiptsModule]).request("/receipts/t1", { headers: { Authorization: `Bearer ${owner.token}` } });
    const body = (await res.json()) as Record<string, any>;
    expect(body.at).toBe(1762740000000);
    expect(body.soul_version).toBe(2);
    expect(body.fuel).toEqual({ cost_micro: 1000, source: "food", tx: "8Fh2", status: "settled" });
    expect(body.provider_cost_usd).toBeCloseTo(0.000071);
    expect(body.voice.provider).toBe("elevenlabs");
  });

  it("GET /attestation is public and summarises the latest per model", async () => {
    fakeNet({});
    const deps = setup();
    await refreshAttestation(deps, MODEL);
    const res = await createApp(deps, [receiptsModule]).request("/attestation");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: Record<string, unknown>[] };
    expect(body.models).toHaveLength(1);
    expect(body.models[0]).toMatchObject({ model: MODEL, nras: "pass", fresh: true, tdx: "not checked in app" });
  });
});
