"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getBattle, type BattleRecord } from "@/lib/chain";
import { traitSummary } from "@/lib/traits";

/**
 * Battle level and record from chain (`get_battle`), with a link to the battle lobby, and the
 * pet's five traits with the battle style they give (collapsed by default).
 */
export function BattleLine({ contract, tokenId, isOwner, traits }: { contract: string; tokenId: string; isOwner: boolean; traits: readonly number[] }) {
  const [r, setR] = useState<BattleRecord | null>(null);
  useEffect(() => {
    let live = true;
    getBattle(contract, tokenId).then((v) => live && setR(v)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [contract, tokenId]);
  const t = traitSummary(traits);
  const level = r?.level ?? 1;
  return (
    <div className="flex flex-col border-2 border-line bg-surface text-sm">
      {r && (
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <span>
            <span className="font-display">Battle Lv {r.level}</span>
            <span className="text-muted"> ({r.xp}/{r.level >= 20 ? "max" : 20 * r.level} XP, {r.wins} won, {r.losses} lost{r.draws ? `, ${r.draws} drawn` : ""})</span>
          </span>
          {isOwner && <Link href="/battle" className="font-display hover:text-accent">Battle</Link>}
        </div>
      )}
      <details className={r ? "border-t-2 border-line" : ""}>
        <summary className="cursor-pointer px-3 py-2 font-display hover:text-accent">Traits</summary>
        <div className="flex flex-col gap-3 px-3 pb-3">
          <ul className="flex flex-col gap-2">
            {t.traits.map((x) => (
              <li key={x.label} className="grid grid-cols-[4.5rem_1fr_2rem] items-center gap-x-2">
                <span>{x.label}</span>
                <div role="meter" aria-label={x.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={x.value} className="h-3 border-2 border-[var(--n-line)] bg-bg">
                  <div className="h-full bg-accent" style={{ width: `${x.value}%` }} />
                </div>
                <span className="text-right font-mono tabular-nums">{x.value}</span>
                <span className="col-start-2 col-span-2 text-xs text-muted">Battle: {x.effect}</span>
              </li>
            ))}
          </ul>
          <div>
            <p><span className="font-display">Battle style: {t.family}</span> <span className="text-muted">(its highest trait)</span></p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {t.skills.map((k) => (
                <li key={k.name} className={k.level <= level ? "" : "text-muted"}>
                  {k.name} <span className="text-muted">{k.level <= level ? "(unlocked)" : `(at Lv ${k.level})`}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}
