"use client";

import "@radix-ui/themes/styles.css";
import "@peerfolio/privy-near-connect/sign-page-plugin/theme.css";
import { SignPagePlugin } from "@peerfolio/privy-near-connect/sign-page-plugin";
import type Privy from "@privy-io/js-sdk-core";
import { useEffect, useState } from "react";
import { RPC_URL } from "@/lib/chain";
import { ensureNearWallet, getPrivy, privyEnabled, privyLoggedIn } from "@/lib/privy";

type Ready =
  | { phase: "loading" }
  | { phase: "signed-out" }
  | { phase: "error"; message: string }
  | { phase: "ready"; privy: Privy };

/**
 * The /sign popup NEAR Connect opens for the "Email or Google" wallet: shows what is being signed
 * and signs it with the user's Privy NEAR wallet. Requests are accepted from our own origin only.
 */
export function SignPopup() {
  const [state, setState] = useState<Ready>({ phase: "loading" });

  useEffect(() => {
    if (!privyEnabled()) return setState({ phase: "error", message: "Email and Google sign-in is not set up." });
    let cancelled = false;
    (async () => {
      try {
        const privy = await getPrivy();
        if (!(await privyLoggedIn(privy))) return !cancelled && setState({ phase: "signed-out" });
        await ensureNearWallet(privy); // the plugin then finds it in the user's linked accounts
        if (!cancelled) setState({ phase: "ready", privy });
      } catch {
        if (!cancelled) setState({ phase: "error", message: "Couldn't reach Privy. Close this window and try again." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.phase === "loading") return <p className="p-6 font-mono text-sm text-muted">Loading...</p>;
  if (state.phase === "error") return <p className="p-6 text-sm text-danger">{state.message}</p>;
  if (state.phase === "signed-out") {
    return (
      <div className="flex flex-col gap-3 p-6">
        <p className="text-sm">Sign in with email or Google first.</p>
        <button
          className="pixel-btn self-start"
          onClick={() => {
            window.opener?.location.assign("/login");
            window.close();
          }}
        >
          Go to sign-in
        </button>
      </div>
    );
  }
  return (
    <SignPagePlugin
      privy={state.privy}
      options={{
        allowedOrigins: [window.location.origin],
        rpcOptions: { url: RPC_URL },
        debug: false,
      }}
    />
  );
}
