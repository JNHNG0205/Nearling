"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/site/Logo";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { putProfile } from "@/lib/brain";
import { inSetup, setupGate } from "@/lib/flow";
import { loadMyPets } from "@/lib/myPets";
import { authHeaders, useSession } from "@/lib/session";
import { useWallet } from "@/lib/wallet";

/**
 * App header (W10): wordmark, Home, Shop, Race, wallet; setup screens (lib/flow.ts inSetup) get no nav. The landing page gets a light, static one
 * (same for everyone): wordmark and "Open app" to /start, which routes by what the account owns.
 */
export function SiteHeader() {
  useTimezoneSync();
  useSetupGate();
  const path = usePathname();
  if (path === "/") {
    return (
      <header className="border-b-2 border-line">
        <div className="mx-auto flex min-h-16 max-w-[1200px] items-center justify-between gap-x-3 px-4 py-2 md:px-6">
          <Link href="/" aria-label="Petto, home" className="pt-3"><Logo /></Link>
          <Link href="/start" className="pixel-btn px-3 text-sm">Open app</Link>
        </div>
      </header>
    );
  }
  return (
    <header className="border-b-2 border-line">
      {/* one row at 390 px too: no wrap, tighter gaps and wordmark on phones */}
      <div className="mx-auto flex min-h-16 max-w-[1200px] items-center gap-x-3 px-4 py-2 md:gap-x-6 md:px-6">
        <Link href="/" aria-label="Petto, home" className="shrink-0 pt-3"><Logo /></Link>
        {inSetup(path) ? (
          <span className="flex-1" />
        ) : (
          <nav aria-label="Main" className="flex flex-1 gap-3 font-display text-sm md:gap-6">
            <Link href="/my" className="hover:text-accent">Home</Link>
            <Link href="/shop" className="hover:text-accent">Shop</Link>
            <Link href="/race" className="hover:text-accent">Race</Link>
            <Link href="/mcp" className="hover:text-accent">MCP</Link>
          </nav>
        )}
        <ConnectButton compact label="Connect wallet" />
      </div>
    </header>
  );
}

const TZ_KEY = "petto.tz-sent.";
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

/** Accounts known to own a pet; a zero is never cached, so a pet hatched a moment ago counts at once. */
const hasPet = new Set<string>();

/**
 * Setup guard (lib/flow.ts setupGate): a connected wallet with no pet is sent from the app pages
 * (Home, Shop, Race, Wallet) to setup. A failed pet lookup leaves the page alone.
 */
function useSetupGate() {
  const path = usePathname();
  const router = useRouter();
  const account = useWallet().accountId;
  const session = useSession();
  useEffect(() => {
    if (!account || setupGate({ path, account, pets: 0 }) === null || hasPet.has(account)) return;
    let live = true;
    loadMyPets(account, session ? authHeaders() : {})
      .then(({ pets }) => {
        if (pets.length > 0) hasPet.add(account);
        const to = setupGate({ path, account, pets: pets.length });
        if (live && to) router.replace(to);
      })
      .catch(() => undefined); // unknown: stay
    return () => {
      live = false;
    };
  }, [path, account, session, router]);
}
