import { describe, expect, it } from "vitest";
import { COSTUME_KEYS, COSTUME_RGB, PET_ANIMS, SIZE, buildPalette, clip, toRgba, type PetAnim } from "./index";

const STAGES = ["baby", "teen", "adult"] as const;
const key = (b: Uint8Array | number[]) => Array.from(b).join(",");

describe("costumes", () => {
  it("every costume draws pixels on every frame, stage and form, in costume colours", () => {
    for (const costume of COSTUME_KEYS) {
      for (const stage of STAGES) {
        for (const name of ["idle", "celebrate", "dormant"] as PetAnim[]) {
          const c = clip(name, { stage, winged: false, costume });
          expect(c.costume?.length).toBe(c.frames.length);
          for (const l of c.costume!) {
            expect(l.back.length).toBe(SIZE * SIZE);
            expect(l.front.length).toBe(SIZE * SIZE);
            expect([...l.back, ...l.front].some((v) => v !== 0)).toBe(true);
            expect([...l.back, ...l.front].every((v) => v < COSTUME_RGB.length)).toBe(true);
          }
        }
      }
    }
  });

  it("all 38 costumes look different from each other", () => {
    const seen = new Set<string>();
    for (const costume of COSTUME_KEYS) {
      const l = clip("idle", { stage: "teen", winged: false, costume }).costume![0]!;
      seen.add(key(l.back) + "|" + key(l.front));
    }
    expect(COSTUME_KEYS.length).toBe(38);
    expect(COSTUME_KEYS).toEqual(expect.arrayContaining(["ceo", "spy"]));
    expect(seen.size).toBe(38);
  });

  it("is off without a costume, for an unknown key and on an egg", () => {
    expect(clip("idle", { stage: "adult", winged: false }).costume).toBeNull();
    expect(clip("idle", { stage: "adult", winged: false, costume: "banana" }).costume).toBeNull();
    expect(clip("idle", { stage: "egg", winged: false, costume: "crown" }).costume).toBeNull();
  });

  it("toRgba draws the front layer over the pet and the back layer only where the pet is clear", () => {
    const c = clip("idle", { stage: "adult", winged: false, costume: "crown" });
    const frame = c.frames[0]!;
    const l = c.costume![0]!;
    const rgba = toRgba(frame, buildPalette([0, 0, 0, 0, 0]), null, l);
    const f = l.front.findIndex((v) => v !== 0);
    expect([rgba[f * 4], rgba[f * 4 + 1], rgba[f * 4 + 2]]).toEqual([...COSTUME_RGB[l.front[f]!]!]);

    const w = clip("idle", { stage: "adult", winged: false, costume: "angel" });
    const wl = w.costume![0]!;
    const behind = wl.back.findIndex((v, i) => v !== 0 && w.frames[0]![i] !== 0);
    const clear = wl.back.findIndex((v, i) => v !== 0 && w.frames[0]![i] === 0 && wl.front[i] === 0);
    const out = toRgba(w.frames[0]!, buildPalette([0, 0, 0, 0, 0]), null, wl);
    expect(behind).toBeGreaterThanOrEqual(0);
    expect([out[behind * 4], out[behind * 4 + 1], out[behind * 4 + 2]]).not.toEqual([...COSTUME_RGB[wl.back[behind]!]!]);
    expect([out[clear * 4], out[clear * 4 + 1], out[clear * 4 + 2]]).toEqual([...COSTUME_RGB[wl.back[clear]!]!]);
  });

  it("every pet animation works with a costume", () => {
    for (const name of Object.keys(PET_ANIMS) as PetAnim[]) {
      expect(clip(name, { stage: "baby", winged: true, costume: "wizard_hat" }).costume?.length).toBe(PET_ANIMS[name].poses.length);
    }
  });
});
