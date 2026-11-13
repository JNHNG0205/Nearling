"use client";

import { useEffect, useState } from "react";
import type { PetState } from "@nearling/shared";
import { FuelMeter } from "@/components/FuelMeter";
import { PetSprite } from "@/components/PetSprite";
import { DEMO_PET_REF, getPetState } from "@/lib/brain";
import { NearlingFrame } from "./NearlingFrame";
import { DemoSpeedPill } from "./Pills";

const POLL_MS = 5_000;
// fixed so the hatch never restarts when the pet loads mid-animation
const EGG_TRAITS = [2, 0, 1, 0, 0];

/**
 * Landing key art: the live demo pet from `pets-demo` in a Petto frame. The egg cracks once
 * on load (the hero entrance), then the real pet shows and its fuel drops in real time.
 */
export function DemoPet() {
  const [pet, setPet] = useState<PetState | null>(null);
  const [offline, setOffline] = useState(false);
  const [hatched, setHatched] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      getPetState(DEMO_PET_REF, { cache: "no-store" })
        .then((p) => {
          if (!live) return;
          setPet(p);
          setOffline(false);
        })
        .catch(() => live && setOffline(true));
    void load();
    const t = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const showPet = hatched && pet;
  return (
    <figure className="flex flex-col items-center gap-4">
      <NearlingFrame label={pet ? `${pet.name}, the live demo pet` : "The demo pet hatching"}>
        {showPet ? (
          <PetSprite traits={pet.traits} stageIndex={pet.stage_index} winged={pet.form === "winged"}
            state={pet.display_state} scale={6} label={`${pet.name}, ${pet.display_state}`} />
        ) : (
          <PetSprite traits={EGG_TRAITS} stageIndex={0} winged={false} state="happy"
            play={hatched ? null : "egg_hatch"} playKey="hero" onDone={() => setHatched(true)} scale={6}
            label="A Petto egg" />
        )}
      </NearlingFrame>
      <figcaption className="flex w-full max-w-[280px] flex-col gap-2">
        {pet ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="font-display">{pet.name}</span>
              {pet.demo_speed && <DemoSpeedPill />}
            </div>
            <FuelMeter fuel={pet.fuel} name={pet.name} />
          </>
        ) : (
          <span className="text-sm text-muted" role="status">
            {offline ? "The demo pet is offline right now." : "Loading the demo pet..."}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
