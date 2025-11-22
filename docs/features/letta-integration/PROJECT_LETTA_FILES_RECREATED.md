# Project .letta Files Recreation Summary

**Date**: 2025-11-05  
**Issue**: Project-specific `.letta/settings.local.json` files missing after cleanup  
**Status**: ✅ **RESOLVED**

## Problem

After clearing all agent state and creating fresh agents, the project-specific `.letta/settings.local.json` files in each project directory (`/opt/stacks/{project}/.letta/settings.local.json`) were not being created automatically. These files allow running `letta` from a project directory to auto-resume the correct agent.

## Root Cause

During the cleanup phase, we deleted all `.letta` folders from project directories:

```bash
find /opt/stacks -type d -name ".letta" ! -path "*/huly-vibe-sync/*" -exec rm -rf {} +
```

The SyncOrchestrator was calling `lettaService.saveAgentId()` to save to the central file, but not `lettaService.saveAgentIdToProjectFolder()` to save to project-specific locations.

## Solution

### 1. Updated SyncOrchestrator.js

Added project-specific save after agent creation:

```javascript
// Persist to database
db.setProjectLettaAgent(projectIdentifier, { agentId: agent.id });
lettaService.saveAgentId(projectIdentifier, agent.id);

// Save to project-specific .letta folder
const projectPath = determineGitRepoPath(hulyProject);
if (projectPath) {
  lettaService.saveAgentIdToProjectFolder(projectPath, agent.id);
}
```

**File**: `lib/SyncOrchestrator.js` (lines 277-284)

### 2. Created Recreation Script

Created `recreate-project-letta-files.js` to recreate all missing `.letta/settings.local.json` files for existing agents.

**Script features**:

- Reads agent IDs from database
- Gets filesystem paths for each project
- Creates `.letta` directory if missing
- Writes `settings.local.json` with correct agent ID
- Creates `.gitignore` to exclude settings from git

### 3. Executed Recreation

```bash
node recreate-project-letta-files.js
```

**Results**:

- ✅ **Created**: 38 new `.letta/settings.local.json` files
- ✅ **Updated**: 2 existing files (LMS, VIBEK)
- ⚠️ **Skipped**: 2 projects (RDCLE, TMCP - paths don't exist)
- ✅ **Total**: 40 out of 42 projects successfully configured

## File Format

Each project's `.letta/settings.local.json` follows Letta Code's standard format:

```json
{
  "lastAgent": "agent-{uuid}"
}
```

**Example** (`/opt/stacks/bookstack-mcp/.letta/settings.local.json`):

```json
{
  "lastAgent": "agent-c8487d94-c01e-4bb8-be27-2d976bd735c1"
}
```

## Verification

### Sample Verifications

#### BKMCP (BookStack MCP)

```bash
# File content
cat /opt/stacks/bookstack-mcp/.letta/settings.local.json
{
  "lastAgent": "agent-c8487d94-c01e-4bb8-be27-2d976bd735c1"
}

# Agent in Letta
curl -s "http://192.168.50.90:8289/v1/agents/agent-c8487d94-c01e-4bb8-be27-2d976bd735c1" \
  -H "Authorization: Bearer lettaSecurePass123" | jq '{name, id}'
{
  "name": "Huly - BookStack MCP",
  "id": "agent-c8487d94-c01e-4bb8-be27-2d976bd735c1"
}
```

#### LMS (Letta MCP Server)

```bash
# File content
cat /opt/stacks/letta-MCP-server/.letta/settings.local.json
{
  "lastAgent": "agent-13eb4426-b06f-4d35-ae5a-5d6ca80409f5"
}

# Agent in Letta
{
  "name": "Huly - Letta MCP Server",
  "id": "agent-13eb4426-b06f-4d35-ae5a-5d6ca80409f5"
}
```

### Complete Verification

All 40 project-specific settings files verified to match their corresponding Letta agents.

## Files Created/Modified

### New Files

1. **`recreate-project-letta-files.js`** - Script to recreate project settings files
2. **40 × `.letta/settings.local.json`** - Project-specific agent settings
3. **40 × `.letta/.gitignore`** - Exclude settings from git

### Modified Files

1. **`lib/SyncOrchestrator.js`** - Added project-specific save call

## Directory Structure

Each project now has:

```
/opt/stacks/{project}/
├── .letta/
│   ├── settings.local.json  # Agent ID
│   └── .gitignore           # Git ignore rules
└── ... (project files)
```

## Benefits

1. **Letta Code Integration**: Can run `letta` from any project directory and it auto-resumes the correct agent
2. **Project Isolation**: Each project tracks its own agent independently
3. **Git Safe**: `.gitignore` prevents committing agent IDs to version control
4. **Automatic Creation**: Future agents will have settings files created automatically
5. **Easy Recovery**: Recreation script can rebuild all settings from database

## Usage

### From Project Directory

```bash
cd /opt/stacks/bookstack-mcp
letta  # Automatically resumes agent-c8487d94-c01e-4bb8-be27-2d976bd735c1
```

### Recreate All Files

```bash
cd /opt/stacks/huly-vibe-sync
node recreate-project-letta-files.js
```

## Skipped Projects

Two projects were skipped because their filesystem paths don't exist:

1. **RDCLE** (Radicale) - Path: `/opt/stacks/radicale`
2. **TMCP** (TurboMCP) - Path: `/opt/stacks/turbomcp`

These can be recreated manually once the project directories exist.

## Future Considerations

1. **New Projects**: Will automatically get `.letta/settings.local.json` created on first agent creation
2. **Re-run Script**: Safe to re-run recreation script - will update existing files
3. **Manual Cleanup**: If deleting an agent, also delete the project's `.letta/settings.local.json`
4. **Backup**: Consider backing up `.letta` folders before cleanup operations

## Related Documentation

- See `SESSION_SUMMARY_2025-11-05_SLEEPTIME_ENV_VAR.md` for full session context
- See `lib/LettaService.js` lines 278-307 for `saveAgentIdToProjectFolder()` implementation
- See `lib/SyncOrchestrator.js` lines 277-284 for automatic save on agent creation

## Conclusion

✅ All 40 accessible project directories now have correct `.letta/settings.local.json` files  
✅ Agent IDs verified to match Letta server  
✅ Future agent creations will automatically create project files  
✅ Recreation script available for recovery if needed
