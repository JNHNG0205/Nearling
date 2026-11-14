import type { Config } from "../config";

/**
 * MCP tools offered on web /mcp. Endpoints and sign-in settings live here, never in user input,
 * so OAuth and API-key traffic only goes to these known providers. Checked 2026-11-14:
 * the `none` servers list tools with no sign-in; Notion, Canva and Slack publish OAuth metadata;
 * Google's Gmail and Calendar MCP servers use Google sign-in.
 */

export type CatalogAuth =
  | { kind: "none" }
  /** the user's own API key, placed in the server path (`{key}` in `urlTemplate`) */
  | { kind: "key"; urlTemplate: string; keyName: string; keyUrl: string }
  /** OAuth 2.1 + PKCE. `dcr`: Petto registers itself with the provider (no app setup). */
  | { kind: "oauth"; setup: "dcr"; scope?: string }
  | { kind: "oauth"; setup: "google"; scope: string }
  | { kind: "oauth"; setup: "slack"; scope: string }
  /** cannot be hosted for strangers; the card explains how to run it yourself */
  | { kind: "local"; help: string };

export interface CatalogEntry {
  id: string;
  name: string;
  url: string;
  what: string;
  try: string;
  auth: CatalogAuth;
  /**
   * Without the team's own Google / Slack app, connect through Zapier's MCP server instead: it signs
   * users in with automatic registration and reaches the app through Zapier's verified apps. Only
   * tools whose name starts with `prefix` are given to the pet.
   */
  viaZapier?: { prefix: string };
}

export const CATALOG: CatalogEntry[] = [
  {
    id: "gmail", name: "Gmail", url: "https://gmailmcp.googleapis.com/mcp/v1",
    what: "Read, search and draft emails. Your pet drafts; you choose what to send.",
    try: "Draft an email to amy@example.com saying I'll be late to lunch.",
    auth: { kind: "oauth", setup: "google", scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose" },
    viaZapier: { prefix: "gmail" },
  },
  {
    id: "gcal", name: "Google Calendar", url: "https://calendarmcp.googleapis.com/mcp/v1",
    what: "See your schedule and book events.",
    try: "Book a dentist appointment next Tuesday at 3pm for 30 minutes.",
    auth: { kind: "oauth", setup: "google", scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly" },
    viaZapier: { prefix: "google_calendar" },
  },
  {
    id: "slack", name: "Slack", url: "https://mcp.slack.com/mcp",
    what: "Read channels, search messages and post for you.",
    try: "What did people say in #general today?",
    auth: { kind: "oauth", setup: "slack", scope: "channels:read,channels:history,chat:write,search:read.public,users:read" },
    viaZapier: { prefix: "slack" },
  },
  {
    id: "notion", name: "Notion", url: "https://mcp.notion.com/mcp",
    what: "Search, read and write pages in your Notion workspace.",
    try: "Add 'buy cat food' to my Notion to-do page.",
    auth: { kind: "oauth", setup: "dcr" },
  },
  {
    id: "canva", name: "Canva", url: "https://mcp.canva.com/mcp",
    what: "Find your designs and create new ones.",
    try: "Make a birthday card design for my friend Sam.",
    auth: { kind: "oauth", setup: "dcr" },
  },
  {
    id: "firecrawl", name: "Firecrawl", url: "https://mcp.firecrawl.dev/mcp",
    what: "Read any web page or search the web.",
    try: "Read https://near.org and tell me what it is about.",
    auth: { kind: "key", urlTemplate: "https://mcp.firecrawl.dev/{key}/v2/mcp", keyName: "Firecrawl API key", keyUrl: "https://www.firecrawl.dev/app/api-keys" },
  },
  {
    id: "playwright", name: "Playwright", url: "",
    what: "Control a web browser: open pages, click and fill forms.",
    try: "Open example.com and take a screenshot.",
    auth: { kind: "local", help: "Playwright drives a real browser, so it runs on your own computer, not on Petto's server. Run `npx @playwright/mcp@latest --port 8931` and use it from an MCP app on that computer." },
  },
  {
    id: "deepwiki", name: "DeepWiki", url: "https://mcp.deepwiki.com/mcp",
    what: "Answers questions about any public GitHub project.", try: "Use DeepWiki: what is the near/near-api-js repo for?",
    auth: { kind: "none" },
  },
  {
    id: "context7", name: "Context7", url: "https://mcp.context7.com/mcp",
    what: "Up-to-date docs and code examples for popular libraries.", try: "Find the React docs on the useEffect hook.",
    auth: { kind: "none" },
  },
  {
    id: "gitmcp", name: "GitMCP", url: "https://gitmcp.io/docs",
    what: "Reads and searches the docs and code of GitHub projects.", try: "Search the docs of vercel/next.js for how routing works.",
    auth: { kind: "none" },
  },
  {
    id: "huggingface", name: "Hugging Face", url: "https://huggingface.co/mcp",
    what: "Finds AI models and datasets on the Hugging Face Hub.", try: "Find small text-to-speech models on Hugging Face.",
    auth: { kind: "none" },
  },
  {
    id: "mslearn", name: "Microsoft Learn", url: "https://learn.microsoft.com/api/mcp",
    what: "Searches Microsoft's official docs and code samples.", try: "How do I create a list in Python? Check Microsoft Learn.",
    auth: { kind: "none" },
  },
  {
    id: "aws", name: "AWS Knowledge", url: "https://knowledge-mcp.global.api.aws",
    what: "Searches AWS documentation and region availability.", try: "Which AWS regions have Amazon Bedrock?",
    auth: { kind: "none" },
  },
  {
    id: "cloudflare", name: "Cloudflare Docs", url: "https://docs.mcp.cloudflare.com/mcp",
    what: "Searches Cloudflare's developer documentation.", try: "How do Cloudflare Workers handle cron triggers?",
    auth: { kind: "none" },
  },
];

export const catalogEntry = (id: string) => CATALOG.find((c) => c.id === id);

export const ZAPIER_MCP_URL = "https://mcp.zapier.com/api/v1/connect";

/** The entry as it will really connect: Gmail, Calendar and Slack go through Zapier until the team adds its own app. */
export function effectiveEntry(cfg: Config, e: CatalogEntry): CatalogEntry {
  if (!e.viaZapier || appCredentials(cfg, e) !== null) return e;
  return { ...e, url: ZAPIER_MCP_URL, auth: { kind: "oauth", setup: "dcr", scope: "openid profile email" } };
}

/** Google and Slack need an app the team registers; the rest work as they are. */
export function appCredentials(cfg: Config, e: CatalogEntry): { client_id: string; client_secret: string } | null | "none_needed" {
  if (e.auth.kind !== "oauth" || e.auth.setup === "dcr") return "none_needed";
  const [id, secret] = e.auth.setup === "google"
    ? [cfg.GOOGLE_OAUTH_CLIENT_ID, cfg.GOOGLE_OAUTH_CLIENT_SECRET]
    : [cfg.SLACK_OAUTH_CLIENT_ID, cfg.SLACK_OAUTH_CLIENT_SECRET];
  return id && secret ? { client_id: id, client_secret: secret } : null;
}

/** What the web shows: no endpoints for key tools, no secrets ever. */
export function catalogView(cfg: Config) {
  return CATALOG.map((e) => ({
    id: e.id,
    name: e.name,
    what: e.what,
    try: e.try,
    auth: e.auth.kind,
    ...(e.auth.kind === "key" ? { key_name: e.auth.keyName, key_url: e.auth.keyUrl } : {}),
    ...(e.auth.kind === "local" ? { help: e.auth.help } : {}),
    available: e.auth.kind !== "local" && appCredentials(cfg, effectiveEntry(cfg, e)) !== null,
    ...(effectiveEntry(cfg, e).url === ZAPIER_MCP_URL ? { via: "Zapier" } : {}),
  }));
}
