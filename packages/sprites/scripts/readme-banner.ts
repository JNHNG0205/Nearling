// README banner: every Closet costume on one pet, drawn by the same code as web and device.
// Usage: pnpm --filter @petto/sprites exec tsx scripts/readme-banner.ts [out.png]
import { writeFileSync } from "node:fs";
import { BRAND_BG } from "../src/render";
import { COSTUME_KEYS, SIZE, buildPalette, clip, toRgba } from "../src/index";
import { encodePng } from "../src/png";

const out = process.argv[2] ?? "../../docs/readme-banner.png";
const COLS = 9;
const SCALE = 4;
const CELL = SIZE * SCALE + 24;
const PAD = 32;
const rows = Math.ceil(COSTUME_KEYS.length / COLS);
const W = COLS * CELL + PAD * 2;
const H = rows * CELL + PAD * 2;
const img = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < img.length; i += 4) img.set([...BRAND_BG, 255], i);

const traits = [0, 0, 1, 0, 0]; // mint, belly: the colour of the logo's pets
COSTUME_KEYS.forEach((costume, n) => {
  const c = clip("idle", { stage: "teen", winged: false, costume });
  const rgba = toRgba(c.frames[0]!, buildPalette(traits), null, c.costume![0]);
  const ox = PAD + (n % COLS) * CELL + 12;
  const oy = PAD + Math.floor(n / COLS) * CELL + 12;
  for (let y = 0; y < SIZE * SCALE; y++) {
    for (let x = 0; x < SIZE * SCALE; x++) {
      const s = (Math.floor(y / SCALE) * SIZE + Math.floor(x / SCALE)) * 4;
      if (rgba[s + 3]) img.set(rgba.subarray(s, s + 4), ((oy + y) * W + ox + x) * 4);
    }
  }
});
writeFileSync(out, encodePng(W, H, img));
console.log(`${out}: ${W}x${H}, ${COSTUME_KEYS.length} costumes`);
