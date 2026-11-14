"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { putProfile } from "@/lib/brain";
import { loadMyPets } from "@/lib/myPets";
import { authHeaders, useSession } from "@/lib/session";

/** One header for every page (W10): wordmark, My pets, Race, wallet. */
export function SiteHeader() {
  useTimezoneSync();
  return (
    <header className="border-b-2 border-line">
      {/* one row at 390 px too: no wrap, tighter gaps and wordmark on phones */}
      <div className="mx-auto flex min-h-16 max-w-[1200px] items-center gap-x-3 px-4 py-2 md:gap-x-6 md:px-6">
        <Link href="/" className="font-display text-xl leading-8 font-bold md:text-[32px]">Petto</Link>
        <nav aria-label="Main" className="flex flex-1 gap-3 text-sm md:gap-6">
          <Link href="/my" className="hover:text-accent">My pets</Link>
          <Link href="/race" className="hover:text-accent">Race</Link>
        </nav>
        <ConnectButton compact label="Connect wallet" />
      </div>
    </header>
  );
}

const TZ_KEY = "nearling.tz-sent.";
let syncing: string | null = null;

/**
 * After sign-in, sends the browser's time zone to each owned pet's profile once, so morning
 * greetings and quiet hours follow the owner's clock (LIMITATIONS A10). Sent again only if the
 * zone changes; retried on the next page load if the brain refused.
 */
function useTimezoneSync() {
  const session = useSession();
  useEffect(() => {
    if (!session) return;
    let tz: string;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    const key = TZ_KEY + session.account;
    let sent: string | null = null;
    try {
      sent = window.localStorage.getItem(key);
    } catch {
      // storage blocked: send anyway
    }
    if (!tz || sent === tz || syncing === key) return;
    syncing = key;
    void (async () => {
      try {
        const headers = authHeaders();
        const { pets } = await loadMyPets(session.account, headers);
        const results = await Promise.allSettled(pets.map((p) => putProfile(p.ref, headers, { owner_tz: tz })));
        if (pets.length > 0 && results.every((r) => r.status === "fulfilled")) {
          try {
            window.localStorage.setItem(key, tz);
          } catch {
            // next load sends it again
          }
        }
      } catch {
        // brain or chain unreachable: try on the next page load
      }
    })();
  }, [session]);
}
