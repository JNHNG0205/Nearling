"use client";

import type Privy from "@privy-io/js-sdk-core";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { FaucetPanel } from "@/components/wallet/FaucetPanel";
import { AppFrame, ErrorText, Panel, Spinner } from "@/components/wallet/ui";
import {
  ensureNearWallet,
  getPrivy,
  oauthReturn,
  privyEnabled,
  privyLoggedIn,
  PRIVY_WALLET_ID,
} from "@/lib/privy";
import { useSignIn } from "@/lib/wallet";

// /login: social login (email code or Google) through Privy, then the same NEP-413 sign-in as a
// wallet, through the "Email or Google" NEAR Connect wallet. Login happens here, in the main
// window, because the /sign popup must answer the wallet selector within 30 s.

export default function LoginPage() {
  return (
    <Suspense fallback={<AppFrame title="Sign in" back="/"><Spinner /></AppFrame>}>
      <Login />
    </Suspense>
  );
}

/** Only same-site paths, so `?next=` cannot send people elsewhere. */
function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/my";
}

type Phase = "loading" | "signed-out" | "code-sent" | "wallet" | "error";

function Login() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { wallet, session, busy, error: signInError, signIn } = useSignIn();
  const [privy, setPrivy] = useState<Privy | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [account, setAccount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const afterLogin = useCallback(async (p: Privy) => {
    setAccount((await ensureNearWallet(p)).address);
    setPhase("wallet");
  }, []);

  useEffect(() => {
    if (!privyEnabled()) return setPhase("error");
    let cancelled = false;
    (async () => {
      try {
        const p = await getPrivy();
        if (cancelled) return;
        setPrivy(p);
        const back = oauthReturn(window.location.search);
        if (back) {
          await p.auth.oauth.loginWithCode(back.code, back.state, back.provider);
          window.history.replaceState(null, "", `/login?next=${encodeURIComponent(next)}`);
        }
        if (await privyLoggedIn(p)) await afterLogin(p);
        else setPhase("signed-out");
      } catch {
        if (!cancelled) {
          setError("Sign-in didn't finish. Please try again.");
          setPhase("signed-out");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [afterLogin, next]);

  async function step(run: () => Promise<void>) {
    setWorking(true);
    setError(null);
    try {
      await run();
    } catch {
      setError("That didn't work. Check and try again.");
    } finally {
      setWorking(false);
    }
  }

  const sendCode = () =>
    step(async () => {
      await privy!.auth.email.sendCode(email.trim());
      setPhase("code-sent");
    });
  const enterCode = () =>
    step(async () => {
      await privy!.auth.email.loginWithCode(email.trim(), code.trim());
      await afterLogin(privy!);
    });
  const google = () =>
    step(async () => {
      const { url } = await privy!.auth.oauth.generateURL("google", `${window.location.origin}/login?next=${encodeURIComponent(next)}`);
      window.location.assign(url);
    });

  if (phase === "error") {
    return (
      <AppFrame title="Sign in" back="/">
        <p className="text-sm text-muted">Email and Google sign-in isn&apos;t set up here. Use a NEAR wallet instead.</p>
      </AppFrame>
    );
  }

  return (
    <AppFrame title="Sign in with email or Google" back="/">
      {phase === "loading" && <Spinner />}

      {(phase === "signed-out" || phase === "code-sent") && (
        <Panel>
          <p className="text-sm">No wallet needed. Petto makes you a NEAR testnet account.</p>
          <button className="pixel-btn" disabled={working || !privy} onClick={() => void google()}>
            Continue with Google
          </button>
          <label className="flex flex-col gap-2">
            <span className="font-display text-sm">Or use your email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 w-full border-2 border-line bg-bg px-3 text-base"
            />
          </label>
          {phase === "signed-out" ? (
            <button className="pixel-btn pixel-btn--secondary" disabled={working || !email.includes("@")} onClick={() => void sendCode()}>
              {working ? "Sending..." : "Email me a code"}
            </button>
          ) : (
            <>
              <label className="flex flex-col gap-2">
                <span className="font-display text-sm">Code from your email</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="h-12 w-full border-2 border-line bg-bg px-3 font-mono text-base"
                />
              </label>
              <button className="pixel-btn" disabled={working || code.trim().length < 6} onClick={() => void enterCode()}>
                {working ? "Checking..." : "Sign in"}
              </button>
            </>
          )}
        </Panel>
      )}

      {phase === "wallet" && account && (
        <Panel>
          <p className="text-sm">Your NEAR testnet account:</p>
          <p className="break-all font-mono text-sm">{account}</p>
          {wallet.accountId === account && session ? (
            <>
              {/* a new account starts with 0 NEAR: the panel shows until it can hatch a pet */}
              <FaucetPanel />
              <Link href={next} className="pixel-btn text-center">
                Continue
              </Link>
            </>
          ) : (
            <button
              className="pixel-btn"
              disabled={busy || !wallet.ready}
              onClick={() => void signIn({ walletId: PRIVY_WALLET_ID })}
            >
              {busy ? "Check the popup..." : "Continue to Petto"}
            </button>
          )}
          <ErrorText>{signInError}</ErrorText>
        </Panel>
      )}

      <ErrorText>{error}</ErrorText>
    </AppFrame>
  );
}
