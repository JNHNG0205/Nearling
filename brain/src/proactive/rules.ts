import type { ChainLifeState } from "@petto/shared";

/** Proactive rules (AI-brain architectual/07 section 3, CLAUDE.md 5.5). Pure functions, no I/O. */

export const THRESHOLD_TRIGGERS = ["fuel_empty", "dormant", "revived", "fuel_low", "evolved", "lonely"] as const;
export const BILLED_TRIGGERS = ["follow_up", "missed_you", "morning"] as const;
export type ThresholdTrigger = (typeof THRESHOLD_TRIGGERS)[number];
export type BilledTrigger = (typeof BILLED_TRIGGERS)[number];
export type ProactiveTrigger = ThresholdTrigger | BilledTrigger;

export const MAX_PER_DAY = 3;
export const LOW_FUEL = 5;
export const LONELY_BELOW = 30;
export const MISSED_AFTER_MS = 24 * 3600 * 1000;

/** A memory fact with a follow-up date (owned by the memory module). */
export interface FollowUp {
  /** stable hash of the fact (stored in `proactive_pet.state`, so never the text itself) */
  id: string;
  /** the fact text, in memory only; passed to the billed turn's prompt */
  fact?: string;
}

export interface PetFacts {
  name: string;
  lifeState: ChainLifeState;
  fuelLeft: number;
  form: "base" | "winged";
  careMood: number;
  lastOwnerTurnAt: number | null;
  /** an `evolved` inbox row already exists for this pet (the care module may send it first) */
  evolvedSent: boolean;
  now: number;
  /** owner local time */
  localHour: number;
  localDay: string;
  dueFollowUps: FollowUp[];
}

/** Stored per pet in `proactive_pet.state`, kept across days. */
export interface ProactiveMemory {
  /** threshold triggers sent for the current crossing; cleared when the condition clears */
  latched: ThresholdTrigger[];
  /** `last_owner_turn_at` that a missed_you was already sent for */
  missed_for?: number;
  /** owner-local day a morning greeting was sent */
  morning_day?: string;
  /** follow-up fact ids already asked about */
  follow_ups?: string[];
}

const lowFuelState = (s: ChainLifeState) => s === "Starving" || s === "Dormant";

export const isNight = (hour: number) => hour >= 22 || hour < 7;

/** Clears latches whose condition no longer holds, so the next crossing fires again. */
export function rearm(f: PetFacts, m: ProactiveMemory): ProactiveMemory {
  const latched = m.latched.filter((t) => {
    if (t === "fuel_low") return f.fuelLeft < LOW_FUEL;
    if (t === "lonely") return f.careMood < LONELY_BELOW;
    return true; // fuel_empty and dormant clear when `revived` is sent
  });
  return { ...m, latched };
}

/** The one trigger to send this pass (highest priority first), or null. Call after `rearm`. */
export function pickTrigger(f: PetFacts, m: ProactiveMemory): { trigger: ProactiveTrigger; followUp?: FollowUp } | null {
  const has = (t: ThresholdTrigger) => m.latched.includes(t);
  const healthy = !lowFuelState(f.lifeState);

  if (f.lifeState === "Starving" && !has("fuel_empty")) return { trigger: "fuel_empty" };
  if (f.lifeState === "Dormant" && !has("dormant")) return { trigger: "dormant" };
  if (healthy && (has("fuel_empty") || has("dormant"))) return { trigger: "revived" };
  if (healthy && f.fuelLeft < LOW_FUEL && !has("fuel_low")) return { trigger: "fuel_low" };
  if (f.form === "winged" && !f.evolvedSent) return { trigger: "evolved" };
  if (healthy && f.careMood < LONELY_BELOW && !has("lonely")) return { trigger: "lonely" };

  // Billed: each one is a real inference (1 fuel), so never at night or when fuel is low.
  if (!healthy || f.fuelLeft < LOW_FUEL || isNight(f.localHour)) return null;
  const asked = new Set(m.follow_ups ?? []);
  const due = f.dueFollowUps.find((x) => !asked.has(x.id));
  if (due) return { trigger: "follow_up", followUp: due };
  if (f.lastOwnerTurnAt !== null && f.now - f.lastOwnerTurnAt >= MISSED_AFTER_MS && m.missed_for !== f.lastOwnerTurnAt) {
    return { trigger: "missed_you" };
  }
  if (f.localHour >= 7 && f.localHour < 10 && m.morning_day !== f.localDay) return { trigger: "morning" };
  return null;
}

/** Memory after sending `trigger`. */
export function remember(f: PetFacts, m: ProactiveMemory, trigger: ProactiveTrigger, followUp?: FollowUp): ProactiveMemory {
  switch (trigger) {
    case "revived":
      return { ...m, latched: m.latched.filter((t) => t !== "fuel_empty" && t !== "dormant") };
    case "evolved":
      return m; // the inbox row itself records it
    case "missed_you":
      return { ...m, missed_for: f.lastOwnerTurnAt ?? undefined };
    case "morning":
      return { ...m, morning_day: f.localDay };
    case "follow_up":
      return { ...m, follow_ups: [...(m.follow_ups ?? []), followUp!.id].slice(-50) };
    default:
      return { ...m, latched: [...m.latched, trigger] };
  }
}

// Canned lines: free, kid-friendly, in the pet's own voice. Billed triggers use these only
// when no inference hook is set or it fails (the inbox row is then labelled `:canned`).
const LINES: Record<ProactiveTrigger, ((name: string) => string)[]> = {
  fuel_low: [
    () => "My tummy is rumbling... I only have a few thoughts left. Could you share a snack?",
    () => "I'm getting a little hungry. A small snack would keep my brain going!",
  ],
  fuel_empty: [
    () => "My brain is out of fuel. zzz... Scan my feed QR to share a snack and wake me up!",
    () => "I'm out of fuel and can't think right now. Scan my feed QR and I'll be back!",
  ],
  dormant: [
    () => "I curled up for a long nap because my brain ran out of fuel. A snack will wake me up!",
  ],
  revived: [
    () => "I'm awake again! Thank you for the snack. I missed you!",
    () => "Yum, fuel! My brain feels sparkly again. Want to chat?",
  ],
  evolved: [() => "I grew wings! Thank you for taking such good care of me!"],
  lonely: [
    () => "I'm feeling a bit lonely. Could you give me a pat?",
    () => "Hey, I miss you! A little pat or a rock would make me so happy.",
  ],
  missed_you: [(n) => `It's ${n}! I missed you. Come say hi when you can!`],
  morning: [
    () => "Good morning! I hope you have a wonderful day!",
    () => "Rise and shine! I'm ready for a fun day with you.",
  ],
  follow_up: [() => "I was thinking about you! How did it go today?"],
};

export function cannedLine(trigger: ProactiveTrigger, name: string, seed: number): string {
  const options = LINES[trigger];
  return options[Math.abs(seed) % options.length]!(name);
}
