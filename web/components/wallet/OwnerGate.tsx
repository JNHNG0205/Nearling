"use client";

import { useSignIn } from "@/lib/wallet";
import { ConnectButton } from "./ConnectButton";
import { Panel } from "./ui";

/**
 * Renders children only for the pet's owner with a brain session; otherwise asks to connect
 * or explains that only the owner can use this page.
 */
export function OwnerGate({
  owner,
  name,
  needSession = true,
  children,
}: {
  owner: string;
  name: string;
  needSession?: boolean;
  children: React.ReactNode;
}) {
  const { wallet, session } = useSignIn();
  if (!wallet.accountId || (needSession && !session)) {
    return (
      <Panel>
        <p>Connect {name}'s owner wallet to continue.</p>
        <ConnectButton />
      </Panel>
    );
  }
  if (wallet.accountId !== owner) {
    return (
      <Panel>
        <p>Only {name}'s owner can do that.</p>
        <p className="text-sm text-muted">
          Signed in as <span className="font-mono">{wallet.accountId}</span>.
        </p>
        <ConnectButton />
      </Panel>
    );
  }
  return <>{children}</>;
}
