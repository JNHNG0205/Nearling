// The pet's five on-chain traits (0 to 100, chain order) in words: what each one does in battle,
// and the battle style its highest trait picks (packages/battle statsFor and allSkillsFor).
import { allSkillsFor, familyOf } from "@petto/battle";

const TRAITS = [
  { label: "Playful", effect: "attack and speed" },
  { label: "Curious", effect: "MP and speed" },
  { label: "Calm", effect: "HP and defence" },
  { label: "Sassy", effect: "critical hits" },
  { label: "Kind", effect: "healing" },
];

export interface TraitSummary {
  traits: { label: string; value: number; effect: string }[];
  family: string;
  skills: { name: string; level: number }[];
}

export function traitSummary(traits: readonly number[]): TraitSummary {
  const family = familyOf(traits);
  return {
    traits: TRAITS.map((t, i) => ({ ...t, value: traits[i] ?? 0 })),
    family: family[0]!.toUpperCase() + family.slice(1),
    skills: allSkillsFor(traits).filter((k) => k.id !== "attack").map((k) => ({ name: k.name, level: k.level })),
  };
}
