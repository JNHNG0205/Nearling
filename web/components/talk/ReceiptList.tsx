"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrainRequestError, getTurns, minutesAgo, type Turn } from "@/lib/brain";
import { authHeaders, useSession } from "@/lib/session";
import { VerifyChip } from "./ReceiptCard";

type Load = { kind: "loading" } | { kind: "signed_out" } | { kind: "denied" } | { kind: "error" } | { kind: "ok"; turns: Turn[] };

/** `/pet/[petRef]/receipts`: recent replies with their verification status (owner only). */
export function ReceiptList({ petRef }: { petRef: string }) {
  const session = useSession();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const token = session?.token ?? null;

  useEffect(() => {
    if (!token) {
      setLoad({ kind: "signed_out" });
      return;
    }
    let live = true;
    setLoad({ kind: "loading" });
    getTurns(petRef, authHeaders(), 50)
      .then((turns) => live && setLoad({ kind: "ok", turns: turns.filter((t) => t.status !== "canned").reverse() }))
      .catch((err) => {
        if (!live) return;
        setLoad(err instanceof BrainRequestError && (err.status === 401 || err.status === 403) ? { kind: "denied" } : { kind: "error" });
      });
    return () => {
      live = false;
    };
  }, [petRef, token]);

  if (load.kind === "loading") return <p className="text-muted" role="status">Loading receipts...</p>;
  if (load.kind === "signed_out") return <p>Connect the owner&apos;s wallet to see this pet&apos;s receipts.</p>;
  if (load.kind === "denied") return <p>Only the pet&apos;s owner can see these receipts.</p>;
  if (load.kind === "error") return <p className="text-warn">The brain did not answer. Try again in a moment.</p>;
  if (load.turns.length === 0) return <p className="text-muted">No replies yet.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {load.turns.map((t) => (
        <li key={t.turn_id}>
          <Link href={`/receipt/${encodeURIComponent(t.turn_id)}`}
            className="pixel-panel flex items-center justify-between gap-3 p-3 hover:border-accent">
            <span className="min-w-0 flex-1 truncate">{t.reply}</span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <VerifyChip status={t.verification} />
              <span className="font-mono text-sm text-muted">{minutesAgo(t.at)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
