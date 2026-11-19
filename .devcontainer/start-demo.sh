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

# Stop an earlier copy of the app, if one is still running. It may belong to another user of the
# codespace (setup steps can run as root), so fall back to sudo.
APP_PATTERN="scripts/preview-start.mjs|next start|next-server|next/dist/bin/next"
app_answers() { curl -fs -o /dev/null -m 3 http://localhost:3000/api/health; }
stop_app() {
  for signal in TERM TERM KILL; do
    pids="$(pgrep -f "$APP_PATTERN") $(port_3000_pids)"
    pids="$(echo $pids)"
    if [ -n "$pids" ]; then kill -s "$signal" $pids 2>/dev/null || sudo -n kill -s "$signal" $pids 2>/dev/null; fi
    for _ in $(seq 1 10); do app_answers || return 0; sleep 1; done
  done
  return 1
}
if ! stop_app; then
  echo "An older copy of the app is still running and could not be stopped."
  echo "Please stop the codespace (github.com/codespaces, ... menu, Stop codespace) and open it again."
  exit 1
fi

# After `git pull`, build the new version first (2 to 4 minutes).
if [ "$(git rev-parse HEAD)" != "$(cat .next/demo-commit 2>/dev/null)" ]; then
  echo "Building the latest version of the app (2 to 4 minutes) ..."
  pnpm install --frozen-lockfile && pnpm build && git rev-parse HEAD > .next/demo-commit
fi

for _ in $(seq 1 60); do
  node -e "require('net').connect(5432,'localhost').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" && break
  sleep 1
done

echo "Starting the demo at $BETTER_AUTH_URL ..."
# Start in the background, detached, so it outlives this setup step.
setsid nohup node scripts/preview-start.mjs > "$LOG" 2>&1 < /dev/null &

# Wait (up to 4 minutes) until the app answers, so the browser opens on a working page.
# The new copy needs a moment to appear in the process list; give up only once it has been gone
# for 5 seconds in a row.
missing=0
for _ in $(seq 1 240); do
  if pgrep -f "node scripts/preview-start.mjs" >/dev/null; then missing=0; else missing=$((missing + 1)); fi
  if [ "$missing" -ge 5 ]; then break; fi
  if app_answers; then
    # Lets the address open on a phone without signing in to GitHub there. If GitHub refuses,
    # the address still works on any device signed in to GitHub.
    if [ -n "${CODESPACE_NAME:-}" ]; then gh codespace ports visibility 3000:public -c "$CODESPACE_NAME" >/dev/null 2>&1 || true; fi
    echo "The demo is running: $BETTER_AUTH_URL"
    bash .devcontainer/check-demo.sh
    exit 0
  fi
  sleep 1
done
echo "The demo did not start. The last lines of $LOG:"
tail -n 40 "$LOG"
exit 1
