// Closet costumes (shirts contract `buy(costume)`): pixel layers drawn from the pet's own geometry,
// so every costume fits every stage and animation (squash, jumps, blinks). `back` sits behind the
// pet (wings, capes, flames), `front` over the face (hats, glasses, masks). Indices into
// COSTUME_RGB. Pure: same geometry, same pixels.
import { SIZE, blank, ellipse, get, px, rect, stamp, type Bitmap } from "./raster";

/** Same keys and order as the shirts contract's COSTUMES. */
export const COSTUME_KEYS = [
  "cap", "sunglasses", "fire", "scarf", "ice_cube", "wizard_hat", "pirate_hat", "flower_crown", "top_hat",
  "striped_shirt", "headphones", "detective", "ninja", "devil_wings", "chef_hat", "astronaut", "clown", "cyborg",
  "explorer", "bow_tie", "crown", "fairy_wings", "graduate", "viking", "raincoat", "volcano", "mummy",
  "tuxedo", "ghost", "knight", "angel", "superhero", "cowboy", "party_hat", "sweater", "ice_crystal",
] as const;
export type CostumeKey = (typeof COSTUME_KEYS)[number];

export function isCostume(key: string | null | undefined): key is CostumeKey {
  return !!key && (COSTUME_KEYS as readonly string[]).includes(key);
}

/** Costume palette (index 0 = clear). Glyph digits 1-f below use these. */
export const COSTUME_RGB: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], // 0 clear
  [0x1c, 0x17, 0x14], // 1 black
  [0xf6, 0xf3, 0xec], // 2 white
  [0xd6, 0x3c, 0x3c], // 3 red
  [0xf2, 0x8c, 0x28], // 4 orange
  [0xf6, 0xd2, 0x44], // 5 yellow
  [0x3f, 0xa3, 0x4d], // 6 green
  [0x3a, 0x6f, 0xd8], // 7 blue
  [0x2b, 0x30, 0x6e], // 8 navy
  [0x7c, 0x52, 0xc4], // 9 purple
  [0xf4, 0x9c, 0xc8], // a pink
  [0x8a, 0x5a, 0x2b], // b brown
  [0xd9, 0xb3, 0x7c], // c tan
  [0x8f, 0x90, 0x98], // d grey
  [0xa6, 0xdc, 0xf4], // e ice blue
  [0xf2, 0xb6, 0x32], // f gold
];

/** Where the pet is in this frame (from drawPet). */
export interface CostumeGeom {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** top row of the head (sprout grows above it) */
  top: number;
  /** first row of the eyes */
  ey: number;
  eyeGap: number;
  ground: number;
  wingUp: boolean;
}

export interface CostumeLayers {
  back: Bitmap;
  front: Bitmap;
}

const inBody = (g: CostumeGeom, x: number, y: number, grow = 0) => {
  const dx = (x + 0.5 - g.cx) / (g.rx + grow);
  const dy = (y + 0.5 - g.cy) / (g.ry + grow);
  return dx * dx + dy * dy <= 1;
};

/** Stamp rows centred on x = cx, bottom row at `bottom`. */
function hat(b: Bitmap, g: CostumeGeom, rows: string[], bottom: number, shift = 0): void {
  const w = Math.max(...rows.map((r) => r.length));
  stamp(b, Math.round(g.cx) - Math.floor(w / 2) + shift, bottom - rows.length + 1, rows);
}

/** First row below the mouth, as the shirt layer (pet.ts): squashed bodies still get a few rows. */
const chest = (g: CostumeGeom) => Math.min(g.ey + 5, Math.round(g.cy + g.ry) - 3);

/** Fill the body below `fromRow` with a colour per row (shirts, sweaters, coats). */
function torso(b: Bitmap, g: CostumeGeom, fromRow: number, colour: (x: number, y: number) => number): void {
  for (let y = fromRow; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (inBody(g, x, y)) px(b, x, y, colour(x, y));
}

/** Columns of the two eyes (2 px wide each), so masks leave them showing. */
const eyeCols = (g: CostumeGeom) => {
  const cx = Math.round(g.cx);
  return new Set([cx - g.eyeGap - 1, cx - g.eyeGap, cx + g.eyeGap - 1, cx + g.eyeGap]);
};

/** A band across the face at `rows`, skipping the eye pixels. */
function mask(b: Bitmap, g: CostumeGeom, rows: number[], c: number, grow = 0): void {
  const eyes = eyeCols(g);
  for (const y of rows) for (let x = 0; x < SIZE; x++) if (inBody(g, x, y, grow) && !(eyes.has(x) && y >= g.ey && y <= g.ey + 2)) px(b, x, y, c);
}

/** Pixels on the edge of an ellipse (ring), for bubbles and halos. */
function ring(b: Bitmap, cx: number, cy: number, rx: number, ry: number, c: number): void {
  const tmp = blank();
  ellipse(tmp, cx, cy, rx, ry, 1);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!get(tmp, x, y)) continue;
      if (!get(tmp, x - 1, y) || !get(tmp, x + 1, y) || !get(tmp, x, y - 1) || !get(tmp, x, y + 1)) px(b, x, y, c);
    }
  }
}

function wings(b: Bitmap, g: CostumeGeom, c: number, edge: number, size: number): void {
  const wy = g.cy - g.ry * 0.3 + (g.wingUp ? -2 : 0);
  for (const s of [-1, 1]) {
    const wx = g.cx + s * (g.rx + size * 0.6);
    ellipse(b, wx, wy, size, size * 0.75, c);
    px(b, Math.round(wx + s * size), Math.round(wy - size * 0.75), edge);
  }
}

type Draw = (l: CostumeLayers, g: CostumeGeom) => void;

const DRAW: Record<CostumeKey, Draw> = {
  cap: ({ front }, g) => hat(front, g, [".3333.....", "333333....", "3333333333"], g.top + 1, 1),
  sunglasses: ({ front }, g) => {
    const cx = Math.round(g.cx);
    const w = g.eyeGap * 2 + 4;
    stamp(front, cx - g.eyeGap - 2, g.ey, ["111" + ".".repeat(w - 6) + "111", "1".repeat(w), "121" + ".".repeat(w - 6) + "111"]);
  },
  fire: ({ back, front }, g) => {
    const cx = Math.round(g.cx);
    for (let i = -3; i <= 3; i++) {
      const h = 6 - Math.abs(i) + (i % 2 === 0 ? 1 : 0);
      const x = cx + i * 2;
      for (let j = 0; j < h; j++) px(back, x, g.top - j + 1, j > h - 3 ? 5 : j > h / 2 ? 4 : 3);
    }
    ellipse(back, g.cx, g.cy, g.rx + 2, g.ry + 1.5, 4);
    ellipse(back, g.cx, g.cy - 1, g.rx + 1, g.ry + 0.5, 5, 4);
    for (const x of [cx - g.rx, cx + g.rx]) px(front, x, g.cy + 2, 5);
  },
  scarf: ({ front }, g) => {
    const y = g.ey + 5;
    for (let x = 0; x < SIZE; x++) if (inBody(g, x, y) || inBody(g, x, y + 1)) {
      px(front, x, y, x % 2 ? 7 : 2);
      px(front, x, y + 1, x % 2 ? 2 : 7);
    }
    const tx = Math.round(g.cx + g.rx * 0.5);
    for (let j = 2; j < 6; j++) px(front, tx, y + j, j % 2 ? 7 : 2);
  },
  ice_cube: ({ front }, g) => {
    const x0 = Math.round(g.cx - g.rx - 2), x1 = Math.round(g.cx + g.rx + 1);
    const y0 = g.top - 3, y1 = g.ground + 1;
    for (let x = x0; x <= x1; x++) { px(front, x, y0, 14); px(front, x, y1, 14); }
    for (let y = y0; y <= y1; y++) { px(front, x0, y, 14); px(front, x1, y, 14); }
    for (let i = 0; i < 4; i++) px(front, x0 + 1 + i, y0 + 1 + i, 2);
    px(front, x1 - 1, y0 + 1, 2);
  },
  wizard_hat: ({ front }, g) => hat(front, g, ["....8....", "...888...", "...858...", "..88888..", "..88858..", ".8888888.", "888888888"], g.top + 1),
  pirate_hat: ({ front }, g) => hat(front, g, ["...11111...", "..1112111..", ".111222111.", "11111111111"], g.top + 1),
  flower_crown: ({ front }, g) => hat(front, g, [".a.5.a.5.a.", "66666666666"], g.top + 1),
  top_hat: ({ front }, g) => hat(front, g, [".1111111.", ".1111111.", ".1111111.", ".3333333.", "111111111"], g.top + 1),
  striped_shirt: ({ front }, g) => torso(front, g, chest(g), (_x, y) => ((y - g.ey) % 2 ? 3 : 5)),
  headphones: ({ front }, g) => {
    ring(front, g.cx, g.top + 3, g.rx + 0.5, 4, 8);
    for (let y = g.top + 3; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (get(front, x, y) === 8) front[y * SIZE + x] = 0;
    for (const s of [-1, 1]) rect(front, Math.round(g.cx + s * (g.rx + 0.5)) - 1, g.ey - 1, 2, 4, 7);
  },
  detective: ({ front }, g) => {
    hat(front, g, ["..bbbbb..", ".bcbcbcb.", "bbbbbbbbb", "b.......b"], g.top + 1);
    const mx = Math.round(g.cx + g.rx + 2), my = Math.round(g.cy);
    ring(front, mx, my - 1, 2, 2, 11);
    px(front, mx, my - 1, 14);
    px(front, mx - 1, my + 1, 11);
    px(front, mx - 2, my + 2, 11);
  },
  ninja: ({ front }, g) => {
    for (let y = g.top - 1; y < g.ey; y++) for (let x = 0; x < SIZE; x++) if (inBody(g, x, y, 0.5)) px(front, x, y, 1);
    mask(front, g, [g.ey + 3, g.ey + 4, g.ey + 5], 1);
    rect(front, Math.round(g.cx + g.rx) - 1, g.ey - 2, 4, 1, 3);
    rect(front, Math.round(g.cx + g.rx) + 1, g.ey - 1, 2, 1, 3);
  },
  devil_wings: ({ back, front }, g) => {
    wings(back, g, 3, 1, 3.5);
    hat(front, g, ["3.......3", "33.....33"], g.top + 1);
  },
  chef_hat: ({ front }, g) => hat(front, g, [".222.222.", "222222222", "22222222d", ".2222222.", ".ddddddd."], g.top + 1),
  astronaut: ({ front }, g) => {
    ring(front, g.cx, g.cy - 1, g.rx + 2.5, g.ry + 3, 14);
    px(front, Math.round(g.cx - g.rx), g.top, 2);
    px(front, Math.round(g.cx - g.rx) + 1, g.top - 1, 2);
    for (let x = 0; x < SIZE; x++) if (inBody(g, x, g.ground - 2)) px(front, x, g.ground - 2, 13);
  },
  clown: ({ back, front }, g) => {
    const colours = [3, 4, 5, 6, 7, 9];
    colours.forEach((c, i) => {
      const a = Math.PI * (0.95 + (i / (colours.length - 1)) * 1.1);
      ellipse(back, g.cx + Math.cos(a) * (g.rx + 1), g.top + 3 + Math.sin(a) * 4, 2.2, 2.2, c);
    });
    rect(front, Math.round(g.cx) - 1, g.ey + 3, 2, 2, 3);
  },
  cyborg: ({ front }, g) => {
    const cx = Math.round(g.cx);
    rect(front, cx - g.eyeGap - 2, g.ey, g.eyeGap * 2 + 4, 1, 1);
    rect(front, cx - g.eyeGap - 2, g.ey + 1, g.eyeGap * 2 + 4, 1, 3);
    rect(front, cx - g.eyeGap - 2, g.ey + 2, g.eyeGap * 2 + 4, 1, 1);
    for (let y = g.top; y < g.ey; y++) for (let x = 0; x < cx - 1; x++) if (inBody(g, x, y)) px(front, x, y, 13);
  },
  explorer: ({ front }, g) => hat(front, g, ["...ccccc...", "..ccccccc..", "..bbbbbbb..", "ccccccccccc"], g.top + 1),
  bow_tie: ({ front }, g) => stamp(front, Math.round(g.cx) - 3, g.ey + 6, ["55..55", "555555", "55..55"]),
  crown: ({ front }, g) => hat(front, g, ["f.f.f.f.f", "fffffffff", "f3fff7fff", "fffffffff"], g.top + 1),
  fairy_wings: ({ back, front }, g) => {
    wings(back, g, 14, 2, 4);
    for (const [dx, dy] of [[-g.rx - 4, -6], [g.rx + 4, -7], [g.rx + 2, 3]] as const) stamp(front, Math.round(g.cx + dx), Math.round(g.cy + dy), [".5.", "555", ".5."]);
  },
  graduate: ({ front }, g) => {
    hat(front, g, ["....5......", "11111111111", "...11111...", "...11111..."], g.top + 1);
    const cx = Math.round(g.cx);
    for (const ex of [cx - g.eyeGap - 2, cx + g.eyeGap - 2]) {
      rect(front, ex, g.ey - 1, 4, 1, 1);
      rect(front, ex, g.ey + 3, 4, 1, 1);
      px(front, ex, g.ey, 1); px(front, ex, g.ey + 1, 1); px(front, ex, g.ey + 2, 1);
      px(front, ex + 3, g.ey, 1); px(front, ex + 3, g.ey + 1, 1); px(front, ex + 3, g.ey + 2, 1);
    }
  },
  viking: ({ front }, g) => hat(front, g, ["2.........2", "22.ddddd.22", ".2ddddddd2.", "..ddddddd..", "..fffffff.."], g.top + 2),
  raincoat: ({ front }, g) => {
    for (let y = g.top - 1; y < g.ey + 4; y++) for (let x = 0; x < SIZE; x++) {
      if (inBody(g, x, y, 1) && !inBody(g, x, y, -0.5)) px(front, x, y, 5);
      if (y < g.ey - 1 && inBody(g, x, y, 1)) px(front, x, y, 5);
    }
    torso(front, g, chest(g), (x) => (x === Math.round(g.cx) ? 4 : 5));
  },
  volcano: ({ back, front }, g) => {
    const cx = Math.round(g.cx);
    const base = g.ground + 1, peak = g.cy + 1;
    for (let y = peak; y <= base; y++) {
      const half = 3 + Math.round(((y - peak) / (base - peak)) * (g.rx + 5));
      for (let x = cx - half; x <= cx + half; x++) px(front, x, y, x === cx - half || x === cx + half ? 1 : 11);
    }
    for (const [dx, len] of [[-2, 3], [1, 4], [3, 2]] as const) for (let j = 0; j < len; j++) px(front, cx + dx, peak + j, 4);
    for (const [dx, dy] of [[-2, -3], [1, -5], [-1, -7]] as const) ellipse(back, g.cx + dx, g.top + dy, 1.8, 1.4, 13);
  },
  mummy: ({ front }, g) => {
    for (let y = g.top; y < SIZE; y++) {
      if (y >= g.ey && y <= g.ey + 2) continue;
      if ((y - g.top) % 3 === 2) continue;
      for (let x = 0; x < SIZE; x++) if (inBody(g, x, y)) px(front, x, y, (x + y) % 5 === 0 ? 12 : 2);
    }
  },
  tuxedo: ({ front }, g) => {
    const cx = Math.round(g.cx);
    torso(front, g, chest(g), (x, y) => (Math.abs(x + 0.5 - g.cx) <= 1 + (y - g.ey - 5) * 0.4 ? 2 : 1));
    stamp(front, cx - 2, g.ey + 5, ["33.33", "33333"]);
  },
  ghost: ({ front }, g) => {
    for (let y = g.top - 2; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      if (!inBody(g, x, y, 1.5) || y > g.ground - (x % 3 === 0 ? 1 : 0)) continue;
      px(front, x, y, 2);
    }
    const cx = Math.round(g.cx);
    rect(front, cx - g.eyeGap - 1, g.ey, 2, 3, 1);
    rect(front, cx + g.eyeGap - 1, g.ey, 2, 3, 1);
    rect(front, cx - 1, g.ey + 4, 2, 2, 1);
  },
  knight: ({ back, front }, g) => {
    for (let y = g.top - 1; y < g.ey; y++) for (let x = 0; x < SIZE; x++) if (inBody(g, x, y, 0.5)) px(front, x, y, 13);
    rect(front, Math.round(g.cx) - 1, g.top - 4, 2, 3, 3);
    const sx = Math.round(g.cx + g.rx + 2);
    for (let j = 0; j < 8; j++) px(back, sx, g.cy - 6 + j, j < 6 ? 13 : 11);
    rect(back, sx - 1, g.cy, 3, 1, 15);
  },
  angel: ({ back, front }, g) => {
    wings(back, g, 2, 2, 3);
    ring(front, g.cx, g.top - 3, 4, 1.2, 15);
  },
  superhero: ({ back, front }, g) => {
    for (let y = g.ey; y <= g.ground; y++) {
      const half = g.rx + 1 + Math.round((y - g.ey) * 0.25);
      for (let x = Math.round(g.cx - half); x <= Math.round(g.cx + half); x++) px(back, x, y, 3);
    }
    mask(front, g, [g.ey - 1, g.ey, g.ey + 1, g.ey + 2], 3, -1);
  },
  cowboy: ({ front }, g) => hat(front, g, ["....bbbbb....", "...bbbbbbb...", "...b11111b...", "bbbbbbbbbbbbb", ".bbbbbbbbbbb."], g.top + 1),
  party_hat: ({ front }, g) => hat(front, g, ["...2...", "...a...", "..a5a..", "..5a5..", ".a5a5a.", "5a5a5a5"], g.top + 1),
  sweater: ({ front }, g) => torso(front, g, chest(g), (x, y) => (y === g.ey + 5 ? 6 : (y - g.ey) % 4 === 0 && x % 2 ? 2 : 6)),
  ice_crystal: ({ back }, g) => {
    const cx = Math.round(g.cx);
    for (const [dx, h] of [[-g.rx - 1, 5], [-g.rx + 3, 7], [0, 8], [g.rx - 3, 7], [g.rx + 1, 5]] as const) {
      for (let j = 0; j < h; j++) {
        px(back, cx + dx, g.cy - g.ry - j + 2, j > h - 2 ? 2 : 14);
        if (j < h - 3) px(back, cx + dx + 1, g.cy - g.ry - j + 2, 14);
      }
    }
    ellipse(back, g.cx, g.cy + 1, g.rx + 2, g.ry + 1, 14);
  },
};

/** The costume's two layers for this frame, or null for no or an unknown costume. */
export function drawCostume(key: string | null | undefined, g: CostumeGeom): CostumeLayers | null {
  if (!isCostume(key)) return null;
  const layers = { back: blank(), front: blank() };
  DRAW[key](layers, g);
  return layers;
}
