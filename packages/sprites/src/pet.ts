// Draws one frame of a Nearling from a pose. Pure function: same pose, same pixels,
// so web, brain and the firmware export always agree.
import { C, SIZE, blank, ellipse, outline, px, rect, stamp, type Bitmap } from "./raster";

export type Eyes = "open" | "blink" | "closed" | "happy" | "dizzy" | "up" | "half" | "sad" | "big";
export type Mouth = "smile" | "open" | "o" | "flat" | "frown" | "wavy" | "chomp" | "none";
export type BodyStage = "baby" | "teen" | "adult";

export interface Fx {
  kind: "heart" | "z" | "dot" | "wave" | "sparkle" | "tear" | "food" | "crumb" | "star" | "rumble";
  x: number; // relative to the body centre
  y: number;
}

export interface Pose {
  dx: number; // body offset
  dy: number; // negative = up (jump)
  squash: number; // 0..3, flattens the body
  eyes: Eyes;
  mouth: Mouth;
  cheeks: boolean;
  wingUp: boolean; // flap phase
  wingSize: 0 | 1 | 2; // 0 none, 1 growing, 2 full (only drawn on winged pets, or during evolve)
  fx: Fx[];
}

export const BASE_POSE: Pose = {
  dx: 0, dy: 0, squash: 0, eyes: "open", mouth: "smile", cheeks: false, wingUp: false, wingSize: 2, fx: [],
};

const GROUND = 29; // body bottom row

const BODY: Record<BodyStage, { rx: number; ry: number; sprout: number }> = {
  baby: { rx: 8, ry: 7, sprout: 1 },
  teen: { rx: 9, ry: 8, sprout: 2 },
  adult: { rx: 10, ry: 9, sprout: 3 },
};

const EYES: Record<Eyes, { rows: string[]; ox: number; oy: number }> = {
  open: { rows: ["56", "55", "55"], ox: 0, oy: 0 },
  big: { rows: ["566", "556", "555", "555"], ox: 0, oy: -1 },
  blink: { rows: ["55"], ox: 0, oy: 2 },
  closed: { rows: ["555"], ox: 0, oy: 2 },
  happy: { rows: [".5.", "5.5"], ox: 0, oy: 1 },
  dizzy: { rows: ["5.5", ".5.", "5.5"], ox: 0, oy: 0 },
  up: { rows: ["56", "55", ".."], ox: 0, oy: -1 },
  half: { rows: ["55", "55"], ox: 0, oy: 1 },
  sad: { rows: ["5.", "56", "55"], ox: 0, oy: 0 },
};

const MOUTHS: Record<Mouth, string[]> = {
  smile: ["5.5", ".5."],
  open: ["555", "575", "555"],
  o: [".5.", "5.5", ".5."],
  flat: ["555"],
  frown: [".5.", "5.5"],
  wavy: [".5.5", "5.5."],
  chomp: ["5.5.5", ".5.5."],
  none: [],
};

const FX: Record<Fx["kind"], string[]> = {
  heart: ["8.8", "888", ".8."],
  z: ["999", "..9", ".9.", "999"],
  dot: ["9"],
  wave: ["9.", ".9", "9."],
  sparkle: [".a.", "aaa", ".a."],
  tear: ["c", "c"],
  food: [".aa.", "aaaa", "aaaa", ".aa."],
  crumb: ["a"],
  star: ["a"],
  rumble: ["9.9"],
};

export interface PetLook {
  stage: BodyStage;
  winged: boolean;
}

export function drawPet(pose: Pose, look: PetLook): Bitmap {
  const b = blank();
  const { rx: brx, ry: bry, sprout } = BODY[look.stage];
  const squash = Math.max(0, Math.min(3, pose.squash));
  const ry = bry - squash;
  const rx = brx + (squash > 0 ? 1 : 0) + (squash > 2 ? 1 : 0);
  const cx = SIZE / 2 + pose.dx;
  const cy = GROUND - ry + pose.dy;

  // 1. wings (behind the body)
  // Small wings tucked high on the sides so they stay inside the 32 px frame;
  // folded away when curled up (squash 3, dormant).
  const wingSize = look.winged && squash < 3 ? pose.wingSize : 0;
  if (wingSize > 0) {
    const wy = cy - ry * 0.45 + (pose.wingUp ? -2 : 0);
    const wrx = wingSize === 2 ? 3 : 2;
    const wry = wingSize === 2 ? 2.5 : 1.5;
    const off = brx - 0.5 + wrx * 0.6; // unsquashed width, so a squashed body never pushes wings out of frame
    ellipse(b, cx - off, wy, wrx, wry, C.wing);
    ellipse(b, cx + off, wy, wrx, wry, C.wing);
    // wing tips flick up
    px(b, Math.round(cx - off - wrx + 0.5), Math.round(wy - wry), C.wing);
    px(b, Math.round(cx + off + wrx - 1.5), Math.round(wy - wry), C.wing);
  }

  // 2. feet, body, sprout
  rect(b, Math.round(cx - rx / 2) - 2, GROUND - 1 + Math.min(0, pose.dy), 3, 2, C.shade);
  rect(b, Math.round(cx + rx / 2) - 1, GROUND - 1 + Math.min(0, pose.dy), 3, 2, C.shade);
  ellipse(b, cx, cy, rx, ry, C.body);
  const top = Math.round(cy - ry);
  const sx = Math.round(cx);
  for (let i = 1; i <= sprout; i++) px(b, sx, top - i, C.leaf);
  px(b, sx + 1, top - sprout, C.leaf);
  if (sprout >= 2) px(b, sx - 1, top - sprout + 1, C.leaf);
  if (sprout >= 3) px(b, sx + 2, top - sprout - 1, C.leaf);

  // 3. shading inside the body only
  ellipse(b, cx + 1, cy + 2, rx, ry, C.shade, C.body); // lower-right shade
  ellipse(b, cx, cy, rx - 1, ry - 1.5, C.body, C.shade); // keep the middle bright
  ellipse(b, cx, cy + ry * 0.45, rx * 0.55, ry * 0.4, C.belly, C.body); // belly (pattern)
  px(b, Math.round(cx - rx / 2), Math.round(cy - ry / 2), C.light); // highlight
  px(b, Math.round(cx - rx / 2) + 1, Math.round(cy - ry / 2), C.light);
  px(b, Math.round(cx - rx / 2), Math.round(cy - ry / 2) + 1, C.light);
  for (const [sx2, sy2] of [[0.45, -0.1], [0.6, 0.35], [-0.65, 0.3]] as const) {
    const x = Math.round(cx + sx2 * rx);
    const y = Math.round(cy + sy2 * ry);
    px(b, x, y, C.spot);
    px(b, x + 1, y, C.spot);
  }

  outline(b, C.outline);

  // 4. face
  const ey = Math.round(cy - 2 + (squash > 1 ? 1 : 0));
  const e = EYES[pose.eyes];
  const eyeGap = look.stage === "baby" ? 3 : 4;
  stamp(b, Math.round(cx) - eyeGap - 1 + e.ox, ey + e.oy, e.rows);
  stamp(b, Math.round(cx) + eyeGap - 1 + e.ox, ey + e.oy, e.rows);
  if (pose.cheeks) {
    px(b, Math.round(cx) - eyeGap - 3, ey + 3, C.cheek);
    px(b, Math.round(cx) + eyeGap + 2, ey + 3, C.cheek);
  }
  const m = MOUTHS[pose.mouth];
  const mw = m[0]?.length ?? 0;
  stamp(b, Math.round(cx) - Math.floor(mw / 2), ey + 4, m);

  // 5. effects, positioned from the body centre
  for (const f of pose.fx) stamp(b, Math.round(cx + f.x), Math.round(cy + f.y), FX[f.kind]);
  return b;
}

export interface EggPose {
  dx: number;
  crack: 0 | 1 | 2 | 3; // 3 = burst
  fx: Fx[];
}

export function drawEgg(pose: EggPose): Bitmap {
  const b = blank();
  const cx = SIZE / 2 + pose.dx;
  const cy = GROUND - 9;
  if (pose.crack < 3) {
    ellipse(b, cx, cy, 7, 9, C.light);
    ellipse(b, cx + 1, cy + 2, 7, 9, C.body, C.light);
    ellipse(b, cx, cy, 6, 8, C.light, C.body);
    for (const [x, y] of [[-3, -3], [2, 1], [-2, 4], [3, -5]] as const) {
      px(b, Math.round(cx + x), cy + y, C.spot);
      px(b, Math.round(cx + x) + 1, cy + y, C.spot);
    }
    outline(b, C.outline);
    if (pose.crack >= 1) stamp(b, Math.round(cx) - 4, cy - 1, ["1.1.1", ".1.1."]);
    if (pose.crack >= 2) stamp(b, Math.round(cx) + 1, cy - 1, ["1.1.", ".1.1"]);
  } else {
    // burst: shell halves on the ground
    ellipse(b, cx - 5, GROUND - 2, 4, 2.5, C.light);
    ellipse(b, cx + 5, GROUND - 2, 4, 2.5, C.light);
    outline(b, C.outline);
  }
  for (const f of pose.fx) stamp(b, Math.round(cx + f.x), Math.round(cy + f.y), FX[f.kind]);
  return b;
}
