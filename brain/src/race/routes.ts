import { Hono, type Context } from "hono";
import { requireCaller, type AuthEnv } from "../auth/guard";
import type { Deps, Module } from "../deps";
import { RaceHub, type Conn, type ResolveResult } from "./hub";
import { upgradeWebSocket } from "./ws";

// Routes: "AI-brain architectual/08-api-reference.md" (Race). Protocol: 06 section 3.

const MAX_MESSAGE = 64 * 1024; // a full 120 s input list fits easily
const SWEEP_MS = 30_000;

const hubs = new WeakMap<Deps, RaceHub>();
export function hubFor(deps: Deps): RaceHub {
  let hub = hubs.get(deps);
  if (!hub) hubs.set(deps, (hub = new RaceHub(deps)));
  return hub;
}

const fail = (c: Context, status: 400 | 401 | 404 | 409 | 429, code: string, message: string) =>
  c.json({ error: { code, message } }, status);

type WsEnv = { Variables: { raceCode: string; raceSlot: 0 | 1 } };

export function raceRoutes(deps: Deps) {
  const hub = hubFor(deps);
  const app = new Hono<WsEnv>();
  const deviceOnly = requireCaller(deps, ["device"]);

  app.post("/race/rooms", (c) => {
    const code = hub.createRoom();
    if (!code) return c.json({ error: { code: "rate_limited", message: "Too many races right now", retry_after_s: 60 } }, 429);
    return c.json({ code });
  });

  app.post("/race/rooms/:code/join", (c) => {
    const r = hub.join(c.req.param("code"));
    if ("error" in r) {
      return r.error === "not_found"
        ? fail(c, 404, "not_found", "No race with that code")
        : fail(c, 409, "conflict", "That race is full or already started");
    }
    return c.json(r);
  });

  app.get("/race/matches/:id", (c) => {
    const match = deps.db.prepare("SELECT * FROM match WHERE id = ?").get(c.req.param("id"));
    if (!match) return fail(c, 404, "not_found", "No such match");
    const players = deps.db
      .prepare("SELECT slot, kind, name, pet_ref, reported_tick, crash_tick, report_valid FROM match_player WHERE match_id = ? ORDER BY slot")
      .all(c.req.param("id"));
    return c.json({ ...match, players });
  });

  app.get(
    "/race/ws",
    async (c, next) => {
      const code = (c.req.query("code") ?? "").toUpperCase();
      const token = c.req.query("race_token");
      let r: ResolveResult;
      if (token) {
        r = hub.resolve(code, { token });
      } else {
        // Devices authenticate with `Authorization: Device <token>` (the paired device token).
        let deviceId: string | null = null;
        const ac = c as unknown as Context<AuthEnv>;
        const denied = await deviceOnly(ac, async () => {
          const caller = ac.get("caller");
          if (caller.kind === "device") deviceId = caller.deviceId;
        });
        if (!deviceId) return denied ?? fail(c, 401, "unauthorized", "Pair the device or join the race first");
        r = hub.resolve(code, { deviceId });
      }
      if ("error" in r) {
        if (r.error === "not_found") return fail(c, 404, "not_found", "No race with that code");
        if (r.error === "unauthorized") return fail(c, 401, "unauthorized", "Join the race first");
        return fail(c, 409, "conflict", "That race is full or already started");
      }
      c.set("raceCode", code);
      c.set("raceSlot", r.slot);
      await next();
    },
    upgradeWebSocket((c) => {
      const code = c.get("raceCode");
      const slot = c.get("raceSlot");
      let conn: Conn | null = null;
      return {
        onOpen: (_evt, ws) => {
          conn = { send: (d) => ws.send(d), close: (code_, reason) => ws.close(code_, reason) };
          hub.open(code, slot, conn);
        },
        onMessage: (evt, ws) => {
          if (!conn) return;
          if (typeof evt.data !== "string" || evt.data.length > MAX_MESSAGE) {
            ws.send(JSON.stringify({ type: "error", code: "bad_message", message: "Send small JSON text frames" }));
            return;
          }
          hub.message(code, slot, conn, evt.data);
        },
        onClose: () => {
          if (conn) hub.close(code, slot, conn);
        },
      };
    }),
  );

  return app as unknown as Hono; // the per-request variables stay inside this router
}

export const raceModule: Module = {
  name: "race",
  routes: raceRoutes,
  start: (deps) => {
    const hub = hubFor(deps);
    const t = setInterval(() => hub.sweep(), SWEEP_MS);
    return () => {
      clearInterval(t);
      hub.stop();
    };
  },
};
