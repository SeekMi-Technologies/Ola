#!/bin/bash
# Ola CRM — one-shot dev startup
# Starts: backend (8888), MCP server (8889), NanoBot (8900), frontend (3000)
# Usage: bash start-dev.sh

set -e

CRM_DIR="$(cd "$(dirname "$0")" && pwd)"
# Repo was renamed nanobot → Ola_bot on GitHub. Prefer the new name; fall
# back to the old one so machines cloned before the rename still work.
if [ -d "$CRM_DIR/../Ola_bot" ]; then
  NANOBOT_DIR="$CRM_DIR/../Ola_bot"
else
  NANOBOT_DIR="$CRM_DIR/../nanobot"
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "=== Ola CRM Dev Startup ==="
echo ""

# Kill any existing processes on our ports
# 8901 (nanobot gateway) included after Plan B v3 phase G — old gateway
# instances from previous start-dev.sh runs held 8901, causing new gateway
# spawn to crash with EADDRINUSE while serve/backend silently restarted.
for PORT in 8888 8889 8900 8901 3000; do
  PID=$(lsof -ti:$PORT 2>/dev/null || true)
  if [ -n "$PID" ]; then
    echo -e "${YELLOW}Killing existing process on port $PORT (PID: $PID)${NC}"
    kill -9 $PID 2>/dev/null || true
    sleep 0.5
  fi
done

# 0. Pre-flight — verify backend/.env, provision ~/.nanobot/ on first boot
echo -e "${GREEN}[1/5] Pre-flight: checking backend/.env and nanobot workspace...${NC}"

if [ ! -f "$CRM_DIR/backend/.env" ]; then
  echo -e "${RED}     Missing $CRM_DIR/backend/.env${NC}"
  echo -e "${YELLOW}     Copy backend/.env.example to backend/.env and fill in required values (see ola/SETUP.md).${NC}"
  exit 1
fi

# Export secrets to shell so all child processes (backend, MCP, nanobot serve,
# nanobot gateway, frontend) inherit them via 12-factor process env. Mirrors
# prod systemd EnvironmentFile= / docker-compose env_file: pattern.
set -a
source "$CRM_DIR/backend/.env"
if [ -f "$CRM_DIR/.secrets/SERVERS.env" ]; then
  source "$CRM_DIR/.secrets/SERVERS.env"
fi
set +a

# #266 Item 3 — fail-fast if backend/.env declares OLA_ENV=prod. Local dev
# must never point at the production Atlas cluster: cross-env writes pollute
# the shared DB with host-specific paths and other dev artifacts (see #266
# Bug 3+4 for the original incident). Prod boxes set OLA_ENV=prod in their
# .env; local dev leaves it unset OR sets =dev.
if [ "${OLA_ENV:-dev}" = "prod" ]; then
  echo -e "${RED}REFUSING TO START: backend/.env has OLA_ENV=prod.${NC}"
  echo -e "${YELLOW}start-dev.sh is for local development only. Set OLA_ENV=dev (or unset it)${NC}"
  echo -e "${YELLOW}in backend/.env before running this script. See #266 for context.${NC}"
  exit 1
fi

# Always-overwrite render of ~/.nanobot/config.json. Single source of truth
# is the vendored template + secrets; manual edits to ~/.nanobot/config.json
# WILL be clobbered on next start (matches the SOUL/AGENTS/TOOLS pattern
# below). Edit ola/nanobot.config.template.json or .secrets/SERVERS.env
# instead. Runtime state (memory/, sessions/) lives in sibling files and is
# untouched.
mkdir -p "$HOME/.nanobot"
(cd "$CRM_DIR/backend" && node -e '
  const path = require("path");
  require("dotenv").config();
  require("dotenv").config({ path: path.join(process.argv[2], ".secrets/SERVERS.env") });
  const fs = require("fs"), os = require("os");
  const required = [
    "MCP_SERVICE_TOKEN", "GEMINI_API_KEY",
    "ZOHO_OLA_EMAIL", "ZOHO_OLA_APP_PASSWORD",
    "ZOHO_IMAP_HOST", "ZOHO_SMTP_HOST",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error("[provision] Missing env vars: " + missing.join(", ") + " — check backend/.env and .secrets/SERVERS.env");
    process.exit(1);
  }
  const tpl = fs.readFileSync(process.argv[1], "utf8");
  const rendered = tpl.replace(/\$\{(\w+)\}/g, (_, k) => process.env[k] || "");
  const dest = path.join(os.homedir(), ".nanobot", "config.json");
  fs.writeFileSync(dest, rendered, { mode: 0o600 });
' "$CRM_DIR/ola/nanobot.config.template.json" "$CRM_DIR")
echo -e "     ${GREEN}Rendered ~/.nanobot/config.json (mode 600, always-overwrite)${NC}"

# Sync Ola workspace prompts into ~/.nanobot/workspace/.
# Two categories with different sync rules:
#   - Canonical system prompts (SOUL/AGENTS/TOOLS) — we own them, ALWAYS
#     overwrite so every operator picks up prompt updates on next start.
#     Any local edit to ~/.nanobot/workspace/SOUL.md will be clobbered;
#     edit ola/nanobot-workspace/SOUL.md in the repo instead.
#   - Per-user files (USER/HEARTBEAT) — first-boot only, never clobber.
mkdir -p "$HOME/.nanobot/workspace"
for f in SOUL.md AGENTS.md TOOLS.md; do
  if [ -f "$CRM_DIR/ola/nanobot-workspace/$f" ]; then
    cp "$CRM_DIR/ola/nanobot-workspace/$f" "$HOME/.nanobot/workspace/$f"
  fi
done
# Sync workspace skills (always-overwrite for canonical Ola skills)
if [ -d "$CRM_DIR/ola/nanobot-workspace/skills" ]; then
  rm -rf "$HOME/.nanobot/workspace/skills"
  cp -R "$CRM_DIR/ola/nanobot-workspace/skills" "$HOME/.nanobot/workspace/"
  echo -e "     ${GREEN}Synced canonical skills/ → ~/.nanobot/workspace/skills/${NC}"
fi
echo -e "     ${GREEN}Synced canonical prompts (SOUL/AGENTS/TOOLS) → ~/.nanobot/workspace/${NC}"
for f in USER.md HEARTBEAT.md; do
  if [ ! -f "$HOME/.nanobot/workspace/$f" ] && [ -f "$CRM_DIR/ola/nanobot-workspace/$f" ]; then
    cp "$CRM_DIR/ola/nanobot-workspace/$f" "$HOME/.nanobot/workspace/$f"
    echo -e "     ${GREEN}Provisioned $f (first boot)${NC}"
  fi
done

# 1. Backend
echo -e "${GREEN}[2/5] Starting backend (port 8888) with nodemon hot reload...${NC}"
cd "$CRM_DIR/backend"
npx nodemon src/server.js --ignore public/ > /tmp/ola-backend.log 2>&1 &
BACKEND_PID=$!

# Wait for backend to bind port before starting MCP (both need MongoDB)
echo -n "     Waiting for backend..."
for i in $(seq 1 15); do
  if lsof -ti:8888 >/dev/null 2>&1; then
    echo -e " ${GREEN}ok${NC}"
    break
  fi
  sleep 1
  if [ $i -eq 15 ]; then
    echo -e " ${RED}timeout${NC}"
  fi
done

# 2. MCP Server
echo -e "${GREEN}[3/5] Starting MCP server (port 8889) with nodemon hot reload...${NC}"
cd "$CRM_DIR/backend"
npx nodemon --watch src/mcp src/mcp/server.js > /tmp/ola-mcp.log 2>&1 &
MCP_PID=$!

# Wait for MCP to bind port before later check_port falsely flags FAILED
echo -n "     Waiting for MCP..."
for i in $(seq 1 15); do
  if lsof -ti:8889 >/dev/null 2>&1; then
    echo -e " ${GREEN}ok${NC}"
    break
  fi
  sleep 1
  if [ $i -eq 15 ]; then
    echo -e " ${RED}timeout${NC}"
  fi
done

# 3. NanoBot — two processes:
#   serve   (8900) — OpenAI-compat /v1/chat/completions for askola web
#   gateway (8901) — ChannelManager (email/etc) + cron + heartbeat
# These are mutually exclusive in a single process; channels never start
# under serve mode. Both share the same ~/.nanobot/config.json + workspace.
if [ -d "$NANOBOT_DIR" ]; then
  echo -e "${GREEN}[4a/5] Starting NanoBot serve (port 8900) — askola chat completions...${NC}"
  cd "$NANOBOT_DIR"
  python -m nanobot serve > /tmp/ola-nanobot.log 2>&1 &
  NANOBOT_PID=$!

  echo -e "${GREEN}[4b/5] Starting NanoBot gateway (port 8901) — channels (email/etc)...${NC}"
  python -m nanobot gateway --port 8901 > /tmp/ola-nanobot-gateway.log 2>&1 &
  NANOBOT_GATEWAY_PID=$!
else
  echo -e "${YELLOW}[4/5] NanoBot directory not found at $NANOBOT_DIR, skipping${NC}"
  NANOBOT_PID=""
  NANOBOT_GATEWAY_PID=""
fi

# 4. Frontend
echo -e "${GREEN}[5/5] Starting frontend (port 3000)...${NC}"
cd "$CRM_DIR/frontend"
npx vite --port 3000 > /tmp/ola-frontend.log 2>&1 &
FRONTEND_PID=$!

# Wait for remaining services to come up
sleep 5

echo ""
echo "=== Status ==="

check_port() {
  if lsof -ti:$1 >/dev/null 2>&1; then
    echo -e "  $2: ${GREEN}running${NC} (port $1)"
  else
    echo -e "  $2: ${RED}FAILED${NC} — check /tmp/ola-$3.log"
  fi
}

check_port 8888 "Backend         " "backend"
check_port 8889 "MCP             " "mcp"
if [ -n "$NANOBOT_PID" ]; then
  check_port 8900 "NanoBot serve   " "nanobot"
fi
if [ -n "$NANOBOT_GATEWAY_PID" ]; then
  check_port 8901 "NanoBot gateway " "nanobot-gateway"
fi
check_port 3000 "Frontend        " "frontend"

echo ""
echo "Logs: /tmp/ola-{backend,mcp,nanobot,frontend}.log"
echo "Stop all: bash $CRM_DIR/stop-dev.sh"
echo ""

# Save PIDs for stop script
echo "$BACKEND_PID $MCP_PID $NANOBOT_PID $FRONTEND_PID" > /tmp/ola-dev-pids
