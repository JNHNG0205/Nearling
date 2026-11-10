"use client";

import { useEffect, useRef } from "react";
import {
  SIZE, clip, paletteFor, stageFromChain, stateAnim, toRgba,
  type AnyAnim, type DisplayState,
} from "@nearling/sprites";

export interface PetSpriteProps {
  traits: readonly number[];
  stageIndex: number; // contract stage 0..3
  winged: boolean;
  state: DisplayState; // the loop when nothing else plays
  /** One-shot or override animation. Change `playKey` to replay the same animation. */
  play?: AnyAnim | null;
  playKey?: number | string;
  onDone?: () => void;
  scale?: number; // integer only (design.md section 4)
  label?: string;
}

/**
 * Draws a Nearling on a 32x32 canvas scaled by an integer factor. Looping clips run until
 * `play` changes; one-shot clips (pat, eat, celebrate, evolve, egg_hatch) end and fall back
 * to the state loop. Reduced motion: holds the first frame.
 */
export function PetSprite({
  traits, stageIndex, winged, state, play = null, playKey, onDone, scale = 4, label = "Your Nearling",
}: PetSpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const traitsKey = traits.join(",");

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const stage = stageFromChain(stageIndex);
    const look = { stage, winged };
    const t = traitsKey.split(",").map(Number);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const image = ctx.createImageData(SIZE, SIZE);

    let current = clip(play ?? stateAnim(state), look);
    let palette = paletteFor(t, current);
    let start = performance.now();
    let lastFrame = -1;
    let raf = 0;

    const draw = (i: number) => {
      const frame = current.frames[i];
      if (!frame) return;
      image.data.set(toRgba(frame, palette));
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.putImageData(image, 0, 0);
    };

    if (reduced) {
      draw(0);
      if (!current.loop) doneRef.current?.();
      return;
    }

    const tick = (now: number) => {
      let i = Math.floor(((now - start) / 1000) * current.fps);
      if (i >= current.frames.length) {
        if (current.loop) {
          i %= current.frames.length;
        } else {
          // one-shot finished: back to the state loop
          doneRef.current?.();
          current = clip(stateAnim(state), look);
          palette = paletteFor(t, current);
          start = now;
          i = 0;
          lastFrame = -1;
        }
      }
      if (i !== lastFrame) {
        draw(i);
        lastFrame = i;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [traitsKey, stageIndex, winged, state, play, playKey]);

  const px = SIZE * Math.max(1, Math.round(scale));
  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      role="img"
      aria-label={label}
      className="pixelated"
      style={{ width: px, height: px }}
    />
  );
}
