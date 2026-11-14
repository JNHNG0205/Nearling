// Battle screen logic (no React): what the screen shows for each server message, the menus, and
// the words for each turn event. The brain referees; this only presents. Spec 3.3.
import { allSkillsFor, type BattleState, type Skill, type TurnEvent } from "@petto/battle";
import type { BattlePet, BattleServerMsg } from "@petto/battle/protocol";
import { BRAIN_URL } from "./brain";

export type Screen = "lobby" | "menu" | "fight" | "waiting" | "playing" | "over";

export interface ClientState {
  screen: Screen;
  you: 0 | 1 | null;
  code: string | null;
  pets: [BattlePet | null, BattlePet | null];
  ready: [boolean, boolean];
  battle: BattleState | null;
  turnEndsAt: number;
  /** events of the last turn, played back one by one by the screen */
  queue: TurnEvent[];
  message: string;
  result: null | { won: boolean | null; xp: number; levelUp: number | null; saved: "pending" | "saved" | "failed"; tx?: string };
  closedEarly: boolean;
  error: string | null;
}

export type ClientEvent = BattleServerMsg | { type: "closed" } | { type: "choose"; screen: Screen } | { type: "played" };

export function initialState(): ClientState {
  return {
    screen: "lobby", you: null, code: null, pets: [null, null], ready: [false, false], battle: null, turnEndsAt: 0,
    queue: [], message: "", result: null, closedEarly: false, error: null,
  };
}

const nameOf = (s: ClientState, side: 0 | 1) => s.pets[side]?.name ?? (side === s.you ? "Your pet" : "The other pet");
const prompt = (s: ClientState) => (s.you === null ? "" : `What will ${nameOf(s, s.you)} do?`);

const ERRORS: Record<string, string> = {
  illegal_move: "That move can't be used right now.",
  already_moved: "You already chose this turn.",
  not_started: "The battle hasn't started yet.",
  bad_message: "Something went wrong. Try again.",
};

export function reduce(s: ClientState, e: ClientEvent): ClientState {
  switch (e.type) {
    case "room":
      return { ...s, you: e.you, code: e.code, pets: e.pets, ready: e.ready, screen: s.battle ? s.screen : "lobby" };
    case "start":
      return { ...s, battle: e.state, turnEndsAt: e.turnEndsAt, screen: "menu", queue: [], error: null, message: prompt(s) };
    case "turn":
      return { ...s, battle: e.state, turnEndsAt: e.turnEndsAt, queue: e.events, screen: "playing", error: null };
    case "played":
      return s.screen === "playing" ? { ...s, queue: [], screen: s.result ? "over" : "menu", message: s.result ? s.message : prompt(s) } : s;
    case "end": {
      const won = e.winner === null ? null : e.winner === s.you;
      const words = won === null ? "It's a draw!" : won ? `${nameOf(s, s.you!)} won!` : `${nameOf(s, s.you!)} lost.`;
      return {
        ...s, message: words,
        result: s.you === null
          ? { won, xp: 0, levelUp: null, saved: "pending" }
          : { won, xp: e.xp[s.you], levelUp: e.levels[s.you][1] > e.levels[s.you][0] ? e.levels[s.you][1] : null, saved: "pending" },
        screen: s.screen === "playing" && s.queue.length > 0 ? "playing" : "over",
      };
    }
    case "saved":
      return s.result ? { ...s, result: { ...s.result, saved: "saved", tx: e.tx } } : s;
    case "save_failed":
      return s.result ? { ...s, result: { ...s.result, saved: "failed" } } : s;
    case "error":
      return { ...s, error: ERRORS[e.code] ?? ERRORS.bad_message!, screen: e.code === "already_moved" ? "waiting" : s.battle ? "menu" : s.screen };
    case "closed":
      return s.result ? s : { ...s, closedEarly: true, message: "This battle ended (the server restarted)" };
    case "choose":
      return { ...s, screen: e.screen, error: null, message: e.screen === "waiting" ? `Waiting for ${nameOf(s, s.you === 0 ? 1 : 0)}...` : prompt(s) };
  }
}

export interface MenuOption { id: string; label: string; mp?: number; disabled: boolean; reason?: string }

/** The buttons on the menu screen ("menu": Fight/Defend/Dodge/Run, "fight": Attack + skills + Back). */
export function menuOptions(s: ClientState): MenuOption[] {
  if (s.screen === "menu") {
    const rested = s.you !== null && s.battle ? s.battle.fighters[s.you].rested : null;
    const stance = (id: "defend" | "dodge", label: string): MenuOption =>
      rested === id ? { id, label, disabled: true, reason: "Catching its breath" } : { id, label, disabled: false };
    return [
      { id: "fight", label: "Fight", disabled: false }, stance("defend", "Defend"), stance("dodge", "Dodge"),
      { id: "run", label: "Run", disabled: false },
    ];
  }
  if (s.screen !== "fight" || s.you === null || !s.battle || !s.pets[s.you]) return [];
  const me = s.battle.fighters[s.you];
  const pet = s.pets[s.you]!;
  const skills = allSkillsFor(pet.traits).map((k): MenuOption => {
    if (k.level > pet.level) return { id: k.id, label: k.name, mp: k.mp, disabled: true, reason: `Unlocks at Lv ${k.level}` };
    if (k.mp > me.mp) return { id: k.id, label: k.name, mp: k.mp, disabled: true, reason: "Not enough MP" };
    return { id: k.id, label: k.name, mp: k.mp || undefined, disabled: false };
  });
  return [...skills, { id: "back", label: "Back", disabled: false }];
}

/** Skill names by id: ids are unique across families (`playful1`, `kind3`...). */
const SKILL_NAMES: Record<string, string> = Object.fromEntries(
  [0, 1, 2, 3, 4].flatMap((i) => allSkillsFor([0, 1, 2, 3, 4].map((j) => (j === i ? 100 : 0)))).map((k: Skill) => [k.id, k.name]),
);

/** One line of the message box for an event. */
export function eventText(e: TurnEvent, names: [string, string]): string {
  if (e.kind === "faint") return `${names[e.side]} fainted!`;
  if (e.kind === "run") return `${names[e.side]} ran away!`;
  if (e.skill === "defend") return `${names[e.side]} braced itself.`;
  if (e.skill === "dodge") return `${names[e.side]} got ready to dodge.`;
  const foe = names[e.side === 0 ? 1 : 0];
  const parts = [`${names[e.side]} used ${SKILL_NAMES[e.skill] ?? e.skill}!`];
  if (e.dodge === "dodged") parts.push(`${foe} dodged the attack!`);
  if (e.dodge === "failed") parts.push(`${foe} tried to dodge, but got hit hard!`);
  if (e.crit) parts.push("A critical hit!");
  if (e.healed > 0) parts.push(`${names[e.side]} healed ${e.healed} HP.`);
  return parts.join(" ");
}

// ---------- brain calls ----------

/** Error copy for the room routes (brain/src/battle/routes.ts). */
const JOIN_ERRORS: Record<string, string> = {
  same_owner: "You can't battle your own pet. Invite a friend.",
  same_pet: "A pet can't battle itself.",
  pet_busy: "That pet is already in a battle. Finish it first.",
  other_contract: "Normal and demo speed pets can't battle each other. Pick a pet of the same kind.",
  full: "That battle already has two pets.",
  not_found: "No battle with that code.",
  daily_limit: "These two pets already battled 3 times in the last 24 hours.",
  pet_unavailable: "Your pet is too hungry to battle. Feed it first.",
  not_owner: "That pet isn't yours.",
  unauthorized: "Sign in to battle.",
};

const local = {
  time: (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  day: (d: Date) => d.toDateString(),
};

/** Plain words for a refused join; the daily limit says when the pair can battle again and what to do now. */
export function joinErrorText(code: string, retryAt?: number, now = Date.now(), clock = local): string {
  if (code !== "daily_limit") return JOIN_ERRORS[code] ?? "The brain didn't answer. Try again in a moment.";
  const when = retryAt
    ? ` They can battle again ${clock.day(new Date(retryAt)) === clock.day(new Date(now)) ? "" : "tomorrow "}at ${clock.time(new Date(retryAt))}.`
    : "";
  return `${JOIN_ERRORS.daily_limit}${when} Pick another pet, or battle someone else.`;
}

export class BattleRequestError extends Error {
  constructor(public code: string, retryAt?: number) {
    super(joinErrorText(code, retryAt));
  }
}

async function post(path: string, body: unknown, auth: Record<string, string>): Promise<unknown> {
  const res = await fetch(`${BRAIN_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { error?: { code?: string; retry_at?: number } } | null;
  if (!res.ok) throw new BattleRequestError(json?.error?.code ?? "upstream", json?.error?.retry_at);
  return json;
}

export async function createBattle(petRef: string, auth: Record<string, string>): Promise<string> {
  return ((await post("/battle/rooms", { pet_ref: petRef }, auth)) as { code: string }).code;
}

export async function joinBattle(code: string, petRef: string, auth: Record<string, string>): Promise<void> {
  await post(`/battle/rooms/${encodeURIComponent(code)}/join`, { pet_ref: petRef }, auth);
}

/** WebSocket URL; browsers cannot set headers on a WebSocket, so the session token rides in the query. */
export function battleSocketUrl(code: string, token: string): string {
  const u = new URL("/battle/ws", BRAIN_URL);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.searchParams.set("code", code);
  u.searchParams.set("token", token);
  return u.toString();
}

/** Room codes are 6 letters/digits, upper case. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}
