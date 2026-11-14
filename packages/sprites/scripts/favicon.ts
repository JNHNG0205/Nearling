// Site icons from the logo's pet (mint baby), drawn by the same code as the app:
// web/app/icon.png (tab, transparent), apple-icon.png (home screen, brand background),
// favicon.ico (a 32 px PNG inside an ICO, for browsers that ask for /favicon.ico).
// Usage: pnpm --filter @petto/sprites exec tsx scripts/favicon.ts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BRAND_BG } from "../src/render";
import { SIZE, buildPalette, clip, toRgba } from "../src/index";
import { encodePng } from "../src/png";

const out = resolve(import.meta.dirname, "../../../web/app");
const c = clip("idle", { stage: "baby", winged: false });
const rgba = toRgba(c.frames[0]!, buildPalette([0, 0, 1, 0, 0]), null);

// tight square around the drawn pixels, one pixel of margin
let [x0, y0, x1, y1] = [SIZE, SIZE, 0, 0];
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (!rgba[(y * SIZE + x) * 4 + 3]) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
}
const side = Math.max(x1 - x0, y1 - y0) + 3;
const ox = x0 - Math.floor((side - (x1 - x0 + 1)) / 2);
const oy = y0 - Math.floor((side - (y1 - y0 + 1)) / 2);

/** The cropped pet scaled to `px` (nearest neighbour), on `bg` or transparent. */
function render(px: number, bg?: readonly number[]): Buffer {
  const img = new Uint8ClampedArray(px * px * 4);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const sx = ox + Math.floor((x * side) / px);
      const sy = oy + Math.floor((y * side) / px);
      const inside = sx >= 0 && sy >= 0 && sx < SIZE && sy < SIZE;
      const s = (sy * SIZE + sx) * 4;
      const d = (y * px + x) * 4;
      if (inside && rgba[s + 3]) img.set(rgba.subarray(s, s + 4), d);
      else if (bg) img.set([...bg, 255], d);
    }
  }
  return encodePng(px, px, img);
}

/** ICO container holding one PNG image (supported by every current browser). */
function ico(png: Buffer, px: number): Buffer {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4); // reserved, type icon, 1 image
  head.writeUInt8(px % 256, 6); head.writeUInt8(px % 256, 7); // width, height (0 = 256)
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12); // planes, bits per pixel
  head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18); // size, offset
  return Buffer.concat([head, png]);
}

writeFileSync(resolve(out, "icon.png"), render(64));
writeFileSync(resolve(out, "apple-icon.png"), render(180, BRAND_BG));
writeFileSync(resolve(out, "favicon.ico"), ico(render(32), 32));
console.log(`icons written to ${out} (pet crop ${side}x${side} px)`);
