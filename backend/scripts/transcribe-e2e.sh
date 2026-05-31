#!/usr/bin/env bash
#
# transcribe-e2e.sh — Issue #271 real-audio E2E harness.
#
# Drives one full upload → transcribe → sidecar cycle against a running local
# backend, captures wall-clock metrics + sidecar shape, prints JSON to stdout,
# and saves a copy under backend/scripts/results/ (gitignored). Used to fill
# the ETA calibration table that #271 ships as deliverable.
#
# Prereqs:
#   - bash, curl, jq installed
#   - Backend running on $BASE (default http://localhost:8888)
#   - ffprobe (from ffmpeg) optional — used to read audio duration; null if missing
#   - For paraformer: cloudflared tunnel up via bash start-dev-paraformer.sh
#     (so BACKEND_PUBLIC_BASE_URL is set in backend/.env)
#
# Usage:
#   bash backend/scripts/transcribe-e2e.sh <audio_file> [options]
#
# Options:
#   --provider openai|paraformer|skip   Override the admin's transcribeProvider
#                                       before the run. "skip" leaves it as-is.
#                                       Default: skip
#   --admin EMAIL                       Admin to log in as (default admin@admin.com)
#   --password PWD                      Password (default admin123)
#   --base URL                          Backend base URL (default http://localhost:8888)
#   --scenario LABEL                    Human label written into JSON output
#                                       (default: audio file basename)
#
# Exit codes: 0 ok, 1 bad args / network / job failed / unexpected response.

set -euo pipefail

# ----- defaults + arg parse -----

AUDIO_FILE=""
PROVIDER="skip"
ADMIN_EMAIL="admin@admin.com"
ADMIN_PASSWORD="admin123"
BASE="http://localhost:8888"
SCENARIO=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --provider)  PROVIDER="$2"; shift 2 ;;
    --admin)     ADMIN_EMAIL="$2"; shift 2 ;;
    --password)  ADMIN_PASSWORD="$2"; shift 2 ;;
    --base)      BASE="$2"; shift 2 ;;
    --scenario)  SCENARIO="$2"; shift 2 ;;
    -h|--help)
      sed -n '3,30p' "$0"; exit 0 ;;
    -*)
      echo "ERROR: unknown flag $1" >&2; exit 1 ;;
    *)
      if [[ -z "$AUDIO_FILE" ]]; then AUDIO_FILE="$1"; shift
      else echo "ERROR: unexpected positional arg $1" >&2; exit 1; fi ;;
  esac
done

if [[ -z "$AUDIO_FILE" ]]; then
  echo "ERROR: audio file required. See --help." >&2; exit 1
fi
if [[ ! -f "$AUDIO_FILE" ]]; then
  echo "ERROR: audio file not found: $AUDIO_FILE" >&2; exit 1
fi
if [[ "$PROVIDER" != "openai" && "$PROVIDER" != "paraformer" && "$PROVIDER" != "skip" ]]; then
  echo "ERROR: --provider must be openai|paraformer|skip (got: $PROVIDER)" >&2; exit 1
fi
for cmd in curl jq; do
  command -v "$cmd" >/dev/null || { echo "ERROR: $cmd not installed" >&2; exit 1; }
done

if [[ -z "$SCENARIO" ]]; then
  SCENARIO="$(basename "$AUDIO_FILE" | sed 's/\.[^.]*$//')"
fi

# ----- paths + cleanup -----

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
mkdir -p "$RESULTS_DIR"

COOKIES="$(mktemp -t ola-e2e-cookies.XXXXXX)"
trap 'rm -f "$COOKIES"' EXIT

# ----- optional: switch admin provider -----

if [[ "$PROVIDER" != "skip" ]]; then
  echo "[1/5] Setting admin $ADMIN_EMAIL → transcribeProvider=$PROVIDER" >&2
  ( cd "$BACKEND_DIR" && node src/setup/set-admin-provider.js "$ADMIN_EMAIL" "$PROVIDER" ) \
    || { echo "ERROR: set-admin-provider failed" >&2; exit 1; }
else
  echo "[1/5] Skipping admin provider switch (using current setting)" >&2
fi

# ----- login -----

echo "[2/5] Login as $ADMIN_EMAIL" >&2
# Use jq to construct JSON body — prevents injection if password contains "
LOGIN_BODY=$(jq -n --arg email "$ADMIN_EMAIL" --arg pwd "$ADMIN_PASSWORD" \
  '{email: $email, password: $pwd}')
LOGIN_RESP=$(curl -sS -X POST "$BASE/api/login" \
  -H 'Content-Type: application/json' -d "$LOGIN_BODY" -c "$COOKIES")
if [[ "$(echo "$LOGIN_RESP" | jq -r '.success // false')" != "true" ]]; then
  echo "ERROR: login failed: $LOGIN_RESP" >&2; exit 1
fi

# ----- audio duration (optional, ffprobe) -----

AUDIO_DURATION_SEC="null"
if command -v ffprobe >/dev/null 2>&1; then
  AUDIO_DURATION_SEC=$(ffprobe -v error -show_entries format=duration \
    -of default=noprint_wrappers=1:nokey=1 "$AUDIO_FILE" 2>/dev/null \
    | awk '{printf "%.2f", $1}')
  [[ -z "$AUDIO_DURATION_SEC" ]] && AUDIO_DURATION_SEC="null"
fi

# ----- upload -----

# macOS BSD `date` lacks %3N — always use python3 for ms-precision timestamps
ms_now() { python3 -c 'import time;print(int(time.time()*1000))'; }

# macOS curl doesn't always sniff audio MIME — schemaValidate.js requires
# audio/* so explicit type=... is needed or upload returns 415. Map by ext.
AUDIO_EXT=$(echo "$AUDIO_FILE" | sed 's/.*\.//' | tr '[:upper:]' '[:lower:]')
case "$AUDIO_EXT" in
  m4a)  AUDIO_MIME="audio/mp4" ;;
  mp3)  AUDIO_MIME="audio/mpeg" ;;
  wav)  AUDIO_MIME="audio/wav" ;;
  flac) AUDIO_MIME="audio/flac" ;;
  aac)  AUDIO_MIME="audio/aac" ;;
  ogg|oga) AUDIO_MIME="audio/ogg" ;;
  webm) AUDIO_MIME="audio/webm" ;;
  *)    echo "ERROR: unsupported audio extension .$AUDIO_EXT" >&2; exit 1 ;;
esac

echo "[3/5] Upload $AUDIO_FILE (mime=$AUDIO_MIME)" >&2
UPLOAD_T0=$(ms_now)
# Note: route is /api/file/create (createCRUDController convention with upload
# bound as methods.create), not /api/file/upload despite older doc references.
UPLOAD_RESP=$(curl -sS -X POST "$BASE/api/file/create" \
  -b "$COOKIES" \
  -F "file=@$AUDIO_FILE;type=$AUDIO_MIME")
UPLOAD_T1=$(ms_now)
UPLOAD_LATENCY_MS=$((UPLOAD_T1 - UPLOAD_T0))

if [[ "$(echo "$UPLOAD_RESP" | jq -r '.success // false')" != "true" ]]; then
  echo "ERROR: upload failed: $UPLOAD_RESP" >&2; exit 1
fi
FILE_ID=$(echo "$UPLOAD_RESP" | jq -r '.result._id')
JOB_ID=$(echo "$UPLOAD_RESP" | jq -r '.result.transcriptionJobId // empty')
DEDUPED=$(echo "$UPLOAD_RESP" | jq -r '.result.deduped // false')

if [[ -z "$JOB_ID" || "$JOB_ID" == "null" ]]; then
  echo "ERROR: no transcriptionJobId in upload response (non-audio? deduped without job?): $UPLOAD_RESP" >&2; exit 1
fi
echo "      file=$FILE_ID job=$JOB_ID deduped=$DEDUPED upload_ms=$UPLOAD_LATENCY_MS" >&2

# ----- poll Job until terminal -----

echo "[4/5] Poll Job $JOB_ID" >&2
POLL_T0=$UPLOAD_T1
JOB_STATUS="pending"
JOB_ERROR=""
TIMEOUT_SEC="${TRANSCRIBE_E2E_TIMEOUT:-2400}" # default 40 min for 30-min recordings
DEADLINE=$(( $(date +%s) + TIMEOUT_SEC ))

while :; do
  if [[ $(date +%s) -gt $DEADLINE ]]; then
    JOB_STATUS="timeout"
    JOB_ERROR="harness timeout after ${TIMEOUT_SEC}s"
    break
  fi
  JOB_RESP=$(curl -sS -b "$COOKIES" "$BASE/api/job/read/$JOB_ID")
  if [[ "$(echo "$JOB_RESP" | jq -r '.success // false')" != "true" ]]; then
    echo "ERROR: job read failed: $JOB_RESP" >&2; exit 1
  fi
  JOB_STATUS=$(echo "$JOB_RESP" | jq -r '.result.status')
  if [[ "$JOB_STATUS" == "done" || "$JOB_STATUS" == "failed" ]]; then
    JOB_ERROR=$(echo "$JOB_RESP" | jq -r '.result.error // ""')
    break
  fi
  printf '.' >&2
  sleep 3
done
printf '\n' >&2

POLL_T1=$(ms_now)
POLL_DURATION_MS=$((POLL_T1 - POLL_T0))
TOTAL_DURATION_MS=$((POLL_T1 - UPLOAD_T0))

# Server-side workerDurationMs from Job.result (set by transcriptionWorker).
# JOB_RESP is guaranteed assigned by the poll loop (otherwise we exited);
# even the timeout branch keeps the last valid response, so no fallback needed.
WORKER_DURATION_MS=$(printf '%s' "$JOB_RESP" | jq -r '.result.result.durationMs // null')
ACTUAL_PROVIDER=$(printf '%s' "$JOB_RESP" | jq -r '.result.result.provider // "unknown"')

# ----- fetch sidecar (only if done) -----

SENTENCE_COUNT="null"
SPEAKER_COUNT="null"
SIDECAR_BYTES="null"
FIRST_LINE=""
if [[ "$JOB_STATUS" == "done" ]]; then
  echo "[5/5] Fetch sidecar" >&2
  SIDECAR_RESP=$(curl -sS -b "$COOKIES" "$BASE/api/file/transcript/$FILE_ID")
  if [[ "$(echo "$SIDECAR_RESP" | jq -r '.success // false')" != "true" ]]; then
    echo "WARN: sidecar fetch failed: $SIDECAR_RESP" >&2
  else
    TRANSCRIPT=$(echo "$SIDECAR_RESP" | jq -r '.result.transcript')
    SIDECAR_BYTES=$(echo "$SIDECAR_RESP" | jq -r '.result.sizeBytes // 0')
    SENTENCE_COUNT=$(printf '%s\n' "$TRANSCRIPT" | grep -cE '^[A-Z?] [0-9]{2}:[0-9]{2}' || true)
    SPEAKER_COUNT=$(printf '%s\n' "$TRANSCRIPT" | grep -oE '^[A-Z?]' | sort -u | wc -l | tr -d ' ')
    FIRST_LINE=$(printf '%s\n' "$TRANSCRIPT" | head -n1)
  fi
else
  echo "[5/5] Skipping sidecar fetch (status=$JOB_STATUS)" >&2
fi

# ----- compose result JSON -----

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
OUT_FILE="$RESULTS_DIR/${SCENARIO}-${ACTUAL_PROVIDER}-$(date +%Y%m%d-%H%M%S).json"

jq -n \
  --arg scenario      "$SCENARIO" \
  --arg audio_file    "$AUDIO_FILE" \
  --arg provider      "$ACTUAL_PROVIDER" \
  --arg admin_email   "$ADMIN_EMAIL" \
  --arg job_status    "$JOB_STATUS" \
  --arg job_error     "$JOB_ERROR" \
  --arg first_line    "$FIRST_LINE" \
  --arg timestamp     "$TS" \
  --argjson audio_duration_sec   "$AUDIO_DURATION_SEC" \
  --argjson upload_latency_ms    "$UPLOAD_LATENCY_MS" \
  --argjson poll_duration_ms     "$POLL_DURATION_MS" \
  --argjson total_duration_ms    "$TOTAL_DURATION_MS" \
  --argjson worker_duration_ms   "${WORKER_DURATION_MS:-null}" \
  --argjson sentence_count       "$SENTENCE_COUNT" \
  --argjson speaker_count        "$SPEAKER_COUNT" \
  --argjson sidecar_bytes        "$SIDECAR_BYTES" \
  --argjson deduped              "$DEDUPED" \
  '{
    scenario: $scenario,
    audio_file: $audio_file,
    audio_duration_sec: $audio_duration_sec,
    provider: $provider,
    admin_email: $admin_email,
    timestamp: $timestamp,
    metrics: {
      upload_latency_ms: $upload_latency_ms,
      poll_duration_ms: $poll_duration_ms,
      total_duration_ms: $total_duration_ms,
      worker_duration_ms: $worker_duration_ms,
      sentence_count: $sentence_count,
      speaker_count: $speaker_count,
      sidecar_bytes: $sidecar_bytes
    },
    deduped: $deduped,
    job_status: $job_status,
    job_error: $job_error,
    first_line: $first_line
  }' | tee "$OUT_FILE"

echo "" >&2
echo "Saved: $OUT_FILE" >&2

# Non-done → exit 1 so CI / loops can detect failure
[[ "$JOB_STATUS" == "done" ]] || exit 1
