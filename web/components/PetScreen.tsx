"use client";

import { useRef, useState, type ReactNode } from "react";
import { careAnim, type AnyAnim, type CareEvent, type DisplayState } from "@petto/sprites";
import { PetSprite } from "./PetSprite";
import { createStroke } from "@/lib/stroke";
import { NearlingFrame } from "./nearling/NearlingFrame";
import { SpeechBubble } from "./nearling/SpeechBubble";

const CARE: { event: CareEvent; label: string }[] = [
  { event: "pat", label: "Pat" },
  { event: "rock", label: "Rock" },
  { event: "shake", label: "Shake" },
  { event: "sleep", label: "Lights off" },
];

/**
 * Browser Petto: the 240x240 device screen with the pet, and the care inputs the device
 * has (touch pad, motion, light). The local animation always plays at once; `onCare` lets the
 * page sync the event to the brain. Care costs no fuel (Build Spec 4).
 *
 * What plays (07-pet-animation section 4): talk flow (`talk`) > one-shot event (`event`) >
 * care > state loop.
 */
export function PetScreen(props: {
  traits: number[];
  stageIndex: number;
  winged: boolean;
  /** Equipped Closet shirt token id, or null. */
  shirt?: string | null;
  /** Equipped costume key, or null. */
  costume?: string | null;
  state: DisplayState;
  name: string;
  talk?: AnyAnim | null;
  event?: { anim: AnyAnim; key: number } | null;
  onEventDone?: () => void;
  bubble?: string | null;
  onCare?: (event: CareEvent) => void;
  buttons?: ReactNode;
  scale?: number;
}) {
  const [care, setCare] = useState<AnyAnim | null>(null);
  const [careKey, setCareKey] = useState(0);
  // rock and sleep are loops: they play until another input (a real device stops on its own)
  const trigger = (event: CareEvent) => {
    setCare(careAnim(event));
    setCareKey((k) => k + 1);
    props.onCare?.(event);
  };
  // stroke the pet with the cursor or a finger (or tap it) to pat, like the device's touch pad
  const stroke = useRef(createStroke());
  const lastTapPat = useRef(0);

  let play: AnyAnim | null = care;
  let key = `c${careKey}`;
  let onDone = () => setCare(null);
  if (props.talk) {
    play = props.talk;
    key = `t${props.talk}`;
    onDone = () => undefined;
  } else if (props.event) {
    play = props.event.anim;
    key = `e${props.event.key}`;
    onDone = () => props.onEventDone?.();
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <NearlingFrame label={`${props.name}'s screen`} buttons={props.buttons ?? null}>
        {props.bubble && (
          <div className="absolute inset-x-3 top-3">
            <SpeechBubble text={props.bubble} className="max-h-[96px] overflow-hidden text-[14px] leading-4" />
          </div>
        )}
        <div
          className="cursor-grab touch-none select-none"
          title={`Stroke or tap ${props.name} to pat`}
          onPointerMove={(e) => {
            if (stroke.current.move(e.clientX, e.clientY, e.timeStamp)) trigger("pat");
          }}
          onPointerLeave={() => stroke.current.reset()}
          onPointerUp={(e) => {
            // a tap pats too; at most one every 2 s, like a stroke
            if (e.pointerType !== "mouse" || e.button === 0) {
              if (e.timeStamp - lastTapPat.current >= 2_000) {
                lastTapPat.current = e.timeStamp;
                trigger("pat");
              }
            }
          }}
        >
        <PetSprite
          traits={props.traits}
          stageIndex={props.stageIndex}
          winged={props.winged}
          shirt={props.shirt ?? null}
          costume={props.costume ?? null}
          state={props.state}
          play={play}
          playKey={key}
          onDone={onDone}
          scale={props.scale ?? (props.bubble ? 4 : 6)}
          label={props.name}
        />
        </div>
      </NearlingFrame>
      <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Care">
        {CARE.map((c) => (
          <button key={c.event} type="button" className="pixel-btn pixel-btn--secondary text-sm"
            onClick={() => trigger(c.event)}>
            {c.label}
          </button>
        ))}
        {care && !props.talk && (
          <button type="button" className="pixel-btn pixel-btn--secondary text-sm" onClick={() => setCare(null)}>
            Stop
          </button>
        )}
      </div>
    </div>
  );
}
