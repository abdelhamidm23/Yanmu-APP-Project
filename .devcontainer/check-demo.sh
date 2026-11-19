#!/usr/bin/env bash
# Prints what the demo is doing, for a screenshot when something goes wrong:
#   bash .devcontainer/check-demo.sh
cd "$(dirname "$0")/.."
. .devcontainer/demo-env.sh
echo "------------------------------------------------------------"
echo "Code version : $(git log -1 --format='%h %s' 2>/dev/null)"
echo "Built version: $(cut -c1-7 .next/demo-commit 2>/dev/null || echo unknown)"
echo "Codespace    : ${CODESPACE_NAME:-not found}"
echo "App address  : $BETTER_AUTH_URL"
echo "Also allowed : ${TRUSTED_ORIGINS:-none}"
echo "Database     : $(node -e "require('net').connect(5432,'localhost').on('connect',()=>{console.log('answering');process.exit(0)}).on('error',()=>{console.log('NOT answering');process.exit(0)})")"
# The process that actually answers on port 3000.
pid=$(port_3000_pids | head -n 1)
if [ -n "$pid" ]; then
  running_url=$( { cat "/proc/$pid/environ" 2>/dev/null || sudo -n cat "/proc/$pid/environ" 2>/dev/null; } | tr '\0' '\n' | sed -n 's/^BETTER_AUTH_URL=//p')
  echo "Running app  : user $(ps -o user= -p "$pid"), started $(ps -o etime= -p "$pid" | xargs) ago, address ${running_url:-unknown}"
else
  echo "Running app  : none found"
fi
echo "App          : $(curl -s -m 5 http://localhost:3000/api/health || echo 'NOT answering')"
# The same sign-in the browser makes, with the browser's address as its origin.
for origin in "$BETTER_AUTH_URL"; do
  code=$(curl -s -m 20 -o /tmp/demo-signin.json -w '%{http_code}' -X POST http://localhost:3000/api/auth/sign-in/email \
    -H "Content-Type: application/json" -H "Origin: $origin" -H "Cookie: demo-check=1" \
    --data "{\"email\":\"owner@yanmu.test\",\"password\":\"$DEV_USER_PASSWORD\"}")
  reason=$(node -e "try{const j=JSON.parse(require('fs').readFileSync('/tmp/demo-signin.json','utf8'));console.log(j.code||j.message||(j.user?'signed in':''))}catch{console.log('')}")
  echo "Test sign-in : HTTP $code $reason"
done
rm -f /tmp/demo-signin.json
if [ -n "${CODESPACE_NAME:-}" ] && command -v gh >/dev/null; then
  echo "Port 3000    : $(gh codespace ports -c "$CODESPACE_NAME" --json sourcePort,visibility -q '.[] | select(.sourcePort==3000) | .visibility' 2>/dev/null || echo unknown)"
fi
echo "Last errors in the app's log:"
grep -iE "error|invalid|refus|fail" /tmp/nursery-demo.log 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | tail -n 6 | cut -c1-200
echo "------------------------------------------------------------"
