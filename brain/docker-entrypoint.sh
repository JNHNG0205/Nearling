#!/bin/sh
# Runs as root only long enough to make the mounted volume writable, then drops to the `node` user.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data/backups
  chown -R node:node /data
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
