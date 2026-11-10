"use client";

import { useState } from "react";
import { careAnim, type AnyAnim, type CareEvent, type DisplayState } from "@nearling/sprites";
import { PetSprite } from "./PetSprite";

const CARE: { event: CareEvent; label: string }[] = [
  { event: "pat", label: "Pat" },
  { event: "rock", label: "Rock" },
  { event: "shake", label: "Shake" },
  { event: "sleep", label: "Lights off" },
];

/**
 * Browser Nearling: the 240x240 device screen with the pet, and the care inputs the
 * device has (touch pad, motion, light). Care is local and costs no fuel (Build Spec 4);
 * syncing events to the brain's /care route comes next.
 */
export function PetScreen(props: {
  traits: number[];
  stageIndex: number;
  winged: boolean;
  state: DisplayState;
  name: string;
}) {
  const [play, setPlay] = useState<AnyAnim | null>(null);
  const [key, setKey] = useState(0);
  // rock and sleep are loops: they play until another input (a real device stops on its own)
  const trigger = (anim: AnyAnim) => {
    setPlay(anim);
    setKey((k) => k + 1);
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="pixel-panel flex h-[240px] w-[240px] items-end justify-center bg-[var(--n-screen)] pb-6"
        aria-label={`${props.name}'s screen`}
      >
        <PetSprite
          traits={props.traits}
          stageIndex={props.stageIndex}
          winged={props.winged}
          state={props.state}
          play={play}
          playKey={key}
          onDone={() => setPlay(null)}
          scale={6}
          label={props.name}
        />
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {CARE.map((c) => (
          <button key={c.event} type="button" className="pixel-btn pixel-btn--secondary text-sm"
            onClick={() => trigger(careAnim(c.event))}>
            {c.label}
          </button>
        ))}
        {play && (
          <button type="button" className="pixel-btn pixel-btn--secondary text-sm" onClick={() => setPlay(null)}>
            Stop
          </button>
        )}
      </div>
    </div>
  );
}
