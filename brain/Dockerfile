# Nearling brain: Node 22 + Hono, SQLite on a volume at /data.
# Build from the repo root (pnpm workspace):
#   docker build -f brain/Dockerfile -t nearling-brain .
# Run locally:
#   docker run --rm -p 8787:8787 --env-file .env -v nearling_data:/data nearling-brain

FROM node:22-bookworm-slim AS deps
# Toolchain for better-sqlite3 in case no prebuilt binary matches (it normally downloads one).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY brain/package.json brain/
COPY packages/shared/package.json packages/shared/
COPY packages/race/package.json packages/race/
COPY packages/sprites/package.json packages/sprites/
# The brain and its workspace deps only. Dev deps stay: the brain runs TypeScript through tsx.
# The second line fails the build if the native SQLite module did not install.
RUN pnpm install --frozen-lockfile --filter "brain..." \
 && cd brain && node -e "new (require('better-sqlite3'))(':memory:').close()"

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8787 \
    DB_PATH=/data/nearling.db \
    BACKUP_DIR=/data/backups
WORKDIR /app
COPY --from=deps /app /app
COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/race/src packages/race/src
COPY packages/race/tsconfig.json packages/race/
COPY brain/src brain/src
COPY brain/tsconfig.json brain/
COPY brain/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /data/backups && chown -R node:node /data
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
WORKDIR /app/brain
# The entrypoint makes /data writable (a fresh Fly volume is owned by root), then drops to `node`.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--import", "tsx", "src/server.ts"]
