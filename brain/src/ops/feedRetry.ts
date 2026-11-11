/**
 * F3: feeder `feed` retries (used by the feeder worker in fuel/orders.ts). A failed try waits
 * 2 s, 10 s, 60 s, 60 s; after the 5th failed try the order is `failed` with an alert. A retry is
 * only allowed when the earlier try provably did not feed:
 *   - the error carries a tx hash: that tx is re-read on chain before the retry, and if it shows
 *     a `fed` event the order is marked fed instead of feeding again;
 *   - no tx hash: the feeder's access key nonces (summed) must be unchanged since before the try,
 *     so nothing was included. If they moved, or cannot be read, the outcome is unknown and the
 *     order fails at once with an alert (a human checks the feeder's txs). Never feed twice.
 */

export const FEED_RETRY_DELAYS_MS = [2_000, 10_000, 60_000, 60_000];
export const MAX_FEED_TRIES = FEED_RETRY_DELAYS_MS.length + 1;

/** near-api-js execution errors carry the tx hash; network errors and timeouts do not. */
export function errorTxHash(e: unknown): string | null {
  if (!e || typeof e !== "object") return null;
  const o = e as {
    txHash?: unknown;
    transactionHash?: unknown;
    context?: { transactionHash?: unknown };
    /** ContractExecutionError (a panic) carries the whole RPC response instead of `txHash`. */
    transactionResult?: { transaction?: { hash?: unknown }; transaction_outcome?: { id?: unknown } };
  };
  const r = o.transactionResult;
  for (const v of [o.txHash, o.transactionHash, o.context?.transactionHash, r?.transaction?.hash, r?.transaction_outcome?.id]) {
    if (typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(v)) return v;
  }
  return null;
}

type Fetch = typeof fetch;

/** Sum of the nonces of every access key on the account (RPC `view_access_key_list`), or null. */
export function createFeederNonce(rpcUrls: string[], accountId: string, f: Fetch = fetch): () => Promise<bigint | null> {
  return async () => {
    for (const url of rpcUrls) {
      try {
        const res = await f(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: "nearling", method: "query",
            params: { request_type: "view_access_key_list", finality: "final", account_id: accountId },
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) continue;
        const j = (await res.json()) as { result?: { keys?: { access_key?: { nonce?: number | string } }[] } };
        if (!j.result?.keys) continue;
        return j.result.keys.reduce((s, k) => s + BigInt(k.access_key?.nonce ?? 0), 0n);
      } catch {
        // try the next RPC
      }
    }
    return null;
  };
}
