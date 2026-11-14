import type { NextConfig } from "next";
import { resolve } from "node:path";

// One env file for the repo: the brain and scripts read the root `.env`, so the web does too.
// Values already set (web/.env.local, the host's env settings) win; no root file = host env only.
try {
  process.loadEnvFile(resolve(process.cwd(), "../.env"));
} catch {
  // no root .env (e.g. on the host)
}

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@nearling/shared", "@nearling/race", "@nearling/sprites", "@nearling/device"],
};

export default config;
