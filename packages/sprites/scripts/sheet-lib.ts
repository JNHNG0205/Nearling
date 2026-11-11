// Shared review-sheet renderer: one row per clip, frames (or chosen columns) scaled ×4 on the UI background.
import { SIZE, paletteFor, toRgba, type Clip } from "../src/index";
import { encodePng } from "../src/png";

export interface SheetRow {
  clip: Clip;
  traits: readonly number[];
  shirt: string | null;
}

/** Default: every frame of the clip with the row's shirt. `columns`: fixed frame + shirt per column instead. */
export function renderSheet(rows: SheetRow[], opts: { columns?: { frame: number; shirt: string | null }[] } = {}): Buffer {
  const SCALE = 4;
  const CELL = SIZE * SCALE + 8;
  const colsOf = (r: SheetRow) => opts.columns ?? r.clip.frames.map((_, frame) => ({ frame, shirt: r.shirt }));
  const cols = Math.max(...rows.map((r) => colsOf(r).length));
  const W = cols * CELL;
  const H = rows.length * CELL;
  const img = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) img.set([12, 10, 8, 255], i * 4); // --p-bg

  rows.forEach((r, row) => {
    colsOf(r).forEach(({ frame, shirt }, col) => {
      const f = r.clip.frames[frame];
      if (!f) return;
      const rgba = toRgba(f, paletteFor(r.traits, r.clip, shirt), r.clip.shirt?.[frame]);
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
  return encodePng(W, H, img);
}
