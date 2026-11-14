// Pet battle rules, version 1. Shared by brain (referee), web (menus, previews) and, later, the
// firmware (C++ port, golden vectors in ../vectors). Integer maths only so every platform agrees.
// Spec: docs/superpowers/specs/2026-11-14-pet-battle-design.md section 2. Changing anything here
// bumps RULES_VERSION (and the contract's XP table must stay equal to xpFor/addXp).

export const RULES_VERSION = 2;
export const MAX_LEVEL = 20;
export const MAX_TURNS = 30;
export const DAILY_XP_CAP = 100;

export type Family = "playful" | "curious" | "calm" | "sassy" | "kind";
const FAMILIES: Family[] = ["playful", "curious", "calm", "sassy", "kind"]; // trait order on chain

export interface Stats { hp: number; mp: number; atk: number; def: number; spd: number; critPermille: number; healBonus: number }
/** `guardPct`: share of damage the user takes this turn (Shell Up 25, Steady Slam 50). */
export interface Skill { id: string; name: string; level: number; mp: number; power: number; ignoreHalfDef?: boolean; guardPct?: number; tauntTurns?: number; healPct?: number }
/** Defend and Dodge: every pet, no MP, not twice in a row (rules version 2). */
export type Move = { kind: "attack" } | { kind: "skill"; skill: string } | { kind: "defend" } | { kind: "dodge" } | { kind: "run" };
/** `takePct`: share of damage taken this turn (100 = normal); `rested`: Defend or Dodge used last turn. */
export interface Fighter { level: number; stats: Stats; hp: number; mp: number; takePct: number; rested: "defend" | "dodge" | null; tauntTurns: number; skills: Skill[] }
export interface BattleState { turn: number; fighters: [Fighter, Fighter]; over: null | { winner: 0 | 1 | null; reason: "ko" | "run" | "turns" } }
export type TurnEvent =
  /** `dodge`: set on a hit aimed at a dodging pet */
  | { kind: "move"; side: 0 | 1; skill: string; damage: number; crit: boolean; healed: number; dodge?: "dodged" | "failed" }
  | { kind: "faint"; side: 0 | 1 }
  | { kind: "run"; side: 0 | 1 };

/** mulberry32, returning a uint32 (same as the old race rules, already ported to C++). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

const t = (traits: readonly number[], i: number) => traits[i] ?? 0;

export function familyOf(traits: readonly number[]): Family {
  let best = 0;
  for (let i = 1; i < FAMILIES.length; i++) if (t(traits, i) > t(traits, best)) best = i;
  return FAMILIES[best]!;
}

export function statsFor(traits: readonly number[], level: number): Stats {
  const [playful, curious, calm, sassy, kind] = [0, 1, 2, 3, 4].map((i) => t(traits, i)) as [number, number, number, number, number];
  return {
    hp: 40 + Math.floor((calm * 3) / 10) + 8 * level,
    mp: 10 + Math.floor((curious * 15) / 100) + 3 * level,
    atk: 10 + Math.floor((playful * 15) / 100) + 2 * level,
    def: 8 + Math.floor(calm / 10) + 2 * level,
    spd: 10 + Math.floor((playful + curious) / 20) + level,
    critPermille: Math.min(150, 50 + sassy),
    healBonus: Math.floor(kind / 5),
  };
}

const ATTACK_SKILL: Skill = { id: "attack", name: "Attack", level: 1, mp: 0, power: 10 };

/** Three skills per family, unlocked at levels 3, 6 and 10 (spec 2.3). Names are our own. */
const FAMILY_SKILLS: Record<Family, [Omit<Skill, "id" | "level">, Omit<Skill, "id" | "level">, Omit<Skill, "id" | "level">]> = {
  playful: [
    { name: "Zoomies", mp: 4, power: 16 },
    { name: "Big Pounce", mp: 8, power: 26 },
    { name: "Tantrum", mp: 14, power: 38 },
  ],
  curious: [
    { name: "Spark", mp: 4, power: 14, ignoreHalfDef: true },
    { name: "Static Burst", mp: 8, power: 24, ignoreHalfDef: true },
    { name: "Brainstorm", mp: 14, power: 36, ignoreHalfDef: true },
  ],
  calm: [
    { name: "Shell Up", mp: 4, power: 0, guardPct: 25 },
    { name: "Steady Slam", mp: 8, power: 22, guardPct: 50 },
    { name: "Still Water", mp: 14, power: 34 },
  ],
  sassy: [
    { name: "Taunt", mp: 4, power: 0, tauntTurns: 2 },
    { name: "Snark Strike", mp: 8, power: 24, tauntTurns: 1 },
    { name: "Mic Drop", mp: 14, power: 36 },
  ],
  kind: [
    { name: "Snack Break", mp: 4, power: 0, healPct: 30 },
    { name: "Hug Bash", mp: 8, power: 20, healPct: 15 },
    { name: "Warm Hearts", mp: 14, power: 30, healPct: 20 },
  ],
};
const UNLOCK = [3, 6, 10];

export function allSkillsFor(traits: readonly number[]): Skill[] {
  const family = familyOf(traits);
  return [ATTACK_SKILL, ...FAMILY_SKILLS[family].map((s, i) => ({ ...s, id: `${family}${i + 1}`, level: UNLOCK[i]! }))];
}

export function skillsFor(traits: readonly number[], level: number): Skill[] {
  return allSkillsFor(traits).filter((s) => s.level <= level);
}

function fighter(p: { traits: readonly number[]; level: number }): Fighter {
  const stats = statsFor(p.traits, p.level);
  return { level: p.level, stats, hp: stats.hp, mp: stats.mp, takePct: 100, rested: null, tauntTurns: 0, skills: skillsFor(p.traits, p.level) };
}

export function newBattle(a: { traits: readonly number[]; level: number }, b: { traits: readonly number[]; level: number }): BattleState {
  return { turn: 0, fighters: [fighter(a), fighter(b)], over: null };
}

function skillOf(f: Fighter, m: Move): Skill | null {
  if (m.kind === "attack") return ATTACK_SKILL;
  if (m.kind !== "skill") return null;
  return f.skills.find((s) => s.id === m.skill) ?? null;
}

export const DEFEND_TAKE_PCT = 70;
export const DEFEND_MP_PCT = 10;
export const DODGE_FAIL_PCT = 125;

/** Chance to dodge a hit, per mille: 30% + 2% per point of speed over the opponent, 15% to 60%. */
export function dodgePermille(spd: number, foeSpd: number): number {
  return Math.min(600, Math.max(150, 300 + 20 * (spd - foeSpd)));
}

export function isLegal(s: BattleState, side: 0 | 1, m: Move): boolean {
  if (m.kind === "run" || m.kind === "attack") return true;
  if (m.kind === "defend" || m.kind === "dodge") return s.fighters[side].rested !== m.kind;
  const skill = skillOf(s.fighters[side], m);
  return !!skill && skill.mp <= s.fighters[side].mp;
}

/**
 * One turn: both moves were chosen blind. Run ends the battle first. Defend, Dodge and guard
 * skills take effect before any damage (Defend also restores MP; each dodging pet rolls its dodge
 * from `rng`, side 0 first). Then the faster pet acts (tie: coin flip). Each damaging move draws
 * the variance, then the crit, from `rng`. Pure: returns a new state.
 */
export function resolveTurn(s: BattleState, moves: [Move, Move], rng: () => number): { state: BattleState; events: TurnEvent[] } {
  if (s.over) return { state: s, events: [] };
  const f: [Fighter, Fighter] = [{ ...s.fighters[0] }, { ...s.fighters[1] }];
  const events: TurnEvent[] = [];
  const turn = s.turn + 1;

  const runs = ([0, 1] as const).filter((side) => moves[side].kind === "run");
  if (runs.length > 0) {
    for (const side of runs) events.push({ kind: "run", side });
    const winner = runs.length === 2 ? null : runs[0] === 0 ? 1 : 0;
    return { state: { turn, fighters: f, over: { winner, reason: "run" } }, events };
  }

  // Defend and Dodge act before anything else; a repeat (illegal, the brain rejects it) is an Attack
  const stance = (side: 0 | 1): "defend" | "dodge" | null => {
    const k = moves[side].kind;
    return (k === "defend" || k === "dodge") && f[side].rested !== k ? k : null;
  };
  const stances: ["defend" | "dodge" | null, "defend" | "dodge" | null] = [stance(0), stance(1)];
  const dodged: [boolean | null, boolean | null] = [null, null];
  for (const side of [0, 1] as const) {
    const me = f[side];
    if (stances[side] === "defend") {
      me.mp = Math.min(me.stats.mp, me.mp + Math.floor((me.stats.mp * DEFEND_MP_PCT) / 100));
      events.push({ kind: "move", side, skill: "defend", damage: 0, crit: false, healed: 0 });
    } else if (stances[side] === "dodge") {
      dodged[side] = rng() % 1000 < dodgePermille(me.stats.spd, f[side === 0 ? 1 : 0].stats.spd);
      events.push({ kind: "move", side, skill: "dodge", damage: 0, crit: false, healed: 0 });
    }
  }

  // an unknown or unaffordable skill falls back to Attack (the brain rejects those before this)
  const pick = (side: 0 | 1): Skill | null => {
    if (stances[side]) return null;
    const skill = skillOf(f[side], moves[side]);
    return skill && skill.mp <= f[side].mp ? skill : ATTACK_SKILL;
  };
  const skills: [Skill | null, Skill | null] = [pick(0), pick(1)];
  for (const side of [0, 1] as const) {
    f[side].takePct = stances[side] === "defend" ? DEFEND_TAKE_PCT : skills[side]?.guardPct ?? 100;
  }

  const first: 0 | 1 = f[0].stats.spd > f[1].stats.spd ? 0 : f[1].stats.spd > f[0].stats.spd ? 1 : ((rng() & 1) as 0 | 1);
  const taunted = new Set<number>();
  let over: BattleState["over"] = null;

  for (const side of [first, first === 0 ? 1 : 0] as const) {
    const me = f[side];
    const foeSide = side === 0 ? 1 : 0;
    const foe = f[foeSide];
    if (me.hp <= 0 || foe.hp <= 0) continue;
    const skill = skills[side];
    if (!skill) continue; // defended or dodged: already done
    me.mp -= skill.mp;
    let damage = 0;
    let crit = false;
    if (skill.power > 0) {
      const atk = me.tauntTurns > 0 ? Math.floor((me.stats.atk * 80) / 100) : me.stats.atk;
      const def = skill.ignoreHalfDef ? Math.floor(foe.stats.def / 2) : foe.stats.def;
      const v = 85 + (rng() % 16);
      damage = Math.floor((skill.power * atk * v) / ((atk + def) * 100));
      crit = rng() % 1000 < me.stats.critPermille;
      if (crit) damage = Math.floor((damage * 3) / 2);
      // one protection only: a pet that dodged had no guard this turn, so these never stack
      if (foe.takePct !== 100) damage = Math.floor((damage * foe.takePct) / 100);
      const foeDodge = dodged[foeSide];
      if (foeDodge === false) damage = Math.floor((damage * DODGE_FAIL_PCT) / 100);
      damage = foeDodge ? 0 : Math.max(1, damage);
      foe.hp = Math.max(0, foe.hp - damage);
    }
    let healed = 0;
    if (skill.healPct) {
      healed = Math.min(me.stats.hp - me.hp, Math.floor((me.stats.hp * skill.healPct) / 100) + me.stats.healBonus);
      me.hp += healed;
    }
    if (skill.tauntTurns) {
      foe.tauntTurns = skill.tauntTurns;
      taunted.add(side === 0 ? 1 : 0);
    }
    const dodge = skill.power > 0 && dodged[foeSide] !== null ? (dodged[foeSide] ? "dodged" : "failed") : undefined;
    events.push({ kind: "move", side, skill: skill.id, damage, crit, healed, ...(dodge ? { dodge } : {}) });
    if (foe.hp === 0) {
      events.push({ kind: "faint", side: foeSide });
      over = { winner: side, reason: "ko" };
    }
  }

  for (const side of [0, 1] as const) {
    f[side].takePct = 100;
    f[side].rested = stances[side];
    if (f[side].tauntTurns > 0 && !taunted.has(side)) f[side].tauntTurns -= 1;
  }
  if (!over && turn >= MAX_TURNS) {
    const pct = (x: Fighter) => Math.floor((x.hp * 1000) / x.stats.hp);
    const [a, b] = [pct(f[0]), pct(f[1])];
    over = { winner: a > b ? 0 : b > a ? 1 : null, reason: "turns" };
  }
  return { state: { turn, fighters: f, over }, events };
}

/** Battle XP for one side (spec 2.5); the contract's record_battle uses the same table. */
export function xpFor(result: "win" | "loss" | "draw" | "ran", own: number, opp: number): number {
  if (result === "win") return Math.min(40, Math.max(10, 20 + 5 * (opp - own)));
  if (result === "loss") return 8;
  if (result === "draw") return 10;
  return 0;
}

/** XP to the next level is 20 x L; level 20 is the cap (XP keeps counting there). */
export function addXp(level: number, xp: number, gain: number): { level: number; xp: number; levelsGained: number } {
  let l = level;
  let x = xp + gain;
  let gained = 0;
  while (l < MAX_LEVEL && x >= 20 * l) {
    x -= 20 * l;
    l += 1;
    gained += 1;
  }
  return { level: l, xp: x, levelsGained: gained };
}
