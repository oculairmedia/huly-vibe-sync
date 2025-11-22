# CPU Usage Analysis & Optimization

**Date**: November 2, 2025  
**Environment**: Docker Compose stack on shared host

## Current CPU Usage

### Top 10 CPU Consumers

| Container | CPU % | Memory | Issue |
|-----------|-------|--------|-------|
| **letta-letta-1** | **100.36%** | 528MB / 4GB | ⚠️ CRITICAL - Maxed out |
| **huly-collaborator-1** | **60.26%** | 181MB | ⚠️ HIGH - Real-time collaboration |
| **searxng_app** | **47.73%** | 358MB | ⚠️ HIGH - Search indexing |
| **letta-postgres-1** | **43.53%** | 420MB / 2GB | ⚠️ HIGH - Database load |
| **huly-huly-rest-api-1** | **41.24%** | 131MB | ⚠️ HIGH - REST API processing |
| **tesslate-orchestrator** | **40.59%** | 135MB | ⚠️ HIGH - Orchestration tasks |
| **huly-vibe-sync** | **29.58%** | 122MB | ⚠️ MEDIUM - **Our service** |
| **huly-minio-1** | **24.43%** | 405MB | 🟡 Storage operations |
| **huly-transactor-1** | **11.79%** | 154MB | ✅ Acceptable |
| **letta-proxy-1** | **8.59%** | 66MB | ✅ Acceptable |

### Total System Load
- **Combined CPU**: ~500%+ (5+ cores constantly busy)
- **Memory Pressure**: Moderate (7.2GB / 72GB used)

## Root Cause Analysis

### 1. Letta Container (100% CPU) - CRITICAL ⚠️

**Symptoms**:
- Maxed out at 100% CPU constantly
- Database concurrency errors (`StaleDataError`)
- Block update conflicts

**Root Cause**:
```
huly-vibe-sync is hammering Letta with memory block updates:

42 projects × 6 blocks/project × sync every 3 seconds
= 252 block operations every 3 seconds
= 84 operations/second to Letta API
```

**Evidence**:
```python
# From letta logs
sqlalchemy.orm.exc.StaleDataError: UPDATE statement on table 'block' 
expected to update 1 row(s); 0 were matched.
```

This happens when multiple concurrent updates try to modify the same block.

### 2. Huly-Vibe-Sync (29% CPU) - MEDIUM ⚠️

**Symptoms**:
- Running at 29% CPU (almost 1/3 of a core)
- Processing 44 projects every 3 seconds
- Constant memory block updates

**Root Cause**:
```javascript
// Current configuration
SYNC_INTERVAL=3000  // 3 seconds
PARALLEL_SYNC=false // Sequential processing
```

**Load Calculation**:
```
Per Cycle (every 3 seconds):
- 44 projects to process
- Each project:
  * Fetch Huly issues
  * Fetch Vibe tasks  
  * Update 6 memory blocks (even if unchanged - checking takes time)
  * Save agent state to DB
  * Save to project .letta folder

Total per cycle: ~44 × 10 operations = 440 operations / 3 seconds
= ~146 operations/second
```

### 3. Letta Postgres (43% CPU) - HIGH ⚠️

**Root Cause**:
- Overwhelmed by huly-vibe-sync's memory block updates
- 84 UPDATE statements/second
- Concurrent writes causing lock contention
- Index updates on every block change

### 4. Huly Collaborator (60% CPU) - HIGH ⚠️

**Cause**: Real-time collaboration features (WebSocket connections, live updates)
**Note**: This is expected for collaboration services

## Optimization Recommendations

### Priority 1: Reduce Sync Frequency ⭐⭐⭐

**Current**: 3 second interval
**Recommended**: 30-60 seconds

```bash
# In .env
SYNC_INTERVAL=30000  # 30 seconds (10x reduction)
# Or
SYNC_INTERVAL=60000  # 60 seconds (20x reduction)
```

**Impact**:
- **huly-vibe-sync CPU**: 29% → **3-6%** (80-90% reduction)
- **letta-letta-1 CPU**: 100% → **10-20%** (80% reduction)
- **letta-postgres-1 CPU**: 43% → **5-10%** (75% reduction)

**Trade-off**:
- Sync lag increases from 3s to 30-60s
- Still acceptable for project management use case
- Issues/tasks don't change that frequently

### Priority 2: Optimize Memory Block Updates ⭐⭐⭐

**Current Problem**: We're checking and attempting to update 6 blocks for 42 agents every cycle, even when nothing changed.

**Solution 1**: Add change detection before API calls

```javascript
// In lib/LettaService.js
async upsertMemoryBlocks(agentId, blocks) {
  // Current: Always calls Letta API to check each block
  
  // Better: Cache block hashes locally
  const localCache = this._blockHashCache[agentId] || {};
  const blocksToUpdate = blocks.filter(block => {
    const hash = crypto.createHash('md5').update(block.value).digest('hex');
    if (localCache[block.label] === hash) {
      return false; // Skip - unchanged
    }
    localCache[block.label] = hash;
    return true; // Update needed
  });
  
  if (blocksToUpdate.length === 0) {
    console.log(`[Letta] All blocks up to date (cached check)`);
    return;
  }
  
  // Only update changed blocks
  await this._updateBlocks(agentId, blocksToUpdate);
}
```

**Impact**:
- Reduces API calls by ~80-90% (most blocks don't change between syncs)
- **letta-letta-1 CPU**: 100% → **20-30%** (70% reduction)

**Solution 2**: Batch block updates

Instead of updating blocks one-by-one, batch them:

```javascript
// Update all blocks in a single transaction
await this.client.agents.updateMemoryBlocks(agentId, {
  blocks: blocksToUpdate
});
```

### Priority 3: Enable Skip Empty Projects ⭐⭐

**Current**: `SKIP_EMPTY_PROJECTS=false`
**Recommended**: `SKIP_EMPTY_PROJECTS=true`

```bash
# In .env
SKIP_EMPTY_PROJECTS=true
```

**Impact**:
- Skips projects with 0 issues after first detection
- Reduces processing by ~20-30% (many empty projects)
- **huly-vibe-sync CPU**: 29% → **20-23%** (20-30% reduction)

### Priority 4: Incremental Sync ⭐

**Current**: `INCREMENTAL_SYNC=false` (fetches all issues every time)
**Consider**: `INCREMENTAL_SYNC=true` (only fetch changed issues)

**Note**: Currently disabled for bidirectional sync. May need code changes to support.

### Priority 5: Reduce Sleep-Time Agent Frequency ⭐

If you're running sleep-time agents (off-hours agents), consider:
- Only running them during actual off-hours (23:00 - 07:00)
- Or disabling them entirely if not needed

## Implementation Plan

### Phase 1: Quick Wins (5 minutes)

```bash
cd /opt/stacks/huly-vibe-sync

# Edit .env
nano .env

# Change these lines:
SYNC_INTERVAL=30000              # Was: 3000
SKIP_EMPTY_PROJECTS=true         # Was: false

# Restart service
docker-compose restart

# Monitor impact
docker stats --no-stream | grep -E "(letta|huly-vibe)"
```

**Expected Result**:
- **huly-vibe-sync**: 29% → **6%** CPU
- **letta-letta-1**: 100% → **20%** CPU  
- **letta-postgres-1**: 43% → **8%** CPU
- **Total system**: ~500% → ~350% CPU (30% reduction)

### Phase 2: Code Optimization (30 minutes)

1. Add local block hash caching
2. Skip unchanged blocks before API calls
3. Batch block updates

**Expected Additional Result**:
- **letta-letta-1**: 20% → **5-10%** CPU
- **huly-vibe-sync**: 6% → **3-4%** CPU

### Phase 3: Advanced (Future)

1. Implement true incremental sync for bidirectional flow
2. Add webhook-based updates instead of polling
3. Implement agent pooling (shared agents for similar projects)

## Monitoring

### Check CPU Usage
```bash
# Real-time monitoring
docker stats

# Top consumers
docker stats --no-stream --format "{{.Name}} {{.CPUPerc}}" | \
  awk '{print $2, $1}' | sort -rn | head -10

# Monitor specific containers
docker stats letta-letta-1 huly-vibe-sync letta-postgres-1
```

### Check Sync Performance
```bash
# Watch logs
docker-compose logs -f huly-vibe-sync | grep -E "(Starting|Complete|projects)"

# Count block updates per minute
docker-compose logs --since 1m huly-vibe-sync | grep "Updated block" | wc -l
```

### Alerts to Add

1. **Letta CPU > 50%**: Indicates sync frequency too high
2. **Sync duration > interval**: Indicates sync can't keep up
3. **Database errors**: Indicates concurrent update conflicts

## Other Heavy Containers

### Huly Collaborator (60% CPU)
**Type**: Real-time collaboration service  
**Action**: Expected behavior - provides live editing/updates  
**Optimization**: Limit max concurrent connections if possible

### SearXNG (47% CPU)  
**Type**: Meta search engine  
**Action**: Review if this is actively used  
**Optimization**: Reduce index update frequency or disable if not needed

### Tesslate Orchestrator (40% CPU)
**Type**: Orchestration service  
**Action**: Review task frequency  
**Optimization**: Increase task intervals if possible

## Summary

### Current State
- **huly-vibe-sync**: Syncing every 3 seconds (too aggressive)
- **Letta**: Maxed out at 100% CPU from block update spam
- **System**: Using 5+ CPU cores constantly

### Recommended Changes
1. ✅ **Increase sync interval**: 3s → 30s (10x reduction)
2. ✅ **Skip empty projects**: Reduce unnecessary processing  
3. ✅ **Add block hash caching**: Prevent unnecessary API calls
4. ⏭️ **Consider disabling sleep-time agents**: If not actively used

### Expected Impact
- **70-80% CPU reduction** on Letta services
- **80-90% CPU reduction** on huly-vibe-sync
- **30% overall system CPU reduction**
- **Improved stability** (no more database conflicts)

**Next Step**: Implement Phase 1 (5 minutes) and monitor results
