"use client";

import dynamic from "next/dynamic";

// /sign: popup for the "Email or Google" wallet (lib/privy.ts). Client only: Privy and the
// signing handshake need window, localStorage and window.opener.
const SignPopup = dynamic(() => import("@/components/wallet/SignPopup").then((m) => m.SignPopup), { ssr: false });

export default function SignPage() {
  return <SignPopup />;
}
