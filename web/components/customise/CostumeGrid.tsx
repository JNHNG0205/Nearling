"use client";

import type { CostumeKey } from "@petto/sprites";
import { PetSprite } from "@/components/PetSprite";
import { COSTUME_PRICE, formatNear } from "@/lib/chain";
import { costumeLabel } from "@/lib/closet";

/** The pet the costumes are previewed on. */
export interface Model {
  name: string;
  traits: readonly number[];
  stageIndex: number;
  winged: boolean;
}

/**
 * Costume cards (Closet and /shop): the pet in each costume, tap to try on, Buy or Wear.
 * Costumes in `owned` show Wear instead of Buy; `onBuy` null shows the price disabled (signed out).
 */
export function CostumeGrid({
  model, keys, owned, trying, busyKey, disabled, onTry, onBuy, onWear,
}: {
  model: Model;
  keys: readonly CostumeKey[];
  owned?: ReadonlyMap<CostumeKey, string>;
  trying: string | null;
  busyKey: string | null;
  disabled: boolean;
  onTry: (key: CostumeKey) => void;
  onBuy: ((key: CostumeKey) => void) | null;
  onWear?: (tokenId: string) => void;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {keys.map((key) => {
        const token = owned?.get(key);
        return (
          <li key={key} className={`pixel-panel pixel-panel--pick relative flex flex-col items-center gap-2 p-3 ${trying === key ? "pixel-panel--selected" : ""}`}>
            {/* the whole card tries the costume on; the price / wear button sits above it */}
            <button className="flex cursor-pointer flex-col items-center gap-1 outline-none after:absolute after:inset-0 after:content-['']"
              onClick={() => onTry(key)} aria-pressed={trying === key} aria-label={`Try on ${costumeLabel(key)}`}>
              <PetSprite traits={model.traits} stageIndex={model.stageIndex} winged={model.winged} costume={key}
                state="happy" scale={2} label={`${model.name} in ${costumeLabel(key)}`} />
              <span className="font-display text-sm">{costumeLabel(key)}</span>
            </button>
            {token && onWear ? (
              <button className="pixel-btn pixel-btn--secondary relative z-10 w-full text-sm" disabled={disabled} onClick={() => onWear(token)}>
                Owned · Wear
              </button>
            ) : (
              <button className="pixel-btn relative z-10 w-full text-sm" disabled={disabled || !onBuy} onClick={() => onBuy?.(key)}
                aria-label={`Buy ${costumeLabel(key)} for ${formatNear(COSTUME_PRICE)} NEAR`}>
                {busyKey === key ? "Check your wallet..." : `${formatNear(COSTUME_PRICE)} NEAR`}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
