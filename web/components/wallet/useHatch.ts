"use client";

import { useCallback } from "react";
import { formatPetRef, type PetState } from "@nearling/shared";
import { postHatch } from "@/lib/brain";
import { getPet, outcomeFailure, tx } from "@/lib/chain";
import { authHeaders } from "@/lib/session";
import { useWallet } from "@/lib/wallet";

/**
 * Hatch a pet (Build Spec 1): the owner signs the contract's `hatch` while the pet is still an
 * egg on chain (so app and chain agree it is a Baby), then the brain plays the hatch and its
 * inbox line. Throws if the chain hatch fails; "already hatched" is fine.
 */
export function useHatch() {
  const wallet = useWallet();
  return useCallback(
    async (contract: string, tokenId: string): Promise<{ hatched_now: boolean; state: PetState }> => {
      const chain = await getPet(contract, tokenId);
      if (chain.stage === 0) {
        const outcome = await wallet.signAndSendTransaction(tx.hatch(contract, tokenId));
        const failure = outcomeFailure(outcome);
        if (failure && !failure.includes("E_HATCHED")) throw new Error(failure);
      }
      return postHatch(formatPetRef(contract, tokenId), authHeaders());
    },
    [wallet],
  );
}
