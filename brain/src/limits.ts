import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Deps } from "./deps";

// API abuse limits: fixed-window counters in memory (one brain instance, so no shared store).
// Per-address rules guard the routes anyone can call; the money routes (/names, /relay) also
// keep a total per day, counted inside the route only when NEAR is actually spent.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const DAY_MS = 24 * HOUR;
const SWEEP_AT = 20_000; // keys kept before expired windows are dropped

export type Take = { ok: true } | { ok: false; retryAfterS: number };

export function createLimiter(now: () => number) {
  const hits = new Map<string, { start: number; n: number }>();
  return {
    take(key: string, max: number, windowMs: number): Take {
      const t = now();
      if (hits.size > SWEEP_AT) for (const [k, w] of hits) if (t - w.start >= windowMs) hits.delete(k);
      let w = hits.get(key);
      if (!w || t - w.start >= windowMs) hits.set(key, (w = { start: t, n: 0 }));
      if (w.n >= max) return { ok: false, retryAfterS: Math.max(1, Math.ceil((w.start + windowMs - t) / 1000)) };
      w.n += 1;
      return { ok: true };
    },
  };
}
export type Limiter = ReturnType<typeof createLimiter>;

const limiters = new WeakMap<Deps, Limiter>();
/** One limiter per brain (per Deps), shared by the app-wide rules and the money caps in routes. */
export function limiterFor(deps: Deps): Limiter {
  let l = limiters.get(deps);
  if (!l) limiters.set(deps, (l = createLimiter(deps.now)));
  return l;
}

/**
 * The caller's address. In production the brain listens on 127.0.0.1 behind Caddy, which sets
 * X-Forwarded-For; the last entry is the one Caddy added, so a client cannot choose it.
 */
export function clientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  const last = xff?.split(",").pop()?.trim();
  if (last) return last;
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown"; // tests (app.request) have no socket
  }
}

export function tooMany(c: Context, retryAfterS: number, message = "Too many requests. Try again in a moment.") {
  c.header("Retry-After", String(retryAfterS));
  return c.json({ error: { code: "rate_limited", message, retry_after_s: retryAfterS } }, 429);
}

interface Rule { path: string; methods?: string[]; max: number; windowMs: number }

/** Per-address limits, tightest first. `path` uses Hono patterns. */
export const RULES: Rule[] = [
  { path: "/auth/nonce", max: 30, windowMs: MINUTE },
  { path: "/session", methods: ["POST"], max: 20, windowMs: MINUTE },
  { path: "/devices/hello", methods: ["POST"], max: 20, windowMs: MINUTE },
  { path: "/devices/pairing/confirm", methods: ["POST"], max: 20, windowMs: MINUTE },
  { path: "/pairings/:token/claim", methods: ["POST"], max: 20, windowMs: MINUTE },
  { path: "/orders", methods: ["POST"], max: 10, windowMs: MINUTE },
  { path: "/orders/:id/direct-tx", methods: ["POST"], max: 20, windowMs: MINUTE },
  { path: "/names", methods: ["POST"], max: 3, windowMs: HOUR },
  { path: "/relay", methods: ["POST"], max: 120, windowMs: HOUR },
  { path: "/battle/rooms", methods: ["POST"], max: 30, windowMs: 10 * MINUTE },
  { path: "/battle/rooms/:code/join", methods: ["POST"], max: 30, windowMs: 10 * MINUTE },
  { path: "/me/mcp", methods: ["POST"], max: 30, windowMs: HOUR },
  { path: "/me/mcp/*", methods: ["POST"], max: 30, windowMs: HOUR },
  { path: "/approvals", methods: ["POST"], max: 30, windowMs: MINUTE },
  { path: "/receipts/:turnId/publish", methods: ["POST"], max: 30, windowMs: MINUTE },
];
/** Every route except /health: a ceiling on floods (most reads also call the chain). */
export const GLOBAL_RULE = { max: 600, windowMs: MINUTE };

export function limit(deps: Deps, name: string, rule: { methods?: string[]; max: number; windowMs: number }): MiddlewareHandler {
  return async (c, next) => {
    if (rule.methods && !rule.methods.includes(c.req.method)) return next();
    const r = limiterFor(deps).take(`${name}|${clientIp(c)}`, rule.max, rule.windowMs);
    if (!r.ok) return tooMany(c, r.retryAfterS);
    return next();
  };
}

/** A total across all callers for one UTC day (money caps); key is the cap's name. */
export function takeDaily(deps: Deps, name: string, max: number): Take {
  const day = Math.floor(deps.now() / DAY_MS);
  const r = limiterFor(deps).take(`${name}|day${day}`, max, DAY_MS);
  if (r.ok) return r;
  return { ok: false, retryAfterS: Math.max(1, Math.ceil(((day + 1) * DAY_MS - deps.now()) / 1000)) };
}
