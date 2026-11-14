"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EXPLORER_TX } from "@/lib/chain";
import { TX_BLOCKS, txProgress } from "@/lib/txProgress";
import type { TxState } from "./useTx";

/** Phone-first app frame: back arrow + Pixelify title, 480 px column, 16 px gutters (design.md 6.2). */
export function AppFrame({
  title,
  back,
  demo,
  wide,
  children,
}: {
  title: string;
  back?: string;
  demo?: boolean;
  /** desktop: up to 1100 px for two-column pages */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className={`mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-6 px-4 py-6 md:max-w-[760px] md:gap-8 md:px-6 md:py-10 ${wide ? "lg:max-w-[1100px]" : ""}`}>
      <header className="flex items-center gap-3">
        {back && (
          <Link href={back} aria-label="Go back" className="font-display text-2xl text-accent">
            &lt;
          </Link>
        )}
        <h1 className="flex-1 font-display text-2xl md:text-3xl">{title}</h1>
        {demo && <DemoSpeedPill />}
      </header>
      {children}
    </main>
  );
}

export function DemoSpeedPill() {
  return <span className="border-2 border-accent px-2 font-display text-sm text-accent">demo speed</span>;
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      <span aria-hidden>! </span>
      {children}
    </p>
  );
}

export function TxLink({ hash }: { hash: string }) {
  return (
    <a href={`${EXPLORER_TX}${hash}`} target="_blank" rel="noreferrer" className="font-mono text-sm text-accent underline">
      {hash.slice(0, 6)}...{hash.slice(-4)}
    </a>
  );
}

/** Mono status line for the last transaction. */
export function TxStatus({ state, doneText = "Done" }: { state: TxState; doneText?: string }) {
  switch (state.phase) {
    case "idle":
      return null;
    case "signing":
      return <TxProgress />;
    case "cancelled":
      return <p className="font-mono text-sm text-muted">Cancelled</p>;
    case "done":
      return (
        <p className="font-mono text-sm text-fuel">
          {doneText} {state.hash && <>. <TxLink hash={state.hash} /></>}
        </p>
      );
    case "error":
      return (
        <ErrorText>
          {state.message} {state.hash && <TxLink hash={state.hash} />}
        </ErrorText>
      );
  }
}

export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`pixel-panel flex flex-col gap-3 p-4 ${className}`}>{children}</section>;
}

export function Spinner({ label = "Loading..." }: { label?: string }) {
  return <p className="font-mono text-sm text-muted">{label}</p>;
}

/** Pending transaction: a pixel bar that keeps moving and a stage line, so it never looks stuck. */
function TxProgress() {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const { filled, label } = txProgress(now - start);
  const secs = Math.floor((now - start) / 1_000);
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <div className="flex items-center gap-1" aria-hidden="true">
        {Array.from({ length: TX_BLOCKS }, (_, i) => (
          <span
            key={i}
            className={`h-3 flex-1 border-2 ${
              i < filled ? `border-accent bg-accent ${i === filled - 1 ? "motion-safe:animate-pulse" : ""}` : "border-line"
            }`}
          />
        ))}
      </div>
      <p className="flex justify-between gap-3 font-mono text-sm text-muted">
        <span>{label}</span>
        <span>{secs}s</span>
      </p>
    </div>
  );
}
