// @nearling/sprites: procedural pixel pets. Look comes from on-chain traits,
// motion from the animation table. Spec: "web-app architectual/07-pet-animation.md".
import { EGG_ANIMS, PET_ANIMS, type AnimDef, type EggAnim, type PetAnim } from "./animations";
import { buildPalette, type PetPalette } from "./palette";
import { drawEgg, drawPet, type BodyStage } from "./pet";
import { SIZE, type Bitmap } from "./raster";

export { SIZE, pack4, type Bitmap } from "./raster";
export { PET_ANIMS, EGG_ANIMS, type PetAnim, type EggAnim, type AnimDef } from "./animations";
export { buildPalette, lookFromTraits, BODY_PALETTES, PATTERNS, type PetPalette, type Pattern } from "./palette";
export type { BodyStage } from "./pet";

export type Stage = "egg" | BodyStage;
export type AnyAnim = PetAnim | EggAnim;

export interface Look {
  stage: Stage;
  winged: boolean;
}

export interface Clip {
  name: AnyAnim;
  fps: number;
  loop: boolean;
  palette: "normal" | "grey";
  then?: "state";
  frames: Bitmap[];
}

const cache = new Map<string, Clip>();

/** Frames for one animation. An egg only has egg animations; any other request on an egg gives egg_idle. */
export function clip(anim: AnyAnim, look: Look): Clip {
  const name: AnyAnim = look.stage === "egg" ? (anim === "egg_hatch" ? "egg_hatch" : "egg_idle") : anim;
  const key = `${name}|${look.stage}|${look.winged ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let made: Clip;
  if (name === "egg_idle" || name === "egg_hatch") {
    const def = EGG_ANIMS[name];
    made = { name, ...meta(def), frames: def.poses.map(drawEgg) };
  } else {
    const stage = look.stage === "egg" ? "baby" : look.stage;
    const def = PET_ANIMS[name as PetAnim];
    // evolve draws its own growing wings, so it renders winged
    const winged = look.winged || name === "evolve";
    made = { name, ...meta(def), frames: def.poses.map((pose) => drawPet(pose, { stage, winged })) };
  }
  cache.set(key, made);
  return made;
}

function meta<P>(def: AnimDef<P>) {
  return { fps: def.fps, loop: def.loop, palette: def.palette, then: def.then };
}

/** RGBA pixels for a canvas ImageData or a PNG. */
export function toRgba(frame: Bitmap, palette: PetPalette): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < frame.length; i++) {
    const idx = frame[i] ?? 0;
    if (idx === 0) continue;
    const [r, g, b] = palette.rgb[idx] ?? [255, 0, 255];
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

export function paletteFor(traits: readonly number[], c: Clip): PetPalette {
  return buildPalette(traits, c.palette);
}

// ---------- what to play (shared by web and device) ----------

export type DisplayState = "happy" | "sad" | "hungry" | "sleepy" | "starving" | "dormant";
export type Emotion = "happy" | "excited" | "sleepy" | "sad" | "hungry" | "curious" | "silly";
export type CareEvent = "pat" | "rock" | "shake" | "sleep";

/** The loop that plays when nothing else is happening. */
export function stateAnim(state: DisplayState): PetAnim {
  switch (state) {
    case "happy": return "idle";
    case "sad": return "sad";
    case "hungry": return "hungry";
    case "sleepy": return "sleep";
    case "starving": return "starving";
    case "dormant": return "dormant";
  }
}

/** The pet's reaction after a reply, from the reply's emotion tag (brain 03 section 3). */
export function emotionAnim(emotion: Emotion): PetAnim {
  switch (emotion) {
    case "happy": return "pat";
    case "excited": return "celebrate";
    case "sleepy": return "rock";
    case "sad": return "sad";
    case "hungry": return "hungry";
    case "curious": return "think";
    case "silly": return "dizzy";
  }
}

/** Offline care reactions (Build Spec 4). */
export function careAnim(event: CareEvent): PetAnim {
  switch (event) {
    case "pat": return "pat";
    case "rock": return "rock";
    case "shake": return "dizzy";
    case "sleep": return "sleep";
  }
}

/** Contract stage index (0 egg, 1 baby, 2 teen, 3 adult) to a sprite stage. */
export function stageFromChain(stage: number): Stage {
  return (["egg", "baby", "teen", "adult"] as const)[Math.max(0, Math.min(3, stage))] ?? "adult";
}
