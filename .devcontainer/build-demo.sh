#!/usr/bin/env bash
# Runs once when the demo codespace is created: installs and builds the app.
set -euo pipefail
cd "$(dirname "$0")/.."
. .devcontainer/demo-env.sh
sudo corepack enable pnpm
pnpm install --frozen-lockfile
pnpm build
