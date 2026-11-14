import { type Context, Hono } from "hono";
import { parsePetRef, type Receipt } from "@nearling/shared";
import { type AttestationRow, ATTESTATION_TTL_MS, knownModels, refreshAttestation } from "../ai/attestation";
import { type AuthEnv, requireCaller } from "../auth/guard";
import type { Db } from "../db/db";
import type { Deps, Module } from "../deps";
import { servedPetRef } from "../identity/common";
import { log } from "../log";

const LIST_LIMIT = 20;

/** Receipts and attestation summary (AI-brain 03 section 7, 08 "Talk and receipts"). */

interface VerificationRow {
  turn_id: string;
  pet_ref: string;
  model: string;
  status: string;
  signature_kind: string | null;
  req_hash: string | null;
  resp_hash: string | null;
  signer: string | null;
  attestation_id: string | null;
  reason: string | null;
  public: number;
  created_at: number;
}
interface TurnRow {
  pet_ref?: string;
  created_at?: number;
  soul_version?: number | null;
  model?: string | null;
  provider_cost_nano?: number | null;
  audio_key?: string | null;
}
interface ChargeRow {
  cost_micro?: number | null;
  charged_micro?: number | null;
  source?: string | null;
  tx_hash?: string | null;
  status?: string | null;
}

/** `turn` and `charge_job` belong to the talk/fuel areas; read them only if they exist. */
function optionalRow<T>(db: Db, sql: string, id: string): T | null {
  try {
    return (db.prepare(sql).get(id) as T | undefined) ?? null;
  } catch (e) {
    if (e instanceof Error && /no such (table|column)/.test(e.message)) return null;
    throw e;
  }
}

const nras = (a: AttestationRow | null) => (a ? (a.ok ? "pass" : "fail") : null);

function buildReceipt(db: Db, turnId: string, ttsProvider = "elevenlabs"): { public: boolean; petRef: string; body: Receipt } | null {
  const v = db.prepare("SELECT * FROM verification WHERE turn_id = ?").get(turnId) as VerificationRow | undefined;
  const t = optionalRow<TurnRow>(db, "SELECT * FROM turn WHERE id = ?", turnId);
  if (!v && !t) return null;
  const ch = optionalRow<ChargeRow>(db, "SELECT * FROM charge_job WHERE turn_id = ?", turnId);
  const att = v?.attestation_id
    ? ((db.prepare("SELECT * FROM attestation WHERE id = ?").get(v.attestation_id) as AttestationRow | undefined) ?? null)
    : null;
  const petRef = (v?.pet_ref ?? t?.pet_ref) as string;
  return {
    public: v?.public === 1,
    petRef,
    body: {
      turn_id: turnId,
      pet_ref: petRef,
      at: t?.created_at ?? v?.created_at ?? null,
      soul_version: t?.soul_version ?? null,
      model: t?.model ?? v?.model ?? null,
      verification: {
        status: v?.status ?? "pending",
        signature_kind: v?.signature_kind ?? null,
        signer: v?.signer ?? null,
        req_hash: v?.req_hash ?? null,
        resp_hash: v?.resp_hash ?? null,
        reason: v?.reason ?? null,
        public: v?.public === 1,
        attestation: att
          ? { id: att.id, fetched_at: att.fetched_at, nras: nras(att), tdx: att.tdx, nras_jwt_signature: "not checked in app" }
          : null,
      },
      fuel: ch
        ? { cost_micro: ch.charged_micro ?? ch.cost_micro ?? null, source: ch.source ?? null, tx: ch.tx_hash ?? null, status: ch.status ?? null }
        : null,
      provider_cost_usd: typeof t?.provider_cost_nano === "number" ? t.provider_cost_nano / 1e9 : null,
      voice: t?.audio_key
        ? { provider: ttsProvider, note: "reply text sent to a third-party voice service" }
        : null,
    },
  };
}

/** Who voiced the audio: the configured provider; "none" now means it was voiced before voice was switched off. */
const voiceProvider = (deps: Deps) => (deps.cfg.TTS_PROVIDER === "none" ? undefined : deps.cfg.TTS_PROVIDER);

export function receiptRoutes(deps: Deps) {
  const app = new Hono();
  const owner = requireCaller(deps, ["owner"]);
  const notFound = { error: { code: "not_found", message: "No such receipt" } };

  /** Runs the owner guard inline; returns a Response to send if the caller does not own the pet. */
  async function checkOwner(ctx: Context, petRef: string): Promise<Response | null> {
    const c = ctx as unknown as Context<AuthEnv>;
    let passed = false;
    const denied = await owner(c, async () => {
      passed = true;
    });
    if (!passed) return denied ?? c.json({ error: { code: "unauthorized", message: "Sign in first" } }, 401);
    const ref = parsePetRef(petRef);
    const pet = ref ? await deps.chain.getPet(ref.contract, ref.tokenId) : null;
    if (!pet) return c.json(notFound, 404);
    if (pet.owner !== c.get("caller").account) {
      return c.json({ error: { code: "not_owner", message: "Only the pet's owner can do that" } }, 403);
    }
    return null;
  }

  app.get("/receipts/:turnId", async (c) => {
    const r = buildReceipt(deps.db, c.req.param("turnId"), voiceProvider(deps));
    if (!r) return c.json(notFound, 404);
    if (!r.public) {
      const denied = await checkOwner(c, r.petRef);
      if (denied) return denied;
    }
    return c.json(r.body);
  });

  /**
   * D6: receipts of one pet, newest first, at most 20. `?public=1` lists only published ones and
   * needs no sign-in (for `/p/[petRef]`); without it the owner sees all of them.
   */
  app.get("/pets/:petRef/receipts", async (c) => {
    const ref = servedPetRef(deps, c.req.param("petRef"));
    if (!ref) return c.json({ error: { code: "invalid", message: "Unknown pet reference" } }, 400);
    const onlyPublic = c.req.query("public") === "1";
    if (!onlyPublic) {
      const denied = await checkOwner(c, ref.petRef);
      if (denied) return denied;
    }
    const rows = deps.db
      .prepare(
        `SELECT turn_id FROM verification WHERE pet_ref = ? ${onlyPublic ? "AND public = 1" : ""}
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(ref.petRef, LIST_LIMIT) as { turn_id: string }[];
    const receipts = rows.flatMap((r) => {
      const b = buildReceipt(deps.db, r.turn_id, voiceProvider(deps));
      return b ? [b.body] : [];
    });
    return c.json({ receipts });
  });

  app.post("/receipts/:turnId/publish", async (c) => {
    const turnId = c.req.param("turnId");
    const v = deps.db.prepare("SELECT pet_ref FROM verification WHERE turn_id = ?").get(turnId) as
      | { pet_ref: string }
      | undefined;
    if (!v) return c.json(notFound, 404);
    const denied = await checkOwner(c, v.pet_ref);
    if (denied) return denied;
    deps.db.prepare("UPDATE verification SET public = 1, updated_at = ? WHERE turn_id = ?").run(deps.now(), turnId);
    log.info("receipt published", { turn_id: turnId });
    return c.json({ public: true });
  });

  app.get("/attestation", (c) => {
    const rows = deps.db
      .prepare(
        `SELECT a.* FROM attestation a
         WHERE a.rowid = (SELECT b.rowid FROM attestation b WHERE b.model = a.model ORDER BY b.fetched_at DESC, b.rowid DESC LIMIT 1)
         ORDER BY a.model`,
      )
      .all() as AttestationRow[];
    return c.json({
      models: rows.map((a) => ({
        model: a.model,
        attestation_id: a.id,
        fetched_at: a.fetched_at,
        fresh: deps.now() - a.fetched_at < ATTESTATION_TTL_MS,
        nras: nras(a),
        model_signers: JSON.parse(a.model_signers) as string[],
        gateway_signer: a.gateway_signer,
        tdx: a.tdx,
        nras_jwt_signature: "not checked in app",
        reason: a.reason,
      })),
    });
  });

  return app;
}

/** Keeps every recently used model's attestation warm (refresh every 30 min). */
function startAttestationRefresh(deps: Deps): () => void {
  const timer = setInterval(() => {
    for (const model of knownModels(deps)) void refreshAttestation(deps, model);
  }, ATTESTATION_TTL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

export const receiptsModule: Module = { name: "receipts", routes: receiptRoutes, start: startAttestationRefresh };
