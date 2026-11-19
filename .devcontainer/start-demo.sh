#!/usr/bin/env bash
# Starts (or restarts) the demo. Runs every time the codespace starts; can also be run by hand:
#   bash .devcontainer/start-demo.sh
# Waits for the database, then hands over to scripts/preview-start.mjs (migrations, base data,
# demo accounts reset, demo data for today, then the app on port 3000). The app keeps running
# after this script returns.
set -uo pipefail
cd "$(dirname "$0")/.."
. .devcontainer/demo-env.sh
LOG=/tmp/nursery-demo.log

# Stop an earlier copy of the app, if one is still running.
pkill -f "scripts/preview-start.mjs" 2>/dev/null
pkill -f "next start" 2>/dev/null
pkill -f "next-server" 2>/dev/null
for _ in $(seq 1 20); do curl -fs -o /dev/null http://localhost:3000/api/health || break; sleep 1; done

for _ in $(seq 1 60); do
  node -e "require('net').connect(5432,'localhost').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" && break
  sleep 1
done

echo "Starting the demo at $BETTER_AUTH_URL ..."
# Start in the background, detached, so it outlives this setup step.
setsid nohup node scripts/preview-start.mjs > "$LOG" 2>&1 < /dev/null &

# Wait (up to 4 minutes) until the app answers, so the browser opens on a working page.
for _ in $(seq 1 240); do
  if curl -fs -o /dev/null http://localhost:3000/api/health; then
    # Lets the address open on a phone without signing in to GitHub there. If GitHub refuses,
    # the address still works on any device signed in to GitHub.
    if [ -n "${CODESPACE_NAME:-}" ]; then gh codespace ports visibility 3000:public -c "$CODESPACE_NAME" >/dev/null 2>&1 || true; fi
    echo "The demo is running: $BETTER_AUTH_URL"
    exit 0
  fi
  sleep 1
done
echo "The demo did not start. Details are in $LOG:"
tail -n 40 "$LOG"
