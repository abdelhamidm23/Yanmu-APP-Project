# Settings shared by build-demo.sh and start-demo.sh. Made-up data only.
export DEMO_MODE=true NEXT_TELEMETRY_DISABLED=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export MIGRATION_DATABASE_URL="postgres://yanmu:yanmu@localhost:5432/yanmu?sslmode=disable"
export APP_DB_PASSWORD="yanmu_app_demo"
export DEV_USER_PASSWORD="${DEV_USER_PASSWORD:-Yanmu-demo-2026!}"

# Setup steps of a Docker Compose codespace do not always get the codespace's own variables;
# GitHub also writes them to this file.
CODESPACE_FILE=/workspaces/.codespaces/shared/.env
codespace_value() { sed -n "s/^$1=//p" "$CODESPACE_FILE" 2>/dev/null | head -n 1 | tr -d "\"'\r"; }
CODESPACE_NAME="${CODESPACE_NAME:-$(codespace_value CODESPACE_NAME)}"
GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-$(codespace_value GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN)}"

if [ -n "$CODESPACE_NAME" ]; then
  # The address GitHub gives the app, e.g. https://<codespace>-3000.app.github.dev
  export BETTER_AUTH_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
else
  export BETTER_AUTH_URL="${BETTER_AUTH_URL:-http://localhost:3000}"
fi
if [ -n "$CODESPACE_NAME" ] || [ -d /workspaces/.codespaces ]; then
  # In a codespace, also accept sign-in from any codespace address, so a wrong guess of the
  # address above can never lock everyone out of the demo.
  # localhost:3000 covers a forwarder that reports the app's inside address as the origin.
  export TRUSTED_ORIGINS="https://*.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev},https://*.app.github.dev,http://localhost:3000"
fi

# A session secret made once per codespace and kept with it.
SECRET_FILE="$HOME/.yanmu-demo-secret"
[ -s "$SECRET_FILE" ] || head -c 32 /dev/urandom | base64 > "$SECRET_FILE"
BETTER_AUTH_SECRET="$(cat "$SECRET_FILE")"
export BETTER_AUTH_SECRET
