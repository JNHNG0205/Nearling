import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { parsePetRef } from "@nearling/shared";
import { readCaller } from "../auth/guard";
import type { Deps, Module } from "../deps";
import { subscribe } from "../events";

const HEARTBEAT_MS = 20_000;
const OWNER_CHECK_MS = 60_000;

/**
 * `GET /pets/:petRef/stream`: SSE of every bus event for the pet, owner only.
 * EventSource cannot set headers, so the session JWT may also come as `?t=<jwt>`.
 * Clients poll `/state`; this stream only carries pushes (inbox, fuel_charged, ...).
 * Ownership is re-checked every 60 s; on a transfer it sends `event: closed` and ends.
 */
export function streamRoutes(deps: Deps, heartbeatMs = HEARTBEAT_MS, ownerCheckMs = OWNER_CHECK_MS) {
  const app = new Hono();

  app.get("/pets/:petRef/stream", async (c) => {
    const q = c.req.query("t");
    const caller = await readCaller(deps, c.req.header("Authorization") ?? (q ? `Bearer ${q}` : undefined));
    if (!caller || caller.kind !== "owner") {
      return c.json({ error: { code: "unauthorized", message: "Sign in first" } }, 401);
    }
    const ref = parsePetRef(c.req.param("petRef"));
    if (!ref) return c.json({ error: { code: "invalid", message: "Unknown pet reference" } }, 400);
    const pet = await deps.chain.getPet(ref.contract, ref.tokenId);
    if (!pet) return c.json({ error: { code: "not_found", message: "No such pet" } }, 404);
    if (pet.owner !== caller.account) {
      return c.json({ error: { code: "not_owner", message: "Only the pet's owner can do that" } }, 403);
    }
    const petRef = `${ref.contract}:${ref.tokenId}`;

    const account = caller.account;
    return streamSSE(c, async (stream) => {
      let finish = () => {};
      const closed = new Promise<void>((resolve) => {
        finish = resolve;
        stream.onAbort(resolve);
      });
      const unsubscribe = subscribe(petRef, (e) => {
        void stream.writeSSE({ event: e.type, data: JSON.stringify(e.data) });
      });
      const beat = setInterval(() => void stream.write(": hb\n\n"), heartbeatMs);
      // D3: a transferred pet stops streaming to its old owner. RPC errors keep the stream open.
      const recheck = setInterval(() => {
        void deps.chain
          .getPet(ref.contract, ref.tokenId)
          .then(async (p) => {
            if (p && p.owner === account) return;
            await stream.writeSSE({ event: "closed", data: JSON.stringify({ reason: "not_owner" }) });
            finish();
          })
          .catch(() => undefined);
      }, ownerCheckMs);
      await stream.write(": connected\n\n");
      await closed;
      clearInterval(beat);
      clearInterval(recheck);
      unsubscribe();
    });
  });

  return app;
}

export const streamModule: Module = { name: "stream", routes: (deps) => streamRoutes(deps) };
