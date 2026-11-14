"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountWithSignedMessage, NearConnector, SignedMessage, WalletManifest } from "@hot-labs/near-connect";
import { NETWORK, RPC_URL, type Outcome } from "@/lib/chain";
import { privyEnabled, privyManifest } from "@/lib/privy";
import { WalletContext, type WalletApi } from "@/lib/wallet";

/**
 * NEAR Connect on testnet. The connector is created after mount (it touches window,
 * IndexedDB and fetches the wallet manifest), so server rendering never loads it.
 */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [connector, setConnector] = useState<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const connectorRef = useRef<NearConnector | null>(null);

  useEffect(() => {
    let cancelled = false;
    let made: NearConnector | null = null;
    const onSignIn = (p: { accounts: { accountId: string }[] }) => setAccountId(p.accounts[0]?.accountId ?? null);
    const onSignOut = () => setAccountId(null);

    (async () => {
      const { NearConnector } = await import("@hot-labs/near-connect");
      if (cancelled) return;
      made = new NearConnector({
        network: NETWORK,
        providers: { testnet: [RPC_URL] },
        features: { signMessage: true, testnet: true },
      });
      connectorRef.current = made;
      if (privyEnabled()) {
        // social login (lib/privy.ts): one more sandbox wallet next to the default list
        await made.whenManifestLoaded.catch(() => undefined);
        await made.registerWallet(privyManifest(window.location.origin) as unknown as WalletManifest);
        if (cancelled) return;
      }
      made.on("wallet:signIn", onSignIn);
      made.on("wallet:signOut", onSignOut);
      setConnector(made);
      const restored = await made.getConnectedWallet().catch(() => null);
      if (cancelled) return;
      if (restored) setAccountId(restored.accounts[0]?.accountId ?? null);
      setReady(true);
    })();

    return () => {
      cancelled = true;
      made?.off("wallet:signIn", onSignIn);
      made?.off("wallet:signOut", onSignOut);
    };
  }, []);

  const api = useMemo<WalletApi>(() => {
    const need = (): NearConnector => {
      const c = connectorRef.current;
      if (!c) throw new Error("Wallet is still loading");
      return c;
    };
    return {
      ready,
      accountId,
      connector,
      async connect(opts) {
        const c = need();
        let signed: SignedMessage | null = null;
        const onSigned = (p: { accounts: AccountWithSignedMessage[] }) => {
          signed = p.accounts[0]?.signedMessage ?? null;
        };
        if (opts?.signMessage) c.on("wallet:signInAndSignMessage", onSigned);
        try {
          const w = await c.connect({
            ...(opts?.walletId ? { walletId: opts.walletId } : {}),
            ...(opts?.signMessage ? { signMessageParams: opts.signMessage } : {}),
          });
          const accounts = await w.getAccounts();
          const id = accounts[0]?.accountId;
          if (!id) throw new Error("Failed to sign in");
          setAccountId(id);
          return { accountId: id, signed };
        } finally {
          if (opts?.signMessage) c.off("wallet:signInAndSignMessage", onSigned);
        }
      },
      async disconnect() {
        const c = need();
        await c.disconnect().catch(() => undefined);
        setAccountId(null);
      },
      async signMessage(input) {
        const w = await need().wallet();
        return w.signMessage({ ...input, network: NETWORK });
      },
      async signAndSendTransaction(req) {
        const w = await need().wallet();
        return (await w.signAndSendTransaction({ network: NETWORK, ...req })) as Outcome;
      },
      async signAndSendTransactions(reqs) {
        const w = await need().wallet();
        return (await w.signAndSendTransactions({ network: NETWORK, transactions: reqs })) as Outcome[];
      },
    };
  }, [ready, accountId, connector]);

  return <WalletContext.Provider value={api}>{children}</WalletContext.Provider>;
}
