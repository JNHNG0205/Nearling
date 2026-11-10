import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Config } from "./config";
import type { Chain } from "./chain/near";
import { petRoutes } from "./routes/pets";

export function createApp(cfg: Config, chain: Chain) {
  const app = new Hono();

  app.use("*", cors({ origin: cfg.WEB_ORIGIN }));

  app.get("/health", (c) => c.json({ ok: true, network: cfg.NEAR_NETWORK, pets: cfg.PETS_CONTRACT }));

  app.route("/", petRoutes(chain, [cfg.PETS_CONTRACT, cfg.DEMO_PETS_CONTRACT]));

  // Never echo internals; log ids and codes only (CLAUDE.md rule 4).
  app.onError((err, c) => {
    console.error(JSON.stringify({ level: "error", path: c.req.path, error: err.name }));
    return c.json({ error: { code: "upstream", message: "Something went wrong" } }, 502);
  });

  return app;
}
