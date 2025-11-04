# Control Agent Tool Sync - Quick Start

## What You Got

**Centralized tool management** for all 42 PM agents via the Control Agent (`Huly-PM-Control`).

Update tools on the Control Agent → They automatically propagate to all PM agents.

## How to Use It

### Add a Tool to All PM Agents

1. **Attach tool to Control Agent** (via Letta UI or API):
```bash
curl -X PATCH "https://letta.oculair.ca/v1/agents/agent-0a2b4b2e-c578-4b04-93d6-00f0e1639507/tools/attach/TOOL_ID" \
  -H "Authorization: Bearer $LETTA_PASSWORD"
```

2. **Wait ~30 seconds** (or restart service for immediate sync):
```bash
docker-compose restart huly-vibe-sync
```

3. **Done!** All 42 PM agents now have the new tool.

### Remove a Tool from All PM Agents

1. **Enable force mode** (temporarily):
```bash
# Edit .env
LETTA_SYNC_TOOLS_FORCE=true

# Restart
docker-compose restart huly-vibe-sync
```

2. **Detach tool from Control Agent**:
```bash
curl -X PATCH "https://letta.oculair.ca/v1/agents/agent-0a2b4b2e-c578-4b04-93d6-00f0e1639507/tools/detach/TOOL_ID" \
  -H "Authorization: Bearer $LETTA_PASSWORD"
```

3. **Wait for sync** (or restart)

4. **Disable force mode**:
```bash
LETTA_SYNC_TOOLS_FORCE=false
docker-compose restart huly-vibe-sync
```

## Manual Sync (Immediate)

```bash
# Preview changes
node sync-tools-from-control.js --dry-run

# Apply changes
node sync-tools-from-control.js
```

## Configuration

**Current Settings** (in `.env`):
```bash
LETTA_SYNC_TOOLS_FROM_CONTROL=true   # Auto-sync enabled
LETTA_SYNC_TOOLS_FORCE=false          # Additive mode (won't remove tools)
LETTA_CONTROL_AGENT=Huly-PM-Control   # Control agent name
```

## Current State

**Control Agent Tools** (10 tools):
- list_projects
- get_task  
- list_tasks
- update_task
- huly_query
- huly_issue_ops
- huly_entity
- memory_replace
- memory_insert
- conversation_search

**PM Agents Managed**: 42 agents

**Sync Status**: All agents have 7 matching tools, need 3 new tools added (memory tools)

## Examples

### Example: Add ToolSelector to All Agents

```bash
# 1. Find ToolSelector tool ID
curl -s "https://letta.oculair.ca/v1/tools?limit=500" \
  -H "Authorization: Bearer $LETTA_PASSWORD" \
  | jq -r '.[] | select(.name | contains("selector")) | {id, name}'

# 2. Attach to Control Agent  
curl -X PATCH "https://letta.oculair.ca/v1/agents/agent-0a2b4b2e-c578-4b04-93d6-00f0e1639507/tools/attach/TOOL_ID" \
  -H "Authorization: Bearer $LETTA_PASSWORD"

# 3. Done! Auto-syncs within 30 seconds
```

### Example: Verify Sync

```bash
# Check sync logs
docker-compose logs -f huly-vibe-sync | grep "Tools synced"

# Output:
# [Letta] ✓ Tools synced: 3 attached, 0 detached
```

## Safety Features

- **Additive by default** - Won't remove tools unless force mode enabled
- **Dry-run support** - Preview changes before applying
- **Rate limiting** - 200ms delay between tool operations
- **Error handling** - Continues sync even if individual tools fail
- **Logging** - All changes logged for audit trail

## More Info

See `CONTROL_AGENT_TOOL_SYNC.md` for complete documentation.
