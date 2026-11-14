// NEAR account names for email/Google users (brain/src/identity/names.ts): the brain creates
// name.testnet with the user's own Privy key; afterwards the old hex account can hand over its
// pets and NEAR. Pure helpers, tested.

/** Same rule as the brain: 2 to 56 lowercase letters/digits, single - or _ between them. */
export function validNameLabel(label: string): boolean {
  return label.length >= 2 && label.length <= 56 && /^[a-z0-9]+([-_][a-z0-9]+)*$/.test(label);
}

/** Left on the old account: its storage (about 0.00182 NEAR) plus gas for the moves. */
export const MOVE_RESERVE = 5n * 10n ** 22n; // 0.05 NEAR

export interface OldPet {
  contract: string;
  tokenId: string;
  name: string;
  /** yocto planted in the Brain Garden */
  staked: string;
  /** an unstake is still on its way back */
  pending: boolean;
}

/** What can move from the old account now: pets with nothing planted, and the NEAR above the reserve. */
export function moveplan(pets: OldPet[], balanceYocto: bigint): { move: OldPet[]; keep: OldPet[]; nearYocto: bigint } {
  const free = (p: OldPet) => BigInt(p.staked) === 0n && !p.pending;
  return {
    move: pets.filter(free),
    keep: pets.filter((p) => !free(p)),
    nearYocto: balanceYocto > MOVE_RESERVE ? balanceYocto - MOVE_RESERVE : 0n,
  };
}
