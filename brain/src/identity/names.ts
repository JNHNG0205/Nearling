// NEAR account names for email/Google users. Their Privy wallet is an implicit account (64 hex
// chars = its own ed25519 key). The brain creates `name.testnet` through the public testnet
// registrar with that same key as full access key, pays the small storage deposit, and remembers
// the link so any browser finds the name again. One name per account.
import { Hono, type Context } from "hono";
import { Account, JsonRpcProvider, KeyPairSigner, PublicKey, baseEncode, type KeyPairString } from "near-api-js";
import { requireCaller, type AuthEnv } from "../auth/guard";
import type { Deps, Module } from "../deps";
import { jsonBody } from "./common";
import { log } from "../log";

const REGISTRAR = "testnet";
const SUFFIX = ".testnet";
/** Storage for a new account with one key (about 0.00182 NEAR), with room to spare. */
const NAME_DEPOSIT = 10n ** 22n; // 0.01 NEAR

export interface Registrar {
  exists(accountId: string): Promise<boolean>;
  /** Creates `accountId` with `publicKey` as its full access key; true on success. */
  create(accountId: string, publicKey: string): Promise<boolean>;
}

/** A NEAR account label: lowercase letters and digits, single - or _ between them, 2 to 56 chars (64 with ".testnet"). */
export function validNameLabel(label: string): boolean {
  return label.length >= 2 && label.length <= 64 - SUFFIX.length && /^[a-z0-9]+([-_][a-z0-9]+)*$/.test(label);
}

/** The ed25519 key of an implicit account (its id is the key in hex), or null for named accounts. */
export function implicitPublicKey(accountId: string): string | null {
  if (!/^[0-9a-f]{64}$/.test(accountId)) return null;
  return `ed25519:${baseEncode(Buffer.from(accountId, "hex"))}`;
}

/** The testnet registrar, paid by the relayer account (full access key). */
export function createRegistrar(accountId: string, key: string, rpcUrl: string): Registrar | null {
  if (!accountId || !key) return null;
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const account = new Account(accountId, provider, KeyPairSigner.fromSecretKey(key as KeyPairString));
  return {
    async exists(id) {
      try {
        await provider.viewAccount({ accountId: id });
        return true;
      } catch (err) {
        if (/does not exist|UNKNOWN_ACCOUNT/i.test(String(err))) return false;
        throw err;
      }
    },
    async create(id, publicKey) {
      PublicKey.fromString(publicKey); // throws on a malformed key before spending anything
      const res = await account.callFunctionRaw({
        contractId: REGISTRAR,
        methodName: "create_account",
        args: { new_account_id: id, new_public_key: publicKey },
        gas: 100n * 10n ** 12n,
        deposit: NAME_DEPOSIT,
      });
      const status = res.status as { SuccessValue?: string } | undefined;
      return typeof status?.SuccessValue === "string" && Buffer.from(status.SuccessValue, "base64").toString() === "true";
    },
  };
}

const err = (c: Context, status: 400 | 404 | 409 | 502 | 503, code: string, message: string) =>
  c.json({ error: { code, message } }, status);

export function nameRoutes(deps: Deps, registrar: Registrar | null) {
  const app = new Hono<AuthEnv>();
  const lookup = (account: string) =>
    (deps.db.prepare("SELECT name FROM near_name WHERE account = ?").get(account) as { name: string } | undefined)?.name ?? null;

  app.get("/names/:account", (c) => {
    const account = c.req.param("account");
    const name = lookup(account);
    return name ? c.json({ account, name }) : err(c, 404, "not_found", "No NEAR name for this account");
  });

  app.post("/names", requireCaller(deps, ["owner"]), async (c) => {
    if (!registrar) return err(c, 503, "names_off", "NEAR names are not set up");
    const account = c.get("caller").account;
    const publicKey = implicitPublicKey(account);
    if (!publicKey) return err(c, 400, "invalid", "This wallet already has a NEAR name");
    const existing = lookup(account);
    if (existing) return err(c, 409, "conflict", `This account already has ${existing}`);
    const label = (await jsonBody(c) as { name?: unknown } | null)?.name;
    if (typeof label !== "string" || !validNameLabel(label)) {
      return err(c, 400, "invalid", "Use 2 to 56 lowercase letters, digits, - or _");
    }
    const name = `${label}${SUFFIX}`;
    if (await registrar.exists(name)) return err(c, 409, "conflict", `${name} is taken`);
    let ok = false;
    try {
      ok = await registrar.create(name, publicKey);
    } catch (e) {
      log.warn("name_create_failed", { name, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
    }
    if (!ok) return err(c, 502, "upstream", `Couldn't create ${name}. Try again or pick another name.`);
    deps.db.prepare("INSERT INTO near_name (account, name, created_at) VALUES (?, ?, ?)").run(account, name, deps.now());
    log.info("name_created", { name });
    return c.json({ account, name });
  });

  return app;
}

export const namesModule: Module = {
  name: "names",
  routes: (deps) =>
    new Hono().route(
      "/",
      nameRoutes(deps, createRegistrar(deps.cfg.RELAYER_ACCOUNT_ID, deps.cfg.RELAYER_KEY, deps.cfg.NEAR_RPC_URLS[0]!)),
    ),
};
