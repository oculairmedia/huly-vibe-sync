# Huly-Vibe Sync - Session Context

## What We Just Completed

Successfully upgraded the Huly-Vibe sync service from MCP protocol to REST API with incremental sync support.

## Current Status

✅ **DEPLOYED AND RUNNING**

- Container: `huly-vibe-sync` - Running with REST API mode
- Location: `/opt/stacks/huly-vibe-sync`
- Image: `ghcr.io/oculairmedia/huly-vibe-sync:latest`
- Status: Initial full sync in progress (first run)

## Key Changes Made

### 1. Created Huly REST API Client
**File**: `lib/HulyRestClient.js`
- Direct REST API communication (faster than MCP)
- Automatic text extraction from MCP-style responses
- Built-in health checking
- Helper methods: `listProjects()`, `listIssues()`, `searchIssues()`

### 2. Updated Main Sync Service
**File**: `index.js`
- Added REST API client support (dual-mode: REST or MCP)
- Incremental sync logic with timestamp tracking
- State persistence in `.sync-state.json`

### 3. Configuration Files Updated
- **`.env`**: Added REST API settings
  - `HULY_API_URL=http://192.168.50.90:3457/api`
  - `HULY_USE_REST=true`
  - `INCREMENTAL_SYNC=true`
  - `SYNC_INTERVAL=30000` (30 seconds)

- **`docker-compose.yml`**: Updated environment variables
- **`Dockerfile`**: Fixed to include `lib/` directory (COPY lib ./lib)
- **`README.md`**: Documented new features

### 4. Git Repository
- Repo: `https://github.com/oculairmedia/huly-vibe-sync`
- All changes committed and pushed
- GitHub Actions automatically builds Docker images
- Latest commits:
  - `0863773` - Fix Dockerfile to include lib directory
  - `62b96fd` - Update .env.example with REST API configuration
  - `d4433b7` - Add Huly REST API client with incremental sync support

## How It Works

### First Sync (Currently Running)
- **Mode**: Full sync of all issues
- **Duration**: ~2-3 minutes for 44 projects, 250+ issues
- **Saves**: Timestamp to `/opt/stacks/huly-vibe-sync/logs/.sync-state.json`

### Subsequent Syncs (After First Completes)
- **Mode**: Incremental sync using `modified_after` filter
- **Duration**: Seconds (only fetches changed issues)
- **Interval**: Every 30 seconds
- **Query**: REST API filters at server-side for efficiency

## Performance Improvements

1. **REST API**: No MCP protocol overhead
2. **Incremental Sync**: Only fetches modified issues
3. **Server-side Filtering**: Reduces network traffic
4. **State Persistence**: Tracks last sync per project

## Configuration

```bash
# Current settings in .env
HULY_API_URL=http://192.168.50.90:3457/api
HULY_USE_REST=true
INCREMENTAL_SYNC=true
SYNC_INTERVAL=30000  # 30 seconds
DRY_RUN=false
VIBE_MCP_URL=http://192.168.50.90:9717/mcp
VIBE_API_URL=http://192.168.50.90:3105/api
STACKS_DIR=/opt/stacks
```

## Testing

Test script available: `test-rest-client.js`
```bash
node test-rest-client.js
```

## Monitoring

```bash
# Check status
docker ps --filter name=huly-vibe-sync

# View logs
docker logs huly-vibe-sync -f

# Check if sync completed
docker logs huly-vibe-sync 2>&1 | grep -E "State saved|sync completed"

# Count sync cycles
docker logs huly-vibe-sync 2>&1 | grep "Starting bidirectional sync" | wc -l
```

## Important Notes

1. **Initial sync takes 2-3 minutes** - This is normal for the first run
2. **State file**: Once created, enables incremental sync
   - Location: `/opt/stacks/huly-vibe-sync/logs/.sync-state.json`
   - Tracks last sync timestamp per project

3. **Sync interval**: Set to 30 seconds to allow initial sync to complete before next cycle

4. **REST API endpoint**: Uses Huly MCP server's built-in REST API
   - No separate container needed
   - API already existed in Huly stack at port 3457

## Next Steps (If Needed)

1. Monitor first sync completion
2. Verify incremental sync starts after state is saved
3. Can adjust `SYNC_INTERVAL` if needed (currently 30s)
4. State file will show timestamps for each project

## Architecture Decision

**Why we didn't create a separate Huly API container:**
The Huly MCP server (`huly-mcp` container in `/opt/stacks/huly-selfhost/`) already includes a fully functional REST API at `/api` endpoints. We leveraged this existing infrastructure instead of creating redundant services.

## Files Modified

```
/opt/stacks/huly-vibe-sync/
├── lib/HulyRestClient.js          (NEW - REST API client)
├── index.js                       (UPDATED - dual-mode support)
├── .env                           (UPDATED - REST config)
├── .env.example                   (UPDATED - REST config)
├── docker-compose.yml             (UPDATED - env vars)
├── Dockerfile                     (FIXED - include lib/)
├── README.md                      (UPDATED - docs)
└── test-rest-client.js            (NEW - testing)
```

## GitHub Actions Status

Latest build: **Success** ✓
- Workflow: Build and Push Docker Image
- Trigger: Push to main branch
- Output: `ghcr.io/oculairmedia/huly-vibe-sync:latest`
- Platforms: linux/amd64, linux/arm64

## Current Deployment

```bash
cd /opt/stacks/huly-vibe-sync
docker-compose ps
# Should show: huly-vibe-sync - Up and Healthy
```

---

**Resume Point**: The service is currently running its initial full sync. Monitor logs to see when it completes and incremental sync begins. All code is committed and deployed.
