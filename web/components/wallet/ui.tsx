"use client";

import Link from "next/link";
import { EXPLORER_TX } from "@/lib/chain";
import type { TxState } from "./useTx";

/** Phone-first app frame: back arrow + Pixelify title, 480 px column, 16 px gutters (design.md 6.2). */
export function AppFrame({
  title,
  back,
  demo,
  children,
}: {
  title: string;
  back?: string;
  demo?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col gap-6 px-4 py-6">
      <header className="flex items-center gap-3">
        {back && (
          <Link href={back} aria-label="Go back" className="font-display text-2xl text-accent">
            &lt;
          </Link>
        )}
        <h1 className="flex-1 font-display text-2xl">{title}</h1>
        {demo && <DemoSpeedPill />}
      </header>
      {children}
    </main>
  );
}

export function DemoSpeedPill() {
  return <span className="border-2 border-accent px-2 font-display text-sm text-accent">demo speed</span>;
}

export function SimulatedPill() {
  return <span className="border-2 border-warn px-2 font-display text-sm text-warn">simulated</span>;
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
      return <p className="font-mono text-sm text-muted">Waiting for your wallet...</p>;
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
