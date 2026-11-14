import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createChain } from "./chain/near";
import { createBrainSigners, createSigner } from "./chain/signer";
import { loadConfig } from "./config";
import { createSealer } from "./crypto";
import { openDb } from "./db/db";
import type { Deps } from "./deps";
import { applyDevSecrets } from "./devSecrets";
import { log } from "./log";
import { MODULES } from "./modules";
import { attachWebSockets } from "./ws";
import { splitKeys } from "./wallet/rpc";

const fromDevFile = process.env.NODE_ENV === "production" ? [] : applyDevSecrets(process.env);
const cfg = loadConfig();
if (fromDevFile.length) log.warn("keys not set; using the saved dev keys (dev only)", { keys: fromDevFile });
if (!cfg.MEMORY_MASTER_KEY) throw new Error("MEMORY_MASTER_KEY is required");
const master = Buffer.from(cfg.MEMORY_MASTER_KEY, "base64");

const deps: Deps = {
  cfg,
  chain: createChain(cfg.NEAR_RPC_URLS),
  db: openDb(cfg.DB_PATH),
  sealer: createSealer(master),
  now: () => Date.now(),
  // One signer per key set, so every caller shares the per-key nonce lanes (B4).
  brain: createBrainSigners(cfg),
  feeder: createSigner(cfg.FEEDER_ACCOUNT_ID, splitKeys(cfg.FEEDER_KEY), cfg.NEAR_RPC_URLS[0] ?? ""),
};

const stops = MODULES.flatMap((m) => (m.start ? [m.start(deps)] : []));
const app = createApp(deps);

const server = serve({ fetch: app.fetch, port: cfg.PORT }, (info) => {
  log.info("brain listening", { port: info.port });
});
attachWebSockets(server, app);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stops.forEach((s) => s());
    server.close();
    deps.db.close();
    process.exit(0);
  });
}
