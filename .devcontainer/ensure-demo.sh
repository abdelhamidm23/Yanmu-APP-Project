#!/usr/bin/env bash
# Runs each time the codespace window opens or reloads: starts the demo only if it is not answering.
cd "$(dirname "$0")/.."
if curl -fs -o /dev/null http://localhost:3000/api/health; then
  echo "The demo is running."
else
  bash .devcontainer/start-demo.sh
fi
