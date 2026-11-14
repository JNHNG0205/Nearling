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
    <section aria-label="Connect your Petto" className="pixel-panel flex flex-col gap-3 p-4">
      <h2 className="font-display text-lg">Connect your Petto</h2>
      <p className="text-sm text-muted">
        Give {name} a body on your desk: pair a Petto device to talk, pet and play with {name} away from the browser.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={href} className="pixel-btn">Connect a Petto</Link>
        <button className="text-sm text-muted underline" onClick={notNow}>
          Not now
        </button>
      </div>
    </section>
  );
}
