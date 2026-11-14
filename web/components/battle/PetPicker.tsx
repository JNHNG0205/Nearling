"use client";

import { useEffect, useState } from "react";
import { PetSprite } from "@/components/PetSprite";
import { getBattle } from "@/lib/chain";
import { loadMyPets, type MyPet } from "@/lib/myPets";
import { authHeaders, useSession } from "@/lib/session";

/** The signed-in owner's pets as a pick list; the first one is picked by default. */
export function PetPicker({ value, onChange }: { value: string | null; onChange: (ref: string) => void }) {
  const session = useSession();
  const [pets, setPets] = useState<MyPet[] | null>(null);
  const [levels, setLevels] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!session) return;
    let live = true;
    loadMyPets(session.account, authHeaders())
      .then(({ pets }) => live && setPets(pets))
      .catch(() => live && setPets([]));
    return () => {
      live = false;
    };
  }, [session]);

  // battle level of each pet, from chain (level 1 before its first battle)
  useEffect(() => {
    if (!pets) return;
    let live = true;
    for (const p of pets) {
      getBattle(p.contract, p.tokenId)
        .then((r) => live && setLevels((l) => ({ ...l, [p.ref]: r.level })))
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [pets]);

  useEffect(() => {
    if (pets?.[0] && !value) onChange(pets[0].ref);
  }, [pets, value, onChange]);

  if (!session) return <p className="text-sm text-muted">Sign in to pick a pet.</p>;
  if (!pets) return <p className="text-sm text-muted">Finding your pets...</p>;
  if (pets.length === 0) return <p className="text-sm text-muted">You need a pet to battle.</p>;

  return (
    <div role="radiogroup" aria-label="Your pet" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {pets.map((p) => (
        <button
          key={p.ref}
          type="button"
          role="radio"
          aria-checked={value === p.ref}
          onClick={() => onChange(p.ref)}
          className={`pixel-panel pixel-panel--pick flex flex-col items-center gap-2 p-3 ${value === p.ref ? "pixel-panel--selected" : ""}`}
        >
          {p.state && (
            <PetSprite
              traits={p.state.traits}
              stageIndex={p.state.stage_index}
              winged={false}
              costume={p.state.equipped_costume ?? null}
              state="happy"
              scale={2}
              label={p.name}
            />
          )}
          <span className="font-display text-sm">{p.name}</span>
          <span className="text-xs text-muted">{levels[p.ref] ? `Battle Lv ${levels[p.ref]}` : "\u00a0"}</span>
          {p.demo && <span className="text-xs text-muted">demo speed</span>}
        </button>
      ))}
    </div>
  );
}
