#!/usr/bin/env bash
# Real-stack smoke for X-Acting-As fail-closed behaviour (Phase ISO).
# Hits a running MCP server (port 8889) — no jest mocks, real Mongo.
#
# Prerequisites:
#   - bash start-dev.sh running (MCP on 8889 + Mongo reachable)
#   - MCP_SERVICE_TOKEN env set (same value as backend/.env)
#
# Usage:
#   MCP_SERVICE_TOKEN=$(grep MCP_SERVICE_TOKEN backend/.env | cut -d= -f2) \
#     bash backend/test/integration/test_mcp_acting_as_smoke.sh
#
# Exit 0 if all PASS, 1 if any FAIL.

set -u

URL="${MCP_URL:-http://127.0.0.1:8889/mcp}"
TOKEN="${MCP_SERVICE_TOKEN:-}"

PASSES=0
FAILS=0

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

if [[ -z "$TOKEN" ]]; then
  red "FAIL: MCP_SERVICE_TOKEN env not set"
  exit 1
fi

probe=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 -X POST "$URL" \
  -H 'Content-Type: application/json' -d '{}' 2>&1)
if [[ "$probe" != "401" && "$probe" != "400" ]]; then
  red "FAIL: cannot reach MCP at $URL (probe=$probe) — is start-dev.sh running?"
  exit 1
fi

# ----------------------------------------------------------------------------
# Helper: post a JSON-RPC payload, echo HTTP status only
# ----------------------------------------------------------------------------
post_status() {
  local payload="$1"
  local extra_header="${2:-}"
  if [[ -n "$extra_header" ]]; then
    curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" \
      -H "Authorization: Bearer $TOKEN" \
      -H 'Content-Type: application/json' \
      -H 'Accept: application/json, text/event-stream' \
      -H "$extra_header" \
      -d "$payload"
  else
    curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" \
      -H "Authorization: Bearer $TOKEN" \
      -H 'Content-Type: application/json' \
      -H 'Accept: application/json, text/event-stream' \
      -d "$payload"
  fi
}

assert_status() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    green "[PASS] $label (HTTP $actual)"
    PASSES=$((PASSES+1))
  else
    red   "[FAIL] $label expected $expected got $actual"
    FAILS=$((FAILS+1))
  fi
}

# Build a tools/call payload for an arbitrary tool name. We do not care about
# the tool's response body — only the gate's HTTP status decision.
call_payload() {
  local tool="$1"
  printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":{}}}' "$tool"
}

initialize_payload='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}'
tools_list_payload='{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# ----------------------------------------------------------------------------
# 1. Missing X-Acting-As + business tool → 401
# ----------------------------------------------------------------------------
status=$(post_status "$(call_payload customer.create)")
assert_status 'business tool without X-Acting-As → 401' 401 "$status"

# 2. Missing X-Acting-As + salesperson.lookup_by_email → 200 (system tool)
status=$(post_status "$(call_payload salesperson.lookup_by_email)")
assert_status 'salesperson.lookup_by_email without X-Acting-As → 200' 200 "$status"

# 3. Missing X-Acting-As + initialize protocol → 200
status=$(post_status "$initialize_payload")
assert_status 'initialize without X-Acting-As → 200' 200 "$status"

# 4. Missing X-Acting-As + tools/list protocol → 200
status=$(post_status "$tools_list_payload")
assert_status 'tools/list without X-Acting-As → 200' 200 "$status"

# 5. Bad ObjectId in X-Acting-As + business tool → 400 VALIDATION
status=$(post_status "$(call_payload customer.create)" 'X-Acting-As: not-a-valid-id')
assert_status 'business tool with non-ObjectId X-Acting-As → 400' 400 "$status"

# 6. Unknown ObjectId in X-Acting-As + business tool → 403 NOT_FOUND
fake_id='000000000000000000000000'
status=$(post_status "$(call_payload customer.create)" "X-Acting-As: $fake_id")
assert_status 'business tool with unknown ObjectId X-Acting-As → 403' 403 "$status"

# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------
echo
echo "Smoke summary: $PASSES PASS / $FAILS FAIL"
if (( FAILS > 0 )); then
  exit 1
fi
