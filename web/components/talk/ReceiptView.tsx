"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  BrainRequestError, getPetState, getReceipt, publishReceipt, type Receipt,
} from "@/lib/brain";
import { authHeaders, useSession } from "@/lib/session";
import { DemoSpeedPill } from "../nearling/Pills";
import { ReceiptCard } from "./ReceiptCard";

type Load =
  | { kind: "loading" }
  | { kind: "private" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ok"; receipt: Receipt; owner: string | null; demo: boolean };

/** `/receipt/[turnId]`: owner only unless the owner published it (03-pages section 5). */
export function ReceiptView({ turnId }: { turnId: string }) {
  const session = useSession();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState(false);
  const token = session?.token ?? null;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const receipt = await getReceipt(turnId, { headers: authHeaders(), cache: "no-store" });
        const pet = await getPetState(receipt.pet_ref, { cache: "no-store" }).catch(() => null);
        if (live) setLoad({ kind: "ok", receipt, owner: pet?.owner ?? null, demo: pet?.demo_speed ?? false });
      } catch (err) {
        if (!live) return;
        if (err instanceof BrainRequestError && (err.status === 401 || err.status === 403)) setLoad({ kind: "private" });
        else if (err instanceof BrainRequestError && err.status === 404) setLoad({ kind: "missing" });
        else setLoad({ kind: "error" });
      }
    })();
    return () => {
      live = false;
    };
  }, [turnId, token]);

  const back = load.kind === "ok" ? `/pet/${encodeURIComponent(load.receipt.pet_ref)}` : "/";

  let body;
  if (load.kind === "loading") body = <p className="text-muted" role="status">Loading the receipt...</p>;
  else if (load.kind === "private") body = (
    <p>This receipt is private to the pet&apos;s owner. Connect the owner&apos;s wallet to see it, or ask them to publish it.</p>
  );
  else if (load.kind === "missing") body = <p>No receipt for this reply. Canned replies cost no fuel and have no receipt.</p>;
  else if (load.kind === "error") body = <p className="text-warn">The brain did not answer. Try again in a moment.</p>;
  else {
    const { receipt, owner } = load;
    const isOwner = !!session && session.account === owner;
    const isPublic = receipt.verification.public === true;
    const publish = async () => {
      setPublishing(true);
      setPublishError(false);
      try {
        await publishReceipt(receipt.turn_id, authHeaders());
        setLoad({ ...load, receipt: { ...receipt, verification: { ...receipt.verification, public: true } } });
      } catch {
        setPublishError(true);
      } finally {
        setPublishing(false);
      }
    };
    body = (
      <ReceiptCard
        receipt={receipt}
        footer={
          isPublic ? (
            <p className="text-sm text-muted">
              Published. Anyone with this link can check it, and it shows on{" "}
              <Link className="text-accent underline underline-offset-4" href={`/p/${encodeURIComponent(receipt.pet_ref)}`}>the public pet page</Link>.
            </p>
          ) : isOwner ? (
            <div className="flex flex-col gap-2">
              <button type="button" className="pixel-btn self-start" onClick={publish} disabled={publishing}>
                {publishing ? "Publishing..." : "Publish this receipt"}
              </button>
              <p className="text-sm text-muted">Publishing shows the checks and hashes, never what was said.</p>
              {publishError && <p className="text-sm text-warn" role="alert"><span aria-hidden>! </span>Publishing failed. Try again.</p>}
            </div>
          ) : null
        }
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col gap-6 px-4 py-6">
      <header className="flex items-center gap-3">
        <Link href={back} className="pixel-btn pixel-btn--secondary px-3" aria-label="Back">&lt;</Link>
        <h1 className="font-display text-2xl">Receipt</h1>
        {load.kind === "ok" && load.demo && (
          <DemoSpeedPill />
        )}
      </header>
      {body}
      <p className="text-sm text-muted">
        How the checks work: <Link href="/privacy" className="text-accent underline underline-offset-4">private replies and what is verified</Link>.
      </p>
    </main>
  );
}
