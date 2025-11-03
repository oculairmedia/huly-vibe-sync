# Letta CPU Usage Analysis

## Current Status
- **Letta CPU**: 25-75% (spiky, variable)
- **Request rate**: ~280 requests per 5 minutes (~56 req/min, ~0.93 req/sec)
- **Status**: ✅ **NORMAL** - This is expected behavior during sync cycles

## What's Causing Letta Processing?

### 1. **huly-vibe-sync (Primary Load - Expected)**
- **Source IP**: 172.20.0.1 (huly-vibe-sync container)
- **Activity**: Syncing 42 projects every 30 seconds
- **Request Pattern** (per sync cycle):
  - `GET /v1/agents/` - List all agents
  - `GET /v1/agents/{agent_id}` - Get agent details
  - `GET /v1/agents/{agent_id}/core-memory/blocks` - Get memory blocks
  - `PATCH /v1/blocks/{block_id}` - Update memory blocks (multiple per project)

#### Typical Sync Cycle
```
For each of 42 projects:
1. GET agent info
2. GET agent memory blocks (6 blocks per agent)
3. PATCH changed blocks (average 2-5 blocks per project)

Total per cycle: ~42 GET requests + ~42×6 block reads + ~42×3 block updates
                 = ~42 + 252 + 126 = ~420 operations per 30s cycle
                 = ~14 requests/second during sync
```

### 2. **External Service (192.168.50.99) - NEEDS INVESTIGATION**
- **Source IP**: 192.168.50.99 (another machine on network)
- **Activity**: Hammering ONE specific block repeatedly
- **Target**: `block-5b977df1-8270-4393-a6cb-ab7e1ae61ca7`
- **Request rate**: ~25 PATCH requests in 2 minutes (~0.2 req/sec)
- **Pattern**: Same block, same IP, constant patching

#### This is SUSPICIOUS
- Not identified yet - need to find what service/script is running on 192.168.50.99
- Could be:
  - Another Letta MCP server
  - A monitoring/health check service
  - A rogue script or agent
  - Matrix homeserver (letta-opencode-plugin is on matrix network)

### Request Breakdown (Last 5 Minutes)
- **Total requests**: 279
- **Block PATCH requests**: 193 (69% of traffic)
- **From huly-vibe-sync (172.20.0.1)**: 202 (72%)
- **From external (192.168.50.99)**: 77 (28%)

## Why CPU Spikes?

### Normal Spikes (Expected)
1. **Sync cycles every 30 seconds**
   - huly-vibe-sync processes 42 projects
   - Each project: read agent + read 6 blocks + update 2-5 blocks
   - Letta does JSON serialization, database lookups, hashing
   - **Duration**: 5-10 seconds of high CPU, then idle

2. **Database operations**
   - Postgres queries for agent/block retrieval
   - SQLite/Postgres updates for block patches
   - Transaction overhead

### Abnormal Activity (Concerning)
- **192.168.50.99 constantly patching same block**
  - This should NOT be happening
  - Need to identify source and purpose

## Is This a Problem?

### ✅ Expected CPU Usage: 17-30%
- Letta processing sync requests every 30s
- Spiky pattern: high during sync, low between
- **This is NORMAL and HEALTHY**

### ⚠️ Unexpected CPU Usage: 60-75%
- When external IP (192.168.50.99) is actively hammering
- Should investigate and potentially rate-limit or block

## Optimization Opportunities

### Already Applied ✅
1. ✅ SYNC_INTERVAL: 3s → 30s (10x reduction)
2. ✅ SKIP_EMPTY_PROJECTS: enabled
3. ✅ Reduced huly-vibe-sync from 29% → 3% CPU

### Phase 2 Optimizations (If Needed)
From previous session notes in `CPU_OPTIMIZATION_RESULTS.md`:

1. **Local block hash caching** in `lib/LettaService.js`
   - Cache block hashes locally
   - Only PATCH if hash changed
   - Estimated: 30-40% reduction in Letta CPU

2. **Batch block updates**
   - Update multiple blocks in one request
   - Reduce HTTP overhead
   - Estimated: 20-30% reduction

3. **Connection pooling**
   - Reuse HTTP connections to Letta
   - Reduce connection overhead

### Immediate Action Items

1. **Identify 192.168.50.99**
   ```bash
   # Check what's on that host
   ssh 192.168.50.99 "ps aux | grep letta"
   
   # Check which service is patching that specific block
   curl -s http://localhost:8083/v1/blocks/block-5b977df1-8270-4393-a6cb-ab7e1ae61ca7 \
     -H "Authorization: Bearer lettaSecurePass123" | jq '.label'
   ```

2. **Monitor the pattern**
   ```bash
   # Watch for external hammering
   docker logs -f letta-letta-1 | grep 192.168.50.99
   
   # Count requests per minute
   docker logs letta-letta-1 --since 1m | grep "192.168.50.99" | wc -l
   ```

3. **Consider rate limiting**
   - If 192.168.50.99 is legitimate but too aggressive
   - Add nginx rate limiting in front of Letta

## Conclusion

### Current State
- ✅ **huly-vibe-sync**: Working perfectly, optimized, expected load
- ✅ **Letta CPU 17-30%**: NORMAL and HEALTHY
- ⚠️ **192.168.50.99**: Unknown external service hammering one block - INVESTIGATE
- ⚠️ **Letta CPU 60-75%**: Only when external hammering occurs - CONCERNING

### Recommendations
1. **Immediate**: Identify what's running on 192.168.50.99
2. **Short-term**: Monitor if problem persists or grows
3. **Long-term**: If needed, implement Phase 2 optimizations from previous session

### Verdict
**The Letta CPU usage is NORMAL for the workload**. The sync process running every 30 seconds with 42 projects naturally causes periodic CPU spikes. The only concern is the unidentified external service at 192.168.50.99.

---

**Session**: 2025-11-02 20:15 EST
**Status**: Investigation needed for 192.168.50.99
