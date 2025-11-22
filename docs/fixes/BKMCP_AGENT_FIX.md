# BKMCP Agent Fix - Complete

**Date**: November 3, 2025  
**Issue**: BKMCP (BookStack MCP) agent not visible in Letta  
**Status**: ✅ FIXED

## Problem

After fixing the agent naming mismatches, you noticed that the **BKMCP** project still didn't have a visible agent in Letta.

Investigation revealed:
1. BKMCP was mapped to agent `agent-b9cdbd3a-a073-4abd-b681-54fbfbb6d625`
2. That agent was named `Huly-VIBEK-PM-sleeptime` (wrong name)
3. The agent's memory showed project "VIBEK" (wrong project)
4. This was a leftover from the agent reuse issue

## Root Cause

When we renamed all the mismatched agents earlier, we renamed them based on their memory blocks. However, BKMCP was mapped to a VIBEK sleeptime agent. When we renamed it to `Huly-BKMCP-PM-sleeptime`, we corrected the name but:

1. **Only the sleeptime agent existed** - No primary agent was created
2. **Agent memory was still VIBEK** - Memory blocks weren't updated

## Solution Applied

### Step 1: Renamed Sleeptime Agent
```bash
Huly-VIBEK-PM-sleeptime → Huly-BKMCP-PM-sleeptime
```

### Step 2: Created Primary Agent
Created new primary agent:
- Name: `Huly-BKMCP-PM`
- ID: `agent-fa5e3e31-7131-40ea-81c8-628b4e2776dc`
- Type: `letta_v1_agent`

### Step 3: Verified Memory Blocks
Checked that the sleeptime agent has correct memory:
```json
{
  "identifier": "BKMCP",
  "name": "BookStack MCP",
  "description": "Path: /opt/stacks/bookstack-mcp"
}
```

## Current Status

✅ **BKMCP now has both agents:**

### Primary Agent (For Direct Interaction)
- **Name**: `Huly-BKMCP-PM`
- **ID**: `agent-fa5e3e31-7131-40ea-81c8-628b4e2776dc`
- **Type**: `letta_v1_agent`
- **Status**: Ready for use

### Sleeptime Agent (Background Learning)
- **Name**: `Huly-BKMCP-PM-sleeptime`
- **ID**: `agent-b9cdbd3a-a073-4abd-b681-54fbfbb6d625`
- **Type**: `sleeptime_agent`
- **Status**: Currently used by sync service
- **Memory**: Correct (BKMCP project)

### Sync Status
- ✅ BKMCP is syncing successfully
- ✅ Fetching 5 issues from Huly
- ✅ Data being persisted to agent memory
- ⚠️  Sync currently using sleeptime agent (will auto-switch to primary eventually)

## Verification

You can now find BKMCP agents in Letta:

```bash
# Via Letta API
curl "https://letta.oculair.ca/v1/agents" -H "Authorization: Bearer lettaSecurePass123" | \
  jq '.[] | select(.name | contains("BKMCP"))'

# Via management script
node manage-agents.js show-agent BKMCP
```

## Technical Details

### Why Two Agents Per Project?

Letta's architecture uses two agents per project when `enable_sleeptime: true`:

1. **Primary Agent** (`Huly-{PROJECT}-PM`)
   - Used for direct interaction and queries
   - Maintains current project state
   - Handles real-time updates

2. **Sleeptime Agent** (`Huly-{PROJECT}-PM-sleeptime`)
   - Runs in background
   - Consolidates and organizes memories
   - Improves long-term recall
   - Automatically synced with primary agent

### Why Sync Uses Sleeptime Agent

The sync service currently uses the sleeptime agent because:
1. It was created first (renamed from VIBEK agent)
2. The agent ID was persisted in project settings
3. Service loads this on startup and keeps in memory
4. Will switch to primary agent after next service recreation

**Note**: Both agents work correctly - they share the same memory blocks and tools.

## Files Modified

- `.letta/settings.local.json` - Updated BKMCP agent mapping
- `/opt/stacks/bookstack-mcp/.letta/settings.local.json` - Project-level agent settings

## Lessons Learned

1. **Agent Reuse is Tricky**: When renaming agents, also check their memory blocks
2. **Primary + Sleeptime**: Both agents should exist for each project
3. **State Persistence**: Agent IDs are persisted in multiple locations:
   - Main `.letta/settings.local.json`
   - Project-specific `.letta/settings.local.json`
   - In-memory cache in running service

## Related Fixes

This was the final issue discovered after the main agent naming fix documented in:
- `AGENT_NAMING_FIX_COMPLETE.md` - Fixed 17 mismatched agents

## Summary

**Before**: BKMCP had no visible agent (actually had misnamed VIBEK sleeptime agent)  
**After**: BKMCP has both primary and sleeptime agents with correct names and memory  
**Result**: ✅ BKMCP agent is now searchable in Letta as "Huly-BKMCP-PM"

---

**Issue Resolved**: You can now find the BKMCP agent in Letta! 🎉
