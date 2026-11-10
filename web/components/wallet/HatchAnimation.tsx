"use client";

import { useEffect, useState } from "react";
import { PetSprite } from "@/components/PetSprite";
import { getPet } from "@/lib/chain";

/** Plays egg_hatch for a freshly minted pet (traits from chain), then calls `onDone`. */
export function HatchAnimation({ contract, tokenId, onDone }: { contract: string; tokenId: string; onDone: () => void }) {
  const [traits, setTraits] = useState<number[] | null>(null);

  useEffect(() => {
    let live = true;
    getPet(contract, tokenId)
      .then((p) => live && setTraits(p.traits))
      .catch(() => live && setTraits([50, 50, 50, 50, 50]));
    return () => {
      live = false;
    };
  }, [contract, tokenId]);

  if (!traits) return <p className="font-mono text-sm text-muted">Warming the egg...</p>;
  return (
    <div className="flex flex-col items-center gap-4">
      <PetSprite traits={traits} stageIndex={0} winged={false} state="happy" play="egg_hatch" onDone={onDone} scale={6} label="Your egg is hatching" />
      <p className="font-display text-lg">It's hatching...</p>
    </div>
  );
}
