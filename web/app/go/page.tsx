"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppFrame, ErrorText, Spinner } from "@/components/wallet/ui";
import { homeRoute } from "@/lib/flow";
import { loadMyPets } from "@/lib/myPets";
import { authHeaders } from "@/lib/session";
import { useWallet } from "@/lib/wallet";

// /go: after sign-in, send the owner where they belong (lib/flow.ts): no pets = setup,
// one pet = its home, several = My pets.
export default function GoPage() {
  const router = useRouter();
  const wallet = useWallet();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!wallet.ready) return;
    if (!wallet.accountId) return router.replace("/");
    let live = true;
    loadMyPets(wallet.accountId, authHeaders())
      .then(({ pets }) => live && router.replace(homeRoute(pets).href))
      .catch(() => live && setError("Couldn't load your pets from NEAR testnet. Refresh to retry."));
    return () => {
      live = false;
    };
  }, [wallet.ready, wallet.accountId, router]);

  return (
    <AppFrame title="Welcome back">
      {error ? <ErrorText>{error}</ErrorText> : <Spinner label="Finding your pets..." />}
    </AppFrame>
  );
}
