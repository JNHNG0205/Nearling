import { z } from "zod";

// Only what the current routes use. Each later module adds its own keys here
// (full list: "AI-brain architectual/01-overview.md" section 7).
const Env = z.object({
  NEAR_NETWORK: z.literal("testnet"), // CLAUDE.md rule 2: testnet only
  NEAR_RPC_URLS: z
    .string()
    .default("https://test.rpc.fastnear.com,https://rpc.testnet.near.org")
    .transform((s) => s.split(",").map((u) => u.trim()).filter(Boolean)),
  PETS_CONTRACT: z.string().default("pets-v8.nearling.testnet"),
  DEMO_PETS_CONTRACT: z.string().default("pets-demo.nearling.testnet"),
  PORT: z.coerce.number().int().default(8787),
  DB_PATH: z.string().default("./data/nearling.db"),
  /** 32 bytes, base64. Required outside tests; generate with `openssl rand -base64 32`. */
  MEMORY_MASTER_KEY: z.string().optional(),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  PUBLIC_WEB_URL: z.string().default("http://localhost:3000"), // Hatch & Pair QR: `${PUBLIC_WEB_URL}/hatch?t=<token>`
  SHIRTS_CONTRACT: z.string().default("shirts.nearling.testnet"),
  /** HS256 secret for owner sessions, base64. Required outside tests. */
  SESSION_JWT_SECRET: z.string().default("dev-only-insecure-session-secret-change-me"),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse({ NEAR_NETWORK: "testnet", ...env });
  if (!parsed.success) {
    throw new Error(`Bad brain config: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  return parsed.data;
}
