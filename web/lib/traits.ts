// The pet's five on-chain traits (0 to 100, chain order) in words: the battle stats each one
// raises, and the battle style its highest trait picks (packages/battle statsFor and allSkillsFor).
import { allSkillsFor, familyOf } from "@petto/battle";

export type Stat = "attack" | "speed" | "mp" | "hp" | "defence" | "crit" | "heal";
export const STAT_LABEL: Record<Stat, string> = {
  attack: "Attack", speed: "Speed", mp: "MP", hp: "HP", defence: "Defence", crit: "Crit", heal: "Healing",
};

const TRAITS: { label: string; stats: Stat[] }[] = [
  { label: "Playful", stats: ["attack", "speed"] },
  { label: "Curious", stats: ["mp", "speed"] },
  { label: "Calm", stats: ["hp", "defence"] },
  { label: "Sassy", stats: ["crit"] },
  { label: "Kind", stats: ["heal"] },
];

export interface TraitSummary {
  traits: { label: string; value: number; stats: Stat[] }[];
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
