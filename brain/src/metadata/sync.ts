import { createHash } from "node:crypto";
import { parsePetRef } from "@nearling/shared";
import type { Db } from "../db/db";
import type { Deps } from "../deps";
import { log } from "../log";
import { buildPetMetadata } from "./build";
import type { Pinata } from "./pinata";

export interface MetadataRow {
  pet_ref: string;
  version: number;
  json_cid: string;
  png_cid: string;
  json_sha256: string;
  png_sha256: string;
  pinned_at: number;
  chain_synced_at: number | null;
}

export function latestMetadata(db: Db, petRef: string): MetadataRow | null {
  return (
    (db.prepare("SELECT * FROM pet_metadata WHERE pet_ref = ? ORDER BY version DESC LIMIT 1").get(petRef) as
      | MetadataRow
      | undefined) ?? null
  );
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest();

// ---------- set_metadata feature detection (pets-v9, docs/CONTRACT_CHANGES_V9.md section 2) ----------

const MISSING_RECHECK_MS = 10 * 60_000;

/**
 * Whether a contract has `set_metadata`, from a free view call with empty args: a missing method
 * gives "method is not found" (MethodNotFound); a present one panics on its arguments. Network
 * errors give null (unknown, try again next time). Present is cached for good, missing for 10 min.
 */
export function createFeatureCheck(deps: Deps) {
  const cache = new Map<string, { has: boolean; at: number }>();
  const warned = new Set<string>();
  return async function hasSetMetadata(contract: string): Promise<boolean | null> {
    const hit = cache.get(contract);
    if (hit && (hit.has || deps.now() - hit.at < MISSING_RECHECK_MS)) return hit.has;
    let has: boolean | null;
    try {
      await deps.chain.view(contract, "set_metadata", {});
      has = true; // a view that succeeds still means the method exists
    } catch (err) {
      const msg = `${err instanceof Error ? `${err.name} ${err.message}` : String(err)}`;
      if (/MethodNotFound|method is not found/i.test(msg)) has = false;
      else if (/GuestPanic|ProhibitedInView|\bE_[A-Z_]+:|deserialize/i.test(msg)) has = true;
      else has = null;
    }
    if (has !== null) cache.set(contract, { has, at: deps.now() });
    if (has === false && !warned.has(contract)) {
      warned.add(contract);
      log.info("set_metadata not on this contract yet; IPFS pins are kept off chain", { contract });
    }
    return has;
  };
}

export type FeatureCheck = ReturnType<typeof createFeatureCheck>;

/** Calls `set_metadata` for the latest pinned version if the contract has it and it is not synced yet. */
export async function syncOnChain(deps: Deps, row: MetadataRow, hasSetMetadata: FeatureCheck): Promise<boolean> {
  if (row.chain_synced_at !== null) return true;
  const ref = parsePetRef(row.pet_ref);
  if (!ref) return false;
  if ((await hasSetMetadata(ref.contract)) !== true) return false;
  const signer = deps.brain?.forContract(ref.contract) ?? null;
  if (!signer) {
    log.warn("set_metadata skipped: no brain signer for contract", { contract: ref.contract });
    return false;
  }
  const b64 = (hex: string) => Buffer.from(hex, "hex").toString("base64");
  try {
    const out = await signer.call(ref.contract, "set_metadata", {
      pet_id: ref.tokenId,
      media: `ipfs://${row.png_cid}`,
      media_hash: b64(row.png_sha256),
      reference: `ipfs://${row.json_cid}`,
      reference_hash: b64(row.json_sha256),
    });
    deps.db
      .prepare("UPDATE pet_metadata SET chain_synced_at = ? WHERE pet_ref = ? AND version = ?")
      .run(deps.now(), row.pet_ref, row.version);
    log.info("set_metadata done", { pet_ref: row.pet_ref, version: row.version, tx: out.txHash });
    return true;
  } catch (err) {
    log.warn("set_metadata failed", { pet_ref: row.pet_ref, error: err instanceof Error ? err.message.slice(0, 160) : "unknown" });
    return false;
  }
}

export type SyncResult =
  | { status: "disabled" | "not_found" }
  | { status: "pinned" | "unchanged"; row: MetadataRow; sig: string };

/**
 * Rebuilds the pet's public JSON and PNG, pins only what changed (by sha256 of the exact bytes),
 * records a new version when the JSON changed, then mirrors it on chain where supported.
 */
export async function syncPetMetadata(deps: Deps, pinata: Pinata, petRef: string, hasSetMetadata: FeatureCheck): Promise<SyncResult> {
  if (!pinata.enabled) return { status: "disabled" };
  const built = await buildPetMetadata(deps, petRef);
  if (!built) return { status: "not_found" };
  const latest = latestMetadata(deps.db, petRef);
  const ref = parsePetRef(petRef)!;
  const base = `nearling-${ref.contract}-${ref.tokenId}`;

  const pngSha = sha256(built.png).toString("hex");
  const pngCid = latest?.png_sha256 === pngSha ? latest.png_cid : await pinata.pin(built.png, `${base}.png`, "image/png");
  const jsonBytes = Buffer.from(JSON.stringify(built.json(pngCid)), "utf8");
  const jsonSha = sha256(jsonBytes).toString("hex");

  let row: MetadataRow;
  let status: "pinned" | "unchanged";
  if (latest && latest.json_sha256 === jsonSha) {
    row = latest;
    status = "unchanged";
  } else {
    const jsonCid = await pinata.pin(jsonBytes, `${base}.json`, "application/json");
    row = {
      pet_ref: petRef,
      version: (latest?.version ?? 0) + 1,
      json_cid: jsonCid,
      png_cid: pngCid,
      json_sha256: jsonSha,
      png_sha256: pngSha,
      pinned_at: deps.now(),
      chain_synced_at: null,
    };
    deps.db
      .prepare(
        `INSERT INTO pet_metadata (pet_ref, version, json_cid, png_cid, json_sha256, png_sha256, pinned_at)
         VALUES (@pet_ref, @version, @json_cid, @png_cid, @json_sha256, @png_sha256, @pinned_at)`,
      )
      .run(row);
    status = "pinned";
    log.info("pet metadata pinned", { pet_ref: petRef, version: row.version, json_cid: jsonCid, png_cid: pngCid });
  }
  if (await syncOnChain(deps, row, hasSetMetadata)) row = latestMetadata(deps.db, petRef) ?? row;
  return { status, row, sig: built.sig };
}

// ---------- per-pet debounce ----------

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Coalesces triggers per pet: the first trigger runs `run(key)` after `ms`; triggers while one is
 * pending are absorbed. So a pet syncs at most once per `ms` (the v9 contract allows one
 * `set_metadata` per pet per minute).
 */
export function createDebouncer(ms: number, run: (key: string) => Promise<unknown>, timers: Timers = realTimers) {
  const pending = new Map<string, unknown>();
  return {
    trigger(key: string) {
      if (pending.has(key)) return;
      pending.set(
        key,
        timers.set(() => {
          pending.delete(key);
          run(key).catch((err: unknown) =>
            log.warn("pet metadata sync failed", { pet_ref: key, error: err instanceof Error ? err.message.slice(0, 160) : "unknown" }),
          );
        }, ms),
      );
    },
    pending: () => [...pending.keys()],
    stop() {
      for (const h of pending.values()) timers.clear(h);
      pending.clear();
    },
  };
}
