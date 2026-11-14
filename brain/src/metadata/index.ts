import { Hono } from "hono";
import { parsePetRef } from "@petto/shared";
import type { Deps, Module } from "../deps";
import { subscribeAll } from "../events";
import { fail, servedPet, servedPetRef } from "../identity/common";
import { log } from "../log";
import { listPets } from "../proactive/pets";
import { buildPetState } from "../routes/pets";
import { lookSig } from "./build";
import { createPinata, type Pinata } from "./pinata";
import {
  createDebouncer, createFeatureCheck, latestMetadata, syncOnChain, syncPetMetadata, type FeatureCheck, type Timers,
} from "./sync";

export { buildPetMetadata, type PetMetadata } from "./build";
export { createPinata } from "./pinata";

const DEBOUNCE_MS = 60_000;
const WATCH_MS = 60_000;
const CHAIN_RETRY_MS = 10 * 60_000;
const ON_CHAIN_TTL_MS = 30_000;
/** Bus events that change the public look (identity/care.ts, hatch.ts, closet.ts). */
export const LOOK_EVENTS = new Set(["evolved", "hatched", "closet_equipped"]);

export interface MetadataOptions {
  fetchFn?: typeof fetch;
  timers?: Timers;
}

/** True when the NFT's NEP-177 `reference` points at our JSON CID (cached 30 s per pet). */
function createOnChainCheck(deps: Deps) {
  const cache = new Map<string, { at: number; reference: string | null }>();
  return async (petRef: string, jsonCid: string): Promise<boolean> => {
    const ref = parsePetRef(petRef);
    if (!ref) return false;
    let hit = cache.get(petRef);
    if (!hit || deps.now() - hit.at >= ON_CHAIN_TTL_MS) {
      try {
        const t = await deps.chain.view<{ metadata?: { reference?: string | null } } | null>(ref.contract, "nft_token", {
          token_id: ref.tokenId,
        });
        hit = { at: deps.now(), reference: t?.metadata?.reference ?? null };
        cache.set(petRef, hit);
      } catch {
        return false;
      }
    }
    return hit.reference === `ipfs://${jsonCid}`;
  };
}

export function metadataRoutes(deps: Deps, pinata: Pinata) {
  const app = new Hono();
  const onChain = createOnChainCheck(deps);
  /** Public: the latest pinned metadata of a pet (no private data is ever pinned). */
  app.get("/pets/:petRef/metadata", servedPet(deps), async (c) => {
    const ref = servedPetRef(deps, c.req.param("petRef"))!;
    const row = latestMetadata(deps.db, ref.petRef);
    if (!row) return fail(c, 404, "not_found", "No IPFS metadata for this pet yet");
    return c.json({
      version: row.version,
      json_cid: row.json_cid,
      png_cid: row.png_cid,
      gateway_url: pinata.gatewayUrl(row.json_cid),
      image_url: pinata.gatewayUrl(row.png_cid),
      pinned_at: row.pinned_at,
      on_chain: await onChain(ref.petRef, row.json_cid),
    });
  });
  return app;
}

/** Background: bus events and a 60 s look check trigger a debounced re-pin per pet. */
export function startMetadataSync(deps: Deps, pinata: Pinata, opts: MetadataOptions = {}): () => void {
  if (!pinata.enabled) {
    log.warn("PINATA_JWT is not set: pet metadata is not pinned to IPFS");
    return () => {};
  }
  const hasSetMetadata: FeatureCheck = createFeatureCheck(deps);
  const lastChainTry = new Map<string, number>();
  const saveSig = (petRef: string, sig: string) =>
    deps.db
      .prepare(
        `INSERT INTO pet_metadata_watch (pet_ref, sig, checked_at) VALUES (?, ?, ?)
         ON CONFLICT(pet_ref) DO UPDATE SET sig = excluded.sig, checked_at = excluded.checked_at`,
      )
      .run(petRef, sig, deps.now());

  const debouncer = createDebouncer(
    DEBOUNCE_MS,
    async (petRef) => {
      const r = await syncPetMetadata(deps, pinata, petRef, hasSetMetadata);
      if (r.status === "pinned" || r.status === "unchanged") saveSig(petRef, r.sig);
    },
    opts.timers,
  );

  const unsubscribe = subscribeAll((e) => {
    if (LOOK_EVENTS.has(e.type)) debouncer.trigger(e.petRef);
  });

  let running = false;
  async function watch() {
    if (running) return;
    running = true;
    try {
      for (const p of await listPets(deps)) {
        try {
          const state = await buildPetState(deps, p.contract, p.tokenId);
          if (!state) continue;
          const seen = deps.db.prepare("SELECT sig FROM pet_metadata_watch WHERE pet_ref = ?").get(p.petRef) as
            | { sig: string }
            | undefined;
          if (seen?.sig !== lookSig(state)) {
            debouncer.trigger(p.petRef);
            continue;
          }
          const row = latestMetadata(deps.db, p.petRef);
          const last = lastChainTry.get(p.petRef) ?? 0;
          if (row && row.chain_synced_at === null && deps.now() - last >= CHAIN_RETRY_MS) {
            lastChainTry.set(p.petRef, deps.now());
            await syncOnChain(deps, row, hasSetMetadata);
          }
        } catch (err) {
          log.warn("metadata watch failed for pet", { pet_ref: p.petRef, error: err instanceof Error ? err.name : "unknown" });
        }
      }
    } finally {
      running = false;
    }
  }

  const t = setInterval(() => void watch(), WATCH_MS);
  return () => {
    clearInterval(t);
    unsubscribe();
    debouncer.stop();
  };
}

export function metadataModule(opts: MetadataOptions = {}): Module {
  let pinata: Pinata | null = null;
  const get = (deps: Deps) => (pinata ??= createPinata(deps.cfg, opts.fetchFn));
  return {
    name: "metadata",
    routes: (deps) => metadataRoutes(deps, get(deps)),
    start: (deps) => startMetadataSync(deps, get(deps), opts),
  };
}
