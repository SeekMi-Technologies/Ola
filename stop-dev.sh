#!/bin/bash
# Ola CRM — stop all dev services (handles both start-dev.sh and
# start-dev-paraformer.sh; paraformer extras are no-ops when not active).

CRM_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$CRM_DIR/backend/.env"
CF_PID_FILE=/tmp/ola-cloudflared.pid
CF_URL_FILE=/tmp/ola-cloudflared.url

echo "Stopping Ola dev services..."

# Kill nodemon parents first; otherwise they respawn the node child immediately
# after we kill it by port and stop-dev.sh appears to do nothing.
pkill -f "nodemon.*src/server\.js" 2>/dev/null && echo "  Killed nodemon (backend)" || true
pkill -f "nodemon.*src/mcp/server\.js" 2>/dev/null && echo "  Killed nodemon (mcp)" || true

# WhatsApp bridge uses OS-assigned port (listen(0)) — kill by process pattern.
# Clean shared + per-admin portfiles so next start-dev fresh discovers new port.
# Stale per-admin port files (left over from earlier multi-bridge mode) would
# otherwise mislead nanobot to connect to a port from a now-dead bridge.
pkill -f "node dist/index\.js" 2>/dev/null && echo "  Killed WhatsApp bridge" || true
rm -f "$HOME/.nanobot/wa/bridge.port"
rm -f "$HOME/.nanobot/wa"/*/port 2>/dev/null || true

# Wipe default dev admin (admin@admin.com) WA auth state — every restart starts
# fresh, requires re-scan. Avoids stale linked-device records on operator phone
# + reduces multi-dev device conflict risk ("顶号" semantics).
# Other admin dirs (if any) preserved so dev setups with multiple test admins
# aren't all nuked.
if [ -d "$HOME/.nanobot/wa/699245d5c692e668ea7ab155/auth" ]; then
  rm -rf "$HOME/.nanobot/wa/699245d5c692e668ea7ab155/auth"
  echo "  Wiped admin@admin.com WA auth (next start-dev = fresh QR scan)"
fi

for PORT in 8888 8889 8900 8901 3000; do
  PID=$(lsof -ti:$PORT 2>/dev/null || true)
  if [ -n "$PID" ]; then
    kill -9 $PID 2>/dev/null || true
    echo "  Killed process on port $PORT"
  fi
done

# Paraformer dev cleanup — only fires if start-dev-paraformer.sh was used.
if [ -f "$CF_PID_FILE" ]; then
  CF_PID=$(cat "$CF_PID_FILE")
  if kill -0 "$CF_PID" 2>/dev/null; then
    kill "$CF_PID" 2>/dev/null || true
    echo "  Killed cloudflared (PID $CF_PID)"
  fi
  rm -f "$CF_PID_FILE" "$CF_URL_FILE"
fi
if [ -f "$ENV_FILE" ] && grep -q '^BACKEND_PUBLIC_BASE_URL=' "$ENV_FILE"; then
  sed -i '' '/^BACKEND_PUBLIC_BASE_URL=/d' "$ENV_FILE"
  echo "  Removed BACKEND_PUBLIC_BASE_URL from backend/.env"
fi

rm -f /tmp/ola-dev-pids
echo "Done."
