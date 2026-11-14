"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PixelIcon } from "@/components/PixelIcon";
import { getBattle, type BattleRecord } from "@/lib/chain";
import { STAT_LABEL, traitSummary } from "@/lib/traits";

/** The pet's five traits with the battle stats each raises, its battle record and battle style. */
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
      <section className="pixel-panel flex flex-col gap-4 p-4">
        <div>
          <h2 className="font-display text-xl">Traits</h2>
          <p className="text-sm text-muted">Set at birth. They shape how {name} looks and fights.</p>
        </div>
        <ul className="flex flex-col gap-4">
          {t.traits.map((x) => (
            <li key={x.label} className="grid grid-cols-[5rem_1fr_2.5rem] items-center gap-x-3 gap-y-1">
              <span className="font-display text-sm">{x.label}</span>
              <div role="meter" aria-label={x.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={x.value} className="h-3 border-2 border-[var(--n-line)] bg-bg">
                <div className="h-full bg-accent" style={{ width: `${x.value}%` }} />
              </div>
              <span className="text-right font-mono tabular-nums">{x.value}</span>
              <span className="col-start-2 col-span-2 flex flex-wrap gap-3 text-xs text-muted">
                {x.stats.map((s) => (
                  <span key={s} className="flex items-center gap-1"><PixelIcon name={s} size={14} />{STAT_LABEL[s]}</span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="pixel-panel flex flex-col gap-4 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="font-display text-xl">Battle style: {t.family}</h2>
            <p className="text-sm text-muted">
              Battle Lv {level}{r && `, ${r.wins} won, ${r.losses} lost${r.draws ? `, ${r.draws} drawn` : ""}`}
            </p>
          </div>
          <Link href="/battle" className="pixel-btn shrink-0 text-sm">Battle</Link>
        </div>
        <ul className="flex flex-col gap-2 text-sm">
          {t.skills.map((k) => {
            const open = k.level <= level;
            return (
              <li key={k.name} className={`flex items-center gap-2 ${open ? "" : "text-muted"}`}>
                <PixelIcon name={open ? "attack" : "lock"} size={14} />
                <span>{k.name}</span>
                {!open && <span className="text-xs">Lv {k.level}</span>}
              </li>
            );
          })}
        </ul>
        <ul className="flex flex-col gap-2 border-t-2 border-line pt-3 text-sm">
          <li className="flex items-center gap-2"><PixelIcon name="defence" size={14} /><span><span className="font-display">Defend</span> <span className="text-muted">takes less damage and regains MP</span></span></li>
          <li className="flex items-center gap-2"><PixelIcon name="dodge" size={14} /><span><span className="font-display">Dodge</span> <span className="text-muted">may avoid the hit; faster pets dodge more</span></span></li>
        </ul>
      </section>
    </div>
  );
}
