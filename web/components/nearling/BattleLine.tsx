"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getBattle, type BattleRecord } from "@/lib/chain";

/** Battle level and record from chain (`get_battle`), with a link to the battle lobby. */
export function BattleLine({ contract, tokenId, isOwner }: { contract: string; tokenId: string; isOwner: boolean }) {
  const [r, setR] = useState<BattleRecord | null>(null);
  useEffect(() => {
    let live = true;
    getBattle(contract, tokenId).then((v) => live && setR(v)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [contract, tokenId]);
  if (!r) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-2 border-line bg-surface px-3 py-2 text-sm">
      <span>
        <span className="font-display">Battle Lv {r.level}</span>
        <span className="text-muted"> ({r.xp}/{r.level >= 20 ? "max" : 20 * r.level} XP, {r.wins} won, {r.losses} lost{r.draws ? `, ${r.draws} drawn` : ""})</span>
      </span>
      {isOwner && <Link href="/battle" className="font-display hover:text-accent">Battle</Link>}
    </div>
  );
}
