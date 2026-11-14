import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Local dev only: when MEMORY_MASTER_KEY or SESSION_JWT_SECRET is not set, use the ones saved in
 * `<db dir>/dev-secrets.env` (created once, gitignored with the rest of brain/data). Before this a
 * missing key meant a new random key on every start, so chats saved earlier could no longer be
 * read and sign-ins from another run were refused. Production sets both keys, so this never runs.
 */
export function applyDevSecrets(env: NodeJS.ProcessEnv): string[] {
  const want = ["MEMORY_MASTER_KEY", "SESSION_JWT_SECRET"].filter((k) => !env[k]);
  if (want.length === 0) return [];
  const file = join(dirname(env.DB_PATH || "./data/nearling.db"), "dev-secrets.env");
  const saved: Record<string, string> = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.+)$/);
      if (m) saved[m[1]!] = m[2]!.trim();
    }
  }
  let changed = false;
  for (const k of want) {
    if (!saved[k]) {
      saved[k] = randomBytes(32).toString("base64");
      changed = true;
    }
    env[k] = saved[k];
  }
  if (changed) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Object.entries(saved).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  }
  return want;
}
