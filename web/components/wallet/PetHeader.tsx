"use client";

import { PetSprite } from "@/components/PetSprite";
import type { PetData } from "./usePet";

/** Sprite, name and fuel line used at the top of the pet sub-pages. */
export function PetHeader({ pet, extra }: { pet: PetData; extra?: React.ReactNode }) {
  const c = pet.chain;
  if (!c) return null;
  const fuel = pet.brain?.fuel.left;
  return (
    <div className="flex items-center gap-4">
      <PetSprite
        traits={c.traits}
        stageIndex={pet.brain?.stage_index ?? c.stage}
        shirt={pet.brain?.equipped_shirt ?? null}
        costume={pet.brain?.equipped_costume ?? null}
        winged={pet.brain?.form === "winged"}
        state={pet.brain?.display_state ?? "happy"}
        scale={2}
        label={c.name}
      />
      <div className="flex flex-col">
        <span className="font-display text-lg">{c.name}</span>
        {fuel !== undefined && <span className="font-mono text-sm text-muted">{fuel} thoughts left</span>}
        {extra}
      </div>
    </div>
  );
}
