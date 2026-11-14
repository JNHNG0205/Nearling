"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { deviceNudgeKey, showDeviceNudge } from "@/lib/flow";

/**
 * "Connect your Petto" on the pet home while no device is paired (skipped in setup). "Not now"
 * hides it for this pet in this browser; Device stays in the pet's menu either way.
 */
export function DeviceNudge({ petRef, name, href, isOwner, paired }: {
  petRef: string;
  name: string;
  href: string;
  isOwner: boolean;
  paired: boolean;
}) {
  const [dismissed, setDismissed] = useState(true); // hidden until localStorage is read (no flash)

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(deviceNudgeKey(petRef)) === "1");
    } catch {
      setDismissed(false);
    }
  }, [petRef]);

  if (!showDeviceNudge({ isOwner, paired, dismissed })) return null;

  function notNow() {
    setDismissed(true);
    try {
      window.localStorage.setItem(deviceNudgeKey(petRef), "1");
    } catch {
      // storage blocked: hidden for this visit only
    }
  }

  return (
    <aside aria-label="Connect your Petto" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-2 border-line bg-surface px-3 py-2 text-sm">
      <span className="flex-1">Give {name} a body on your desk: connect a Petto device.</span>
      <Link href={href} className="font-display text-accent underline">Connect your Petto</Link>
      <button className="text-muted underline" onClick={notNow}>
        Not now
      </button>
    </aside>
  );
}
