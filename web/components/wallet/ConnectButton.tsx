"use client";

import { useEffect, useState } from "react";
import { accountBalance, formatNear } from "@/lib/chain";
import { useSignIn } from "@/lib/wallet";
import { ErrorText } from "./ui";

/**
 * Connect + NEP-413 sign-in in one popup when the wallet supports it, then POST /session.
 * When the wallet is connected but the brain session is missing, it signs the message only.
 */
export function ConnectButton({ label = "Connect wallet", compact = false }: { label?: string; compact?: boolean }) {
  const { wallet, session, busy, error, signIn, signOut } = useSignIn();

  if (!wallet.ready) {
    return (
      <button className="pixel-btn" disabled>
        Loading wallet...
      </button>
    );
  }

  if (wallet.accountId && session) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col items-end leading-tight">
          <span className={`truncate font-mono text-sm ${compact ? "max-w-[9rem]" : ""}`} title={wallet.accountId}>
            {wallet.accountId}
          </span>
          <Balance account={wallet.accountId} />
        </span>
        <button className={`pixel-btn pixel-btn--secondary ${compact ? "px-3 text-sm" : ""}`} onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button className={`pixel-btn ${compact ? "px-3 text-sm" : ""}`} disabled={busy} onClick={() => void signIn()}>
        {busy ? "Check your wallet..." : wallet.accountId ? "Sign in to Petto" : label}
      </button>
      {!compact && wallet.accountId && (
        <button className="self-start text-sm text-muted underline" onClick={() => void signOut()}>
          Disconnect {wallet.accountId}
        </button>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

const BALANCE_MS = 30_000;

/** The wallet's NEAR on testnet, refreshed every 30 s and when the tab comes back into view. */
function Balance({ account }: { account: string }) {
  const [yocto, setYocto] = useState<bigint | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => accountBalance(account).then((b) => live && setYocto(b), () => undefined);
    void load();
    const t = setInterval(load, BALANCE_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [account]);

  if (yocto === null) return null;
  return (
    <span className="font-mono text-xs text-muted" title="Wallet balance on NEAR testnet">
      {formatNear(yocto, 3)} NEAR
    </span>
  );
}
