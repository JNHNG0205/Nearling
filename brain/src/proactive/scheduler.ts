import { fuelLeft } from "@nearling/shared";
import type { Deps, Module } from "../deps";
import { subscribeAll } from "../events";
import { decay } from "../identity/care";
import { log } from "../log";
import { ensureProfile, getProfile } from "../profiles";
import { pushInbox } from "./inbox";
import { listPets, type KnownPet } from "./pets";
import {
  BILLED_TRIGGERS,
  MAX_PER_DAY,
  cannedLine,
  pickTrigger,
  rearm,
  remember,
  type BilledTrigger,
  type FollowUp,
  type PetFacts,
  type ProactiveMemory,
} from "./rules";

const PASS_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/**
 * Billed proactive message (missed_you, morning, follow_up): a real private-model turn with
 * `channel = proactive`, its own charge_job and receipt. Implemented by the talk module.
 * Return null (or throw) to fall back to a free canned line.
 */
export type GenerateProactive = (
  deps: Deps,
  petRef: string,
  trigger: BilledTrigger,
  ctx: { owner: string; followUp?: FollowUp },
) => Promise<{ text: string; turnId: string } | null>;

/** Memory facts whose follow-up date is `day` (owner-local `YYYY-MM-DD`). Implemented by the memory module. */
export type DueFollowUps = (petRef: string, owner: string, day: string) => Promise<FollowUp[]>;

export interface ProactiveHooks {
  generateProactive?: GenerateProactive;
  dueFollowUps?: DueFollowUps;
}

/** Owner-local hour and day; unknown or invalid time zones fall back to UTC. */
export function localTime(now: number, tz: string | null): { hour: number; day: string } {
  let parts: Intl.DateTimeFormatPart[];
  const opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" };
  try {
    parts = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: tz ?? "UTC" }).formatToParts(new Date(now));
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: "UTC" }).formatToParts(new Date(now));
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { hour: Number(get("hour")), day: `${get("year")}-${get("month")}-${get("day")}` };
}

function loadMemory(deps: Deps, petRef: string): ProactiveMemory {
  const row = deps.db.prepare("SELECT state FROM proactive_pet WHERE pet_ref = ?").get(petRef) as { state: string } | undefined;
  const m = row ? (JSON.parse(row.state) as Partial<ProactiveMemory>) : {};
  return { ...m, latched: m.latched ?? [] };
}

function saveMemory(deps: Deps, petRef: string, m: ProactiveMemory) {
  deps.db
    .prepare("INSERT INTO proactive_pet (pet_ref, state) VALUES (?, ?) ON CONFLICT(pet_ref) DO UPDATE SET state = excluded.state")
    .run(petRef, JSON.stringify(m));
}

const evolvedSent = (deps: Deps, petRef: string) =>
  !!deps.db.prepare("SELECT 1 FROM inbox WHERE pet_ref = ? AND trigger LIKE 'evolved%'").get(petRef);

/**
 * The care module publishes `evolved` on the bus when a pet grows wings; this writes the one-time
 * canned inbox line (free). The 15 min pass is a backstop if the brain restarted in between.
 * Not counted in the daily proactive max: it answers the owner's own care.
 */
export function onEvolved(deps: Deps, petRef: string): void {
  const profile = getProfile(deps.db, petRef);
  if (!profile || evolvedSent(deps, petRef)) return;
  const item = pushInbox(deps, petRef, profile.owner_account, "evolved", cannedLine("evolved", "", 0));
  log.info("proactive sent", { pet_ref: petRef, trigger: "evolved", inbox_id: item.id, canned: true });
}

async function petPass(deps: Deps, hooks: ProactiveHooks, p: KnownPet): Promise<void> {
  const pet = await deps.chain.getPet(p.contract, p.tokenId);
  if (!pet) return;
  const config = await deps.chain.getConfig(p.contract);
  const now = deps.now();
  const profile = ensureProfile(deps.db, p.petRef, pet.owner, now);
  const local = localTime(now, profile.owner_tz);
  const owner = pet.owner;

  const facts: PetFacts = {
    name: pet.name,
    lifeState: pet.life_state,
    fuelLeft: fuelLeft(pet.budget_micro, config.fuel_price_micro),
    form: profile.form,
    // care_mood is only decayed on sync; decay on read like /state does
    careMood: profile.care_mood_at === null ? profile.care_mood : decay(profile.care_mood, profile.care_mood_at, now)[0],
    lastOwnerTurnAt: profile.last_owner_turn_at ?? null, // set by the talk module; null = never
    evolvedSent: evolvedSent(deps, p.petRef),
    now,
    localHour: local.hour,
    localDay: local.day,
    dueFollowUps: hooks.dueFollowUps ? await hooks.dueFollowUps(p.petRef, owner, local.day) : [],
  };
  let memory = rearm(facts, loadMemory(deps, p.petRef));
  saveMemory(deps, p.petRef, memory);

  const day = Math.floor(now / DAY_MS);
  const today = deps.db.prepare("SELECT count, fired FROM proactive_day WHERE pet_ref = ? AND day = ?").get(p.petRef, day) as
    | { count: number; fired: string }
    | undefined;
  if ((today?.count ?? 0) >= MAX_PER_DAY) return;

  const pick = pickTrigger(facts, memory);
  if (!pick) return;
  const { trigger, followUp } = pick;

  let text = cannedLine(trigger, pet.name, day + p.petRef.length);
  let label: string = trigger;
  let turnId: string | undefined;
  if ((BILLED_TRIGGERS as readonly string[]).includes(trigger)) {
    let gen: { text: string; turnId: string } | null = null;
    if (hooks.generateProactive) {
      try {
        gen = await hooks.generateProactive(deps, p.petRef, trigger as BilledTrigger, { owner, followUp });
      } catch (err) {
        log.warn("proactive generate failed", { pet_ref: p.petRef, trigger, error: err instanceof Error ? err.name : "unknown" });
      }
    }
    if (gen) ({ text, turnId } = gen);
    else label = `${trigger}:canned`;
  }

  const item = pushInbox(deps, p.petRef, owner, label, text, turnId);
  const fired = [...(today ? (JSON.parse(today.fired) as string[]) : []), trigger];
  deps.db
    .prepare(
      `INSERT INTO proactive_day (pet_ref, day, count, fired) VALUES (?, ?, 1, ?)
       ON CONFLICT(pet_ref, day) DO UPDATE SET count = count + 1, fired = excluded.fired`,
    )
    .run(p.petRef, day, JSON.stringify(fired));
  memory = remember(facts, memory, trigger, followUp);
  saveMemory(deps, p.petRef, memory);
  log.info("proactive sent", { pet_ref: p.petRef, trigger, inbox_id: item.id, canned: item.canned });
}

/** One scheduler pass over every known pet: at most one message per pet. */
export async function runProactivePass(deps: Deps, hooks: ProactiveHooks = {}): Promise<void> {
  for (const p of await listPets(deps)) {
    try {
      await petPass(deps, hooks, p);
    } catch (err) {
      log.warn("proactive pass failed", { pet_ref: p.petRef, error: err instanceof Error ? err.name : "unknown" });
    }
  }
}

/** Pass the talk and memory hooks here in modules.ts once they exist. */
export function createProactiveModule(hooks: ProactiveHooks = {}): Module {
  return {
    name: "proactive",
    start(deps) {
      let running = false;
      const tick = async () => {
        if (running) return; // overlap guard
        running = true;
        try {
          await runProactivePass(deps, hooks);
        } catch (err) {
          log.error("proactive pass crashed", { error: err instanceof Error ? err.name : "unknown" });
        } finally {
          running = false;
        }
      };
      const unsubscribe = subscribeAll((e) => {
        if (e.type !== "evolved") return;
        try {
          onEvolved(deps, e.petRef);
        } catch (err) {
          log.warn("evolved inbox failed", { pet_ref: e.petRef, error: err instanceof Error ? err.name : "unknown" });
        }
      });
      void tick();
      const timer = setInterval(() => void tick(), PASS_MS);
      return () => {
        clearInterval(timer);
        unsubscribe();
      };
    },
  };
}

export const proactiveModule = createProactiveModule();
