import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Deps, Module } from "./deps";
import { log } from "./log";
import { MODULES } from "./modules";

export function createApp(deps: Deps, modules: Module[] = MODULES) {
  const app = new Hono();

  // WEB_ORIGIN may list several sites, comma separated (the domain and the vercel.app address)
  app.use("*", cors({ origin: deps.cfg.WEB_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean) }));

  app.get("/health", (c) => c.json({ ok: true, network: deps.cfg.NEAR_NETWORK, pets: deps.cfg.PETS_CONTRACT }));

  for (const m of modules) if (m.routes) app.route("/", m.routes(deps));

  // Never echo internals; log ids and codes only (CLAUDE.md rule 4).
  app.onError((err, c) => {
    log.error("unhandled", { path: c.req.path, error: err.name });
    return c.json({ error: { code: "upstream", message: "Something went wrong" } }, 502);
  });

  return app;
}
