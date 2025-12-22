# Quick Start: Deploy Beads Integration

## When Docker Image is Ready

### 1. Pull New Image
```bash
cd /opt/stacks/huly-vibe-sync
docker-compose pull huly-vibe-sync
```

### 2. Stop Current Container
```bash
docker-compose down
```

### 3. Start with New Image
```bash
docker-compose up -d
```

### 4. Watch Logs for Phase 3
```bash
# Watch for beads sync activity
docker-compose logs -f | grep -E "(Phase 3|Beads|phase: 3)"

# Or just follow all logs
docker-compose logs -f --tail=50
```

## What to Expect

### First Sync Cycle
- Phase 1: Huly → Vibe (existing)
- Phase 2: Vibe → Huly (existing)
- **Phase 3a: Huly → Beads** (NEW - will create ~125 issues)
- **Phase 3b: Beads → Huly** (NEW - status sync)

### Log Output to Look For
```
[Beads] Fetching issues...
[Beads] Found X issues
[Beads] Creating issue: <title>
[Beads] ✓ Created issue: graphiti-<id>
```

### Check Results
```bash
# In graphiti project
cd /opt/stacks/graphiti
bd list | wc -l   # Should show 125+ issues after full sync

# View specific issues
bd list | head -20

# Check sync state in database
docker cp huly-vibe-sync:/app/logs/sync-state.db /tmp/sync-check.db
sqlite3 /tmp/sync-check.db "SELECT COUNT(*) FROM issues WHERE beads_issue_id IS NOT NULL;"
```

## Configuration (Optional)

Current defaults work out of the box:
```env
BEADS_ENABLED=true
BEADS_SYNC_INTERVAL=60000  # 1 minute
```

To disable beads sync:
```bash
# In .env file
BEADS_ENABLED=false

# Restart
docker-compose restart
```

## Troubleshooting

### Container won't start
```bash
# Check logs
docker-compose logs huly-vibe-sync

# Verify database migration ran
docker exec huly-vibe-sync ls -la /app/logs/sync-state.db
```

### Beads sync not running
```bash
# Check config
docker exec huly-vibe-sync env | grep BEADS

# Should show:
# BEADS_ENABLED=true
```

### No issues created in beads
```bash
# Check if graphiti has .beads/ directory
ls -la /opt/stacks/graphiti/.beads/

# Check if project has filesystem_path
docker cp huly-vibe-sync:/app/logs/sync-state.db /tmp/check.db
sqlite3 /tmp/check.db "SELECT identifier, name, filesystem_path FROM projects WHERE identifier='GRAPH';"
```

## Expected Timeline

- **Pull image**: 30-60 seconds
- **Container start**: 5-10 seconds
- **First sync**: 10-30 seconds
- **Phase 3 (125 issues)**: 2-5 minutes
  - ~200ms per issue creation
  - Includes beads CLI overhead

## Success Criteria

✅ Container running and healthy  
✅ Logs show "Phase 3" entries  
✅ `bd list` in graphiti shows 125+ issues  
✅ Database has beads_issue_id populated  
✅ Status changes sync bidirectionally  

## Current Build Status

Check: https://github.com/oculairmedia/huly-vibe-sync/actions/runs/20445559798

Commit: `db44e0c` - "Add Beads integration for three-way sync"
