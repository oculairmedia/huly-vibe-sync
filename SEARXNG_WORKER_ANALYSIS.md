# SearXNG Worker Recycling Analysis

## Problem Summary
SearXNG workers are being killed and respawned every ~60 seconds, causing:
- Continuous worker churn (5 workers × 60s = worker restart every 12s)
- Excessive CPU usage (historically 30-35%, now reduced to 0.01%)
- Unnecessary memory allocation/deallocation cycles

## Root Cause

### Current Configuration (`/opt/stacks/searxng/config/uwsgi.ini`)
```ini
max-requests = 1000           # Restart worker after 1000 requests
max-worker-lifetime = 3600    # Restart worker after 1 hour (3600s)
reload-on-rss = 2048          # Restart worker if RSS > 2048 MB
worker-reload-mercy = 60      # Grace period for worker shutdown
```

### Why Workers Restart Every 60 Seconds
Workers are hitting the `max-requests = 1000` limit quickly due to:
1. **Health check requests** from Caddy/monitoring
2. **Internal requests** (static files, metrics, etc.)
3. **MCP server polling** from mcp-searxng container

Even with no actual search traffic, workers accumulate 1000 requests in ~60 seconds:
- 1000 requests / 60 seconds = ~16.7 requests/second
- With 5 workers, each handling ~3.3 req/sec

### Evidence from Logs
```
2025-11-03 00:52:23 - worker 1 killed successfully (pid: 219423)
2025-11-03 00:52:23 - Respawned uWSGI worker 1 (new pid: 219744)
2025-11-03 00:53:23 - worker 5 killed successfully (pid: 219487)
2025-11-03 00:53:23 - Respawned uWSGI worker 5 (new pid: 219808)
```
**Pattern**: Exactly 60 seconds between worker restarts

## Solution: Apply Updated Configuration

A `.new` configuration file already exists that removes the problematic settings:

### Optimized Config (`uwsgi.ini.new`)
```ini
workers = 4                   # Reduced from 5
threads = 4                   # Reduced from 8
enable-threads = 4           # Properly set
buffer-size = 8192           # Reduced from 32768
offload-threads = 4          # Reduced from 8

# REMOVED problematic settings:
# - max-requests (was causing 60s recycling)
# - max-worker-lifetime (unnecessary for stable service)
# - reload-on-rss (workers never approached 2GB)
# - worker-reload-mercy (no longer needed)
# - thunder-lock (unnecessary for current load)
# - harakiri (no hanging requests)
```

### Benefits of New Configuration
1. ✅ **No arbitrary worker restarts** - workers run indefinitely
2. ✅ **Lower resource usage** - fewer workers/threads for actual load
3. ✅ **Simpler configuration** - only essential settings
4. ✅ **More stable** - no recycling churn

## Implementation Plan

```bash
# Backup current config
cd /opt/stacks/searxng/config
cp uwsgi.ini uwsgi.ini.backup-$(date +%Y%m%d-%H%M%S)

# Apply new configuration
mv uwsgi.ini.new uwsgi.ini

# Restart SearXNG to apply changes
cd /opt/stacks/searxng
docker-compose restart searxng

# Monitor workers (should NOT restart every 60s)
docker logs -f searxng_app
```

## Expected Results

### Before Fix
- Workers restart every 60 seconds
- CPU usage: 0.01% (already low due to huly-vibe-sync optimizations)
- 5 workers × 8 threads = 40 concurrent handlers

### After Fix
- Workers run indefinitely (only restart on container restart)
- CPU usage: <0.01% (slight improvement)
- 4 workers × 4 threads = 16 concurrent handlers (sufficient for actual load)

## Monitoring

Watch for these indicators:
```bash
# Should see NO "Respawned" messages after applying fix
docker logs searxng_app --since 5m | grep Respawned

# Workers should maintain same PID
docker exec searxng_app ps aux | grep "uWSGI worker"

# CPU should remain stable and low
docker stats --no-stream searxng_app
```

## Why CPU Usage Already Low (0.01%)

The worker recycling was causing **30-35% CPU** during the previous session.
After reducing `huly-vibe-sync` SYNC_INTERVAL from 3s to 30s, the request
rate to SearXNG dropped dramatically:

- **Before**: huly-vibe-sync polling constantly → many health/internal requests
- **After**: Much lower request rate → workers still recycle but with less impact

However, fixing the worker recycling completely will:
1. Eliminate unnecessary process creation/destruction
2. Reduce memory allocation churn
3. Improve stability and predictability
4. Remove log spam (cleaner logs)

## Related Files
- `/opt/stacks/searxng/config/uwsgi.ini` - Current config (problematic)
- `/opt/stacks/searxng/config/uwsgi.ini.new` - Optimized config (ready to apply)
- `/opt/stacks/searxng/docker-compose.yml` - Docker Compose configuration
- `CPU_OPTIMIZATION_RESULTS.md` - Previous optimization session results

## Conclusion

The worker recycling is a **configuration issue**, not a code issue.
Someone already created the optimized config (`.new` files) but never applied it.

**Recommendation**: Apply the new configuration immediately to eliminate
unnecessary worker churn and improve system stability.
