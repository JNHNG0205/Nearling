import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { issueSession, sha256 } from "../auth/guard";
import { publish } from "../events";
import { testDeps } from "../test/deps";

const REF = "pets-v8.nearling.testnet:1";
const PATH = `/pets/${REF}/stream`;

async function readUntil(body: ReadableStream<Uint8Array>, needle: string): Promise<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let text = "";
  while (!text.includes(needle)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value);
  }
  await reader.cancel();
  return text;
}

describe("GET /pets/:petRef/stream", () => {
  it("streams bus events to the owner authenticated with ?t=", async () => {
    const deps = testDeps();
    const { token } = await issueSession(deps, "alice.testnet");
    const res = await createApp(deps).request(`${PATH}?t=${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    setTimeout(() => {
      publish("pets-v8.nearling.testnet:2", "inbox", { id: 99 }); // another pet: not forwarded
      publish(REF, "inbox", { id: 1 });
    }, 10);
    const text = await readUntil(res.body!, "event: inbox");
    expect(text).toContain(": connected");
    expect(text).toContain('event: inbox\ndata: {"id":1}');
    expect(text).not.toContain("99");
  });

  it("also accepts the Authorization header", async () => {
    const deps = testDeps();
    const { token } = await issueSession(deps, "alice.testnet");
    const res = await createApp(deps).request(PATH, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    await res.body!.cancel();
  });

  it("rejects strangers, missing tokens and devices", async () => {
    const deps = testDeps();
    const bob = await issueSession(deps, "bob.testnet");
    const app = createApp(deps);
    expect((await app.request(`${PATH}?t=${bob.token}`)).status).toBe(403);
    expect((await app.request(PATH)).status).toBe(401);
    expect((await app.request(`${PATH}?t=junk`)).status).toBe(401);
    deps.db
      .prepare("INSERT INTO device (id, hw_id, secret_hash, token_hash, pet_ref, owner_account, created_at) VALUES ('d1','hw','x',?,?,?,0)")
      .run(sha256("devtok"), REF, "alice.testnet");
    expect((await app.request(PATH, { headers: { Authorization: "Device devtok" } })).status).toBe(401);
  });
});
