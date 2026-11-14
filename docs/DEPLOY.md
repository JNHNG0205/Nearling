# Deploying Nearling (testnet)

Everything here is ready to run, but **a human runs it** (`CLAUDE.md` rule 1: no deploys, no posting, no spending without explicit confirmation). Testnet only: the brain refuses any `NEAR_NETWORK` other than `testnet`.

| Part | Where | Config in the repo |
|---|---|---|
| Brain (`brain/`) | Fly.io, one machine, volume `nearling_data` at `/data` | `brain/Dockerfile`, `brain/docker-entrypoint.sh`, `fly.toml`, `.dockerignore` |
| Web (`web/`) | Vercel, project root `web/` | `web/vercel.json` |
| Contracts | already on testnet (`pets-v8`, `pets-demo`, `shirts`) | `scripts/deploy-testnet.sh` (Role 1) |

Order: brain first (to get its URL), then web (to get its URL), then point the brain back at the web.

## 0. Before you start

- Installed: `flyctl` (`fly auth login`), Vercel CLI (`npm i -g vercel`, `vercel login`), or use the Vercel dashboard.
- A filled local `.env` (names in `.env.example`). Generate the two server secrets once and **keep them forever**: changing `MEMORY_MASTER_KEY` makes stored memories unreadable, changing `SESSION_JWT_SECRET` signs everyone out.

```bash
openssl rand -base64 32   # MEMORY_MASTER_KEY
openssl rand -base64 32   # SESSION_JWT_SECRET
```

- Chain keys ready (`docs/LIMITATIONS.md` B3, B4, C2): brain function-call keys in `BRAIN_KEYS`, feeder key in `FEEDER_KEY`.

## 1. Brain on Fly.io

Run from the **repo root** (the Docker build needs the pnpm workspace).

```bash
# 1. Create the app (once). Keeps fly.toml; pick another name if "nearling-brain" is taken
#    and update `app` in fly.toml.
fly apps create nearling-brain

# 2. Volume for SQLite (memories, turns, orders, inbox). Same region as fly.toml.
fly volumes create nearling_data --region sin --size 1 --app nearling-brain

# 3. Secrets (values from your .env; never commit them). Non-secret settings are in fly.toml [env].
fly secrets set --app nearling-brain --stage \
  NEAR_RPC_URLS="$NEAR_RPC_URLS" \
  BRAIN_ACCOUNT_ID="$BRAIN_ACCOUNT_ID" BRAIN_KEYS="$BRAIN_KEYS" \
  FEEDER_ACCOUNT_ID="$FEEDER_ACCOUNT_ID" FEEDER_KEY="$FEEDER_KEY" FEEDER_DAILY_CAP_NEAR="$FEEDER_DAILY_CAP_NEAR" \
  WALLET_VALIDATOR_POOL="$WALLET_VALIDATOR_POOL" \
  NEARAI_API_KEY="$NEARAI_API_KEY" NEARAI_CHAT_MODEL="$NEARAI_CHAT_MODEL" NEARAI_STT_MODEL="$NEARAI_STT_MODEL" \
  TTS_PROVIDER="$TTS_PROVIDER" TTS_MODEL="$TTS_MODEL" TTS_API_KEY="$TTS_API_KEY" TTS_VOICE_ID="$TTS_VOICE_ID" \
  MEMORY_MASTER_KEY="$MEMORY_MASTER_KEY" SESSION_JWT_SECRET="$SESSION_JWT_SECRET" \
  GLOBAL_DAILY_SPEND_CAP_USD="$GLOBAL_DAILY_SPEND_CAP_USD" \
  INTENTS_MODE="$INTENTS_MODE" ONECLICK_BASE_URL="$ONECLICK_BASE_URL" ONECLICK_JWT="$ONECLICK_JWT" \
  SETTLEMENT_ACCOUNT_MAINNET="$SETTLEMENT_ACCOUNT_MAINNET" INTENTS_LIVE_CONFIRMED=0 \
  MOCK_AI=0
# Load the variables first with:  set -a; . ./.env; set +a
# Empty values are fine for optional ones (TTS_*, ONECLICK_JWT, SETTLEMENT_ACCOUNT_MAINNET).

# 4. Deploy (builds brain/Dockerfile remotely; no local Docker needed).
fly deploy --app nearling-brain

# 5. Exactly one machine (in-memory rate limits, locks, race rooms, SSE).
fly scale count 1 --app nearling-brain
```

Notes:
- `INTENTS_LIVE_CONFIRMED` stays `0` unless a human decides to take real mainnet payments (`docs/LIMITATIONS.md` F1). With `0`, live mode only requests dry quotes.
- Contract ids (`PETS_CONTRACT`, `DEMO_PETS_CONTRACT`, `SHIRTS_CONTRACT`, `NEARON_POOL`) are in `fly.toml [env]`. After a new `pets-vN` deploy, change them there, add brain function-call keys for the new contract, and `fly deploy` again.
- The image runs as the `node` user; the entrypoint only `chown`s `/data` as root, then drops privileges.
- `BACKUP_DIR=/data/backups` is set for the backup job (`docs/LIMITATIONS.md` O2). Until that job exists, copy the database by hand while traffic is low: `fly ssh sftp get /data/nearling.db --app nearling-brain` (the image has no `sqlite3` CLI). Fly also snapshots volumes daily.
- Local Docker run (same image): `docker build -f brain/Dockerfile -t nearling-brain .` then `docker run --rm -p 8787:8787 --env-file .env -v nearling_data:/data nearling-brain`.

## 2. Web on Vercel

Project settings (dashboard: Add New Project, import the repo):

| Setting | Value |
|---|---|
| Root Directory | `web` |
| Framework | Next.js (also set in `web/vercel.json`) |
| Install Command | `pnpm install --frozen-lockfile` (pnpm finds the workspace root; "Include files outside the root directory" must stay on, it is the default) |
| Build Command | `pnpm build` |
| Node.js | 22.x |

Environment variables (Production; `NEXT_PUBLIC_*` are baked in at build time, so redeploy after changing them):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_BRAIN_URL` | `https://nearling-brain.fly.dev` (no trailing slash) |
| `NEXT_PUBLIC_NEAR_NETWORK` | `testnet` |
| `NEXT_PUBLIC_PETS_CONTRACT` | `pets.petto.testnet` |
| `NEXT_PUBLIC_DEMO_PETS_CONTRACT` | `pets-demo.petto.testnet` |
| `NEXT_PUBLIC_SHIRTS_CONTRACT` | `shirts.petto.testnet` |
| `NEXT_PUBLIC_DEMO_PET_REF` | the landing page's live demo pet, e.g. `pets-demo.petto.testnet:0` (pick a seeded pet that exists) |
| `NEXT_PUBLIC_RPC_URL` | optional, default `https://test.rpc.fastnear.com` |

With the CLI instead of the dashboard:

```bash
cd web
vercel link                       # choose/create the project; set Root Directory to `web` when asked
for n in NEXT_PUBLIC_BRAIN_URL NEXT_PUBLIC_NEAR_NETWORK NEXT_PUBLIC_PETS_CONTRACT \
         NEXT_PUBLIC_DEMO_PETS_CONTRACT NEXT_PUBLIC_SHIRTS_CONTRACT NEXT_PUBLIC_DEMO_PET_REF; do
  vercel env add "$n" production  # paste the value when prompted
done
vercel deploy --prod
```

## 3. Wire the two together

The brain's CORS allows exactly one origin, and device QR codes point at the web.

| Variable | Set on | Value | Used for |
|---|---|---|---|
| `WEB_ORIGIN` | brain (Fly secret) | `https://<your-app>.vercel.app` (scheme + host, no path, no trailing slash) | CORS `Access-Control-Allow-Origin` |
| `PUBLIC_WEB_URL` | brain (Fly secret) | same production URL | Hatch & Pair QR (`${PUBLIC_WEB_URL}/hatch?t=...`), receipt and feed links |
| `NEXT_PUBLIC_BRAIN_URL` | web (Vercel env) | `https://<brain-app>.fly.dev` | every brain call, SSE stream, race WebSocket (`wss://.../race/ws`) |

```bash
fly secrets set --app nearling-brain \
  WEB_ORIGIN=https://<your-app>.vercel.app PUBLIC_WEB_URL=https://<your-app>.vercel.app
```

`fly secrets set` restarts the machine. Vercel preview URLs are a different origin, so the brain rejects their requests: test on the production URL (or temporarily point `WEB_ORIGIN` at a preview).

## 4. HTTPS for the device

- Fly terminates TLS for `https://<brain-app>.fly.dev` (`force_https` in `fly.toml`), so the device talks HTTPS with no extra setup on the server.
- Firmware: set the brain base URL to `https://<brain-app>.fly.dev` and the race socket to `wss://<brain-app>.fly.dev/race/ws`. The ESP32 must trust the certificate chain: use the ESP-IDF / Arduino CA bundle, or pin the root CA that `openssl s_client -connect <brain-app>.fly.dev:443 -showcerts` prints. Device calls carry `Authorization: Device <token>` (pairing uses `X-Device-Id` / `X-Device-Secret`), see `AI-brain architectual/08-api-reference.md`.
- A custom domain (optional): `fly certs add brain.<domain>`, then update `NEXT_PUBLIC_BRAIN_URL` and the firmware.

## 5. Smoke checks after deploy

```bash
B=https://nearling-brain.fly.dev
W=https://<your-app>.vercel.app

curl -s $B/health                                    # {"ok":true,"network":"testnet","pets":"pets.petto.testnet"}
curl -s "$B/pets/$(printf 'pets.petto.testnet:1' | jq -sRr @uri)/state" | head -c 400   # seeded pet #1 state
curl -s -o /dev/null -w '%{http_code}\n' -H "Origin: $W" -X OPTIONS "$B/health" -H 'Access-Control-Request-Method: GET'   # 204
curl -s -D - -o /dev/null -H "Origin: $W" $B/health | grep -i access-control-allow-origin   # echoes $W
curl -s $B/feed/packs                                # packs and enabled modes
curl -s -o /dev/null -w '%{http_code}\n' $W/         # 200
fly logs --app nearling-brain                        # no "Bad brain config"; "brain listening"; warnings name any missing keys
fly status --app nearling-brain                      # 1 machine, check passing
```

Then in a browser on the production web URL (`docs/LIMITATIONS.md` W1, W2 still need this first real run):

1. Landing shows the live demo pet (brain reachable, CORS ok).
2. Connect Meteor (testnet), adopt on `pets-demo`, send a chat: a reply arrives and a `thought` event appears on the contract within a minute (brain keys work).
3. Feed with the NEAR wallet pack: fuel rises once.
4. `/race`: create a room, open the code in a second tab, race (WebSocket through Fly works).
5. Restart the machine (`fly machine restart`), reload the pet's receipts: history is still there (volume mounted).

## 6. Keep it up for judging

HACKATHON.md: a hosted demo should stay online until at least 2026-11-18 (ideally 2026-11-25). Keep `auto_stop_machines = "off"`, watch `fly logs` for `level=alert`, and top up the feeder account and NEAR AI org credit if they run low.
