"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_TICKS, TICKS_PER_SECOND, initState, mulberry32, step, type RaceState } from "@petto/race";
import { SIZE, clip, paletteFor, stageFromChain, toRgba, type Clip } from "@petto/sprites";

// RaceCanvas (web 04 section 6, design.md section 5): 240x240 logical, integer scale, two lanes.
// The course comes from the same packages/race step() the brain replays, so what you dodge here is
// exactly what the server checks.

const W = 240;
const LANE_X = [60, 180] as const; // lane centres
const PET_Y = 192; // sprite top; the rules' pet row is y 200..216
const OFFSET = 20; // you on the left of a lane, the opponent on the right
const BAR_W = 88;
const BAR_H = 12;

// design.md section 2 tokens (canvas cannot read CSS variables cheaply every frame)
const C = {
  screen: "#0f140c", line: "#3a332b", ink: "#ffffff", muted: "#8f8a84", accent: "#c9a45a",
  bar: "#e25c4f", barEdge: "#000000",
};

export interface Look {
  traits: number[];
  stage: number;
}

export interface Opponent {
  lane: 0 | 1;
  laneTick: number; // highest tick seen, so late or out-of-order relays never move it back
  crashed: boolean;
}

export interface RaceSnapshot {
  tick: number | null; // crash tick, null = alive
  inputs: number[];
}

export interface RaceCanvasProps {
  seed: number;
  startAt: number; // server ms
  serverNow: () => number;
  me: Look;
  opp: Look;
  oppRef: React.RefObject<Opponent>;
  /** Filled by the canvas: the current report, for `request_inputs`. */
  snapshotRef: React.RefObject<RaceSnapshot>;
  onLane: (tick: number, lane: 0 | 1) => void;
  onCrash: (tick: number, inputs: number[]) => void;
}

/** One frame canvas per sprite frame, so transparent pixels composite over the track. */
function frameCanvases(c: Clip, traits: number[]): HTMLCanvasElement[] {
  const palette = paletteFor(traits, c);
  return c.frames.map((f) => {
    const el = document.createElement("canvas");
    el.width = SIZE;
    el.height = SIZE;
    const ctx = el.getContext("2d");
    if (ctx) {
      const img = ctx.createImageData(SIZE, SIZE);
      img.data.set(toRgba(f, palette));
      ctx.putImageData(img, 0, 0);
    }
    return el;
  });
}

function sprites(look: Look) {
  const l = { stage: stageFromChain(Math.max(1, look.stage)), winged: false }; // an egg cannot race
  const idle = clip("idle", l);
  const dizzy = clip("dizzy", l);
  return {
    idle: { fps: idle.fps, frames: frameCanvases(idle, look.traits) },
    dizzy: { fps: dizzy.fps, frames: frameCanvases(dizzy, look.traits) },
  };
}

export function RaceCanvas(props: RaceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);
  const propsRef = useRef(props);
  propsRef.current = props;
  const pressRef = useRef<(want?: 0 | 1) => void>(() => undefined);

  // Integer scale only: x1 under 520 px wide, x2 above (design.md section 4).
  useEffect(() => {
    const fit = () => setScale(window.innerWidth >= 520 ? 2 : 1);
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const meKey = props.me.traits.join(",") + "|" + props.me.stage;
  const oppKey = props.opp.traits.join(",") + "|" + props.opp.stage;

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { seed, startAt } = propsRef.current;
    const me: RaceState = initState();
    const course: RaceState = initState(); // same obstacles, never stops (drawn after you crash)
    const rngMe = mulberry32(seed);
    const rngCourse = mulberry32(seed);
    const switches = new Set<number>();
    let reported = false;
    const meSprites = sprites(propsRef.current.me);
    const oppSprites = sprites(propsRef.current.opp);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    propsRef.current.snapshotRef.current = { tick: null, inputs: [] };

    const shownLane = (): 0 | 1 => (switches.has(me.tick) ? (me.lane === 0 ? 1 : 0) : me.lane);

    pressRef.current = (want) => {
      const p = propsRef.current;
      if (me.crashedAt !== null || p.serverNow() < startAt || me.tick >= MAX_TICKS) return;
      const lane = shownLane();
      if (want !== undefined && want === lane) return;
      if (switches.has(me.tick)) return; // one switch per tick (the rules ignore duplicates)
      switches.add(me.tick); // applied at the next tick boundary, drawn now
      p.snapshotRef.current = { tick: null, inputs: [...switches] };
      p.onLane(me.tick, lane === 0 ? 1 : 0);
    };

    const drawPet = (set: ReturnType<typeof sprites>, crashed: boolean, x: number, now: number) => {
      const anim = crashed ? set.dizzy : set.idle;
      const i = reduced ? 0 : Math.floor((now / 1000) * anim.fps) % anim.frames.length;
      const f = anim.frames[i];
      if (f) ctx.drawImage(f, x - SIZE / 2, PET_Y);
    };

    let raf = 0;
    const frame = (now: number) => {
      const p = propsRef.current;
      const t = p.serverNow();
      const target = Math.min(MAX_TICKS, Math.max(0, Math.floor(((t - startAt) * TICKS_PER_SECOND) / 1000)));
      while (course.tick < target) {
        step(course, rngCourse, false);
        if (course.crashedAt !== null) {
          // the course only needs obstacles; step() has already moved them this tick
          course.crashedAt = null;
          course.tick += 1;
        }
      }
      while (me.crashedAt === null && me.tick < target) step(me, rngMe, switches.has(me.tick));
      if (me.crashedAt !== null && !reported) {
        reported = true;
        const inputs = [...switches].filter((s) => s <= (me.crashedAt ?? 0));
        p.snapshotRef.current = { tick: me.crashedAt, inputs };
        p.onCrash(me.crashedAt, inputs);
      }

      // track
      ctx.fillStyle = C.screen;
      ctx.fillRect(0, 0, W, W);
      ctx.fillStyle = C.line;
      const dash = Math.floor((course.tick * 2) % 16);
      for (let y = -16 + dash; y < W; y += 16) ctx.fillRect(W / 2 - 1, y, 2, 8);
      ctx.fillRect(0, 0, 2, W);
      ctx.fillRect(W - 2, 0, 2, W);

      // obstacles
      for (const o of course.obstacles) {
        const cy = Math.floor(o.y / 100);
        const x = LANE_X[o.lane] - BAR_W / 2;
        ctx.fillStyle = C.barEdge;
        ctx.fillRect(x - 2, cy - BAR_H / 2 - 2, BAR_W + 4, BAR_H + 4);
        ctx.fillStyle = C.bar;
        ctx.fillRect(x, cy - BAR_H / 2, BAR_W, BAR_H);
      }

      // pets: opponent first, you on top
      const opp = p.oppRef.current;
      drawPet(oppSprites, opp.crashed, LANE_X[opp.lane] + OFFSET, now);
      const myX = LANE_X[me.crashedAt === null ? shownLane() : me.lane] - OFFSET;
      drawPet(meSprites, me.crashedAt !== null, myX, now);
      ctx.fillStyle = C.accent; // "you" marker
      ctx.fillRect(myX - 3, PET_Y - 8, 6, 2);
      ctx.fillRect(myX - 1, PET_Y - 6, 2, 2);

      // clock
      ctx.fillStyle = C.muted;
      ctx.font = "10px monospace";
      ctx.textBaseline = "top";
      ctx.fillText(`${(Math.min(target, me.crashedAt ?? target) / TICKS_PER_SECOND).toFixed(1)} s`, 8, 8);

      // countdown from the server's start_at
      if (t < startAt) {
        const n = Math.ceil((startAt - t) / 1000);
        ctx.fillStyle = C.accent;
        ctx.font = "bold 48px monospace";
        ctx.textAlign = "center";
        ctx.fillText(String(n), W / 2, 80);
        ctx.textAlign = "start";
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "ArrowDown") {
        e.preventDefault();
        pressRef.current();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        pressRef.current(0);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        pressRef.current(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
  }, [props.seed, props.startAt, meKey, oppKey]);

  return (
    <div className="pixel-panel bg-[var(--n-surface-2)] p-2">
      <canvas
        ref={canvasRef}
        width={W}
        height={W}
        role="img"
        aria-label="Petto Run track. Press space, the arrow keys or tap to switch lanes."
        className="pixelated block touch-none select-none"
        style={{ width: W * scale, height: W * scale }}
        onPointerDown={(e) => {
          e.preventDefault();
          pressRef.current();
        }}
      />
    </div>
  );
}
