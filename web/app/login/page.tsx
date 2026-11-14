"use client";

import type Privy from "@privy-io/js-sdk-core";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { AppFrame, ErrorText, Panel, Spinner } from "@/components/wallet/ui";
import {
  ensureNearWallet,
  getPrivy,
  oauthReturn,
  privyEnabled,
  privyLoggedIn,
  privyLogout,
  PRIVY_WALLET_ID,
} from "@/lib/privy";
import { useSignIn } from "@/lib/wallet";

// /login: social login (email code or Google) through Privy, then the same NEP-413 sign-in as a
// wallet, through the "Email or Google" NEAR Connect wallet (it signs on the page, lib/privyHost.ts).
// Once Privy knows you, the Petto sign-in runs by itself (auto-approved) and you land on `next`;
// pages that need NEAR show the faucet panel there.

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
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { wallet, session, busy, error: signInError, signIn, signOut } = useSignIn();
  const [privy, setPrivy] = useState<Privy | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [account, setAccount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [autoTried, setAutoTried] = useState(false);

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

  // Logged in to Privy: sign in to Petto with it (no click), then go on to `next`.
  useEffect(() => {
    if (phase !== "wallet" || !account || !wallet.ready || busy) return;
    if (wallet.accountId === account && session) return router.replace(next);
    if (wallet.accountId && wallet.accountId !== account) {
      void wallet.disconnect().catch(() => undefined); // another wallet (e.g. Meteor) was connected
      return;
    }
    if (autoTried) return;
    setAutoTried(true);
    void signIn({ walletId: PRIVY_WALLET_ID });
  }, [phase, account, wallet, session, busy, autoTried, next, router, signIn]);

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
  /** Logged in to Privy as someone else: end that login (and the Petto sign-in if it is that account). */
  const switchAccount = () =>
    step(async () => {
      if (wallet.accountId === account) await signOut();
      await privyLogout();
      setAccount(null);
      setCode("");
      setAutoTried(false);
      setPhase("signed-out");
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
          <button
            className="pixel-btn flex items-center justify-center gap-3"
            disabled={working || !privy}
            onClick={() => void google()}
          >
            <GoogleMark />
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
          {!signInError ? (
            <Spinner label={`Signing you in as ${account.slice(0, 8)}...`} />
          ) : (
            <>
              <ErrorText>{signInError}</ErrorText>
              <button className="pixel-btn" disabled={busy || !wallet.ready} onClick={() => void signIn({ walletId: PRIVY_WALLET_ID })}>
                Try again
              </button>
            </>
          )}
          <button className="self-start text-sm text-muted underline" disabled={working || busy} onClick={() => void switchAccount()}>
            Use a different account
          </button>
        </Panel>
      )}

      <ErrorText>{error}</ErrorText>
    </AppFrame>
  );
}

/** Google's multicolor "G" (sign-in branding). */
function GoogleMark() {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true">
      <svg viewBox="0 0 48 48" width="18" height="18">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
    </span>
  );
}
