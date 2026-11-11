"use client";

import { useCallback, useEffect, useState } from "react";
import { accountBalance, formatNear } from "@/lib/chain";
import { FAUCET_THRESHOLD, FAUCETS, needsFaucet } from "@/lib/faucet";
import { useWallet } from "@/lib/wallet";
import { ErrorText, Panel } from "./ui";

/**
 * Shown only when the connected testnet account holds less than `need` (default 0.3 NEAR).
 * Links to the official faucets; nothing here calls a faucet for the user.
 */
export function FaucetPanel({ need = FAUCET_THRESHOLD }: { need?: bigint }) {
  const { accountId } = useWallet();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);

  const check = useCallback(async () => {
    if (!accountId) return;
    setChecking(true);
    setFailed(false);
    try {
      setBalance(await accountBalance(accountId));
    } catch {
      setFailed(true);
    } finally {
      setChecking(false);
    }
  }, [accountId]);

  useEffect(() => {
    setBalance(null);
    void check();
  }, [check]);

  if (!accountId) return null;
  if (failed && balance === null) {
    return (
      <ErrorText>
        Couldn&apos;t read your balance from NEAR testnet.{" "}
        <button className="underline" onClick={() => void check()}>Check again</button>
      </ErrorText>
    );
  }
  if (!needsFaucet(balance, need)) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(accountId!);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Panel className="border-warn">
      <h2 className="font-display text-lg">Get free testnet NEAR</h2>
      <p className="text-sm">
        Your account holds <span className="font-mono">{formatNear(balance ?? 0n)} NEAR</span>. You need about{" "}
        <span className="font-mono">{formatNear(need)} NEAR</span> for this step. Testnet NEAR is free and has no real value.
      </p>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-sm" title={accountId}>{accountId}</span>
        <button className="pixel-btn pixel-btn--secondary px-3 text-sm" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy account id"}
        </button>
      </div>
      <p className="text-sm text-muted">
        Open a faucet, paste your account id and request NEAR. Then come back and check your balance.
      </p>
      <div className="flex flex-wrap gap-3">
        {FAUCETS.map((f) => (
          <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="pixel-btn pixel-btn--secondary text-sm">
            Open {f.name}
          </a>
        ))}
      </div>
      <button className="pixel-btn self-start" disabled={checking} onClick={() => void check()}>
        {checking ? "Checking..." : "Check my balance"}
      </button>
    </Panel>
  );
}
