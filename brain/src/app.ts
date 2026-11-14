import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { Deps, Module } from "./deps";
import { GLOBAL_RULE, limit, RULES } from "./limits";
import { log } from "./log";
import { MODULES } from "./modules";

export function createApp(deps: Deps, modules: Module[] = MODULES) {
  const app = new Hono();

  // WEB_ORIGIN may list several sites, comma separated (for example the site and http://localhost:3000)
  app.use("*", cors({ origin: deps.cfg.WEB_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean) }));

  app.get("/health", (c) => c.json({ ok: true, network: deps.cfg.NEAR_NETWORK, pets: deps.cfg.PETS_CONTRACT }));

  // Abuse limits (src/limits.ts): bodies over 64 KB are refused except the talk upload (its own
  // audio limit), every address gets a flood ceiling, and the open or costly routes tighter ones.
  const smallBody = bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.json({ error: { code: "invalid", message: "Request too large" } }, 413),
  });
  app.use("*", (c, next) => (/^\/pets\/[^/]+\/talk$/.test(c.req.path) ? next() : smallBody(c, next)));
  app.use("*", limit(deps, "all", GLOBAL_RULE));
  RULES.forEach((r, i) => app.use(r.path, limit(deps, `r${i}`, r)));

  for (const m of modules) if (m.routes) app.route("/", m.routes(deps));

  // Never echo internals; log ids and codes only (CLAUDE.md rule 4).
  app.onError((err, c) => {
    log.error("unhandled", { path: c.req.path, error: err.name });
    return c.json({ error: { code: "upstream", message: "Something went wrong" } }, 502);
  });

  return app;
}
