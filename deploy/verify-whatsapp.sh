#!/usr/bin/env bash
set -euo pipefail

state_dir=${1:?usage: verify-whatsapp.sh STATE_DIR BRIDGE_URL GATEWAY_CONTAINER}
bridge_url=${2:?usage: verify-whatsapp.sh STATE_DIR BRIDGE_URL GATEWAY_CONTAINER}
gateway_container=${3:?usage: verify-whatsapp.sh STATE_DIR BRIDGE_URL GATEWAY_CONTAINER}
config="$state_dir/config.json"

if ! jq -e '.channels.whatsapp.enabled == true' "$config" >/dev/null; then
  echo "WhatsApp verification failed: channels.whatsapp.enabled is not true" >&2
  exit 1
fi

mapfile -t admin_ids < <(
  find "$state_dir/wa" -mindepth 2 -maxdepth 2 -type d -name auth -printf '%h\n' |
    sed 's#.*/##' |
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
  status=$(
    curl --fail --silent --show-error --max-time 10 \
      -H "Authorization: Bearer $token" \
      "$bridge_url/wa/$admin_id/status"
  )
  bridge_status=$(jq -r '.status // "missing"' <<<"$status")
  if [ "$bridge_status" != connected ]; then
    echo "WhatsApp verification failed: bridge status is $bridge_status" >&2
    exit 1
  fi

  if ! docker logs --since 10m "$gateway_container" 2>&1 |
    grep -F "[$admin_id] Connected to WhatsApp bridge" >/dev/null; then
    echo "WhatsApp verification failed: gateway is not connected for an admin" >&2
    exit 1
  fi
done

echo "WhatsApp verification passed for ${#admin_ids[@]} admin connection(s)"
