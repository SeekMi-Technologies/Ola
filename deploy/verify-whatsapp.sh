#!/usr/bin/env bash
set -euo pipefail

state_dir=${1:?usage: verify-whatsapp.sh STATE_DIR BRIDGE_URL}
bridge_url=${2:?usage: verify-whatsapp.sh STATE_DIR BRIDGE_URL}
config="$state_dir/config.json"

if ! jq -e '.channels.whatsapp.enabled == true' "$config" >/dev/null; then
  echo "WhatsApp verification failed: channels.whatsapp.enabled is not true" >&2
  exit 1
fi

mapfile -t admin_ids < <(
  while IFS= read -r auth_dir; do
    if find "$auth_dir" -type f -print -quit | grep -q .; then
      basename "$(dirname "$auth_dir")"
    fi
  done < <(find "$state_dir/wa" -mindepth 2 -maxdepth 2 -type d -name auth) |
    grep -E '^[a-f0-9]{24}$' |
    sort -u
)

if [ "${#admin_ids[@]}" -eq 0 ]; then
  echo "WhatsApp verification failed: no persisted admin auth directories" >&2
  exit 1
fi

for admin_id in "${admin_ids[@]}"; do
  token=$(
    printf '%s' "$admin_id" |
      openssl dgst -sha256 -hmac "${MCP_SERVICE_TOKEN:?MCP_SERVICE_TOKEN is required}" -hex |
      awk '{print $2}'
  )
  # The bridge needs time after container start to re-handshake with WhatsApp
  # servers before it reports connected. Poll for up to ~2.5 minutes.
  bridge_status=missing
  for attempt in $(seq 1 30); do
    status=$(
      curl --silent --max-time 10 \
        -H "Authorization: Bearer $token" \
        "$bridge_url/wa/$admin_id/status" 2>/dev/null || true
    )
    bridge_status=$(jq -r '.status // "missing"' <<<"$status" 2>/dev/null || true)
    bridge_status=${bridge_status:-missing}
    [ "$bridge_status" = connected ] && break
    echo "Bridge not ready for $admin_id (attempt $attempt/30, status: $bridge_status)" >&2
    sleep 5
  done
  if [ "$bridge_status" != connected ]; then
    echo "WhatsApp verification failed: bridge status is $bridge_status after 30 attempts" >&2
    exit 1
  fi

  # The gateway's WS re-subscription to the bridge can lag the bridge status
  # flip; poll the live subscriber count the bridge reports. (Previously this
  # grepped the gateway container logs for a "Connected" line, which only
  # exists if the gateway restarted recently — deploys that leave the nanobot
  # containers untouched failed spuriously once the line aged out of the
  # docker-logs window.)
  gateway_clients=0
  for attempt in $(seq 1 6); do
    status=$(
      curl --silent --max-time 10 \
        -H "Authorization: Bearer $token" \
        "$bridge_url/wa/$admin_id/status" 2>/dev/null || true
    )
    gateway_clients=$(
      jq -r 'if has("gatewayClients") then (.gatewayClients | tostring) else "absent" end' \
        <<<"$status" 2>/dev/null || true
    )
    gateway_clients=${gateway_clients:-0}
    if [ "$gateway_clients" = absent ]; then
      # Transitional: bridge image predates the gatewayClients field. Don't fail
      # the deploy on it; the bridge status above already proved WhatsApp is up.
      echo "Warning: bridge status has no gatewayClients field (old bridge image); skipping gateway check for $admin_id" >&2
      break
    fi
    [ "$gateway_clients" -ge 1 ] 2>/dev/null && break
    echo "Gateway not subscribed for $admin_id yet (attempt $attempt/6, gatewayClients: $gateway_clients)" >&2
    sleep 5
  done
  if [ "$gateway_clients" != absent ] && ! [ "$gateway_clients" -ge 1 ] 2>/dev/null; then
    echo "WhatsApp verification failed: no gateway subscriber on the bridge for an admin" >&2
    exit 1
  fi
done

echo "WhatsApp verification passed for ${#admin_ids[@]} admin connection(s)"
