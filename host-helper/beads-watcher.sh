#!/bin/bash
set -uo pipefail

SYNC_API="${BEADS_SYNC_API:-http://localhost:3099/api/sync/trigger}"
WATCH_ROOT="${BEADS_WATCH_ROOT:-/opt/stacks}"
DEBOUNCE_MS="${BEADS_DEBOUNCE_MS:-2000}"
LOG_FILE="${BEADS_LOG_FILE:-/var/log/beads-watcher.log}"

declare -A PENDING_SYNCS
declare -A LAST_SYNC

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

trigger_sync() {
    local project="$1"
    local now=$(date +%s%3N)
    local last="${LAST_SYNC[$project]:-0}"
    
    if (( now - last < DEBOUNCE_MS )); then
        PENDING_SYNCS[$project]=1
        return
    fi
    
    LAST_SYNC[$project]=$now
    unset "PENDING_SYNCS[$project]" 2>/dev/null || true
    
    log "Triggering sync for $project"
    curl -s -X POST "${SYNC_API}?project=${project}" -o /dev/null &
}

process_pending() {
    for project in "${!PENDING_SYNCS[@]}"; do
        trigger_sync "$project"
    done
}

extract_project() {
    local path="$1"
    local rel="${path#$WATCH_ROOT/}"
    local project_dir="${rel%%/*}"
    
    local db_path="$WATCH_ROOT/$project_dir/.beads/beads.db"
    if [[ -f "$db_path" ]]; then
        local prefix=$(sqlite3 "$db_path" \
            "SELECT SUBSTR(id, 1, INSTR(id, '-')-1) FROM issues LIMIT 1" 2>/dev/null || echo "")
        if [[ -n "$prefix" ]]; then
            echo "${prefix^^}"
            return
        fi
    fi
    echo "$project_dir"
}

main() {
    if ! command -v inotifywait &>/dev/null; then
        log "ERROR: inotifywait not found. Install: apt install inotify-tools"
        exit 1
    fi
    
    log "Starting Beads file watcher"
    log "Watch root: $WATCH_ROOT"
    log "Sync API: $SYNC_API"
    
    mapfile -t watch_dirs < <(find "$WATCH_ROOT" -maxdepth 2 -type d -name ".beads" 2>/dev/null)
    
    if [[ ${#watch_dirs[@]} -eq 0 ]]; then
        log "No .beads directories found"
        exit 1
    fi
    
    log "Watching ${#watch_dirs[@]} .beads directories"
    
    (while true; do sleep 2; kill -ALRM $$ 2>/dev/null || exit 0; done) &
    TIMER_PID=$!
    trap "kill $TIMER_PID 2>/dev/null; exit 0" EXIT INT TERM
    trap 'process_pending' ALRM
    
    inotifywait -m -q -e modify,create \
        --include 'issues\.jsonl$' \
        --format '%w%f' \
        "${watch_dirs[@]}" 2>/dev/null | while read -r filepath; do
        
        case "$filepath" in
            *issues.jsonl)
                project=$(extract_project "$filepath")
                [[ -n "$project" ]] && trigger_sync "$project"
                ;;
        esac
    done
}

main "$@"
