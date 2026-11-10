import type { Hono } from "hono";
import type { Chain } from "./chain/near";
import type { Config } from "./config";
import type { Sealer } from "./crypto";
import type { Db } from "./db/db";

/** Everything a module needs. Created once in server.ts, faked in tests. */
export interface Deps {
  cfg: Config;
  chain: Chain;
  db: Db;
  sealer: Sealer;
  now: () => number;
}

/** A feature area: its routes and, optionally, background jobs started by the scheduler. */
export interface Module {
  name: string;
  routes?: (deps: Deps) => Hono;
  start?: (deps: Deps) => () => void; // returns a stop function
}
