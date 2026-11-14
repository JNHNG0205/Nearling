import type { NextConfig } from "next";
import { resolve } from "node:path";

// One env file for the repo: the brain and scripts read the root `.env`, so the web does too.
// Values already set (web/.env.local, the host's env settings) win; no root file = host env only.
try {
  process.loadEnvFile(resolve(process.cwd(), "../.env"));
} catch {
  // no root .env (e.g. on the host)
}

// Pin the public values in the config: Next resets process.env when it reloads its own env files,
// which would drop the root-file values from the bundle (Privy sign-in vanished that way).
const publicEnv = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => e[0].startsWith("NEXT_PUBLIC_") && typeof e[1] === "string"),
);

const config: NextConfig = {
  env: publicEnv,
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@petto/shared", "@petto/race", "@petto/sprites", "@petto/device"],
};

export default config;
