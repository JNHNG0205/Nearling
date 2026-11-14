#!/usr/bin/env bash
# Deploys the brain to a Linux server you can SSH into (e.g. a DigitalOcean droplet):
# Docker container with a volume for SQLite, Caddy in front for HTTPS (WebSockets included).
#   ./scripts/deploy-droplet.sh root@203.0.113.7 https://petto.vercel.app [domain]
# domain defaults to <ip-with-dashes>.sslip.io, which needs no DNS setup.
# KEEP_ENV=1 keeps the brain env already on the server (CI: no app secrets in GitHub); the
# web-origin argument is then unused, pass "-".
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

if [ "${KEEP_ENV:-0}" = 1 ]; then
  echo "Keeping the brain env already on the server."
  ssh "$HOST" "test -s $APP/brain.env" || { echo "No $APP/brain.env on the server; deploy once without KEEP_ENV." >&2; exit 1; }
else
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
fi

echo "Building and starting the brain on $HOST ..."
ssh "$HOST" bash -s <<EOF
set -euo pipefail
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
cd $APP/src
docker build -q -f brain/Dockerfile -t petto-brain .
docker rm -f petto-brain >/dev/null 2>&1 || true
docker run -d --name petto-brain --restart unless-stopped \
  -p 127.0.0.1:8787:8787 -v petto_data:/data --env-file $APP/brain.env petto-brain >/dev/null
# Caddy only when it is not already serving this domain, so a redeploy keeps HTTPS up
if [ "\$(docker inspect -f '{{.State.Running}} {{join .Args " "}}' petto-caddy 2>/dev/null)" != "true reverse-proxy --from $DOMAIN --to localhost:8787" ]; then
  docker rm -f petto-caddy >/dev/null 2>&1 || true
  docker run -d --name petto-caddy --restart unless-stopped --network host \
    -v petto_caddy:/data caddy:2 caddy reverse-proxy --from $DOMAIN --to localhost:8787 >/dev/null
fi
docker image prune -f >/dev/null
EOF

echo "Waiting for https://$DOMAIN/health ..."
for _ in $(seq 1 30); do
  if curl -fsS "https://$DOMAIN/health"; then echo; echo "Brain is up: https://$DOMAIN (set NEXT_PUBLIC_BRAIN_URL to this on Vercel)"; exit 0; fi
  sleep 4
done
echo "Not answering yet; check: ssh $HOST docker logs petto-brain / docker logs petto-caddy" >&2
exit 1
