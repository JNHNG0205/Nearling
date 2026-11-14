"use client";

import { useEffect, useSyncExternalStore } from "react";
import { confirmStore } from "@/lib/privyHost";

/** Same-page approval for the "Email or Google" wallet (lib/privyHost.ts): no popup or tab. */
export function PrivyConfirm() {
  const req = useSyncExternalStore(confirmStore.subscribe, confirmStore.get, () => null);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && req.reject();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req]);

  if (!req) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="privy-confirm-title"
        className="pixel-panel flex w-full max-w-[420px] flex-col gap-4 bg-bg p-5"
      >
        <h2 id="privy-confirm-title" className="font-display text-lg">
          {req.title}
        </h2>
        <ul className="flex flex-col gap-2 text-sm">
          {req.lines.map((l, i) => (
            <li key={i} className="break-words border-2 border-line p-2 font-mono">
              {l}
            </li>
          ))}
        </ul>
        {req.gasless && <p className="text-sm text-fuel">Gas paid by Petto. You only pay the NEAR shown above.</p>}
        <p className="text-xs text-muted">Signed with your email or Google NEAR account on testnet.</p>
        <div className="grid grid-cols-2 gap-3">
          <button className="pixel-btn pixel-btn--secondary" onClick={req.reject}>
            Cancel
          </button>
          <button className="pixel-btn" autoFocus onClick={req.approve}>
            Approve
          </button>
        </div>
      </section>
    </div>
  );
}
