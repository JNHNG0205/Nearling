import { describe, expect, it } from "vitest";
import type { PetView } from "@nearling/shared";
import { ensureProfile } from "../profiles";
import { TEST_PET, testDeps } from "../test/deps";
import { pushInbox } from "./inbox";
import { listPets } from "./pets";
import { localTime, runProactivePass, type ProactiveHooks } from "./scheduler";

const REF = "pets-v8.nearling.testnet:1";
const T0 = 1_800_000_000_000; // 2027-01-15 08:00 UTC
const HOUR = 3600_000;
const KL = "Asia/Kuala_Lumpur"; // 16:00 at T0: daytime, not morning

function setup(opts: { pet?: Partial<PetView>; tz?: string | null; care?: number; form?: "winged"; lastTurn?: number | null } = {}) {
  let now = T0;
  const deps = testDeps({ pets: { "1": { ...TEST_PET, ...opts.pet } }, now: () => now });
  deps.chain.view = async <T>() => [] as T; // no extra nft_tokens
  ensureProfile(deps.db, REF, "alice.testnet", now);
  deps.db
    .prepare("UPDATE pet_profile SET owner_tz = ?, care_mood = ?, form = ?, last_owner_turn_at = ? WHERE pet_ref = ?")
    .run(opts.tz === undefined ? KL : opts.tz, opts.care ?? 80, opts.form ?? "base", opts.lastTurn === undefined ? T0 : opts.lastTurn, REF);
  const pet = (p: Partial<PetView>) => (deps.pets["1"] = { ...deps.pets["1"]!, ...p });
  const profile = (sql: string, ...args: unknown[]) => deps.db.prepare(`UPDATE pet_profile SET ${sql} WHERE pet_ref = ?`).run(...args, REF);
  const pass = async (hooks?: ProactiveHooks) => {
    await runProactivePass(deps, hooks);
    now += 15 * 60_000;
  };
  const inbox = () =>
    (deps.db.prepare("SELECT trigger, turn_id, text_enc FROM inbox ORDER BY id").all() as { trigger: string; turn_id: string | null; text_enc: Buffer }[]).map(
      (r) => ({ trigger: r.trigger, turn_id: r.turn_id, text: deps.sealer.open(REF, r.text_enc) }),
    );
  const triggers = () => inbox().map((r) => r.trigger);
  return { deps, pet, profile, pass, inbox, triggers, setNow: (t: number) => (now = t) };
}

describe("proactive scheduler", () => {
  it("fuel_low fires once per crossing and again after a refill", async () => {
    const s = setup({ pet: { budget_micro: 3_000 } });
    await s.pass();
    await s.pass();
    expect(s.triggers()).toEqual(["fuel_low"]);
    s.pet({ budget_micro: 10_000 });
    await s.pass();
    s.pet({ budget_micro: 4_000 });
    await s.pass();
    expect(s.triggers()).toEqual(["fuel_low", "fuel_low"]);
  });

  it("fuel_empty, dormant, then revived, each once", async () => {
    const s = setup();
    s.pet({ budget_micro: 0, life_state: "Starving" });
    await s.pass();
    await s.pass();
    s.pet({ life_state: "Dormant" });
    await s.pass();
    await s.pass();
    s.pet({ budget_micro: 20_000, life_state: "Happy" });
    await s.pass();
    await s.pass();
    expect(s.triggers()).toEqual(["fuel_empty", "dormant", "revived"]);
    expect(s.inbox()[0]!.text).toContain("out of fuel");
    expect(s.inbox()[0]!.text).toContain("feed QR");
  });

  it("evolved fires once, and not at all if the care module already sent it", async () => {
    const s = setup({ form: "winged" });
    await s.pass();
    await s.pass();
    expect(s.triggers()).toEqual(["evolved"]);

    const t = setup({ form: "winged" });
    pushInbox(t.deps, REF, "alice.testnet", "evolved", "I grew wings!");
    await t.pass();
    expect(t.triggers()).toEqual(["evolved"]);
  });

  it("lonely when care mood is below 30, once per dip", async () => {
    const s = setup({ care: 20 });
    await s.pass();
    await s.pass();
    s.profile("care_mood = 50");
    await s.pass();
    s.profile("care_mood = 10");
    await s.pass();
    expect(s.triggers()).toEqual(["lonely", "lonely"]);
  });

  it("missed_you after 24 h without an owner turn uses the inference hook", async () => {
    const s = setup({ lastTurn: T0 - 25 * HOUR });
    const calls: unknown[] = [];
    const hooks: ProactiveHooks = {
      generateProactive: async (_d, petRef, trigger, ctx) => {
        calls.push({ petRef, trigger, ctx });
        return { text: "I missed you! How was the trip?", turnId: "turn-9" };
      },
    };
    await s.pass(hooks);
    await s.pass(hooks);
    expect(s.inbox()).toEqual([{ trigger: "missed_you", turn_id: "turn-9", text: "I missed you! How was the trip?" }]);
    expect(calls).toEqual([{ petRef: REF, trigger: "missed_you", ctx: { owner: "alice.testnet", followUp: undefined } }]);
  });

  it("falls back to a canned line labelled :canned when no hook or the hook fails", async () => {
    const s = setup({ lastTurn: T0 - 25 * HOUR });
    await s.pass({ generateProactive: async () => { throw new Error("boom"); } });
    expect(s.inbox()).toMatchObject([{ trigger: "missed_you:canned", turn_id: null }]);

    const t = setup({ tz: "UTC" });
    await t.pass();
    expect(t.inbox()).toMatchObject([{ trigger: "morning:canned", turn_id: null }]);
  });

  it("morning once per owner-local day, 07:00 to 10:00", async () => {
    const s = setup({ tz: "UTC", lastTurn: null });
    await s.pass();
    await s.pass();
    expect(s.triggers()).toEqual(["morning:canned"]);
    s.setNow(T0 + 24 * HOUR);
    await s.pass();
    expect(s.triggers()).toEqual(["morning:canned", "morning:canned"]);

    const late = setup({ tz: KL }); // 16:00
    await late.pass();
    expect(late.triggers()).toEqual([]);
  });

  it("billed ones are skipped at night and when fuel is low; free ones still fire", async () => {
    const ny = setup({ tz: "America/New_York", lastTurn: T0 - 25 * HOUR }); // 03:00
    await ny.pass();
    expect(ny.triggers()).toEqual([]);
    ny.profile("care_mood = 10");
    await ny.pass();
    expect(ny.triggers()).toEqual(["lonely"]);

    const low = setup({ tz: "UTC", pet: { budget_micro: 3_000 }, lastTurn: T0 - 25 * HOUR });
    await low.pass();
    await low.pass();
    expect(low.triggers()).toEqual(["fuel_low"]);
  });

  it("follow_up asks once per due fact, passing the fact to the hook", async () => {
    const s = setup();
    const seen: unknown[] = [];
    const hooks: ProactiveHooks = {
      dueFollowUps: async (_ref, owner, day) => {
        seen.push({ owner, day });
        return [{ id: "f1" }];
      },
      generateProactive: async (_d, _r, trigger, ctx) => ({ text: `How did the exam go? ${trigger} ${ctx.followUp?.id}`, turnId: "t1" }),
    };
    await s.pass(hooks);
    await s.pass(hooks);
    expect(s.inbox()).toEqual([{ trigger: "follow_up", turn_id: "t1", text: "How did the exam go? follow_up f1" }]);
    expect(seen[0]).toEqual({ owner: "alice.testnet", day: "2027-01-15" });
  });

  it("sends one per pass and at most 3 per UTC day", async () => {
    const s = setup({ pet: { budget_micro: 3_000 }, form: "winged", care: 10 });
    await s.pass();
    expect(s.triggers()).toEqual(["fuel_low"]); // three due, one sent
    await s.pass();
    await s.pass();
    s.pet({ budget_micro: 0, life_state: "Starving" });
    await s.pass();
    expect(s.triggers()).toEqual(["fuel_low", "evolved", "lonely"]);
    s.setNow(T0 + 24 * HOUR);
    await s.pass();
    expect(s.triggers()).toEqual(["fuel_low", "evolved", "lonely", "fuel_empty"]);
  });

  it("writes the inbox for the pet's current owner", async () => {
    const s = setup({ care: 10 });
    s.pet({ owner: "bob.testnet" });
    await s.pass();
    expect(s.deps.db.prepare("SELECT owner_account FROM inbox").all()).toEqual([{ owner_account: "bob.testnet" }]);
  });
});

describe("pet enumeration and local time", () => {
  it("merges profile rows with nft_tokens pages on both contracts", async () => {
    const deps = testDeps();
    ensureProfile(deps.db, "pets-v8.nearling.testnet:7", "a.testnet", 0);
    const calls: unknown[] = [];
    deps.chain.view = async <T>(contract: string, method: string, args?: Record<string, unknown>) => {
      calls.push({ contract, method, args });
      if (contract !== "pets-v8.nearling.testnet") return [{ token_id: "2" }] as T;
      return (args?.from_index === "0" ? Array.from({ length: 50 }, (_, i) => ({ token_id: String(i) })) : [{ token_id: "50" }]) as T;
    };
    const refs = (await listPets(deps)).map((p) => p.petRef);
    expect(refs).toHaveLength(52); // 0..50 (profile :7 is a duplicate) + demo :2
    expect(refs).toContain("pets-demo.nearling.testnet:2");
    expect(refs).toContain("pets-v8.nearling.testnet:50");
    expect(calls).toHaveLength(3);
  });

  it("falls back to UTC for an unknown time zone", () => {
    expect(localTime(T0, "Mars/Olympus")).toEqual({ hour: 8, day: "2027-01-15" });
    expect(localTime(T0, KL)).toEqual({ hour: 16, day: "2027-01-15" });
  });
});
