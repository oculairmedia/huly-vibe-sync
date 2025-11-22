# Huly-Vibe-Sync File Upload Status
**Date:** 2025-11-04  
**Issue:** Agents missing project files/folders

---

## Problem Discovered

When checking agents in Letta, they had **no folders or files attached**, even though the sync service is supposed to upload project files to Letta for agent context.

## Root Causes Found

### 1. **First-Time Setup Skipped**
The file upload code only runs during "first-time agent setup" (when agent is newly created). Since agents were recreated after cleanup but state files still existed, the system thought agents weren't new.

**Fix Applied:** Cleared state files to trigger first-time setup

### 2. **Environment Variables Missing** 
The critical environment variables weren't passed to the Docker container:
- `LETTA_UPLOAD_PROJECT_FILES`
- `LETTA_ATTACH_REPO_DOCS`
- `LETTA_MODEL`
- `LETTA_EMBEDDING`

**Fix Applied:** Added all Letta feature flags to `docker-compose.yml`

### 3. **State Stored in Multiple Locations**
Agent state is persisted in TWO places:
1. **Database:** `/app/logs/sync-state.db` - Project metadata including `letta_agent_id`
2. **Local State JSON:** `/app/.letta/settings.local.json` - Centralized agent mapping
3. **Per-Project Files:** `/opt/stacks/[project]/.letta/settings.local.json` - Letta CLI integration

When cleaning up, ALL THREE need to be cleared to trigger first-time setup.

---

## Current Status

### ✅ Fixed
1. Docker-compose now includes all Letta feature flags
2. Folders are being created and attached to agents
3. File upload is attempting to run

### ⚠️ Partial Issues
File upload is running but hitting errors:
- **409 Conflicts:** Some files/sources already exist (from previous runs)
- **"Response body disturbed" errors:** SDK/API issue with file upload

### Example Success
```bash
# OpenCode Project agent now has folder attached:
Folder: Huly-OPCDE-root (source-d40d0d70-10fc-45e9-98cb-64ad725db000)
```

---

## Files Modified

### docker-compose.yml
Added Letta environment variables:
```yaml
# Letta Integration
- LETTA_BASE_URL=${LETTA_BASE_URL}
- LETTA_PASSWORD=${LETTA_PASSWORD}
- HULY_MCP_URL=${HULY_MCP_URL:-http://192.168.50.90:3457/mcp}
- LETTA_MODEL=${LETTA_MODEL:-anthropic/sonnet-4-5}
- LETTA_EMBEDDING=${LETTA_EMBEDDING:-letta/letta-free}
- LETTA_ATTACH_REPO_DOCS=${LETTA_ATTACH_REPO_DOCS:-true}
- LETTA_UPLOAD_PROJECT_FILES=${LETTA_UPLOAD_PROJECT_FILES:-true}
- LETTA_SEND_MESSAGES=${LETTA_SEND_MESSAGES:-false}
- LETTA_CONTROL_AGENT=${LETTA_CONTROL_AGENT:-Huly-PM-Control}
```

---

## Next Steps (To Complete File Upload)

### P0 - Fix Upload Errors
1. **Investigate 409 conflicts:**
   - Check if sources/folders already exist from previous runs
   - Add idempotency logic to handle existing files
   - Or clear old sources before retry

2. **Fix "Response body disturbed" errors:**
   - This is a JavaScript fetch/stream issue
   - Likely in `LettaService.uploadReadme()` or `uploadProjectFiles()`
   - May need to clone request body before reading it

### P1 - Verify Upload Success
1. Check that files appear in folders: `GET /v1/folders/{folder_id}/files`
2. Verify file content is accessible to agents
3. Test agent can search/retrieve file content

### P2 - Monitoring
1. Add success/failure metrics for file uploads
2. Log file count and total size uploaded per project
3. Alert if upload fails consistently

---

## Code Locations

### Where File Upload Happens
**File:** `/opt/stacks/huly-vibe-sync/index.js`  
**Lines:** 1126-1136

```javascript
// Upload project files to folder (first time only)
if (process.env.LETTA_UPLOAD_PROJECT_FILES === 'true') {
  console.log(`[Letta] Discovering and uploading project files...`);
  const files = await lettaService.discoverProjectFiles(filesystemPath);
  if (files.length > 0) {
    await lettaService.uploadProjectFiles(fsFolder.id, filesystemPath, files, 50);
    console.log(`[Letta] ✓ Project files uploaded to agent folder`);
  } else {
    console.log(`[Letta] No files found to upload`);
  }
}
```

### Where Errors Need Fixing
**File:** `/opt/stacks/huly-vibe-sync/lib/LettaService.js`  
**Methods:**
- `uploadReadme()` - README file upload
- `uploadProjectFiles()` - Bulk file upload
- `ensureSource()` - Source/folder creation

---

## Testing Commands

### Check Agent Folders
```bash
export LETTA_BASE_URL=http://192.168.50.90:8289
export LETTA_PASSWORD=lettaSecurePass123

# Get agent ID
AGENT_ID=$(curl -s "${LETTA_BASE_URL}/v1/agents?tags=huly-vibe-sync&limit=1" \
  -H "Authorization: Bearer ${LETTA_PASSWORD}" | jq -r '.[0].id')

# List folders attached to agent
curl -s "${LETTA_BASE_URL}/v1/agents/${AGENT_ID}/folders" \
  -H "Authorization: Bearer ${LETTA_PASSWORD}" | jq '.'
```

### Check Folder Files
```bash
# Get folder ID from agent
FOLDER_ID=$(curl -s "${LETTA_BASE_URL}/v1/agents/${AGENT_ID}/folders" \
  -H "Authorization: Bearer ${LETTA_PASSWORD}" | jq -r '.[0].id')

# List files in folder
curl -s "${LETTA_BASE_URL}/v1/folders/${FOLDER_ID}/files?limit=10" \
  -H "Authorization: Bearer ${LETTA_PASSWORD}" | jq '[.[] | {file_name, file_size, status: .processing_status}]'
```

### Check Upload Logs
```bash
docker logs huly-vibe-sync 2>&1 | grep -E "uploading|uploaded|Discovering.*files"
```

---

## Conclusion

**Progress Made:** ✅
- Identified why files weren't uploading (missing env vars + skipped first-time setup)
- Fixed docker-compose configuration
- Folders now being created and attached to agents
- File upload attempting to run

**Still Broken:** ⚠️
- File upload hitting 409 and body stream errors
- No files successfully uploaded yet
- Need to debug LettaService upload methods

**Next Session:** Fix the upload errors in LettaService.js to complete file upload feature.
