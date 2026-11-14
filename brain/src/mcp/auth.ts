import { randomBytes } from "node:crypto";
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { AuthorizationServerMetadata, OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Deps } from "../deps";
import { log } from "../log";
import { appCredentials, catalogEntry, effectiveEntry, type CatalogEntry } from "./catalog";
import { checkUrl, McpError } from "./client";
import { tokenContext, type ServerRow } from "./store";

/**
 * How a connected server is reached. Sealed in `mcp_server.token_enc` (older rows hold a plain
 * bearer string). OAuth access is refreshed shortly before it expires.
 */
export type StoredAuth =
  | { kind: "bearer"; token: string }
  | { kind: "path_key"; key: string }
  | { kind: "oauth"; access_token: string; refresh_token?: string; expires_at?: number };

const STATE_TTL_MS = 10 * 60_000;
const REFRESH_EARLY_MS = 60_000;

export const callbackUrl = (deps: Deps) => `${deps.cfg.BRAIN_PUBLIC_URL.replace(/\/$/, "")}/mcp/oauth/callback`;

export function readAuth(deps: Deps, owner: string, row: ServerRow): StoredAuth | null {
  if (!row.token_enc) return null;
  const raw = deps.sealer.open(tokenContext(owner), row.token_enc);
  try {
    const parsed = JSON.parse(raw) as StoredAuth;
    if (parsed && typeof parsed === "object" && "kind" in parsed) return parsed;
  } catch {
    // a plain token from POST /me/mcp
  }
  return { kind: "bearer", token: raw };
}

export const sealAuth = (deps: Deps, owner: string, a: StoredAuth) => deps.sealer.seal(tokenContext(owner), JSON.stringify(a));

// ---------- provider settings (fixed by the catalog, never by user input) ----------

interface Provider {
  authServer: URL;
  metadata: AuthorizationServerMetadata;
  client: OAuthClientInformationFull;
  /** RFC 8707 resource for providers that publish protected-resource metadata */
  resource?: URL;
}

const metaCache = new Map<string, { metadata: AuthorizationServerMetadata; authServer: URL; resource?: URL }>();

async function discover(e: CatalogEntry): Promise<{ metadata: AuthorizationServerMetadata; authServer: URL; resource?: URL }> {
  const cacheKey = `${e.id} ${e.url}`;
  const hit = metaCache.get(cacheKey);
  if (hit) return hit;
  let authServer: URL;
  let resource: URL | undefined;
  if (e.auth.kind === "oauth" && e.auth.setup === "google") {
    authServer = new URL("https://accounts.google.com");
  } else {
    const prm = await discoverOAuthProtectedResourceMetadata(e.url).catch(() => null);
    authServer = new URL(prm?.authorization_servers?.[0] ?? new URL(e.url).origin);
    if (prm?.resource && e.auth.kind === "oauth" && e.auth.setup === "dcr") resource = new URL(prm.resource);
  }
  const metadata = await discoverAuthorizationServerMetadata(authServer);
  if (!metadata) throw new McpError("unreachable");
  const out = { metadata, authServer, ...(resource ? { resource } : {}) };
  metaCache.set(cacheKey, out);
  return out;
}

async function provider(deps: Deps, e: CatalogEntry): Promise<Provider> {
  const { metadata, authServer, resource } = await discover(e);
  const creds = appCredentials(deps.cfg, e);
  if (creds === null) throw new McpError("not_set_up");
  if (creds !== "none_needed") return { authServer, metadata, client: { ...creds, redirect_uris: [callbackUrl(deps)] }, ...(resource ? { resource } : {}) };

  // dynamic client registration: once per provider and callback address, kept sealed
  const row = deps.db.prepare("SELECT client_enc FROM mcp_oauth_client WHERE provider = ?").get(e.id) as { client_enc: Buffer } | undefined;
  if (row) {
    const client = JSON.parse(deps.sealer.open("mcp-client", row.client_enc)) as OAuthClientInformationFull;
    if (client.redirect_uris?.includes(callbackUrl(deps))) return { authServer, metadata, client, ...(resource ? { resource } : {}) };
  }
  const client = await registerClient(authServer, {
    metadata,
    clientMetadata: {
      client_name: "Petto",
      redirect_uris: [callbackUrl(deps)],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  });
  deps.db
    .prepare("INSERT OR REPLACE INTO mcp_oauth_client (provider, client_enc, created_at) VALUES (?, ?, ?)")
    .run(e.id, deps.sealer.seal("mcp-client", JSON.stringify(client)), deps.now());
  log.info("mcp oauth client registered", { provider: e.id });
  return { authServer, metadata, client, ...(resource ? { resource } : {}) };
}

// ---------- sign-in ----------

/** The provider's sign-in link for this owner. The PKCE verifier and state are kept for 10 minutes. */
export async function startSignIn(deps: Deps, owner: string, catalog: CatalogEntry): Promise<string> {
  const e = effectiveEntry(deps.cfg, catalog);
  if (e.auth.kind !== "oauth") throw new McpError("bad_url");
  const p = await provider(deps, e);
  const state = randomBytes(24).toString("base64url");
  const { authorizationUrl, codeVerifier } = await startAuthorization(p.authServer, {
    metadata: p.metadata,
    clientInformation: p.client,
    redirectUrl: callbackUrl(deps),
    state,
    ...("scope" in e.auth && e.auth.scope ? { scope: e.auth.scope } : {}),
    ...(p.resource ? { resource: p.resource } : {}),
  });
  if (e.auth.setup === "google") {
    // a refresh token, so the pet keeps access after the first hour
    authorizationUrl.searchParams.set("access_type", "offline");
    authorizationUrl.searchParams.set("prompt", "consent");
  }
  deps.db.prepare("DELETE FROM mcp_oauth_state WHERE created_at < ?").run(deps.now() - STATE_TTL_MS);
  deps.db
    .prepare("INSERT INTO mcp_oauth_state (state, owner_account, catalog_id, verifier_enc, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(state, owner, e.id, deps.sealer.seal(tokenContext(owner), codeVerifier), deps.now());
  return authorizationUrl.toString();
}

/** Back from the provider: swaps the code for access (once; the state is single use). */
export async function finishSignIn(deps: Deps, state: string, code: string): Promise<{ owner: string; entry: CatalogEntry; auth: StoredAuth }> {
  const row = deps.db.prepare("SELECT * FROM mcp_oauth_state WHERE state = ?").get(state) as
    | { owner_account: string; catalog_id: string; verifier_enc: Buffer; created_at: number }
    | undefined;
  deps.db.prepare("DELETE FROM mcp_oauth_state WHERE state = ?").run(state);
  const found = row ? catalogEntry(row.catalog_id) : undefined;
  if (!row || !found || deps.now() - row.created_at > STATE_TTL_MS) throw new McpError("expired");
  const entry = found;
  const p = await provider(deps, effectiveEntry(deps.cfg, entry));
  const tokens = await exchangeAuthorization(p.authServer, {
    metadata: p.metadata,
    clientInformation: p.client,
    authorizationCode: code,
    codeVerifier: deps.sealer.open(tokenContext(row.owner_account), row.verifier_enc),
    redirectUri: callbackUrl(deps),
    ...(p.resource ? { resource: p.resource } : {}),
  });
  const auth: StoredAuth = {
    kind: "oauth",
    access_token: tokens.access_token,
    ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    ...(tokens.expires_in ? { expires_at: deps.now() + tokens.expires_in * 1000 } : {}),
  };
  return { owner: row.owner_account, entry, auth };
}

/** Address and bearer token for a call, refreshing OAuth access that is about to expire. */
export async function resolveServer(deps: Deps, owner: string, row: ServerRow): Promise<{ url: URL; token: string | null }> {
  const listed = row.catalog_id ? catalogEntry(row.catalog_id) : undefined;
  const entry = listed ? effectiveEntry(deps.cfg, listed) : undefined;
  const auth = readAuth(deps, owner, row);
  if (auth?.kind === "path_key" && entry?.auth.kind === "key") {
    return { url: new URL(entry.auth.urlTemplate.replace("{key}", encodeURIComponent(auth.key))), token: null };
  }
  // catalog addresses are fixed and public; only owner-typed ones go through the address guard
  const url = entry ? new URL(row.url) : await checkUrl(row.url, deps.cfg.MCP_ALLOW_PRIVATE);
  if (!auth) return { url, token: null };
  if (auth.kind !== "oauth") return { url, token: auth.kind === "bearer" ? auth.token : null };
  if (entry && auth.refresh_token && auth.expires_at && auth.expires_at - REFRESH_EARLY_MS < deps.now()) {
    try {
      const p = await provider(deps, entry);
      const t = await refreshAuthorization(p.authServer, {
        metadata: p.metadata,
        clientInformation: p.client,
        refreshToken: auth.refresh_token,
        ...(p.resource ? { resource: p.resource } : {}),
      });
      const next: StoredAuth = {
        kind: "oauth",
        access_token: t.access_token,
        refresh_token: t.refresh_token ?? auth.refresh_token,
        ...(t.expires_in ? { expires_at: deps.now() + t.expires_in * 1000 } : {}),
      };
      deps.db.prepare("UPDATE mcp_server SET token_enc = ? WHERE id = ?").run(sealAuth(deps, owner, next), row.id);
      return { url, token: next.access_token };
    } catch {
      log.warn("mcp oauth refresh failed", { server_id: row.id, provider: entry.id });
    }
  }
  return { url, token: auth.access_token };
}
