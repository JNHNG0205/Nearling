// Stage progress from the on-chain stage and XP (contract/src/pet.rs): an egg becomes a Baby by
// hatching (contract `hatch`), then XP grows it: Teen at 100, Adult at 500. XP comes from chats
// (+1 each) and the owner's daily check-in (+2).

const NEXT: Record<number, { name: string; at: number | null; from: number } | null> = {
  0: { name: "Baby", at: null, from: 0 }, // by hatching, not XP
  1: { name: "Teen", at: 100, from: 0 },
  2: { name: "Adult", at: 500, from: 100 },
  3: null,
};

/** Next stage for a pet at `stage` (0 egg .. 3 adult) with `xp`; `at` is null when it is not reached by XP. */
export function growth(xp: number, stage: number): { xp: number; next: string | null; at: number | null; from: number } {
  const n = NEXT[Math.min(Math.max(stage, 0), 3)];
  if (!n) return { xp, next: null, at: null, from: 500 };
  return { xp, next: n.name, at: n.at, from: n.from };
}
