#!/usr/bin/env bash
set -euo pipefail

state_dir=${1:?usage: provision-nanobot-workspaces.sh STATE_DIR SOURCE_DIR}
source_dir=${2:?usage: provision-nanobot-workspaces.sh STATE_DIR SOURCE_DIR}

# Single shared workspace: serve and gateway both default to it (WS-D interim,
# the former api-workspace split was dropped). See doc/nanobot_multitenancy_redesign.md §9.
workspace="$state_dir/workspace"
install -d -m 700 "$workspace"

for file in SOUL.md AGENTS.md TOOLS.md; do
  if [ -f "$source_dir/$file" ]; then
    install -m 600 "$source_dir/$file" "$workspace/$file"
  fi
done

if [ -d "$source_dir/skills" ]; then
  rm -rf "$workspace/skills"
  cp -a "$source_dir/skills" "$workspace/skills"
fi

for file in USER.md HEARTBEAT.md; do
  if [ ! -f "$workspace/$file" ] && [ -f "$source_dir/$file" ]; then
    install -m 600 "$source_dir/$file" "$workspace/$file"
  fi
done

