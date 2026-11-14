# MCP tools: setup

Web `/mcp` lists ready-made tools (brain `src/mcp/catalog.ts`). How each one connects:

| Tool | How it connects | Setup needed |
|---|---|---|
| Notion, Canva | "Sign in with..." (OAuth 2.1 + PKCE). Petto registers itself with the provider the first time (dynamic client registration) | None |
| Firecrawl | The user pastes their own API key (firecrawl.dev, free tier) | None |
| DeepWiki, Context7, GitMCP, Hugging Face, Microsoft Learn, AWS Knowledge, Cloudflare Docs | Open, no account | None |
| Gmail, Google Calendar | **Sign in with Google** directly once the team adds a Google Cloud OAuth app (below). Until then they connect **through Zapier** (Zapier MCP registers Petto automatically; the user signs in to Zapier and allows the app; each card keeps only its own app's tools) | Optional: a Google Cloud OAuth app |
| Slack | **Sign in with Slack** directly once the team adds a Slack app (below); through Zapier until then | Optional: a Slack app |
| Playwright | Not hosted: it drives a real browser, which on our server would let anyone reach internal addresses | Runs on the user's own computer |

After a sign-in the provider sends the browser to `${BRAIN_PUBLIC_URL}/mcp/oauth/callback`; the brain finishes it,
stores the access encrypted (and refreshes it before it expires), then sends the browser back to `${PUBLIC_WEB_URL}/mcp`.

## Brain settings (`.env`)

```
BRAIN_PUBLIC_URL=http://localhost:8787     # the address browsers use for the brain (https in production)
PUBLIC_WEB_URL=http://localhost:3000
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
SLACK_OAUTH_CLIENT_ID=
SLACK_OAUTH_CLIENT_SECRET=
```

Restart the brain after changing them. Cards for Google and Slack say "Coming soon" until their two values are set.

## Gmail and Google Calendar (one Google app for both)

1. Google Cloud Console: create a project (or pick one).
2. APIs and services, Library: enable **Gmail API** and **Google Calendar API**.
3. OAuth consent screen: user type **External**, app name "Petto", your email as support contact.
   - Scopes: `gmail.readonly`, `gmail.compose`, `calendar.events`, `calendar.readonly`.
   - While the app is in **Testing**, only the **test users** you add here can sign in (add your team's Google accounts).
     Gmail scopes are "restricted": publishing to everyone needs Google's verification, which takes weeks.
4. Credentials, Create credentials, **OAuth client ID**, type **Web application**.
   - Authorized redirect URI: `http://localhost:8787/mcp/oauth/callback` (and the hosted brain's `https://.../mcp/oauth/callback`).
5. Copy the client ID and secret into `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.

## Slack

1. api.slack.com/apps, **Create New App**, From scratch, name "Petto", pick your workspace.
2. OAuth and Permissions:
   - Redirect URL: `http://localhost:8787/mcp/oauth/callback` (and the hosted one). Slack requires https for
     distributed apps; for local testing add the localhost URL anyway, or use the hosted brain.
   - **User Token Scopes**: `channels:read`, `channels:history`, `chat:write`, `search:read.public`, `users:read`.
3. Basic Information: copy the **Client ID** and **Client Secret** into `SLACK_OAUTH_CLIENT_ID` and `SLACK_OAUTH_CLIENT_SECRET`.

## Safety

- Every tool call the pet proposes waits for the owner's **Approve** in chat; nothing runs on its own.
- Sign-in endpoints and server addresses come from the catalog, never from user input. Owner-typed servers
  (optional) must be public https addresses (no private networks).
- Tokens, API keys, task arguments and results are sealed (AES-GCM) in the brain database and never logged.
