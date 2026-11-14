import { renderPetPng } from "@petto/sprites/render";
import { STAGES, parsePetRef } from "@petto/shared";
import type { Deps } from "../deps";
import { buildPetState } from "../routes/pets";

/**
 * The pet's public metadata JSON (docs/IPFS.md). Only public data: everything here is already
 * readable on chain (name, Soul, traits, stage) or is the public look (form, equipped shirt NFT).
 * Never: chat, memories, nickname, owner time zone, care stats, device, owner account.
 */
export interface PetMetadata {
  name: string;
  description: string;
  soul: { version: number; prompt: string };
  traits: { playful: number; curious: number; calm: number; sassy: number; kind: number };
  stage: string;
  form: "base" | "winged";
  equipped_shirt: string | null;
  contract: string;
  token_id: string;
  image: string;
  external_url: string;
  attributes: { trait_type: string; value: string | number; display_type?: "number" }[];
}

const TRAIT_NAMES = ["playful", "curious", "calm", "sassy", "kind"] as const;
const DEFAULT_DESCRIPTION = "A Petto: an AI pet on NEAR that pays for its own private AI brain.";
export const DESCRIPTION_MAX_BYTES = 200;
/** 32 px sprite x 8 = 256 px image. */
export const IMAGE_SCALE = 8;

/** First `max` bytes of `s` as UTF-8, never cutting a character in half. */
export function utf8Prefix(s: string, max: number): string {
  let out = "";
  let used = 0;
  for (const ch of s) {
    const n = Buffer.byteLength(ch, "utf8");
    if (used + n > max) break;
    out += ch;
    used += n;
  }
  return out;
}

export interface BuiltMetadata {
  /** The idle frame PNG (same sprites as web and device). */
  png: Buffer;
  /** Look signature: changes when anything that affects the JSON or the PNG changes. */
  sig: string;
  /** The JSON for a given image CID. */
  json(pngCid: string): PetMetadata;
}

/** Look signature from public state, without reading the Soul text (the 60 s watch job). */
export function lookSig(s: { name: string; soul_version: number; stage_index: number; form: string; equipped_shirt: string | null; traits: number[] }): string {
  return JSON.stringify([s.name, s.soul_version, s.stage_index, s.form, s.equipped_shirt, s.traits]);
}

/** Builds the public metadata for one pet, or null if the token does not exist. */
export async function buildPetMetadata(deps: Deps, petRef: string): Promise<BuiltMetadata | null> {
  const ref = parsePetRef(petRef);
  if (!ref) return null;
  const state = await buildPetState(deps, ref.contract, ref.tokenId);
  if (!state) return null;
  const soul = state.soul_version > 0 ? await deps.chain.getSoul(ref.contract, ref.tokenId) : { version: 0, prompt: "" };
  const t = state.traits;
  const traits = {
    playful: t[0] ?? 0, curious: t[1] ?? 0, calm: t[2] ?? 0, sassy: t[3] ?? 0, kind: t[4] ?? 0,
  };
  const stage = STAGES[state.stage_index] ?? "adult";
  const png = renderPetPng({
    traits: state.traits,
    stageIndex: state.stage_index,
    winged: state.form === "winged",
    shirt: state.equipped_shirt,
    scale: IMAGE_SCALE,
    background: "brand",
  });
  const description = soul.version > 0 && soul.prompt.trim()
    ? utf8Prefix(soul.prompt.trim(), DESCRIPTION_MAX_BYTES)
    : DEFAULT_DESCRIPTION;
  const web = deps.cfg.PUBLIC_WEB_URL.replace(/\/+$/, "");
  return {
    png,
    sig: lookSig(state),
    json: (pngCid) => ({
      name: state.name,
      description,
      soul: { version: soul.version, prompt: soul.prompt },
      traits,
      stage,
      form: state.form,
      equipped_shirt: state.equipped_shirt,
      contract: ref.contract,
      token_id: ref.tokenId,
      image: `ipfs://${pngCid}`,
      external_url: `${web}/p/${encodeURIComponent(petRef)}`,
      attributes: [
        ...TRAIT_NAMES.map((n) => ({
          trait_type: n[0]!.toUpperCase() + n.slice(1), value: traits[n], display_type: "number" as const,
        })),
        { trait_type: "Stage", value: stage },
        { trait_type: "Form", value: state.form === "winged" ? "Winged" : "Base" },
        { trait_type: "Soul version", value: soul.version, display_type: "number" as const },
        { trait_type: "Shirt", value: state.equipped_shirt === null ? "None" : `#${state.equipped_shirt}` },
      ],
    }),
  };
}
