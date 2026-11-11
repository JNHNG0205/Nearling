import { nearToYocto } from "near-api-js";

/** Below this the faucet panel shows: a 0.2 NEAR hatch plus gas and a first snack. */
export const FAUCET_THRESHOLD: bigint = nearToYocto("0.3");

/** Official testnet faucets, both listed on the NEAR docs faucet page. */
export const FAUCETS = [
  { name: "NEAR docs faucet", url: "https://docs.near.org/getting-started/faucet" },
  { name: "near-faucet.io", url: "https://near-faucet.io/" },
] as const;

/** A payment of `yocto` plus 0.01 NEAR for gas. */
export function withGas(yocto: string | bigint): bigint {
  return BigInt(yocto) + nearToYocto("0.01");
}

/** True only when the balance is known and under what the next step needs. */
export function needsFaucet(balance: bigint | null, need: bigint = FAUCET_THRESHOLD): boolean {
  return balance !== null && balance < need;
}
