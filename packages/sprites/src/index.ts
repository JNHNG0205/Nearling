// @nearling/sprites: procedural pixel pets. Look comes from on-chain traits,
// motion from the animation table. Spec: "web-app architectual/07-pet-animation.md".
import { EGG_ANIMS, PERSONALITY_ANIMS, PET_ANIMS, type AnimDef, type EggAnim, type PetAnim } from "./animations";
import { buildPalette, type PetPalette } from "./palette";
import type { Personality } from "./personality";
import { drawEgg, drawPet, type BodyStage } from "./pet";
import { SIZE, type Bitmap } from "./raster";

export { SIZE, SHIRT, pack4, type Bitmap } from "./raster";
export { PET_ANIMS, EGG_ANIMS, PERSONALITY_ANIMS, type PetAnim, type EggAnim, type AnimDef } from "./animations";
export {
  buildPalette, lookFromTraits, shirtColourIndex, BODY_PALETTES, PATTERNS, SHIRT_COLOURS,
  type PetPalette, type Pattern,
} from "./palette";
export { PERSONALITIES, personalityFromTraits, type Personality } from "./personality";
export type { BodyStage } from "./pet";

export type Stage = "egg" | BodyStage;
export type AnyAnim = PetAnim | EggAnim;

export interface Look {
  stage: Stage;
  winged: boolean;
  /** Equipped Closet shirt token id (shirts contract) or null. Adds the shirt layer; its colour comes from the palette. */
  shirt?: string | null;
  /** From `personalityFromTraits(traits)`; picks a personality variant where one exists. */
  personality?: Personality | null;
}

export interface Clip {
  name: AnyAnim;
  fps: number;
  loop: boolean;
  palette: "normal" | "grey";
  then?: "state";
  /** The personality variant these frames use, or null for the default clip. */
  personality: Personality | null;
  frames: Bitmap[];
  /** Shirt overlay per frame (draw over the frame where non-zero); null without a shirt and on an egg. */
  shirt: Bitmap[] | null;
}

const cache = new Map<string, Clip>();

/** Frames for one animation. An egg only has egg animations; any other request on an egg gives egg_idle. */
export function clip(anim: AnyAnim, look: Look): Clip {
  const name: AnyAnim = look.stage === "egg" ? (anim === "egg_hatch" ? "egg_hatch" : "egg_idle") : anim;
  const egg = name === "egg_idle" || name === "egg_hatch";
  const variant = !egg && look.personality ? PERSONALITY_ANIMS[look.personality][name as PetAnim] : undefined;
  const personality = variant ? (look.personality ?? null) : null;
  const shirted = !egg && look.shirt != null;
  const key = `${name}|${look.stage}|${look.winged ? 1 : 0}|${personality ?? ""}|${shirted ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let made: Clip;
  if (name === "egg_idle" || name === "egg_hatch") {
    const def = EGG_ANIMS[name];
    made = { name, ...meta(def), personality: null, frames: def.poses.map(drawEgg), shirt: null };
  } else {
    const stage = look.stage === "egg" ? "baby" : look.stage;
    const def = variant ?? PET_ANIMS[name as PetAnim];
    // evolve draws its own growing wings, so it renders winged
    const winged = look.winged || name === "evolve";
    const layers = def.poses.map((pose) => drawPet(pose, { stage, winged }));
    made = {
      name, ...meta(def), personality,
      frames: layers.map((l) => l.frame),
      shirt: shirted ? layers.map((l) => l.shirt) : null,
    };
  }
  cache.set(key, made);
  return made;
}

function meta<P>(def: AnimDef<P>) {
  return { fps: def.fps, loop: def.loop, palette: def.palette, then: def.then };
}

/** RGBA pixels for a canvas ImageData or a PNG. Pass the frame's shirt layer to draw the shirt over it. */
export function toRgba(frame: Bitmap, palette: PetPalette, shirt?: Bitmap | null): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < frame.length; i++) {
    const s = shirt && palette.shirt ? (shirt[i] ?? 0) : 0;
    const idx = frame[i] ?? 0;
    if (idx === 0 && s === 0) continue;
    const [r, g, b] = (s ? palette.shirt?.[s] : palette.rgb[idx]) ?? [255, 0, 255];
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Palette for a clip: grey for starving and dormant; shirt colours from the equipped token id. */
export function paletteFor(traits: readonly number[], c: Clip, shirt: string | null = null): PetPalette {
  return buildPalette(traits, c.palette, c.shirt ? shirt : null);
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
