import { describe, expect, it } from "vitest";
import {
  EGG_ANIMS, PERSONALITIES, PERSONALITY_ANIMS, PET_ANIMS, SHIRT, SHIRT_COLOURS, SIZE, buildPalette, careAnim, clip,
  emotionAnim, lookFromTraits, pack4, paletteFor, personalityFromTraits, shirtColourIndex, stageFromChain, stateAnim,
  toRgba, type PetAnim,
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

describe("shirt layer", () => {
  it("every pet animation has a shirt on every frame, stage and form, inside the body and the frame", () => {
    for (const stage of STAGES) {
      for (const winged of [false, true]) {
        for (const name of Object.keys(PET_ANIMS) as PetAnim[]) {
          const c = clip(name, { stage, winged, shirt: "0" });
          expect(c.shirt?.length).toBe(c.frames.length);
          c.shirt!.forEach((s, i) => {
            expect(s.some((v) => v !== 0)).toBe(true);
            // only shirt indices, and never outside the pet
            expect(s.every((v, p) => v === 0 || (v <= SHIRT.trim && c.frames[i]![p] !== 0))).toBe(true);
            for (let y = 0; y < SIZE; y++) {
              expect(s[y * SIZE]).toBe(0);
              expect(s[y * SIZE + SIZE - 1]).toBe(0);
            }
          });
        }
      }
    }
  });

  it("leaves the face and effects on top (no shirt pixel over an eye, mouth or fx)", () => {
    for (const name of ["talk", "eat", "pat"] as const) {
      const c = clip(name, { stage: "baby", winged: false, shirt: "3" });
      c.frames.forEach((f, i) => {
        for (let p = 0; p < f.length; p++) if ([5, 7, 8, 9, 10].includes(f[p]!)) expect(c.shirt![i]![p]).toBe(0);
      });
    }
  });

  it("is off without a shirt and on an egg; colour comes from the token id", () => {
    expect(clip("idle", { stage: "adult", winged: false }).shirt).toBeNull();
    expect(clip("idle", { stage: "egg", winged: false, shirt: "0" }).shirt).toBeNull();
    expect([0, 1, 2, 7].map((n) => shirtColourIndex(String(n)))).toEqual([0, 1, 2, 7]);
    expect(shirtColourIndex("10")).toBe(7); // (49 * 31 + 48) % 8
    const c = clip("idle", { stage: "adult", winged: false, shirt: "1" });
    expect(paletteFor([0, 0, 0, 0, 0], c, "1").shirt?.[1]).toEqual(SHIRT_COLOURS[1]!.colours[0]);
    const rgba = toRgba(c.frames[0]!, paletteFor([0, 0, 0, 0, 0], c, "1"), c.shirt![0]);
    const p = c.shirt![0]!.findIndex((v) => v === SHIRT.cloth);
    expect([rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]]).toEqual([...SHIRT_COLOURS[1]!.colours[0]]);
  });
});

describe("personality from traits", () => {
  it("follows the documented rule", () => {
    expect(personalityFromTraits([90, 10, 10, 10, 10])).toBe("playful");
    expect(personalityFromTraits([10, 80, 80, 10, 10])).toBe("curious"); // tie goes to the lower index
    expect(personalityFromTraits([0, 0, 0, 0, 50])).toBe("kind");
    expect(personalityFromTraits([49, 49, 49, 49, 49])).toBeNull();
    expect(personalityFromTraits([])).toBeNull();
  });

  it("variants keep timing, differ from the default, and stay inside the frame", () => {
    for (const personality of PERSONALITIES) {
      for (const [name, def] of Object.entries(PERSONALITY_ANIMS[personality]) as [PetAnim, (typeof PET_ANIMS)[PetAnim]][]) {
        const base = PET_ANIMS[name];
        expect([def.fps, def.loop, def.poses.length]).toEqual([base.fps, base.loop, base.poses.length]);
        for (const stage of STAGES) {
          const c = clip(name, { stage, winged: true, personality });
          expect(c.personality).toBe(personality);
          const d = clip(name, { stage, winged: true });
          expect(c.frames.some((f, i) => !Buffer.from(f).equals(Buffer.from(d.frames[i]!)))).toBe(true);
          for (const f of c.frames) {
            for (let x = 0; x < SIZE; x++) expect(f[x]).toBe(0); // top row
            for (let y = 0; y < SIZE; y++) {
              expect(f[y * SIZE]).toBe(0);
              expect(f[y * SIZE + SIZE - 1]).toBe(0);
            }
          }
        }
      }
    }
  });

  it("animations without a variant play the default clip", () => {
    expect(clip("sad", { stage: "teen", winged: false, personality: "playful" }).personality).toBeNull();
    expect(clip("idle", { stage: "teen", winged: false, personality: "sassy" }).personality).toBeNull();
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
