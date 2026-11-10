// Every Nearling animation as a list of poses. Frame data is generated from these
// (drawPet / drawEgg), so changing a pose here changes web and firmware together.
import { BASE_POSE, type EggPose, type Fx, type Pose } from "./pet";

export type PetAnim =
  // idle and state loops
  | "idle" | "sad" | "hungry" | "sleep" | "starving" | "dormant"
  // talk flow (Build Spec 2)
  | "listen" | "think" | "talk"
  // offline care (Build Spec 4)
  | "pat" | "rock" | "dizzy"
  // fuel and progress
  | "eat" | "celebrate" | "evolve";

export type EggAnim = "egg_idle" | "egg_hatch";

export interface AnimDef<P> {
  fps: number;
  loop: boolean;
  palette: "normal" | "grey";
  /** animation to return to when a one-shot ends (the web and firmware use the state loop) */
  then?: "state";
  poses: P[];
}

const p = (o: Partial<Pose>): Pose => ({ ...BASE_POSE, ...o });
const fx = (kind: Fx["kind"], x: number, y: number): Fx => ({ kind, x, y });

export const PET_ANIMS: Record<PetAnim, AnimDef<Pose>> = {
  // breathe, blink, slow wing flap
  idle: {
    fps: 4, loop: true, palette: "normal",
    poses: [
      p({}), p({}), p({ squash: 1, wingUp: true }), p({ squash: 1, wingUp: true }),
      p({}), p({}), p({ eyes: "blink" }), p({ wingUp: true }),
    ],
  },
  sad: {
    fps: 3, loop: true, palette: "normal",
    poses: [0, 1, 2, 3, 4, 5].map((i) =>
      p({ squash: 1, eyes: "sad", mouth: "frown", fx: i >= 1 && i <= 4 ? [fx("tear", -5, -1 + i)] : [] }),
    ),
  },
  hungry: {
    fps: 4, loop: true, palette: "normal",
    poses: [0, 1, 2, 3].map((i) =>
      p({ dy: 0, dx: i === 1 ? 1 : i === 3 ? -1 : 0, squash: 1, eyes: "half", mouth: "wavy",
        fx: i % 2 === 0 ? [fx("rumble", 6, 3)] : [fx("rumble", -8, 3)] }),
    ),
  },
  sleep: {
    fps: 2, loop: true, palette: "normal",
    poses: [0, 1, 2, 3, 4, 5].map((i) =>
      p({ squash: i % 3 === 0 ? 1 : 2, eyes: "closed", mouth: "o", wingSize: 2,
        fx: [fx("z", 7 + (i % 3), -9 - (i % 3) * 3)] }),
    ),
  },
  starving: {
    fps: 2, loop: true, palette: "grey",
    poses: [0, 1, 2, 3].map((i) => p({ squash: 2, eyes: i === 2 ? "closed" : "half", mouth: "frown" })),
  },
  dormant: {
    fps: 1, loop: true, palette: "grey",
    poses: [0, 1, 2, 3].map((i) =>
      p({ squash: 3, eyes: "closed", mouth: "none", fx: i === 3 ? [fx("z", 8, -6)] : [] }),
    ),
  },

  listen: {
    fps: 4, loop: true, palette: "normal",
    poses: [0, 1, 2, 3].map((i) =>
      p({ eyes: "big", mouth: "o", fx: i % 2 === 0 ? [fx("wave", 10, -6)] : [fx("wave", 10, -6), fx("wave", 12, -7)] }),
    ),
  },
  think: {
    fps: 3, loop: true, palette: "normal",
    poses: [1, 2, 3, 0].map((n) =>
      p({ eyes: "up", mouth: "flat", fx: [fx("dot", 6, -12), fx("dot", 8, -13), fx("dot", 10, -14)].slice(0, n) }),
    ),
  },
  talk: {
    fps: 8, loop: true, palette: "normal",
    poses: [
      p({ mouth: "open" }), p({ mouth: "smile", dy: -1 }), p({ mouth: "o" }), p({ mouth: "smile" }),
    ],
  },

  pat: {
    fps: 8, loop: false, palette: "normal", then: "state",
    poses: [0, -1, -3, -4, -3, -1, 0, 0].map((dy, i) =>
      p({ dy, squash: i === 0 || i === 6 ? 1 : 0, eyes: "happy", mouth: "open", cheeks: true, wingUp: i % 2 === 0,
        fx: [fx("heart", 8, -6 - i), ...(i >= 3 ? [fx("heart", -11, -4 - (i - 3))] : [])] }),
    ),
  },
  rock: {
    fps: 4, loop: true, palette: "normal",
    poses: [-1, 0, 1, 0].map((dx) => p({ dx, eyes: "half", mouth: "flat" })),
  },
  dizzy: {
    fps: 10, loop: true, palette: "normal",
    poses: [-2, 2, -1, 1, -2, 2, 0, 0].map((dx, i) =>
      p({ dx, eyes: "dizzy", mouth: "wavy",
        fx: [fx("star", -4 + ((i * 3) % 9), -11), fx("star", 4 - ((i * 3) % 9), -12)] }),
    ),
  },

  eat: {
    fps: 8, loop: false, palette: "normal", then: "state",
    poses: [
      p({ mouth: "o", fx: [fx("food", 11, -1)] }),
      p({ mouth: "open", fx: [fx("food", 7, 0)] }),
      p({ mouth: "open", fx: [fx("food", 3, 1)] }),
      p({ mouth: "chomp", squash: 1 }),
      p({ mouth: "smile", eyes: "happy", cheeks: true, fx: [fx("crumb", 4, 4), fx("crumb", -4, 5)] }),
      p({ mouth: "chomp", squash: 1 }),
      p({ mouth: "smile", eyes: "happy", cheeks: true, fx: [fx("crumb", 5, 6)] }),
      p({ mouth: "smile", eyes: "happy", cheeks: true }),
    ],
  },
  celebrate: {
    fps: 10, loop: false, palette: "normal", then: "state",
    poses: [0, -2, -5, -7, -8, -7, -5, -2, 0, 0].map((dy, i) =>
      p({ dy, squash: i === 0 || i === 8 ? 1 : 0, eyes: "happy", mouth: "open", cheeks: true, wingUp: i % 2 === 1,
        fx: i >= 2 && i <= 7 ? [fx("sparkle", -12, -8 + (i % 2)), fx("sparkle", 10, -10 + (i % 3))] : [] }),
    ),
  },
  evolve: {
    fps: 8, loop: false, palette: "normal", then: "state",
    poses: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) =>
      p({ dy: i >= 4 && i <= 9 ? -2 : 0, eyes: i < 4 ? "big" : "happy", mouth: i < 4 ? "o" : "open",
        cheeks: i >= 6, wingSize: i < 4 ? 0 : i < 7 ? 1 : 2, wingUp: i % 2 === 0,
        fx: [fx("sparkle", -12 + ((i * 5) % 24), -10 + ((i * 7) % 6)), fx("sparkle", 12 - ((i * 5) % 24), -4 - ((i * 3) % 6))] }),
    ),
  },
};

const e = (o: Partial<EggPose>): EggPose => ({ dx: 0, crack: 0, fx: [], ...o });

export const EGG_ANIMS: Record<EggAnim, AnimDef<EggPose>> = {
  egg_idle: {
    fps: 3, loop: true, palette: "normal",
    poses: [e({}), e({}), e({ dx: 1 }), e({}), e({ dx: -1 }), e({})],
  },
  egg_hatch: {
    fps: 6, loop: false, palette: "normal", then: "state",
    poses: [
      e({ dx: 1 }), e({ dx: -1 }), e({ dx: 1, crack: 1 }), e({ dx: -1, crack: 1 }),
      e({ crack: 2 }), e({ dx: 1, crack: 2 }),
      e({ crack: 3, fx: [{ kind: "sparkle", x: -9, y: -6 }, { kind: "sparkle", x: 7, y: -8 }] }),
      e({ crack: 3, fx: [{ kind: "sparkle", x: -11, y: -9 }, { kind: "sparkle", x: 9, y: -11 }] }),
    ],
  },
};
