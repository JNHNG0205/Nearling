"use client";

import { useEffect, useRef } from "react";
import {
  SIZE, clip, paletteFor, personalityFromTraits, stageFromChain, stateAnim, toRgba,
  type AnyAnim, type DisplayState,
} from "@petto/sprites";

export interface PetSpriteProps {
  traits: readonly number[];
  stageIndex: number; // contract stage 0..3
  winged: boolean;
  /** Equipped Closet shirt token id (`PetState.equipped_shirt`), or null for none. */
  shirt?: string | null;
  /** Equipped costume key (`PetState.equipped_costume`); drawn instead of the plain shirt. */
  costume?: string | null;
  state: DisplayState; // the loop when nothing else plays
  /** One-shot or override animation. Change `playKey` to replay the same animation. */
  play?: AnyAnim | null;
  playKey?: number | string;
  onDone?: () => void;
  scale?: number; // integer only (design.md section 4)
  label?: string;
}

/**
 * Draws a Petto on a 32x32 canvas scaled by an integer factor. Looping clips run until
 * `play` changes; one-shot clips (pat, eat, celebrate, evolve, egg_hatch) end and fall back
 * to the state loop. Reduced motion: holds the first frame. Traits pick the colour, pattern and
 * personality variant; an equipped shirt or costume is drawn as its own layer.
 */
export function PetSprite({
  traits, stageIndex, winged, shirt: shirtToken = null, costume = null, state, play = null, playKey, onDone, scale = 4, label = "Your Petto",
}: PetSpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shirt = costume ? null : shirtToken;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const traitsKey = traits.join(",");

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const stage = stageFromChain(stageIndex);
    const t = traitsKey.split(",").map(Number);
    const look = { stage, winged, shirt, costume, personality: personalityFromTraits(t) };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const image = ctx.createImageData(SIZE, SIZE);

    let current = clip(play ?? stateAnim(state), look);
    let palette = paletteFor(t, current, shirt);
    let start = performance.now();
    let lastFrame = -1;
    let raf = 0;

    const draw = (i: number) => {
      const frame = current.frames[i];
      if (!frame) return;
      image.data.set(toRgba(frame, palette, current.shirt?.[i], current.costume?.[i]));
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
          palette = paletteFor(t, current, shirt);
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
  }, [traitsKey, stageIndex, winged, shirt, costume, state, play, playKey]);

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
