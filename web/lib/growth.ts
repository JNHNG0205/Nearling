// Stage progress from on-chain XP. Thresholds match the contract (contract/src/pet.rs STAGE_XP):
// Baby 10, Teen 100, Adult 500. XP comes from chats (+1 each) and the owner's daily check-in (+2).

const STAGES: { name: string; xp: number }[] = [
  { name: "Baby", xp: 10 },
  { name: "Teen", xp: 100 },
  { name: "Adult", xp: 500 },
];

/** Where `xp` stands: the next stage (null when Adult), its threshold, and where this stage began. */
export function growth(xp: number): { xp: number; next: string | null; at: number; from: number } {
  const i = STAGES.findIndex((s) => xp < s.xp);
  if (i === -1) return { xp, next: null, at: 500, from: 500 };
  return { xp, next: STAGES[i]!.name, at: STAGES[i]!.xp, from: i === 0 ? 0 : STAGES[i - 1]!.xp };
}
