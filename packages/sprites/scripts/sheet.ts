// Review sheet: every animation (rows) x frames (columns), scaled up, on the UI background.
// Usage: pnpm --filter @nearling/sprites sheet [out.png] [stage] [winged] [traits csv]
import { writeFileSync } from "node:fs";
import { EGG_ANIMS, PET_ANIMS, SIZE, clip, paletteFor, toRgba, type AnyAnim, type Stage } from "../src/index";
import { encodePng } from "./png";

const [out = "sheet.png", stageArg = "adult", wingedArg = "0", traitsArg = "0,0,1,0,0"] = process.argv.slice(2);
const stage = stageArg as Stage;
const winged = wingedArg === "1";
const traits = traitsArg.split(",").map(Number);

const SCALE = 4;
const CELL = SIZE * SCALE + 8;
const names: AnyAnim[] = stage === "egg" ? (Object.keys(EGG_ANIMS) as AnyAnim[]) : (Object.keys(PET_ANIMS) as AnyAnim[]);
const clips = names.map((n) => clip(n, { stage, winged }));
const cols = Math.max(...clips.map((c) => c.frames.length));
const W = cols * CELL;
const H = clips.length * CELL;
const img = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) img.set([12, 10, 8, 255], i * 4); // --p-bg

clips.forEach((c, row) => {
  const pal = paletteFor(traits, c);
  c.frames.forEach((f, col) => {
    const rgba = toRgba(f, pal);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const s = (y * SIZE + x) * 4;
        if (rgba[s + 3] === 0) continue;
        for (let sy = 0; sy < SCALE; sy++) {
          for (let sx = 0; sx < SCALE; sx++) {
            const X = col * CELL + 4 + x * SCALE + sx;
            const Y = row * CELL + 4 + y * SCALE + sy;
            img.set([rgba[s]!, rgba[s + 1]!, rgba[s + 2]!, 255], (Y * W + X) * 4);
          }
        }
      }
    }
  });
});

writeFileSync(out, encodePng(W, H, img));
console.log(`wrote ${out}: ${clips.map((c) => `${c.name}(${c.frames.length})`).join(" ")}`);
