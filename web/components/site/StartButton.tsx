"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { homeRoute } from "@/lib/flow";
import { loadMyPets } from "@/lib/myPets";
import { authHeaders } from "@/lib/session";
import { useSignIn } from "@/lib/wallet";

/**
 * The landing page's main button (lib/flow.ts): signed out "Get started" (connect, then /go);
 * signed in it leads home: "Hatch your first pet", "Open <pet>" or "My pets".
 */
export function StartButton() {
  const router = useRouter();
  const { wallet, session, busy, signIn } = useSignIn();
  const [home, setHome] = useState<{ href: string; label: string } | null>(null);

  useEffect(() => {
    setHome(null);
    if (!wallet.accountId || !session) return;
    let live = true;
    loadMyPets(wallet.accountId, authHeaders())
      .then(({ pets }) => live && setHome(homeRoute(pets)))
      .catch(() => live && setHome({ href: "/my", label: "My pets" }));
    return () => {
      live = false;
    };
  }, [wallet.accountId, session]);

  if (home) {
    return (
      <Link href={home.href} className="pixel-btn">
        {home.label}
      </Link>
    );
  }
  if (wallet.accountId && session) {
    return (
      <button className="pixel-btn" disabled>
        Finding your pets...
      </button>
    );
  }
  return (
    <button
      className="pixel-btn"
      disabled={!wallet.ready || busy}
      onClick={async () => {
        if (await signIn()) router.push("/go");
      }}
    >
      {busy ? "Check your wallet..." : "Get started"}
    </button>
  );
}
