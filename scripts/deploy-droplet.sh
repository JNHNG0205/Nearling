#!/usr/bin/env bash
# Deploys the brain to a Linux server you can SSH into (e.g. a DigitalOcean droplet):
# Docker container with a volume for SQLite, Caddy in front for HTTPS (WebSockets included).
#   ./scripts/deploy-droplet.sh root@203.0.113.7 https://petto.vercel.app [domain]
# domain defaults to <ip-with-dashes>.sslip.io, which needs no DNS setup.
# Needs: ssh access with your key, rsync, the root .env. Testnet only.
set -euo pipefail

HOST="${1:?usage: deploy-droplet.sh user@host https://web-origin [domain]}"
WEB="${2:?usage: deploy-droplet.sh user@host https://web-origin [domain]}"
IP="${HOST#*@}"
DASHED="$(printf '%s' "$IP" | tr . -)"
DOMAIN="${3:-$DASHED.sslip.io}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/petto

echo "Copying the code to $HOST:$APP/src ..."
ssh "$HOST" "mkdir -p $APP/src"
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude target --exclude .git --exclude '.env*' \
  --exclude 'brain/data' --exclude '.playwright-mcp' \
  "$ROOT/" "$HOST:$APP/src/"

echo "Writing the brain env (root-only) ..."
# The root .env minus web-only and local-path values, then the server's own values (last wins).
{
  grep -vE '^(NEXT_PUBLIC_|PORT=|DB_PATH=|BACKUP_DIR=|WEB_ORIGIN=|PUBLIC_WEB_URL=)' "$ROOT/.env" | grep -E '^[A-Z_]+='
  echo "PORT=8787"
  echo "DB_PATH=/data/petto.db"
  echo "BACKUP_DIR=/data/backups"
  echo "WEB_ORIGIN=$WEB"
  echo "PUBLIC_WEB_URL=$WEB"
} | ssh "$HOST" "umask 077 && cat > $APP/brain.env"

echo "Building and starting the brain on $HOST ..."
ssh "$HOST" bash -s <<EOF
set -euo pipefail
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
cd $APP/src
docker build -q -f brain/Dockerfile -t petto-brain .
docker rm -f petto-brain >/dev/null 2>&1 || true
docker run -d --name petto-brain --restart unless-stopped \
  -p 127.0.0.1:8787:8787 -v petto_data:/data --env-file $APP/brain.env petto-brain >/dev/null
docker rm -f petto-caddy >/dev/null 2>&1 || true
docker run -d --name petto-caddy --restart unless-stopped --network host \
  -v petto_caddy:/data caddy:2 caddy reverse-proxy --from $DOMAIN --to localhost:8787 >/dev/null
EOF

echo "Waiting for https://$DOMAIN/health ..."
for _ in $(seq 1 30); do
  if curl -fsS "https://$DOMAIN/health"; then echo; echo "Brain is up: https://$DOMAIN (set NEXT_PUBLIC_BRAIN_URL to this on Vercel)"; exit 0; fi
  sleep 4
done
echo "Not answering yet; check: ssh $HOST docker logs petto-brain / docker logs petto-caddy" >&2
exit 1
