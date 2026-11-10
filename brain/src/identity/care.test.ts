import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { issueSession } from "../auth/guard";
import { subscribe } from "../events";
import { getProfile } from "../profiles";
import { testDeps } from "../test/deps";

const PET = "pets-v8.nearling.testnet:1";
const HOUR = 3_600_000;

function setup() {
  let t = 1_800_000_000_000;
  const deps = testDeps({ now: () => t });
  const app = createApp(deps);
  const sync = async (events: { id: string; kind: string; at: number }[], account = "alice.testnet") => {
    const res = await app.request(`/pets/${PET}/care`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${(await issueSession(deps, account)).token}` },
      body: JSON.stringify({ events }),
    });
    return { status: res.status, body: (await res.json()) as { mood: number; milestones: Record<string, boolean>; form: string; evolved_now: boolean } };
  };
  return { deps, sync, now: () => t, advance: (ms: number) => (t += ms) };
}

describe("POST /pets/:petRef/care", () => {
  it("applies each event once", async () => {
    const { sync, now } = setup();
    const events = [
      { id: "e1", kind: "pat", at: now() },
      { id: "e2", kind: "shake", at: now() },
    ];
    expect((await sync(events)).body.mood).toBe(83); // 80 + 5 - 2
    expect((await sync(events)).body.mood).toBe(83);
    expect((await sync([...events, { id: "e3", kind: "rock", at: now() }])).body.mood).toBe(86);
  });

  it("decays 2 per hour and clamps to 0..100", async () => {
    const { sync, now, advance } = setup();
    await sync([{ id: "a", kind: "pat", at: now() }]); // 85
    advance(3 * HOUR + 30 * 60_000);
    expect((await sync([])).body.mood).toBe(79); // 3 whole hours
    advance(30 * 60_000);
    expect((await sync([])).body.mood).toBe(77); // the half hour was kept, not rounded away
    advance(100 * HOUR);
    expect((await sync([])).body.mood).toBe(0);
    const pats = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, kind: "pat", at: now() }));
    expect((await sync(pats)).body.mood).toBe(100);
  });

  it("decays between offline events in time order", async () => {
    const { sync, now } = setup();
    const t0 = now() - 5 * HOUR;
    // Sent out of order: rock (5 h ago) then pat (now). Mood starts at the first event.
    const r = await sync([
      { id: "b", kind: "pat", at: now() },
      { id: "a", kind: "rock", at: t0 },
    ]);
    expect(r.body.mood).toBe(78); // 80 + 3, -10 over 5 h, +5
  });

  it("sleep sets sleeping_until for 30 minutes", async () => {
    const { deps, sync, now } = setup();
    await sync([{ id: "s", kind: "sleep", at: now() }]);
    expect(getProfile(deps.db, PET)!.sleeping_until).toBe(now() + 30 * 60_000);
  });

  it("evolves once when pat, rock and sleep are all done", async () => {
    const { deps, sync, now } = setup();
    const events: string[] = [];
    const stop = subscribe(PET, (e) => events.push(e.type));
    const first = await sync([{ id: "1", kind: "pat", at: now() }, { id: "2", kind: "rock", at: now() }]);
    expect(first.body).toMatchObject({ milestones: { pat: true, rock: true, sleep: false }, form: "base", evolved_now: false });
    const second = await sync([{ id: "3", kind: "sleep", at: now() }]);
    expect(second.body).toMatchObject({ form: "winged", evolved_now: true });
    const third = await sync([{ id: "4", kind: "pat", at: now() }]);
    expect(third.body).toMatchObject({ form: "winged", evolved_now: false });
    expect(events.filter((e) => e === "evolved")).toHaveLength(1);
    expect(getProfile(deps.db, PET)!.evolved_at).toBe(now());
    stop();
  });

  it("is owner or bound device only", async () => {
    const { sync, now } = setup();
    expect((await sync([{ id: "x", kind: "pat", at: now() }], "bob.testnet")).status).toBe(403);
  });

  it("rejects bad events", async () => {
    const { sync, now } = setup();
    expect((await sync([{ id: "x", kind: "dance", at: now() }])).status).toBe(400);
  });
});
