// What each battle event looks like on screen (BattleScreen plays them one by one): a motion on
// each pet's wrapper, an optional sprite clip, and an optional floating popup. No React here.
import { allSkillsFor, type Skill, type TurnEvent } from "@petto/battle";
import type { PetAnim } from "@petto/sprites";
import type { IconName } from "@/components/PixelIcon";

export type Motion = "lunge" | "hit" | "dodge" | "brace" | "ready" | "cast" | "faint" | "run" | null;
export interface Popup { text: string; tone: "damage" | "crit" | "heal" | "info"; icon?: IconName }
export interface SideFx { side: 0 | 1; motion: Motion; sprite?: PetAnim; popup?: Popup }

/** Every skill by id: ids are unique across families (`playful1`, `kind3`...). */
const SKILLS: Record<string, Skill> = Object.fromEntries(
  [0, 1, 2, 3, 4].flatMap((i) => allSkillsFor([0, 1, 2, 3, 4].map((j) => (j === i ? 100 : 0)))).map((k) => [k.id, k]),
);

export function battleFx(e: TurnEvent): SideFx[] {
  if (e.kind === "faint") return [{ side: e.side, motion: "faint" }];
  if (e.kind === "run") return [{ side: e.side, motion: "run" }];
  const me = e.side;
  const foe: 0 | 1 = me === 0 ? 1 : 0;
  if (e.skill === "defend") return [{ side: me, motion: "brace", popup: { text: "Defend", tone: "info", icon: "defence" } }];
  if (e.skill === "dodge") return [{ side: me, motion: "ready" }];

  const skill = SKILLS[e.skill];
  const heal: Popup | undefined = e.healed > 0 ? { text: `+${e.healed}`, tone: "heal" } : undefined;
  if (!skill || skill.power === 0) {
    // status skills: Shell Up braces, Taunt marks the foe, a pure heal casts
    if (skill?.guardPct) return [{ side: me, motion: "brace", popup: { text: skill.name, tone: "info", icon: "defence" } }];
    const out: SideFx[] = [{ side: me, motion: "cast", ...(heal ? { sprite: "eat" as const, popup: heal } : {}) }];
    if (skill?.tauntTurns) out.push({ side: foe, motion: null, popup: { text: "Taunted", tone: "info" } });
    return out;
  }

  const attacker: SideFx = { side: me, motion: "lunge", ...(heal ? { sprite: "eat" as const, popup: heal } : e.crit ? { sprite: "celebrate" as const } : {}) };
  if (e.dodge === "dodged") return [attacker, { side: foe, motion: "dodge", popup: { text: "Miss", tone: "info" } }];
  const text = e.crit ? `CRIT -${e.damage}` : e.dodge === "failed" ? `-${e.damage} Hard hit` : `-${e.damage}`;
  return [attacker, { side: foe, motion: "hit", sprite: "dizzy", popup: { text, tone: e.crit ? "crit" : "damage" } }];
}
