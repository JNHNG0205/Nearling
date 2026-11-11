// Node-side pet image: the idle frame as PNG bytes (NFT media on IPFS). Same frames as web and device.
// Node only (uses node:zlib); import from "@nearling/sprites/render", never from the browser bundle.
import { SIZE, clip, paletteFor, stageFromChain, toRgba } from "./index";
import { encodePng } from "./png";

/** Brand background (web `--p-bg`, #0c0a08). */
export const BRAND_BG: readonly [number, number, number] = [0x0c, 0x0a, 0x08];

export interface RenderPetOptions {
  traits: readonly number[];
  /** Contract stage index: 0 egg, 1 baby, 2 teen, 3 adult. */
  stageIndex: number;
  winged: boolean;
  /** Equipped Closet shirt token id, or null. */
  shirt: string | null;
  /** Integer upscale (nearest neighbour), 1 to 32. */
  scale: number;
  /** "transparent" (default) or "brand". */
  background?: "transparent" | "brand";
}

/** PNG bytes of the pet's idle frame (egg_idle for an egg). Deterministic: same input, same bytes. */
export function renderPetPng(opts: RenderPetOptions): Buffer {
  const look = { stage: stageFromChain(opts.stageIndex), winged: opts.winged, shirt: opts.shirt };
  const c = clip("idle", look);
  const frame = c.frames[0];
  const shirt = c.shirt?.[0] ?? null;
  const rgba = frame
    ? toRgba(frame, paletteFor(opts.traits, c, opts.shirt), shirt)
    : new Uint8ClampedArray(SIZE * SIZE * 4);
  if (opts.background === "brand") {
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] === 0) {
        rgba[i] = BRAND_BG[0];
        rgba[i + 1] = BRAND_BG[1];
        rgba[i + 2] = BRAND_BG[2];
        rgba[i + 3] = 255;
      }
    }
  }
  const scale = Math.max(1, Math.min(32, Math.round(opts.scale) || 1));
  const w = SIZE * scale;
  const out = new Uint8ClampedArray(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const src = (Math.floor(y / scale) * SIZE + Math.floor(x / scale)) * 4;
      out.set(rgba.subarray(src, src + 4), (y * w + x) * 4);
    }
  }
  return encodePng(w, w, out);
}
