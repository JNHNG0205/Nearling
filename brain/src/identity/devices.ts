import { markHatched } from "./hatch";
import { randomBytes, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { baseDecode } from "near-api-js";
import { z } from "zod";
import { actionSummary, type PendingAction } from "@petto/shared";
import { requireCaller, requirePetAccess, sha256, type AuthEnv } from "../auth/guard";
import type { Db } from "../db/db";
import type { Deps, Module } from "../deps";
import { publish } from "../events";
import { log } from "../log";
import { ensureProfile } from "../profiles";
import { fail, jsonBody, servedPet, servedPetRef } from "./common";

// Hatch & Pair (AI-brain architectual/05 sections 1 and 2).

const PAIRING_TTL_MS = 10 * 60_000;

type PairingStatus = "open" | "claimed" | "awaiting_confirm" | "confirmed" | "expired" | "cancelled";

interface DeviceRow {
  id: string;
  hw_id: string;
  secret_hash: string;
  pet_ref: string | null;
  owner_account: string | null;
  revoked_at: number | null;
}

interface PairingRow {
  id: string;
  device_id: string;
  token: string;
  status: PairingStatus;
  pet_ref: string | null;
  owner_account: string | null;
  expires_at: number;
}

const LIVE: PairingStatus[] = ["open", "claimed", "awaiting_confirm"];

/** `device` part of `PetState` (GET /pets/:petRef/state). */
export function deviceStatus(db: Db, petRef: string): { paired: boolean; last_seen_at: number | null } {
  const row = db
    .prepare("SELECT last_seen_at FROM device WHERE pet_ref = ? AND revoked_at IS NULL ORDER BY bound_at DESC LIMIT 1")
    .get(petRef) as { last_seen_at: number | null } | undefined;
  return { paired: !!row, last_seen_at: row?.last_seen_at ?? null };
}

/** Marks a live pairing past its expiry as expired, so it can never bind. */
function settle(db: Db, p: PairingRow | undefined, now: number): PairingRow | undefined {
  if (p && LIVE.includes(p.status) && p.expires_at <= now) {
    db.prepare("UPDATE pairing SET status = 'expired' WHERE id = ?").run(p.id);
    return { ...p, status: "expired" };
  }
  return p;
}

const isBound = (d: DeviceRow) => d.pet_ref !== null && d.revoked_at === null;

const Hello = z.object({
  hw_id: z.string().min(1).max(64),
  device_secret: z.string().min(16).max(128),
  fw_version: z.string().max(32).optional(),
  device_pk: z.string().max(60).refine(isEd25519Pk).optional(),
});

/** `ed25519:<base58>` of a 32-byte public key (the device's limited access key, CLAUDE.md 7.2). */
export function isEd25519Pk(s: string): boolean {
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  try {
    return baseDecode(s.slice("ed25519:".length)).length === 32;
  } catch {
    return false;
  }
}

/** A pending on-chain action as the device shows it (GET /devices/actions, `action_pending` event). */
export interface DeviceAction extends PendingAction {
  /** ms */
  expires_at: number;
  /** One line for the 240x240 screen, e.g. "Stake 1 NEAR". */
  summary: string;
}

/** `get_pending_actions(pet_id)` without expired entries (the contract rejects approving those). */
export async function pendingActions(deps: Deps, contract: string, tokenId: string, petName?: string): Promise<DeviceAction[]> {
  const list = await deps.chain.view<PendingAction[]>(contract, "get_pending_actions", { pet_id: tokenId });
  return list
    .map((a) => ({ ...a, expires_at: Number(BigInt(a.expires_at_ns) / 1_000_000n), summary: actionSummary(a.action, petName) }))
    .filter((a) => a.expires_at > deps.now());
}

/**
 * One poll round: for every pet with a bound device, publishes `action_pending` when its list of
 * pending action ids changed since the last round. `last` holds the previous ids per pet.
 */
export async function pollPendingActions(deps: Deps, last: Map<string, string>): Promise<void> {
  const refs = (
    deps.db.prepare("SELECT DISTINCT pet_ref FROM device WHERE revoked_at IS NULL AND pet_ref IS NOT NULL").all() as { pet_ref: string }[]
  ).map((r) => r.pet_ref);
  for (const key of [...last.keys()]) if (!refs.includes(key)) last.delete(key);
  for (const petRef of refs) {
    const ref = servedPetRef(deps, petRef);
    if (!ref) continue;
    try {
      const pet = await deps.chain.getPet(ref.contract, ref.tokenId);
      if (!pet) continue;
      const actions = await pendingActions(deps, ref.contract, ref.tokenId, pet.name);
      const ids = actions.map((a) => a.id).join(",");
      if (ids === (last.get(petRef) ?? "")) continue;
      last.set(petRef, ids);
      publish(petRef, "action_pending", { actions, approval_mode: pet.approval_mode });
    } catch (err) {
      log.warn("action_poll_failed", { pet_ref: petRef, err: String(err).slice(0, 200) });
    }
  }
}

const ACTION_POLL_MS = 10_000;

export function deviceRoutes(deps: Deps) {
  const { db, now, chain, cfg } = deps;
  const app = new Hono<AuthEnv>();

  const latestPairing = (deviceId: string) =>
    settle(
      db,
      db.prepare("SELECT * FROM pairing WHERE device_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(deviceId) as
        | PairingRow
        | undefined,
      now(),
    );

  /** Device secret auth for GET /devices/pairing and confirm: headers X-Device-Id (hw_id), X-Device-Secret. */
  const secretDevice = (c: Context) => {
    const hwId = c.req.header("X-Device-Id");
    const secret = c.req.header("X-Device-Secret");
    if (!hwId || !secret) return null;
    const d = db.prepare("SELECT * FROM device WHERE hw_id = ?").get(hwId) as DeviceRow | undefined;
    return d && d.secret_hash === sha256(secret) ? d : null;
  };

  const revoke = (where: string, ...args: unknown[]) =>
    db.prepare(`UPDATE device SET revoked_at = ?, token_hash = NULL WHERE revoked_at IS NULL AND ${where}`).run(now(), ...args);

  app.post("/devices/hello", async (c) => {
    const body = Hello.safeParse(await jsonBody(c));
    if (!body.success) return fail(c, 400, "invalid", "Expected hw_id, device_secret and an optional ed25519 device_pk");
    const { hw_id, device_secret, fw_version, device_pk } = body.data;

    let d = db.prepare("SELECT * FROM device WHERE hw_id = ?").get(hw_id) as DeviceRow | undefined;
    if (!d) {
      const id = randomUUID();
      db.prepare(
        "INSERT INTO device (id, hw_id, secret_hash, fw_version, device_pk, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(id, hw_id, sha256(device_secret), fw_version ?? null, device_pk ?? null, now(), now());
      d = db.prepare("SELECT * FROM device WHERE id = ?").get(id) as DeviceRow;
      log.info("device_registered", { device: id });
    } else if (d.secret_hash !== sha256(device_secret)) {
      return fail(c, 401, "unauthorized", "Wrong device secret");
    } else {
      db.prepare(
        "UPDATE device SET fw_version = COALESCE(?, fw_version), device_pk = COALESCE(?, device_pk), last_seen_at = ? WHERE id = ?",
      ).run(fw_version ?? null, device_pk ?? null, now(), d.id);
    }

    // A bound device whose pet changed hands is revoked here too (same rule as the guard).
    if (isBound(d)) {
      const ref = servedPetRef(deps, d.pet_ref!);
      let owner: string | null | undefined;
      try {
        owner = ref ? ((await chain.getPet(ref.contract, ref.tokenId))?.owner ?? null) : null;
      } catch {
        owner = undefined; // RPC outage: keep the binding, the guard re-checks on every pet route
      }
      if (owner === undefined || owner === d.owner_account) return c.json({ bound: true, pet_ref: d.pet_ref });
      revoke("id = ?", d.id);
    }

    let p = latestPairing(d.id);
    if (!p || !LIVE.includes(p.status)) {
      const token = randomBytes(16).toString("base64url");
      db.prepare("INSERT INTO pairing (id, device_id, token, status, created_at, expires_at) VALUES (?, ?, ?, 'open', ?, ?)").run(
        randomUUID(), d.id, token, now(), now() + PAIRING_TTL_MS,
      );
      p = latestPairing(d.id)!;
    }
    return c.json({
      bound: false,
      pairing: { token: p.token, qr_url: `${cfg.PUBLIC_WEB_URL}/hatch?t=${p.token}`, expires_at: p.expires_at },
    });
  });

  app.get("/devices/pairing", async (c) => {
    const d = secretDevice(c);
    if (!d) return fail(c, 401, "unauthorized", "Unknown device");
    const p = latestPairing(d.id);
    if (!p) return fail(c, 404, "not_found", "No pairing; call /devices/hello");
    let pet_name: string | undefined;
    if (p.status === "awaiting_confirm" && p.pet_ref) {
      const ref = servedPetRef(deps, p.pet_ref);
      pet_name = ref ? (await chain.getPet(ref.contract, ref.tokenId))?.name : undefined;
    }
    return c.json({ status: p.status, pet_name, expires_at: p.expires_at });
  });

  app.post("/devices/pairing/confirm", async (c) => {
    const d = secretDevice(c);
    if (!d) return fail(c, 401, "unauthorized", "Unknown device");
    const p = latestPairing(d.id);
    if (!p) return fail(c, 404, "not_found", "No pairing");
    if (p.status === "expired") return fail(c, 410, "expired", "Pairing expired");
    if (p.status !== "awaiting_confirm" || !p.pet_ref || !p.owner_account) {
      return fail(c, 409, "conflict", "Pairing is not waiting for confirmation");
    }
    // Fresh owner check: the pet may have moved since the claim.
    const ref = servedPetRef(deps, p.pet_ref);
    const pet = ref ? await chain.getPet(ref.contract, ref.tokenId) : null;
    if (!pet || pet.owner !== p.owner_account) return fail(c, 403, "not_owner", "The pet has a new owner");

    const deviceToken = randomBytes(32).toString("base64url");
    const bound = db.transaction(() => {
      // Single use: only the first confirm moves the pairing on.
      const r = db.prepare("UPDATE pairing SET status = 'confirmed' WHERE id = ? AND status = 'awaiting_confirm'").run(p.id);
      if (r.changes !== 1) return false;
      revoke("pet_ref = ? AND id != ?", p.pet_ref, d.id); // the pet's previous device
      db.prepare(
        "UPDATE device SET token_hash = ?, pet_ref = ?, owner_account = ?, bound_at = ?, revoked_at = NULL, last_seen_at = ? WHERE id = ?",
      ).run(sha256(deviceToken), p.pet_ref, p.owner_account, now(), now(), d.id); // replaces this device's previous binding
      ensureProfile(db, p.pet_ref!, p.owner_account!, now());
      return true;
    })();
    if (!bound) return fail(c, 409, "conflict", "Pairing already used");
    publish(p.pet_ref, "paired", { device_id: d.id });
    markHatched(deps, p.pet_ref!, p.owner_account!); // Build Spec 1: "Pair Mochi?" press hatches the egg
    log.info("device_paired", { device: d.id, pet_ref: p.pet_ref });
    return c.json({ device_token: deviceToken, pet_ref: p.pet_ref });
  });

  app.get("/pairings/:token", (c) => {
    const p = settle(db, db.prepare("SELECT * FROM pairing WHERE token = ?").get(c.req.param("token")) as PairingRow | undefined, now());
    if (!p) return fail(c, 404, "not_found", "No such pairing");
    return c.json({ status: p.status, expires_at: p.expires_at });
  });

  app.post("/pairings/:token/claim", requireCaller(deps, ["owner"]), async (c) => {
    const caller = c.get("caller");
    const p = settle(db, db.prepare("SELECT * FROM pairing WHERE token = ?").get(c.req.param("token")) as PairingRow | undefined, now());
    if (!p) return fail(c, 404, "not_found", "No such pairing");
    if (p.status === "expired") return fail(c, 410, "expired", "Pairing expired");
    if (p.status !== "open") return fail(c, 409, "conflict", "Pairing already claimed");

    const body = (await jsonBody(c)) as { pet_ref?: unknown } | null;
    const ref = typeof body?.pet_ref === "string" ? servedPetRef(deps, body.pet_ref) : null;
    if (!ref) return fail(c, 400, "invalid", "Unknown pet reference");
    const pet = await chain.getPet(ref.contract, ref.tokenId);
    if (!pet) return fail(c, 404, "not_found", "No such pet");
    if (pet.owner !== caller.account) return fail(c, 403, "not_owner", "Only the pet's owner can pair it");

    const r = db
      .prepare("UPDATE pairing SET status = 'awaiting_confirm', pet_ref = ?, owner_account = ? WHERE id = ? AND status = 'open' AND expires_at > ?")
      .run(ref.petRef, caller.account, p.id, now());
    if (r.changes !== 1) return fail(c, 409, "conflict", "Pairing already claimed");
    return c.json({ status: "awaiting_confirm" });
  });

  app.post("/pets/:petRef/unpair", servedPet(deps), requirePetAccess(deps, ["owner"]), (c) => {
    const ref = servedPetRef(deps, c.req.param("petRef"))!;
    const r = revoke("pet_ref = ?", ref.petRef);
    log.info("device_unpaired", { pet_ref: ref.petRef, devices: r.changes });
    return c.json({ ok: true });
  });

  // Device page status (owner): brain pairing, the device's key, the key on chain and on the owner's account.
  app.get("/pets/:petRef/device", servedPet(deps), requirePetAccess(deps, ["owner"]), async (c) => {
    const ref = servedPetRef(deps, c.req.param("petRef"))!;
    const pet = (await chain.getPet(ref.contract, ref.tokenId))!;
    const row = db
      .prepare("SELECT device_pk, last_seen_at FROM device WHERE pet_ref = ? AND revoked_at IS NULL ORDER BY bound_at DESC LIMIT 1")
      .get(ref.petRef) as { device_pk: string | null; last_seen_at: number | null } | undefined;
    const devicePk = row?.device_pk ?? null;
    let keyAdded: boolean | null = false;
    if (devicePk) {
      try {
        const keys = await chain.accessKeys(pet.owner);
        keyAdded = keys.some((k) => {
          const perm = k.access_key.permission;
          return (
            k.public_key === devicePk &&
            typeof perm === "object" &&
            "FunctionCall" in perm &&
            (perm.FunctionCall as { receiver_id: string }).receiver_id === ref.contract
          );
        });
      } catch {
        keyAdded = null; // RPC outage: unknown
      }
    }
    return c.json({
      paired: !!row,
      device_pk: devicePk,
      last_seen_at: row?.last_seen_at ?? null,
      chain_device_pk: pet.device_pk,
      key_added: keyAdded,
      approval_mode: pet.approval_mode,
      pantry_supported: pet.pantry_yocto !== undefined,
    });
  });

  // On-chain pending actions for the device's approve screen (CLAUDE.md 7.3 step 2).
  app.get("/devices/actions", requireCaller(deps, ["device"]), async (c) => {
    const caller = c.get("caller");
    if (caller.kind !== "device") return fail(c, 401, "unauthorized", "Device token required");
    const ref = servedPetRef(deps, caller.petRef);
    if (!ref) return fail(c, 400, "invalid", "Unknown pet reference");
    const pet = await chain.getPet(ref.contract, ref.tokenId);
    if (!pet) return fail(c, 404, "not_found", "No such pet");
    if (pet.owner !== caller.account) {
      revoke("id = ?", caller.deviceId);
      return fail(c, 403, "not_owner", "The pet has a new owner");
    }
    const row = db.prepare("SELECT device_pk FROM device WHERE id = ?").get(caller.deviceId) as { device_pk: string | null } | undefined;
    const actions = await pendingActions(deps, ref.contract, ref.tokenId, pet.name);
    return c.json({
      pet_ref: ref.petRef,
      contract: ref.contract,
      pet_id: ref.tokenId,
      approval_mode: pet.approval_mode,
      key_registered: !!row?.device_pk && row.device_pk === pet.device_pk,
      actions,
    });
  });

  return app;
}

export const devicesModule: Module = {
  name: "devices",
  routes: (deps) => new Hono().route("/", deviceRoutes(deps)),
  start: (deps) => {
    const last = new Map<string, string>();
    let running = false;
    const id = setInterval(() => {
      if (running) return;
      running = true;
      void pollPendingActions(deps, last).finally(() => (running = false));
    }, ACTION_POLL_MS);
    return () => clearInterval(id);
  },
};
