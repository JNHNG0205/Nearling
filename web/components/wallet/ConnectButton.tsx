"use client";

import { useSignIn } from "@/lib/wallet";
import { ErrorText } from "./ui";

/**
 * Connect + NEP-413 sign-in in one popup when the wallet supports it, then POST /session.
 * When the wallet is connected but the brain session is missing, it signs the message only.
 */
export function ConnectButton({ label = "Connect Meteor" }: { label?: string }) {
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
        <span className="truncate font-mono text-sm" title={wallet.accountId}>
          {wallet.accountId}
        </span>
        <button className="pixel-btn pixel-btn--secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button className="pixel-btn" disabled={busy} onClick={() => void signIn()}>
        {busy ? "Check your wallet..." : wallet.accountId ? "Sign in to Nearling" : label}
      </button>
      {!wallet.accountId && (
        <button
          className="self-start text-sm text-muted underline"
          disabled={busy}
          onClick={() => void signIn({ anyWallet: true })}
        >
          Use another wallet
        </button>
      )}
      {wallet.accountId && (
        <button className="self-start text-sm text-muted underline" onClick={() => void signOut()}>
          Disconnect {wallet.accountId}
        </button>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
