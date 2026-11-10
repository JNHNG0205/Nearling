"use client";

import { useCallback, useState } from "react";
import { outcomeFailure, parseEvents, txHash, type ChainEvent, type Outcome, type TxRequest } from "@/lib/chain";
import { errorText, friendlyChainError, isWalletRejection } from "@/lib/errors";
import { useWallet } from "@/lib/wallet";

export interface TxResult {
  hash: string | null;
  events: ChainEvent[];
  outcome: Outcome;
}

export type TxState =
  | { phase: "idle" }
  | { phase: "signing" }
  | { phase: "done"; hash: string | null }
  | { phase: "cancelled" }
  | { phase: "error"; code: string | null; message: string; hash: string | null };

/**
 * Sends one transaction through the connected wallet, waits for the final outcome (wallets
 * return it), parses EVENT_JSON logs and maps `E_` panics to friendly copy.
 * Returns null when the tx was rejected, failed or cancelled; `state` says which.
 */
export function useTx(petName?: string) {
  const wallet = useWallet();
  const [state, setState] = useState<TxState>({ phase: "idle" });

  const send = useCallback(
    async (req: TxRequest): Promise<TxResult | null> => {
      setState({ phase: "signing" });
      try {
        const outcome = await wallet.signAndSendTransaction(req);
        const hash = outcome ? txHash(outcome) : null;
        const failure = outcome ? outcomeFailure(outcome) : null;
        if (failure) {
          const f = friendlyChainError(failure, petName);
          setState({ phase: "error", ...f, hash });
          return null;
        }
        setState({ phase: "done", hash });
        return { hash, events: outcome ? parseEvents(outcome) : [], outcome: outcome ?? {} };
      } catch (err) {
        if (isWalletRejection(err)) {
          setState({ phase: "cancelled" });
          return null;
        }
        const f = friendlyChainError(errorText(err), petName);
        setState({ phase: "error", ...f, hash: null });
        return null;
      }
    },
    [wallet, petName],
  );

  const reset = useCallback(() => setState({ phase: "idle" }), []);
  return { send, state, reset, busy: state.phase === "signing" };
}
