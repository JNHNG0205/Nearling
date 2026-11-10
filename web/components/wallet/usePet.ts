"use client";

import { useCallback, useEffect, useState } from "react";
import type { PetState, PetView } from "@nearling/shared";
import { getPetState } from "@/lib/brain";
import { getPet, isDemoContract, petFromRef } from "@/lib/chain";

export interface PetData {
  contract: string;
  tokenId: string;
  ref: string;
  demo: boolean;
  /** Settled chain view (source of truth for money and ownership). */
  chain: PetView | null;
  /** Brain state (form, display state); null when the brain is unreachable. */
  brain: PetState | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/** Loads `get_pet` from chain and `/state` from the brain for a URL petRef. */
export function usePet(rawRef: string): PetData | { invalid: true } {
  const parsed = petFromRef(rawRef);
  const [chain, setChain] = useState<PetView | null>(null);
  const [brain, setBrain] = useState<PetState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const contract = parsed?.contract;
  const tokenId = parsed?.tokenId;
  const ref = parsed?.ref;

  const reload = useCallback(async () => {
    if (!contract || !tokenId || !ref) return;
    const [c, b] = await Promise.allSettled([getPet(contract, tokenId), getPetState(ref, { cache: "no-store" })]);
    if (c.status === "fulfilled") {
      setChain(c.value);
      setError(null);
    } else {
      setError(/E_UNKNOWN_PET/.test(String(c.reason)) ? "This pet doesn't exist." : "Couldn't reach NEAR testnet. Retry in a moment.");
    }
    setBrain(b.status === "fulfilled" ? b.value : null);
    setLoading(false);
  }, [contract, tokenId, ref]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!parsed) return { invalid: true };
  return { ...parsed, demo: isDemoContract(parsed.contract), chain, brain, error, loading, reload };
}
