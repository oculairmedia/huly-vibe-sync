# Graphiti Visualizer CPU Optimization

## Problem Identified

**Service**: `graphiti-graph-visualizer-rust-1`  
**CPU Usage**: Indirectly causing **FalkorDB to use 16% CPU**  
**Root Cause**: Aggressive polling of FalkorDB every **5 seconds**

### How It Works

The graph visualizer (`/opt/stacks/graphiti/graph-visualizer-rust/src/main.rs`) spawns a background task that:

1. Polls FalkorDB every 5 seconds (line 536)
2. Executes expensive centrality queries:
   - `MATCH (n) WHERE EXISTS(n.degree_centrality) RETURN SUM(n.degree_centrality)`
   - `MATCH (n) WHERE EXISTS(n.degree_centrality) RETURN MAX(n.degree_centrality)`
   - `MATCH (n) RETURN COALESCE(n.type, labels(n)[0]) as type, count(n)`
3. Checks for graph changes (node count, edge count, centrality values)
4. Triggers DuckDB reload if changes detected

### Impact

- **720 polling cycles per hour** (every 5 seconds)
- Each cycle hits FalkorDB with 3-5 queries
- Total: **2,160-3,600 queries per hour**
- FalkorDB processing these queries = **16% constant CPU**

## Solution Applied

### File Modified
```
/opt/stacks/graphiti/graph-visualizer-rust/src/main.rs
```

### Change Made
```rust
// BEFORE (line 536):
let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(5));

// AFTER:
let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
```

### Backup Created
```
/opt/stacks/graphiti/graph-visualizer-rust/src/main.rs.backup-20251102-HHMMSS
```

## Rebuild Instructions

**IMPORTANT**: Container must be rebuilt for changes to take effect.

```bash
cd /opt/stacks/graphiti

# Stop running container
docker-compose stop graph-visualizer-rust

# Rebuild with new interval
docker build --no-cache \
  -f graph-visualizer-rust/Dockerfile \
  -t ghcr.io/oculairmedia/graphiti-rust-visualizer:feature-chutes-ai-integration \
  graph-visualizer-rust/

# Start container with rebuilt image
docker-compose up -d graph-visualizer-rust
```

## Expected Results

### Before Optimization
- **Polling Frequency**: 720/hour (every 5s)
- **FalkorDB CPU**: 16%
- **Query Load**: 2,160-3,600 queries/hour

### After Optimization
- **Polling Frequency**: 120/hour (every 30s)
- **FalkorDB CPU**: Expected 2-3% (85% reduction)
- **Query Load**: 360-600 queries/hour (83% reduction)

## Verification

After rebuild and restart:

```bash
# Monitor FalkorDB CPU
docker stats --no-stream | grep falkordb

# Check visualizer logs for 30s interval
docker logs -f graphiti-graph-visualizer-rust-1

# Verify polling timing (should see changes ~30s apart)
docker logs graphiti-graph-visualizer-rust-1 | grep "Graph changed" | tail -10
```

## Pattern Recognition

This is the **3rd service** with aggressive polling:

1. ✅ **huly-vibe-sync**: 3s → 30s (89% reduction)
2. ✅ **matrix-client**: 0.5s → 30s (98% reduction)
3. ⏳ **graph-visualizer**: 5s → 30s (83% reduction) - **PENDING REBUILD**

**Common Issue**: All services polling for changes in relatively stable resources  
**Common Solution**: Increase polling intervals to 30 seconds

## Status

- [x] Issue identified
- [x] Root cause analyzed
- [x] Code modified
- [x] Backup created
- [x] Container stopped
- [ ] **Container rebuild required** ← NEXT STEP
- [ ] Container restarted
- [ ] CPU reduction verified
- [ ] Optimization documented

## Next Steps

1. **Rebuild container** (requires executing from `/opt/stacks/graphiti`)
2. **Restart container**
3. **Verify CPU drop** from 16% to 2-3%
4. **Update optimization summary** with results

---

## Related Files

- Source: `/opt/stacks/graphiti/graph-visualizer-rust/src/main.rs`
- Backup: `/opt/stacks/graphiti/graph-visualizer-rust/src/main.rs.backup-*`
- Docker Compose: `/opt/stacks/graphiti/docker-compose.yml`
- Dockerfile: `/opt/stacks/graphiti/graph-visualizer-rust/Dockerfile`
