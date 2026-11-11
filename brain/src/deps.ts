import type { Hono } from "hono";
import type { Chain } from "./chain/near";
import type { BrainSigners, TxSigner } from "./chain/signer";
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
  /** Brain signers per pets contract, shared by the charge worker and the garden sweep (B4). Unset in most tests. */
  brain?: BrainSigners;
  /** The one feeder signer (Feed the Brain orders). Unset or null = not configured. */
  feeder?: TxSigner | null;
}

/** A feature area: its routes and, optionally, background jobs started by the scheduler. */
export interface Module {
  name: string;
  routes?: (deps: Deps) => Hono;
  start?: (deps: Deps) => () => void; // returns a stop function
}
