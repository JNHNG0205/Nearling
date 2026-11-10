import { createNodeWebSocket } from "@hono/node-ws";
import type { Hono } from "hono";

// node-ws needs the app to route upgrade requests, but modules build their routes before the app
// exists. The app is handed in by server.ts once it is created (attachWebSockets).
let app: Hono | null = null;

const nodeWs = createNodeWebSocket({
  app: { request: (...args: Parameters<Hono["request"]>) => app!.request(...args) } as unknown as Hono,
});

export const upgradeWebSocket = nodeWs.upgradeWebSocket;

/** Called once by server.ts with the Node server: enables `GET /race/ws`. */
export function attachWebSockets(server: Parameters<typeof nodeWs.injectWebSocket>[0], appInstance: Hono): void {
  app = appInstance;
  nodeWs.injectWebSocket(server);
}
