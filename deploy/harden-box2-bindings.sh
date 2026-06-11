#!/usr/bin/env bash
set -euo pipefail

TAILSCALE_IP="${1:?usage: harden-box2-bindings.sh <tailscale-ip>}"
CONFIG=/root/.nanobot/config.json
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="/root/ola-backups/$STAMP-bindings"

if ! [[ "$TAILSCALE_IP" =~ ^100\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
  echo "Refusing non-Tailscale address" >&2
  exit 1
fi

install -d -m 700 "$BACKUP"
cp -a "$CONFIG" "$BACKUP/config.json"
cp -a /etc/systemd/system/nanobot.service "$BACKUP/"
cp -a /etc/systemd/system/nanobot-bridge.service "$BACKUP/"

rollback() {
  cp -a "$BACKUP/config.json" "$CONFIG"
  rm -rf /etc/systemd/system/nanobot.service.d /etc/systemd/system/nanobot-bridge.service.d
  systemctl daemon-reload
  systemctl restart nanobot.service nanobot-gateway.service nanobot-bridge.service
}
trap rollback ERR

install -d /etc/systemd/system/nanobot.service.d /etc/systemd/system/nanobot-bridge.service.d
printf '[Service]\nExecStart=\nExecStart=/usr/bin/python3.11 -m nanobot serve --host %s --port 8900\n' \
  "$TAILSCALE_IP" > /etc/systemd/system/nanobot.service.d/bind-tailscale.conf
printf '[Service]\nEnvironment=BRIDGE_BIND_HOST=%s\n' \
  "$TAILSCALE_IP" > /etc/systemd/system/nanobot-bridge.service.d/bind-tailscale.conf

python3.11 - "$CONFIG" "$TAILSCALE_IP" <<'PY'
import json
import os
import sys
from pathlib import Path

path = Path(sys.argv[1])
data = json.loads(path.read_text())
data.setdefault("gateway", {})["host"] = sys.argv[2]
temp = path.with_suffix(".tmp")
temp.write_text(json.dumps(data, indent=2) + "\n")
os.chmod(temp, 0o600)
os.replace(temp, path)
PY

systemctl daemon-reload
systemctl restart nanobot.service nanobot-gateway.service nanobot-bridge.service

for port in 8900 8901; do
  for attempt in {1..30}; do
    if curl --fail --silent --max-time 2 "http://$TAILSCALE_IP:$port/health" >/dev/null; then
      break
    fi
    sleep 2
  done
  curl --fail --silent --show-error --max-time 5 "http://$TAILSCALE_IP:$port/health" >/dev/null
done
for attempt in {1..30}; do
  bridge_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 \
    "http://$TAILSCALE_IP:3001/wa/000000000000000000000000/status" || true)"
  [ "$bridge_status" = 401 ] && break
  sleep 2
done
test "$bridge_status" = 401

if ss -lnt | grep -Eq "0\.0\.0\.0:(8900|8901|3001)"; then
  echo "A protected service is still publicly bound" >&2
  exit 1
fi

trap - ERR
echo "Box 2 services are bound to $TAILSCALE_IP"
