// Tiny indexed-colour raster for 32x32 pixel art. 0 = transparent.

export const SIZE = 32;
export type Bitmap = Uint8Array; // SIZE * SIZE palette indices

/** Palette indices. 16 colours so frames pack to 4 bits per pixel for the ESP32. */
export const C = {
  clear: 0,
  outline: 1,
  body: 2,
  shade: 3,
  light: 4,
  eye: 5,
  white: 6,
  cheek: 7,
  heart: 8,
  fx: 9,
  gold: 10,
  wing: 11,
  tear: 12,
  leaf: 13,
  belly: 14, // mapped per pet: light (belly pattern) or body (plain)
  spot: 15, // mapped per pet: shade (spots pattern) or body (plain)
} as const;

/** Shirt overlay layer indices (its own 4-entry palette, `PetPalette.shirt`). Drawn over the frame where non-zero. */
export const SHIRT = { clear: 0, cloth: 1, shade: 2, trim: 3 } as const;

export function blank(): Bitmap {
  return new Uint8Array(SIZE * SIZE);
}

export function px(b: Bitmap, x: number, y: number, c: number): void {
  if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) b[y * SIZE + x] = c;
}

export function get(b: Bitmap, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return 0;
  return b[y * SIZE + x] ?? 0;
}

/** Filled ellipse sampled at pixel centres. `only` limits painting to pixels already of that index. */
export function ellipse(b: Bitmap, cx: number, cy: number, rx: number, ry: number, c: number, only?: number): void {
  if (rx <= 0 || ry <= 0) return;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1 && (only === undefined || get(b, x, y) === only)) px(b, x, y, c);
    }
  }
}

export function rect(b: Bitmap, x: number, y: number, w: number, h: number, c: number): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(b, x + i, y + j, c);
}

/**
 * Stamp a tiny glyph. Rows are strings; '.' or ' ' = leave as is, '0'-'9' and 'a'-'f' = palette index.
 */
export function stamp(b: Bitmap, x: number, y: number, rows: readonly string[]): void {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === undefined || ch === "." || ch === " ") continue;
      px(b, x + i, y + j, parseInt(ch, 16));
    }
  });
}

/** 1 px outline around every non-transparent pixel (4-neighbour), drawn into transparent pixels. */
export function outline(b: Bitmap, c: number): void {
  const src = b.slice();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (get(src, x, y) !== 0) continue;
      if (get(src, x - 1, y) || get(src, x + 1, y) || get(src, x, y - 1) || get(src, x, y + 1)) px(b, x, y, c);
    }
  }
}

/** Pack to 4 bits per pixel, high nibble first (firmware format). */
export function pack4(b: Bitmap): Uint8Array {
  const out = new Uint8Array(b.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = (((b[2 * i] ?? 0) & 15) << 4) | ((b[2 * i + 1] ?? 0) & 15);
  return out;
}
