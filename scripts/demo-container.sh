#!/bin/sh
# Start command for the all-in-one demo container (deploy/huggingface/Dockerfile).
# Runs a throwaway Postgres inside the container: the demo starts empty every time,
# then preview-start.mjs adds the base data and the demo accounts. Made-up data only.
set -e
export PGDATA=/tmp/pgdata
rm -rf "$PGDATA"
initdb -U yanmu --auth=trust -D "$PGDATA" >/dev/null
pg_ctl -D "$PGDATA" -o "-c listen_addresses=127.0.0.1 -k /tmp" -l /tmp/postgres.log -w start >/dev/null
createdb -h 127.0.0.1 -U yanmu yanmu

export MIGRATION_DATABASE_URL="postgres://yanmu@127.0.0.1:5432/yanmu?sslmode=disable"
export APP_DB_PASSWORD="${APP_DB_PASSWORD:-$(head -c 24 /dev/urandom | base64 | tr -d '/+=')}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-$(head -c 32 /dev/urandom | base64)}"
export DEV_USER_PASSWORD="${DEV_USER_PASSWORD:-Yanmu-demo-2026!}"
# Hugging Face tells the container its public address in SPACE_HOST.
if [ -n "$SPACE_HOST" ]; then export BETTER_AUTH_URL="https://$SPACE_HOST"; fi
exec node scripts/preview-start.mjs
