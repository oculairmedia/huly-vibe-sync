# Control Agent Tool Synchronization

## Overview

The **Control Agent** (`Huly-PM-Control`) serves as the central configuration hub for all PM agents. When you update tools on the Control Agent, those changes can be automatically propagated to all PM agents.

## How It Works

```
┌─────────────────────────┐
│  Huly-PM-Control Agent  │  ← Update tools here
│  (Control Agent)        │
└────────────┬────────────┘
             │
             │ Sync Tools
             ├──────────────────────┐
             ↓                      ↓
    ┌────────────────┐     ┌────────────────┐
    │  PM Agent #1   │     │  PM Agent #2   │
    │  (Project A)   │     │  (Project B)   │
    └────────────────┘     └────────────────┘
             ↓                      ↓
           ... (N PM agents)  ...
```

### Key Features

1. **Central Configuration** - Update tools in one place (Control Agent)
2. **Automatic Propagation** - Tools sync to PM agents during each sync cycle
3. **Scale Management** - Manage 40+ PM agents from a single control point
4. **Flexible Modes**:
   - **Additive Mode** (default): Only adds new tools, never removes
   - **Force Mode**: Ensures exact match with Control Agent (adds + removes)

## Configuration

### Environment Variables

```bash
# Enable automatic tool sync (default: true)
LETTA_SYNC_TOOLS_FROM_CONTROL=true

# Force exact match with control agent (default: false)
# WARNING: This will REMOVE tools not in control agent
LETTA_SYNC_TOOLS_FORCE=false

# Control agent name (default: Huly-PM-Control)
LETTA_CONTROL_AGENT=Huly-PM-Control
```

### docker-compose.yml

```yaml
environment:
  - LETTA_SYNC_TOOLS_FROM_CONTROL=${LETTA_SYNC_TOOLS_FROM_CONTROL:-true}
  - LETTA_SYNC_TOOLS_FORCE=${LETTA_SYNC_TOOLS_FORCE:-false}
  - LETTA_CONTROL_AGENT=${LETTA_CONTROL_AGENT:-Huly-PM-Control}
```

## Usage

### Method 1: Automatic Sync (Built-in)

Tools automatically sync during regular sync cycles:

```bash
# Enable in .env
LETTA_SYNC_TOOLS_FROM_CONTROL=true

# Restart service
docker-compose restart huly-vibe-sync

# Tools will sync on next cycle (every 30 seconds)
```

**Behavior:**
- Runs during each project sync
- Only attaches new tools (doesn't remove)
- Safe for production use
- Logs all changes

### Method 2: Manual Sync (On-Demand)

Run the standalone script for immediate sync:

```bash
# Dry run (preview changes)
node sync-tools-from-control.js --dry-run

# Apply changes
node sync-tools-from-control.js
```

**Features:**
- Syncs all PM agents at once
- Shows detailed progress
- Reports summary of changes
- Useful for bulk updates

### Method 3: Programmatic (API)

Use the LettaService method directly:

```javascript
import { createLettaService } from './lib/LettaService.js';

const letta = createLettaService();

// Sync tools from control to specific agent (additive)
await letta.syncToolsFromControl(agentId, false);

// Force exact match (removes tools not in control)
await letta.syncToolsFromControl(agentId, true);
```

## Workflows

### Adding a New Tool to All PM Agents

1. **Update Control Agent** (via Letta UI or API):
   ```bash
   # Attach tool to control agent
   curl -X PATCH "https://letta.oculair.ca/v1/agents/CONTROL_AGENT_ID/tools/attach/TOOL_ID" \
     -H "Authorization: Bearer $LETTA_PASSWORD"
   ```

2. **Wait for Auto-Sync** (or trigger manually):
   ```bash
   # Option A: Wait ~30 seconds for next sync cycle
   docker-compose logs -f huly-vibe-sync | grep "Tools synced"
   
   # Option B: Trigger immediately
   node sync-tools-from-control.js
   ```

3. **Verify** (check any PM agent):
   ```bash
   curl -X GET "https://letta.oculair.ca/v1/agents/PM_AGENT_ID/tools" \
     -H "Authorization: Bearer $LETTA_PASSWORD" | jq '.[].name'
   ```

### Removing a Tool from All PM Agents

1. **Enable Force Mode**:
   ```bash
   echo "LETTA_SYNC_TOOLS_FORCE=true" >> .env
   docker-compose restart huly-vibe-sync
   ```

2. **Detach Tool from Control Agent**:
   ```bash
   curl -X PATCH "https://letta.oculair.ca/v1/agents/CONTROL_AGENT_ID/tools/detach/TOOL_ID" \
     -H "Authorization: Bearer $LETTA_PASSWORD"
   ```

3. **Verify Propagation**:
   ```bash
   # Check sync logs
   docker-compose logs huly-vibe-sync | grep "detached"
   ```

4. **Disable Force Mode** (optional):
   ```bash
   echo "LETTA_SYNC_TOOLS_FORCE=false" >> .env
   docker-compose restart huly-vibe-sync
   ```

### Creating a New "Tool Profile"

Control Agent can have different tool sets for different purposes:

```bash
# 1. Update control agent with new tool set
# 2. Run force sync to apply exact configuration
node sync-tools-from-control.js

# All PM agents now match control agent exactly
```

## Best Practices

### Development/Testing

```bash
LETTA_SYNC_TOOLS_FROM_CONTROL=true   # Auto-sync enabled
LETTA_SYNC_TOOLS_FORCE=false          # Additive only (safe)
```

**Benefits:**
- New tools automatically distribute
- Won't remove experimental tools from individual agents
- Safe for iterative development

### Production

```bash
LETTA_SYNC_TOOLS_FROM_CONTROL=true   # Auto-sync enabled
LETTA_SYNC_TOOLS_FORCE=true           # Exact match (strict)
```

**Benefits:**
- Guaranteed consistency across all PM agents
- No tool drift over time
- Easy auditing (all agents match control)

### Staging/Preview

```bash
# Dry run first
node sync-tools-from-control.js --dry-run

# Review changes before applying
node sync-tools-from-control.js
```

## Monitoring

### Check Sync Status

```bash
# View sync logs
docker-compose logs -f huly-vibe-sync | grep -E "(Syncing tools|Tools synced)"

# Example output:
# [Letta] Syncing tools from control agent...
# [Letta] ✓ Tools synced: 3 attached, 0 detached
```

### Verify Agent Configuration

```bash
# List tools on control agent
curl -s "https://letta.oculair.ca/v1/agents/CONTROL_AGENT_ID/tools" \
  -H "Authorization: Bearer $LETTA_PASSWORD" | jq '.[].name'

# Compare with PM agent
curl -s "https://letta.oculair.ca/v1/agents/PM_AGENT_ID/tools" \
  -H "Authorization: Bearer $LETTA_PASSWORD" | jq '.[].name'
```

### Audit All Agents

```bash
# Run sync script with dry-run to see current state
node sync-tools-from-control.js --dry-run

# Shows which agents need updates
```

## Troubleshooting

### Tools Not Syncing

**Check:** Is auto-sync enabled?
```bash
grep LETTA_SYNC_TOOLS_FROM_CONTROL .env
# Should show: LETTA_SYNC_TOOLS_FROM_CONTROL=true
```

**Check:** Are there errors in logs?
```bash
docker-compose logs huly-vibe-sync | grep "Error syncing tools"
```

**Fix:** Run manual sync to see detailed errors
```bash
node sync-tools-from-control.js
```

### Tools Being Removed Unexpectedly

**Cause:** Force mode is enabled

**Fix:** Disable force mode
```bash
# Edit .env
LETTA_SYNC_TOOLS_FORCE=false

# Restart
docker-compose restart huly-vibe-sync
```

### Sync Takes Too Long

**Cause:** 40+ agents × rate limits = slow sync

**Solution:** Tools sync in background during regular sync cycles. No action needed unless using manual script.

**Optimize Manual Sync:**
```bash
# Manual script includes rate limiting (200ms per tool)
# For 40 agents × 10 tools = ~80 seconds total
# This is expected behavior
```

## Architecture

### Control Agent Structure

```javascript
{
  id: "agent-xxx",
  name: "Huly-PM-Control",
  tools: [
    { id: "tool-aaa", name: "huly_query" },
    { id: "tool-bbb", name: "huly_issue_ops" },
    { id: "tool-ccc", name: "vibe_list_tasks" },
    // ... more tools
  ]
}
```

### Sync Process Flow

```
1. Get Control Agent → tools: [A, B, C, D]
2. Get PM Agent     → tools: [A, B, X]
3. Calculate Diff   → attach: [C, D], detach: [X] (if force)
4. Apply Changes    → attach C, attach D, (detach X)
5. Log Result       → "2 attached, 0 detached"
```

### Rate Limiting

- **200ms delay** between tool operations
- Prevents API rate limit errors
- ~5 tools per second per agent

## Security Considerations

### Force Mode Risks

⚠️ **WARNING:** Force mode will remove tools from PM agents!

**Safe Use:**
- Only enable when you want exact replication
- Test with dry-run first
- Audit control agent tools before enabling

**Example Disaster:**
```bash
# BAD: Control agent accidentally has 0 tools
# Force mode ON → ALL PM agents lose ALL tools
```

**Prevention:**
```bash
# Always verify control agent first
node sync-tools-from-control.js --dry-run
```

### Access Control

Only administrators with Letta API access can:
- Modify Control Agent tools
- Enable/disable sync
- Run manual sync scripts

## Examples

### Example 1: Add ToolSelector to All Agents

```bash
# 1. Find ToolSelector tool ID
curl -s "https://letta.oculair.ca/v1/tools?limit=500" \
  -H "Authorization: Bearer $LETTA_PASSWORD" \
  | jq -r '.[] | select(.name | contains("selector")) | {id, name}'

# 2. Attach to Control Agent
curl -X PATCH "https://letta.oculair.ca/v1/agents/CONTROL_AGENT_ID/tools/attach/TOOL_ID" \
  -H "Authorization: Bearer $LETTA_PASSWORD"

# 3. Auto-sync propagates to all PM agents within 30 seconds
```

### Example 2: Standardize All Agents

```bash
# Current state: PM agents have varying tool sets
# Goal: All agents have exact same tools as control

# Enable force mode
echo "LETTA_SYNC_TOOLS_FORCE=true" >> .env
docker-compose restart huly-vibe-sync

# Wait for next sync cycle or trigger manually
node sync-tools-from-control.js

# Verify all agents match
node sync-tools-from-control.js --dry-run
# Should show: "0 to attach, 0 to detach" for all agents
```

### Example 3: Progressive Rollout

```bash
# Phase 1: Add tool to control agent
# (Tools auto-sync to PM agents in additive mode)

# Phase 2: Wait 1 week for testing

# Phase 3: Enable force mode to remove old tools
echo "LETTA_SYNC_TOOLS_FORCE=true" >> .env
docker-compose restart huly-vibe-sync
```

## API Reference

### syncToolsFromControl(agentId, forceSync)

Syncs tools from control agent to a PM agent.

**Parameters:**
- `agentId` (string): PM Agent ID
- `forceSync` (boolean): If true, detach tools not in control agent

**Returns:**
```javascript
{
  total: 10,         // Total tools in control agent
  attached: 3,       // Tools attached during sync
  detached: 1,       // Tools detached (if forceSync)
  skipped: 6,        // Tools already attached
  errors: []         // Array of {toolId, operation, error}
}
```

**Example:**
```javascript
const result = await lettaService.syncToolsFromControl(agentId, false);
console.log(`Synced: ${result.attached} attached, ${result.detached} detached`);
```

## Related Documentation

- [Letta Agent Architecture](./docs/LETTA_AGENT_ARCHITECTURE.md)
- [Tool Management Guide](./docs/TOOL_MANAGEMENT.md)
- [PM Agent Configuration](./docs/PM_AGENT_CONFIG.md)

## Changelog

**2025-11-03** - Initial implementation
- Added `syncToolsFromControl()` method to LettaService
- Created standalone `sync-tools-from-control.js` script
- Integrated auto-sync into main sync loop
- Added environment variables for configuration
- Created comprehensive documentation
