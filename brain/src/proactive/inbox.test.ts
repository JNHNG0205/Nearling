import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { issueSession, sha256 } from "../auth/guard";
import { subscribe } from "../events";
import { testDeps } from "../test/deps";
import type { InboxItem } from "@nearling/shared";
import { pushInbox } from "./inbox";

const REF = "pets-v8.nearling.testnet:1";
const BASE = `/pets/${REF}/inbox`;

async function owner(deps: ReturnType<typeof testDeps>, account = "alice.testnet") {
  return { Authorization: `Bearer ${(await issueSession(deps, account)).token}` };
}

function addDevice(deps: ReturnType<typeof testDeps>) {
  deps.db
    .prepare("INSERT INTO device (id, hw_id, secret_hash, token_hash, pet_ref, owner_account, created_at) VALUES ('d1','hw','x',?,?,?,0)")
    .run(sha256("devtok"), REF, "alice.testnet");
  return { Authorization: "Device devtok" };
}

describe("inbox", () => {
  it("stores text sealed at rest and publishes an inbox event", () => {
    const deps = testDeps();
    const seen: unknown[] = [];
    const off = subscribe(REF, (e) => seen.push(e));
    const item = pushInbox(deps, REF, "alice.testnet", "lonely", "Could you give me a pat?");
    off();
    const row = deps.db.prepare("SELECT text_enc FROM inbox WHERE id = ?").get(item.id) as { text_enc: Buffer };
    expect(row.text_enc.toString("utf8")).not.toContain("pat");
    expect(deps.sealer.open(REF, row.text_enc)).toBe("Could you give me a pat?");
    expect(item.canned).toBe(true);
    expect(seen).toEqual([{ petRef: REF, type: "inbox", data: { ...item } }]);
  });

  it("lists after a cursor for the owner and the device, never another owner's rows", async () => {
    const deps = testDeps();
    const a = pushInbox(deps, REF, "alice.testnet", "lonely", "one");
    pushInbox(deps, REF, "old-owner.testnet", "lonely", "not yours");
    const b = pushInbox(deps, REF, "alice.testnet", "morning", "two", "turn-1");
    const app = createApp(deps);

    const all = (await (await app.request(BASE, { headers: await owner(deps) })).json()) as InboxItem[];
    expect(all.map((i) => i.text)).toEqual(["one", "two"]);
    expect(all[1]).toMatchObject({ trigger: "morning", canned: false, turn_id: "turn-1" });

    const after = (await (await app.request(`${BASE}?after=${a.id}`, { headers: addDevice(deps) })).json()) as InboxItem[];
    expect(after.map((i) => i.id)).toEqual([b.id]);

    expect((await app.request(BASE, { headers: await owner(deps, "bob.testnet") })).status).toBe(403);
    expect((await app.request(`${BASE}?after=x`, { headers: await owner(deps) })).status).toBe(400);
  });

  it("ack marks delivered for a device and read for the owner, up to the id", async () => {
    const deps = testDeps();
    const a = pushInbox(deps, REF, "alice.testnet", "lonely", "one");
    const b = pushInbox(deps, REF, "alice.testnet", "lonely", "two");
    const app = createApp(deps);
    const post = async (headers: Record<string, string>, body: unknown) =>
      app.request(`${BASE}/ack`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });

    expect((await post(addDevice(deps), { up_to: a.id })).status).toBe(200);
    expect((await post(await owner(deps), { up_to: b.id })).status).toBe(200);
    expect((await post(await owner(deps), { up_to: "x" })).status).toBe(400);

    const rows = deps.db.prepare("SELECT id, delivered_device_at, read_at FROM inbox ORDER BY id").all();
    expect(rows).toEqual([
      { id: a.id, delivered_device_at: deps.now(), read_at: deps.now() },
      { id: b.id, delivered_device_at: null, read_at: deps.now() },
    ]);
  });
});
