#!/bin/bash
# Ola CRM — paraformer dev startup (wraps start-dev.sh)
# Starts cloudflared quick tunnel → writes BACKEND_PUBLIC_BASE_URL into
# backend/.env → calls start-dev.sh. Required when admin.transcribeProvider
# is paraformer locally, because DashScope must fetch the audio file over a
# publicly-reachable URL and a Mac behind NAT cannot serve directly.
#
# State files (read by stop-dev.sh for symmetric cleanup):
#   /tmp/ola-cloudflared.pid       — tunnel process PID
#   /tmp/ola-cloudflared.url       — the trycloudflare URL written to .env
#
# Usage: bash start-dev-paraformer.sh
# Stop : bash stop-dev.sh           # handles both this + plain start-dev.sh

set -e

CRM_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$CRM_DIR/backend/.env"
CF_LOG=/tmp/ola-cloudflared.log
CF_PID_FILE=/tmp/ola-cloudflared.pid
CF_URL_FILE=/tmp/ola-cloudflared.url

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "=== Ola CRM Dev (Paraformer mode) ==="
echo ""

# Pre-flight
if ! command -v cloudflared >/dev/null 2>&1; then
  echo -e "${RED}cloudflared not found.${NC} Install once: brew install cloudflared"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo -e "${RED}Missing $ENV_FILE${NC} — see backend/.env.example"
  exit 1
fi

if ! grep -q '^DASHSCOPE_API_KEY=' "$ENV_FILE"; then
  echo -e "${YELLOW}WARN: $ENV_FILE has no DASHSCOPE_API_KEY — paraformer path will fail at runtime.${NC}"
  echo -e "${YELLOW}      Add DASHSCOPE_API_KEY=sk-... to backend/.env (see ola/PARAFORMER_LOCAL_DEV.md).${NC}"
fi

# Kill any stale tunnel from a previous run (don't accumulate processes)
if [ -f "$CF_PID_FILE" ]; then
  OLD_PID=$(cat "$CF_PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo -e "${YELLOW}Killing stale cloudflared (PID $OLD_PID) from previous run${NC}"
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$CF_PID_FILE"
fi

# 1. Start cloudflared quick tunnel pointing at backend (8888)
echo -e "${GREEN}[1/3] Starting cloudflared quick tunnel → http://localhost:8888 ...${NC}"
: > "$CF_LOG"
cloudflared tunnel --url http://localhost:8888 --no-autoupdate >"$CF_LOG" 2>&1 &
CF_PID=$!
echo "$CF_PID" > "$CF_PID_FILE"

# 2. Wait for trycloudflare URL (timeout 30s)
echo -n "     Waiting for tunnel URL..."
TUNNEL_URL=""
for i in $(seq 1 30); do
  TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$CF_LOG" 2>/dev/null | head -1)
  if [ -n "$TUNNEL_URL" ]; then
    echo -e " ${GREEN}ok${NC} (${i}s)"
    echo "$TUNNEL_URL" > "$CF_URL_FILE"
    break
  fi
  sleep 1
done

if [ -z "$TUNNEL_URL" ]; then
  echo -e " ${RED}timeout${NC}"
  echo "     cloudflared log tail:"
  tail -10 "$CF_LOG" | sed 's/^/       /'
  kill "$CF_PID" 2>/dev/null || true
  rm -f "$CF_PID_FILE"
  exit 1
fi
echo "     → $TUNNEL_URL"

# 3. Inject BACKEND_PUBLIC_BASE_URL into backend/.env
#    Always purge any pre-existing line first (idempotent). Ensure file ends
#    with a newline before append, otherwise our new line gets concatenated
#    to whatever last line lacks the trailing '\n' (real bug from first run).
#    BSD sed (macOS) needs the empty '' after -i.
sed -i '' '/^BACKEND_PUBLIC_BASE_URL=/d' "$ENV_FILE"
[ -n "$(tail -c1 "$ENV_FILE")" ] && echo "" >> "$ENV_FILE"
echo "BACKEND_PUBLIC_BASE_URL=$TUNNEL_URL" >> "$ENV_FILE"
echo -e "${GREEN}[2/3] Wrote BACKEND_PUBLIC_BASE_URL → $ENV_FILE${NC}"

# 4. Hand off to start-dev.sh — it sources backend/.env so the tunnel URL
#    is picked up by backend env when nodemon spawns.
echo -e "${GREEN}[3/3] Handing off to start-dev.sh ...${NC}"
echo ""
exec bash "$CRM_DIR/start-dev.sh"
