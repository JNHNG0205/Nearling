import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createChain } from "./chain/near";
import { loadConfig } from "./config";

const cfg = loadConfig();
const app = createApp(cfg, createChain(cfg.NEAR_RPC_URLS));

serve({ fetch: app.fetch, port: cfg.PORT }, (info) => {
  console.log(JSON.stringify({ level: "info", msg: "brain listening", port: info.port }));
});
