"use client";

import type { ReactNode } from "react";
import { PetSprite } from "@/components/PetSprite";

// The Petto wordmark (web/public/images/logo.jpeg) drawn with the app's own sprites, so it works on
// the dark header: "Pett" in the pixel face, the egg as the "o", and mint babies perched on the letters.

const MINT = [0, 0, 1, 0, 0]; // the logo's colour: mint body, belly pattern

/** Shows only the part of a 32 px sprite canvas inside the box (x, y, w, h in sprite pixels). */
function Crop({ x, y, w, h, scale, children }: { x: number; y: number; w: number; h: number; scale: number; children: ReactNode }) {
  return (
    <span aria-hidden className="inline-block overflow-hidden" style={{ width: w * scale, height: h * scale }}>
      <span className="block" style={{ marginLeft: -x * scale, marginTop: -y * scale }}>{children}</span>
    </span>
  );
}

/** A mint baby sitting on a letter (the logo's little pets). */
function Perch({ left }: { left: number }) {
  return (
    <span className="absolute bottom-[78%]" style={{ left }}>
      <Crop x={7} y={13} w={18} h={18} scale={1}>
        <PetSprite traits={MINT} stageIndex={1} winged={false} state="happy" scale={1} label="" />
      </Crop>
    </span>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-end font-display text-[28px] font-bold leading-none md:text-[44px]">
      <span className="relative">P<Perch left={0} /></span>
      e
      <span className="relative">t<Perch left={-2} /></span>
      t
      {/* the egg "o": 1x beside the phone-size letters, 2x on wider screens */}
      <span className="mb-[-1px] ml-[2px] md:hidden">
        <Crop x={7} y={10} w={18} h={21} scale={1}>
          <PetSprite traits={MINT} stageIndex={0} winged={false} state="happy" scale={1} label="" />
        </Crop>
      </span>
      <span className="mb-[-2px] ml-[3px] hidden md:inline-block">
        <Crop x={7} y={10} w={18} h={21} scale={2}>
          <PetSprite traits={MINT} stageIndex={0} winged={false} state="happy" scale={2} label="" />
        </Crop>
      </span>
    </span>
  );
}
