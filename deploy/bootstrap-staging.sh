#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  exec sudo "$0" "$@"
fi

if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl git jq logrotate
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y ca-certificates curl git jq logrotate
elif command -v yum >/dev/null 2>&1; then
  yum install -y ca-certificates curl git jq logrotate
else
  echo "Unsupported package manager" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  if grep -Eq '^ID="?alinux"?$' /etc/os-release && command -v dnf >/dev/null 2>&1; then
    dnf install -y dnf-plugins-core
    dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    curl -fsSL https://get.docker.com | sh
  fi
fi
if ! docker compose version >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get install -y docker-compose-plugin
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y docker-compose-plugin
  else
    yum install -y docker-compose-plugin
  fi
fi
systemctl enable --now docker
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
  usermod -aG docker "$SUDO_USER"
fi

if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
systemctl enable --now tailscaled

if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
fi

install -d -m 755 /opt/ola-staging/crm/backend /opt/ola-staging/nanobot
install -d -m 700 -o 1000 -g 1000 /opt/ola-staging/nanobot-state

cat >/etc/logrotate.d/ola-containers <<'EOF'
/var/lib/docker/containers/*/*.log {
  rotate 7
  daily
  compress
  size 25M
  missingok
  delaycompress
  copytruncate
}
EOF

cat >/etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "25m",
    "max-file": "3"
  }
}
EOF
systemctl restart docker

echo "Bootstrap complete. Authenticate Tailscale with: sudo tailscale up"
