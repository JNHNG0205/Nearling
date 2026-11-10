import { describe, expect, it } from "vitest";
import {
  EGG_ANIMS, PET_ANIMS, SIZE, buildPalette, careAnim, clip, emotionAnim, lookFromTraits, pack4,
  stageFromChain, stateAnim, toRgba, type PetAnim,
} from "./index";

const STAGES = ["baby", "teen", "adult"] as const;

describe("frames", () => {
  it("every pet animation renders non-empty 32x32 frames on every stage and form", () => {
    for (const stage of STAGES) {
      for (const winged of [false, true]) {
        for (const name of Object.keys(PET_ANIMS) as PetAnim[]) {
          const c = clip(name, { stage, winged });
          expect(c.frames.length).toBe(PET_ANIMS[name].poses.length);
          for (const f of c.frames) {
            expect(f.length).toBe(SIZE * SIZE);
            expect(f.some((v) => v !== 0)).toBe(true);
          }
        }
      }
    }
  });

  it("the calm loops stay inside the frame (nothing clipped at the edges)", () => {
    for (const stage of STAGES) {
      for (const name of ["idle", "sad", "sleep", "talk", "think", "listen", "starving", "dormant"] as const) {
        for (const f of clip(name, { stage, winged: true }).frames) {
          for (let y = 0; y < SIZE; y++) {
            expect(f[y * SIZE]).toBe(0);
            expect(f[y * SIZE + SIZE - 1]).toBe(0);
          }
        }
      }
    }
  });

  it("an egg only plays egg animations", () => {
    expect(clip("talk", { stage: "egg", winged: false }).name).toBe("egg_idle");
    expect(clip("egg_hatch", { stage: "egg", winged: false }).frames.length).toBe(EGG_ANIMS.egg_hatch.poses.length);
  });

  it("is deterministic", () => {
    const a = clip("idle", { stage: "teen", winged: false }).frames[0]!;
    const b = clip("idle", { stage: "teen", winged: false }).frames[0]!;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("packs to 4 bits per pixel for the firmware", () => {
    const f = clip("idle", { stage: "adult", winged: false }).frames[0]!;
    const packed = pack4(f);
    expect(packed.length).toBe(512);
    expect(packed[0]! >> 4).toBe(f[0]);
    expect(packed[0]! & 15).toBe(f[1]);
  });
});

describe("palette from traits", () => {
  it("follows the documented rule", () => {
    expect(lookFromTraits([10, 0, 4, 0, 0])).toEqual({ bodyIndex: 2, pattern: "belly" });
    expect(lookFromTraits([])).toEqual({ bodyIndex: 0, pattern: "plain" });
  });
  it("grey variant has no colour", () => {
    const g = buildPalette([3, 0, 0, 0, 0], "grey");
    for (const [r, gg, b] of g.rgb.slice(1)) expect(r === gg && gg === b).toBe(true);
  });
  it("maps frames to RGBA with transparency", () => {
    const f = clip("idle", { stage: "adult", winged: false }).frames[0]!;
    const rgba = toRgba(f, buildPalette([0, 0, 0, 0, 0]));
    expect(rgba[3]).toBe(0); // top-left corner is transparent
    expect(rgba.some((v, i) => i % 4 === 3 && v === 255)).toBe(true);
  });
});

describe("what to play", () => {
  it("maps states, emotions and care", () => {
    expect(stateAnim("happy")).toBe("idle");
    expect(stateAnim("dormant")).toBe("dormant");
    expect(emotionAnim("excited")).toBe("celebrate");
    expect(careAnim("shake")).toBe("dizzy");
    expect(stageFromChain(0)).toBe("egg");
    expect(stageFromChain(9)).toBe("adult");
  });
});
