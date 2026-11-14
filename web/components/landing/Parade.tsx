"use client";

import { useState } from "react";
import type { AnyAnim } from "@petto/sprites";
import { PetSprite } from "@/components/PetSprite";

// Landing hero: five pets on one ground line, each a different look, stage and costume (all of it
// pickable in the app). Hover or tap one and it reacts. On a phone the outer two are cut by the edges.

interface Walker {
  name: string;
  traits: number[]; // [colour, 0, pattern, 0, 0] as the hatch picker sets them
  stage: number;
  costume: string;
  react: AnyAnim;
}

const PETS: Walker[] = [
  { name: "Mint in headphones", traits: [0, 0, 2, 0, 0], stage: 1, costume: "headphones", react: "celebrate" },
  { name: "Rose in a flower crown", traits: [7, 0, 1, 0, 0], stage: 2, costume: "flower_crown", react: "pat" },
  { name: "Sky in a wizard hat", traits: [2, 0, 1, 0, 0], stage: 3, costume: "wizard_hat", react: "dizzy" },
  { name: "Lemon in a crown", traits: [3, 0, 0, 0, 0], stage: 2, costume: "crown", react: "celebrate" },
  { name: "Coral in a party hat", traits: [4, 0, 2, 0, 0], stage: 1, costume: "party_hat", react: "pat" },
];

export function Parade() {
  const [playing, setPlaying] = useState<{ i: number; n: number } | null>(null);
  return (
    <ul aria-label="Five Petto pets" className="flex items-end justify-center gap-2 overflow-hidden border-b-2 border-line sm:gap-6">
      {PETS.map((p, i) => (
        <li key={p.name} className="shrink-0">
          <button type="button" aria-label={p.name} className="block cursor-pointer"
            onPointerEnter={() => setPlaying({ i, n: (playing?.n ?? 0) + 1 })}
            onClick={() => setPlaying({ i, n: (playing?.n ?? 0) + 1 })}>
            <PetSprite traits={p.traits} stageIndex={p.stage} winged={false} costume={p.costume} state="happy"
              play={playing?.i === i ? p.react : null} playKey={playing?.i === i ? playing.n : undefined}
              onDone={() => setPlaying((cur) => (cur?.i === i ? null : cur))} scale={6} label={p.name} />
          </button>
        </li>
      ))}
    </ul>
  );
}
