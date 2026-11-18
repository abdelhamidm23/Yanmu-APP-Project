# Settings shared by build-demo.sh and start-demo.sh. Made-up data only.
export DEMO_MODE=true NEXT_TELEMETRY_DISABLED=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export MIGRATION_DATABASE_URL="postgres://yanmu:yanmu@localhost:5432/yanmu?sslmode=disable"
export APP_DB_PASSWORD="yanmu_app_demo"
export DEV_USER_PASSWORD="${DEV_USER_PASSWORD:-Yanmu-demo-2026!}"
# The address GitHub gives the app, e.g. https://<codespace>-3000.app.github.dev
if [ -n "${CODESPACE_NAME:-}" ]; then
  export BETTER_AUTH_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
else
  export BETTER_AUTH_URL="${BETTER_AUTH_URL:-http://localhost:3000}"
fi
# A session secret made once per codespace and kept with it.
SECRET_FILE="$HOME/.yanmu-demo-secret"
[ -s "$SECRET_FILE" ] || head -c 32 /dev/urandom | base64 > "$SECRET_FILE"
BETTER_AUTH_SECRET="$(cat "$SECRET_FILE")"
export BETTER_AUTH_SECRET
