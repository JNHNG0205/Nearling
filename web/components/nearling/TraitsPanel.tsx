"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getBattle, type BattleRecord } from "@/lib/chain";
import { traitSummary } from "@/lib/traits";

/** The pet's five traits with what each raises in battle, its battle record and battle style. */
export function TraitsPanel({ contract, tokenId, traits, name }: { contract: string; tokenId: string; traits: readonly number[]; name: string }) {
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
    <div className="flex flex-col gap-6">
      <section className="pixel-panel flex flex-col gap-3 p-4">
        <h2 className="font-display text-xl">Traits</h2>
        <p className="text-sm text-muted">Set at birth and stored on NEAR. They shape {name}&apos;s look and how it fights.</p>
        <ul className="flex flex-col gap-3">
          {t.traits.map((x) => (
            <li key={x.label} className="grid grid-cols-[5rem_1fr_2.5rem] items-center gap-x-3">
              <span className="font-display text-sm">{x.label}</span>
              <div role="meter" aria-label={x.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={x.value} className="h-3 border-2 border-[var(--n-line)] bg-bg">
                <div className="h-full bg-accent" style={{ width: `${x.value}%` }} />
              </div>
              <span className="text-right font-mono tabular-nums">{x.value}</span>
              <span className="col-start-2 col-span-2 text-xs text-muted">Battle: {x.effect}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="pixel-panel flex flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-xl">Battle style: {t.family}</h2>
          <Link href="/battle" className="font-display text-sm hover:text-accent">Battle</Link>
        </div>
        <p className="text-sm text-muted">
          From {name}&apos;s highest trait.{r && ` Battle Lv ${r.level}: ${r.wins} won, ${r.losses} lost${r.draws ? `, ${r.draws} drawn` : ""}.`}
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          {t.skills.map((k) => (
            <li key={k.name} className={k.level <= level ? "" : "text-muted"}>
              {k.name} <span className="text-muted">{k.level <= level ? "(unlocked)" : `(unlocks at Lv ${k.level})`}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
