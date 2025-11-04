# Agent Type Fix - Completed

## Problem Statement

The huly-vibe-sync service was incorrectly using **sleeptime agents** instead of **primary agents** for project management tasks. Letta creates two types of agents per project when `enable_sleeptime: true`:

- **Primary Agent** (`Huly-{PROJECT}-PM`) - For direct interaction and PM tasks
- **Sleeptime Agent** (`Huly-{PROJECT}-PM-sleeptime`) - For background memory consolidation

The sync service should ALWAYS use primary agents, but the database contained sleeptime agent IDs which were being reused across sync runs.

## Root Cause

1. **Letta SDK Issue**: The `agents.retrieve()` method doesn't return the `agent_type` field, returning `undefined` instead
2. **Database Persistence**: Once a sleeptime agent ID was saved to the database, it would be reused indefinitely
3. **Settings File Persistence**: Agent IDs were also persisted to `.letta/settings.local.json` which reinforced the wrong mappings

## Solution Implemented

### Modified Files

1. **`index.js` (line 1138-1147)**: Added sleeptime agent detection
   - Checks if agent name ends with `-sleeptime`
   - Throws error to force recreation with primary agent
   - Logs warning for visibility

2. **`lib/LettaService.js` (line 327-330)**: Added fallback check in `ensureAgent()`
   - Validates `agent_type === 'sleeptime_agent'` when SDK returns it
   - Falls through to search for primary agent by name

### Fix Logic

```javascript
// Check agent name since SDK doesn't return agent_type reliably
if (existingAgent.name && existingAgent.name.endsWith('-sleeptime')) {
  console.warn(`[Letta] ⚠️  Database has sleeptime agent ${lettaInfo.letta_agent_id} (${existingAgent.name}), forcing recreation with primary agent`);
  throw new Error('Sleeptime agent detected, forcing recreation');
}
```

When a sleeptime agent is detected, the error is caught and the service:
1. Calls `ensureAgent()` to find/create the correct primary agent
2. Attaches all necessary tools and memory blocks
3. Updates the database with the new primary agent ID
4. Updates `.letta/settings.local.json` files

## Results

### Projects Fixed (Example from Logs)

✅ **OPCDE** (OpenCode):
- OLD: `agent-4e31ab6f-a0c6-4222-8f45-58722f9babbe` (sleeptime)
- NEW: `agent-fa5e3e31-7131-40ea-81c8-628b4e2776dc` (primary)

✅ **BKMCP** (BookStack MCP):
- OLD: `agent-b9cdbd3a-a073-4abd-b681-54fbfbb6d625` (sleeptime)
- NEW: `agent-63f8ac7c-f5f5-4d81-9bc5-aae1a593991d` (primary)

✅ **LMS** (Letta MCP Server):
- OLD: `agent-99edecca-d875-4d9e-b04b-41b74b1c9e6e` (sleeptime)
- NEW: `agent-812ea809-b316-47c3-a39d-304b8be7c35e` (primary)

### Expected Impact

- **All 42 projects** will now use primary agents
- Sleeptime agents detected on first run after container restart
- Automatic fix with full tool/memory/folder reattachment
- One-time fix - subsequent runs will use correct primary agents

## Validation

To verify the fix is working:

```bash
# Check logs for sleeptime detection
docker logs huly-vibe-sync 2>&1 | grep "sleeptime"

# Query database to see current mappings
cd /opt/stacks/huly-vibe-sync
sqlite3 logs/sync-state.db "SELECT identifier, letta_agent_id FROM projects WHERE identifier IN ('OPCDE', 'BKMCP', 'LMS');"

# Verify agent types via Letta API
curl -s http://192.168.50.90:8289/v1/agents/{agent-id} -H "Authorization: Bearer lettaSecurePass123" | jq '{name, agent_type}'
```

## Additional Cleanup Needed

The logs show **47-49 duplicate agents** per project name due to past issues. Run the cleanup script:

```bash
cd /opt/stacks/huly-vibe-sync
node cleanup-agents.js
```

## Status

✅ **Fix Deployed**: Docker container rebuilt with fix (2025-11-02 23:19)  
✅ **Automated Detection**: Service now automatically detects and corrects sleeptime agents  
✅ **One-Time Fix**: Each project fixes itself on first sync after container restart  
⚠️  **Duplicate Cleanup**: Manual cleanup of duplicate agents recommended but not required

## Technical Notes

- Fix works despite Letta SDK not returning `agent_type` field
- Uses agent name pattern matching as reliable fallback
- Graceful error handling ensures no sync interruptions
- All agent configurations (tools, memory, folders) properly reattached

## Date

**Completed**: November 2, 2025 @ 23:20 EST
**Session**: Agent Type Fix and System Optimization
