// Time-based progress for a pending transaction. Signing in the wallet and NEAR's confirmation
// happen in one call, so the real stage is unknown: the bar fills fast then slows, never reaching
// the end until the transaction is done, and the text moves on so it never looks stuck.

export const TX_BLOCKS = 10;

export function txProgress(elapsedMs: number): { filled: number; label: string } {
  const s = elapsedMs / 1_000;
  const filled = Math.min(TX_BLOCKS - 1, Math.max(1, Math.round(TX_BLOCKS * (1 - Math.exp(-s / 4)))));
  const label =
    s < 2 ? "Waiting for your wallet..." : s < 6 ? "Sending to NEAR testnet..." : "NEAR is confirming. This takes a few seconds...";
  return { filled, label };
}
