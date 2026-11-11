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
  /** NEAR AI Cloud, OpenAI-compatible (CLAUDE.md 8.1). Staging for the hackathon. */
  NEARAI_BASE_URL: z.string().default("https://cloud-stg-api.near.ai/v1"),
  NEARAI_API_KEY: z.string().optional(),
  // ---- fuel / orders / garden / wallet (AI-brain 04, 05 section 5) ----
  /**
   * Feed the Brain payment modes. `direct` is always on. `simulated` adds the labelled
   * "Pay (simulated)" button. `live` adds NEAR Intents 1Click and keeps simulated on as the
   * demo fallback (needs SETTLEMENT_ACCOUNT_MAINNET).
   */
  INTENTS_MODE: z.enum(["direct", "live", "simulated"]).default("direct"),
  ONECLICK_BASE_URL: z.string().default("https://1click.chaindefuser.com"),
  ONECLICK_JWT: z.string().optional(),
  SETTLEMENT_ACCOUNT_MAINNET: z.string().optional(),
  /**
   * Set to "1" only by a human (CLAUDE.md rule 1). Without it live orders request `dry: true`
   * quotes only, so no deposit address exists and no mainnet money can move.
   */
  INTENTS_LIVE_CONFIRMED: z.string().default("0"),
  FEEDER_ACCOUNT_ID: z.string().default(""),
  FEEDER_KEY: z.string().default(""),
  FEEDER_DAILY_CAP_NEAR: z.coerce.number().positive().default(10),
  NEARON_POOL: z.string().default("mw-pool-1024.testnet"),
  /**
   * Testnet validator pool for Wallet staking (`get_account_staked_balance`). Checked 2026-11-11:
   * active in `validators`, producing all expected blocks, 3% reward fee (legends takes 100%).
   */
  WALLET_VALIDATOR_POOL: z.string().default("stakely_v2.pool.f863973.m0"),

  // Talk, NEAR AI, TTS, charging (AI-brain 03, 04 section 2)
  NEARAI_CHAT_MODEL: z.string().default("z-ai/glm-5.3-flash"),
  NEARAI_STT_MODEL: z.string().default("openai/whisper-large-v3"),
  TTS_PROVIDER: z.enum(["elevenlabs", "kokoro", "none"]).default("none"),
  TTS_MODEL: z.string().default("eleven_flash_v2_5"),
  TTS_API_KEY: z.string().optional(),
  TTS_VOICE_ID: z.string().optional(),
  /** Kokoro only: OpenAI-compatible base URL of the self-hosted container. */
  TTS_BASE_URL: z.string().default("http://localhost:8880/v1"),
  BRAIN_ACCOUNT_ID: z.string().default("brain.nearling.testnet"),
  BRAIN_KEYS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((k) => k.trim()).filter(Boolean)),
  /** Brain function-call keys per contract (B4): a key works for one receiver only. PETS falls back to BRAIN_KEYS. */
  BRAIN_KEYS_PETS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((k) => k.trim()).filter(Boolean)),
  BRAIN_KEYS_DEMO: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((k) => k.trim()).filter(Boolean)),
  GLOBAL_DAILY_SPEND_CAP_USD: z.coerce.number().nonnegative().default(5),
  // ---- ops (AI-brain 09 section 3): /ops, alerts, backups, billing, org balance ----
  /** ElevenLabs Flash v2.5 USD per 1,000 characters, for the spend cap. [VERIFY] our plan's price. */
  TTS_USD_PER_1K_CHARS: z.coerce.number().nonnegative().default(0.05),
  /** NEAR AI org whose balance is read after sweeps; falls back to the pets contract `config().org_id`. */
  NEARAI_ORG_ID: z.string().optional(),
  /** `GET /ops` basic auth. The route is 404 unless both are set. */
  OPS_USER: z.string().optional(),
  OPS_PASSWORD: z.string().optional(),
  /** Discord or Slack style webhook that receives `log.alert` lines (ids only), rate limited. */
  ALERT_WEBHOOK_URL: z.string().optional(),
  BACKUP_DIR: z.string().default("./data/backups"),
  // ---- public pet metadata on IPFS (docs/IPFS.md). Unset JWT = module is a no-op. ----
  PINATA_JWT: z.string().optional(),
  /** Dedicated gateway host, e.g. "example.mypinata.cloud". Unset = https://ipfs.io. */
  PINATA_GATEWAY: z.string().optional(),
  /** Tests only (CLAUDE.md rule 5): canned fake inference, never in the demo path. */
  MOCK_AI: z
    .string()
    .default("0")
    .transform((s) => s === "1" || s === "true"),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse({ NEAR_NETWORK: "testnet", ...env });
  if (!parsed.success) {
    throw new Error(`Bad brain config: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  return parsed.data;
}
