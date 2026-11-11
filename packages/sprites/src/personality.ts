// Personality from on-chain traits (CLAUDE.md 5.4 order: playful, curious, calm, sassy, kind).
// Rule (firmware uses the same): the highest trait wins if it is at least 50; ties go to the
// lower index; below 50 the pet has no personality and plays the default clips.

export const PERSONALITIES = ["playful", "curious", "calm", "sassy", "kind"] as const;
export type Personality = (typeof PERSONALITIES)[number];

export const PERSONALITY_MIN = 50;

export function personalityFromTraits(traits: readonly number[]): Personality | null {
  let best = 0;
  let value = -1;
  for (let i = 0; i < PERSONALITIES.length; i++) {
    const t = traits[i] ?? 0;
    if (t > value) {
      value = t;
      best = i;
    }
  }
  return value >= PERSONALITY_MIN ? (PERSONALITIES[best] ?? null) : null;
}
