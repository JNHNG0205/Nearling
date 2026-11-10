// Per-pet colours from on-chain traits. Index meanings: raster.ts `C`.
// Rule (firmware uses the same): body palette = traits[0] % 8, pattern = traits[2] % 3.

export type Rgb = readonly [number, number, number];

/** [outline, body, shade, light] */
export const BODY_PALETTES: ReadonlyArray<{ name: string; colours: readonly [Rgb, Rgb, Rgb, Rgb] }> = [
  { name: "mint", colours: [[22, 46, 38], [126, 214, 170], [78, 164, 128], [196, 244, 216]] },
  { name: "peach", colours: [[58, 30, 20], [248, 168, 120], [208, 118, 82], [255, 214, 184]] },
  { name: "sky", colours: [[20, 34, 58], [120, 176, 236], [76, 128, 196], [192, 224, 252]] },
  { name: "lemon", colours: [[56, 46, 14], [244, 212, 96], [204, 164, 56], [255, 238, 170]] },
  { name: "coral", colours: [[60, 20, 24], [240, 120, 112], [196, 78, 76], [255, 184, 172]] },
  { name: "sage", colours: [[30, 40, 24], [160, 192, 120], [116, 148, 84], [214, 232, 182]] },
  { name: "sand", colours: [[52, 40, 26], [214, 184, 140], [170, 140, 100], [240, 222, 190]] },
  { name: "rose", colours: [[58, 22, 40], [236, 150, 186], [194, 104, 142], [252, 204, 224]] },
];

const GREY: readonly [Rgb, Rgb, Rgb, Rgb] = [[30, 30, 30], [138, 138, 138], [104, 104, 104], [176, 176, 176]];

const FIXED: Record<number, Rgb> = {
  5: [26, 20, 16], // eye
  6: [255, 255, 255], // white highlight
  7: [242, 139, 155], // cheek
  8: [226, 92, 79], // heart
  9: [223, 231, 255], // fx (z, dots, waves)
  10: [201, 164, 90], // gold (food, sparkles) = UI accent
  11: [245, 241, 230], // wing
  12: [111, 183, 224], // tear
  13: [154, 212, 106], // leaf
};

export type Pattern = "plain" | "belly" | "spots";
export const PATTERNS: readonly Pattern[] = ["plain", "belly", "spots"];

export interface PetPalette {
  name: string;
  pattern: Pattern;
  /** 16 RGB entries; entry 0 is transparent and never drawn. */
  rgb: Rgb[];
}

export function lookFromTraits(traits: readonly number[]): { bodyIndex: number; pattern: Pattern } {
  const t0 = traits[0] ?? 0;
  const t2 = traits[2] ?? 0;
  return { bodyIndex: t0 % BODY_PALETTES.length, pattern: PATTERNS[t2 % PATTERNS.length] ?? "plain" };
}

export function buildPalette(traits: readonly number[], variant: "normal" | "grey" = "normal"): PetPalette {
  const { bodyIndex, pattern } = lookFromTraits(traits);
  const base = BODY_PALETTES[bodyIndex] ?? BODY_PALETTES[0]!;
  const [outline, body, shade, light] = variant === "grey" ? GREY : base.colours;
  const rgb: Rgb[] = new Array(16).fill([0, 0, 0]);
  rgb[1] = outline;
  rgb[2] = body;
  rgb[3] = shade;
  rgb[4] = light;
  for (const [i, c] of Object.entries(FIXED)) rgb[Number(i)] = variant === "grey" ? toGrey(c) : c;
  rgb[14] = pattern === "belly" ? light : body;
  rgb[15] = pattern === "spots" ? shade : body;
  return { name: variant === "grey" ? `${base.name}-grey` : base.name, pattern, rgb };
}

function toGrey([r, g, b]: Rgb): Rgb {
  const y = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
  return [y, y, y];
}
