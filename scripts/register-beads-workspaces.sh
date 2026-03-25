#!/bin/bash
# Register all beads workspaces with beads-ui server
# Called by systemd ExecStartPost after bdui starts

BDUI_URL="${BDUI_URL:-http://localhost:3112}"
STACKS_DIR="${STACKS_DIR:-/opt/stacks}"

# Wait for server to be ready
for i in $(seq 1 10); do
  if curl -sf "$BDUI_URL/healthz" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

count=0
for beads_dir in "$STACKS_DIR"/*/.beads; do
  [ -d "$beads_dir" ] || continue
  project_dir=$(dirname "$beads_dir")

  # Find database file
  db_file=""
  if [ -f "$beads_dir/metadata.json" ]; then
    db_file="$beads_dir/metadata.json"
  elif [ -f "$beads_dir/beads.db" ] && [ -s "$beads_dir/beads.db" ]; then
    db_file="$beads_dir/beads.db"
  fi

  [ -n "$db_file" ] || continue

  curl -sf -X POST "$BDUI_URL/api/register-workspace" \
    -H 'Content-Type: application/json' \
    -d "{\"path\": \"$project_dir\", \"database\": \"$db_file\"}" > /dev/null 2>&1

  count=$((count + 1))
done

echo "Registered $count beads workspaces with beads-ui"
