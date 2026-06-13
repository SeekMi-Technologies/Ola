#!/bin/bash
# Ola CRM — local dev launcher (local-only; never used by deploy or CI).
# Brings up: backend 8888 · MCP 8889 · nanobot serve 8900 · gateway 8901 ·
# WhatsApp bridge · frontend 3000.  Stop with: bash stop-dev.sh
set -e

CRM_DIR="$(cd "$(dirname "$0")" && pwd)"

# Sibling AI repo: prefer the renamed Ola_bot, fall back to the old nanobot path.
if [ -d "$CRM_DIR/../Ola_bot" ]; then
  NANOBOT_DIR="$CRM_DIR/../Ola_bot"
else
  NANOBOT_DIR="$CRM_DIR/../nanobot"
fi

# Host of the dedicated local-dev Atlas cluster. The DB guard whitelists this
# and refuses everything else (staging ola-dev, prod cluster0, ...).
LOCAL_DB_HOST="ola-local.dmbtqkq"

# Local-dev seed admin (admin@admin.com) in the shared ola-local cluster, used to
# pre-create its WhatsApp bridge auth dir. Re-seeding ola-local mints a new _id.
DEV_ADMIN_ID="6a2dda1adf0fb4e9881a34c9"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

log()  { echo -e "${GREEN}$*${NC}"; }
warn() { echo -e "${YELLOW}$*${NC}"; }
# fail "<headline>" ["<hint>" ...] — print in red/yellow and abort.
fail() {
  echo -e "${RED}REFUSING TO START: $1${NC}"; shift
  for line in "$@"; do echo -e "${YELLOW}$line${NC}"; done
  exit 1
}

free_ports() {
  for p in "$@"; do
    local pid; pid=$(lsof -ti:"$p" 2>/dev/null || true)
    if [ -n "$pid" ]; then warn "Freeing port $p (PID $pid)"; kill -9 $pid 2>/dev/null || true; sleep 0.5; fi
  done
}

# wait_port <port> <label> — block until bound (15s); informational, never fatal.
wait_port() {
  printf '     waiting for %s' "$2"
  for _ in $(seq 1 15); do
    if lsof -ti:"$1" >/dev/null 2>&1; then echo -e " ${GREEN}ok${NC}"; return 0; fi
    sleep 1
  done
  echo -e " ${RED}timeout${NC}"; return 0
}

# check_port <port> <label> <log-slug>
check_port() {
  if lsof -ti:"$1" >/dev/null 2>&1; then
    echo -e "  $2: ${GREEN}running${NC} (port $1)"
  else
    echo -e "  $2: ${RED}FAILED${NC} — check /tmp/ola-$3.log"
  fi
}

echo
echo "=== Ola CRM Dev Startup ==="
echo

free_ports 8888 8889 8900 8901 3000

# ── Load local config ────────────────────────────────────────────────────────
# backend/.env is the SINGLE source of local config (DB + API keys + nanobot
# secrets). The prod bundle .secrets/SERVERS.env is deploy-only and is never
# sourced here. set -a exports every var so child processes inherit it.
log "[1/5] Pre-flight: backend/.env + nanobot workspace"
[ -f "$CRM_DIR/backend/.env" ] || fail \
  "missing $CRM_DIR/backend/.env" \
  "Copy backend/.env.example → backend/.env and fill it in (see ola/SETUP.md)."
set -a
source "$CRM_DIR/backend/.env"
set +a

# ── DB isolation guard ───────────────────────────────────────────────────────
# Positive whitelist: local dev runs ONLY against $LOCAL_DB_HOST, so a stray
# staging/prod URI in backend/.env can never let local processes write a shared DB.
[ -n "${DATABASE:-}" ] || fail \
  "backend/.env does not set DATABASE." \
  "Point it at the local-dev cluster ($LOCAL_DB_HOST). See ola/SETUP.md."
case "$DATABASE" in
  *"$LOCAL_DB_HOST"*) ;;
  *) fail \
      "DATABASE is not the local-dev cluster ($LOCAL_DB_HOST)." \
      "Got host: $(printf '%s' "$DATABASE" | sed 's#.*@##; s#/.*##')" \
      "start-dev.sh runs ONLY against $LOCAL_DB_HOST — staging/prod are off-limits. Fix backend/.env." ;;
esac
[ "${OLA_ENV:-dev}" != "prod" ] || fail \
  "backend/.env has OLA_ENV=prod — start-dev.sh is local-only." \
  "Unset OLA_ENV or set it to dev."

# ── Render ~/.nanobot/config.json ────────────────────────────────────────────
# Always overwritten from the vendored template + backend/.env. Hand-edits are
# clobbered every start; change ola/nanobot.config.template.json or backend/.env.
# Runtime state (memory/, sessions/) lives alongside and is untouched.
mkdir -p "$HOME/.nanobot"
(cd "$CRM_DIR/backend" && node -e '
  const fs = require("fs"), os = require("os"), path = require("path");
  require("dotenv").config();
  const required = [
    "MCP_SERVICE_TOKEN", "DEEPSEEK_API_KEY",
    "ZOHO_OLA_EMAIL", "ZOHO_OLA_APP_PASSWORD", "ZOHO_IMAP_HOST", "ZOHO_SMTP_HOST",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error("[provision] missing in backend/.env: " + missing.join(", "));
    process.exit(1);
  }
  const tpl = fs.readFileSync(process.argv[1], "utf8");
  const rendered = tpl.replace(/\$\{(\w+)\}/g, (_, k) => process.env[k] || "");
  fs.writeFileSync(path.join(os.homedir(), ".nanobot", "config.json"), rendered, { mode: 0o600 });
' "$CRM_DIR/ola/nanobot.config.template.json")
log "     rendered ~/.nanobot/config.json (mode 600)"

# ── Sync Ola workspace prompts/skills ────────────────────────────────────────
# Canonical prompts (SOUL/AGENTS/TOOLS) + skills are always overwritten so every
# start picks up repo updates; per-user files (USER/HEARTBEAT) seed once.
mkdir -p "$HOME/.nanobot/workspace"
for f in SOUL.md AGENTS.md TOOLS.md; do
  [ -f "$CRM_DIR/ola/nanobot-workspace/$f" ] && cp "$CRM_DIR/ola/nanobot-workspace/$f" "$HOME/.nanobot/workspace/$f"
done
if [ -d "$CRM_DIR/ola/nanobot-workspace/skills" ]; then
  rm -rf "$HOME/.nanobot/workspace/skills"
  cp -R "$CRM_DIR/ola/nanobot-workspace/skills" "$HOME/.nanobot/workspace/"
fi
for f in USER.md HEARTBEAT.md; do
  if [ ! -f "$HOME/.nanobot/workspace/$f" ] && [ -f "$CRM_DIR/ola/nanobot-workspace/$f" ]; then
    cp "$CRM_DIR/ola/nanobot-workspace/$f" "$HOME/.nanobot/workspace/$f"
    log "     provisioned $f (first boot)"
  fi
done
log "     synced canonical prompts + skills → ~/.nanobot/workspace/"

# ── Backend (8888) + MCP (8889) ──────────────────────────────────────────────
log "[2/5] backend (8888) — nodemon hot reload"
cd "$CRM_DIR/backend"
npx nodemon src/server.js --ignore public/ > /tmp/ola-backend.log 2>&1 &
BACKEND_PID=$!
wait_port 8888 "backend"   # bind before MCP — both need MongoDB

log "[3/5] MCP server (8889) — nodemon hot reload"
npx nodemon --watch src/mcp src/mcp/server.js > /tmp/ola-mcp.log 2>&1 &
MCP_PID=$!
wait_port 8889 "MCP"

# macOS system proxy (Clash on 7897) 403s api.deepseek.com — bypass it so
# nanobot's Python client connects directly.
export no_proxy="api.deepseek.com,localhost,127.0.0.1,${no_proxy:-}"
export NO_PROXY="api.deepseek.com,localhost,127.0.0.1,${NO_PROXY:-}"

# ── NanoBot serve + gateway + WhatsApp bridge ────────────────────────────────
# serve (8900) = askola /v1/chat/completions; gateway (8901) = channels + cron +
# heartbeat. Mutually exclusive per process; both share ~/.nanobot config + workspace.
if [ -d "$NANOBOT_DIR" ]; then
  log "[4/5] nanobot serve (8900) + gateway (8901)"
  cd "$NANOBOT_DIR"
  python -m nanobot serve > /tmp/ola-nanobot.log 2>&1 &
  NANOBOT_PID=$!
  python -m nanobot gateway --port 8901 > /tmp/ola-nanobot-gateway.log 2>&1 &
  NANOBOT_GATEWAY_PID=$!

  # WhatsApp bridge (single shared, dev convenience). Kill orphan bridges first:
  # two bridges sharing one admin creds.json → 440 connectionReplaced reconnect loop.
  log "     WhatsApp bridge — default admin admin@admin.com"
  pkill -f "node dist/index\.js" 2>/dev/null && echo "     killed orphan bridge(s)" || true
  sleep 1

  # Wipe ALL admin WA auth every start so a clean QR scan is guaranteed regardless
  # of how the prior session ended (ctrl+c leaves stale auth dirs + portfiles).
  if [ -d "$HOME/.nanobot/wa" ] && [ -n "$(ls -A "$HOME/.nanobot/wa" 2>/dev/null)" ]; then
    rm -rf "$HOME/.nanobot/wa"/*
    echo "     wiped previous WA state"
  fi

  if [ ! -f "$NANOBOT_DIR/bridge/dist/index.js" ]; then
    printf '     building bridge (first run)...'
    (cd "$NANOBOT_DIR/bridge" && npm install --silent --no-audit --no-fund && npm run build) > /tmp/ola-wa-bridge-build.log 2>&1
    [ -f "$NANOBOT_DIR/bridge/dist/index.js" ] && echo -e " ${GREEN}ok${NC}" || echo -e " ${RED}FAILED${NC} — see /tmp/ola-wa-bridge-build.log"
  fi
  mkdir -p "$HOME/.nanobot/wa/$DEV_ADMIN_ID/auth"
  cd "$NANOBOT_DIR/bridge"
  AUTH_ROOT="$HOME/.nanobot/wa" nohup node dist/index.js > /tmp/ola-wa-bridge.log 2>&1 &
  WA_BRIDGE_PID=$!
else
  warn "[4/5] nanobot dir not found at $NANOBOT_DIR — skipping serve/gateway/bridge"
  NANOBOT_PID=""; NANOBOT_GATEWAY_PID=""; WA_BRIDGE_PID=""
fi

# ── Frontend (3000) ──────────────────────────────────────────────────────────
log "[5/5] frontend (3000) — vite"
cd "$CRM_DIR/frontend"
npx vite --port 3000 > /tmp/ola-frontend.log 2>&1 &
FRONTEND_PID=$!

sleep 5

echo
echo "=== Status ==="
check_port 8888 "Backend         " "backend"
check_port 8889 "MCP             " "mcp"
if [ -n "$NANOBOT_PID" ]; then check_port 8900 "NanoBot serve   " "nanobot"; fi
if [ -n "$NANOBOT_GATEWAY_PID" ]; then check_port 8901 "NanoBot gateway " "nanobot-gateway"; fi
if [ -n "$WA_BRIDGE_PID" ] && [ -f "$HOME/.nanobot/wa/bridge.port" ]; then
  BRIDGE_PORT=$(cat "$HOME/.nanobot/wa/bridge.port")
  if kill -0 "$WA_BRIDGE_PID" 2>/dev/null; then
    # creds.json present → Baileys auto-reconnects; missing → scan the QR from the log.
    if [ -f "$HOME/.nanobot/wa/$DEV_ADMIN_ID/auth/creds.json" ]; then
      WA_NOTE="admin@admin.com auto-reconnect (creds.json present)"
    else
      WA_NOTE="FIRST scan needed — run: tail -n 100 -f /tmp/ola-wa-bridge.log"
    fi
    echo -e "  WA bridge       : ${GREEN}running${NC} (port $BRIDGE_PORT) — $WA_NOTE"
  else
    echo -e "  WA bridge       : ${RED}FAILED${NC} — check /tmp/ola-wa-bridge.log"
  fi
fi
check_port 3000 "Frontend        " "frontend"

echo
echo "Logs: /tmp/ola-{backend,mcp,nanobot,nanobot-gateway,wa-bridge,frontend}.log"
echo "Stop: bash $CRM_DIR/stop-dev.sh"
echo

echo "$BACKEND_PID $MCP_PID $NANOBOT_PID $NANOBOT_GATEWAY_PID $WA_BRIDGE_PID $FRONTEND_PID" > /tmp/ola-dev-pids
