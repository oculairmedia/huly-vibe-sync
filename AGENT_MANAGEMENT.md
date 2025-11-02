# Agent Management Guide

This guide covers how to manage deployed Letta agents without recreating them.

## Overview

The `manage-agents.js` CLI provides commands to modify deployed agents:
- View agent details and memory blocks
- Update memory blocks (persona, config, metadata)
- Add/delete memory blocks
- Attach/detach tools
- Bulk operations across all agents

## Quick Start

```bash
# List all agents
npm run agents

# Show specific agent details
node manage-agents.js show-agent GRAPH

# Update persona for all agents
node manage-agents.js update-persona-all

# Update board config for specific agent
node manage-agents.js update-block GRAPH board_config
```

## Commands Reference

### Agent Information

**List all Huly agents:**
```bash
node manage-agents.js list-agents
# or
npm run agents
```

**Show agent details with memory blocks and tools:**
```bash
node manage-agents.js show-agent <name|id>

# Examples:
node manage-agents.js show-agent GRAPH
node manage-agents.js show-agent Huly-GRAPH-PM
node manage-agents.js show-agent agent-1a0ad2a8-a565-4b03-8e03-2a2e649d285d
```

### Memory Block Management

**Update a memory block for one agent:**
```bash
node manage-agents.js update-block <agent> <label>

# Examples:
node manage-agents.js update-block GRAPH project
node manage-agents.js update-block GRAPH board_config
node manage-agents.js update-block GRAPH persona
```

**Update a memory block for ALL agents:**
```bash
node manage-agents.js update-block-all <label>

# Examples:
node manage-agents.js update-block-all board_config
node manage-agents.js update-block-all persona
```

**Supported block labels:**
- `project` - Project metadata (name, paths, URLs)
- `board_config` - Status mapping and workflow configuration
- `persona` - Agent personality and role description

**Note:** Other blocks (`board_metrics`, `hotspots`, `backlog_summary`, `change_log`) require issue data and are updated automatically by the sync service.

**Add a new custom memory block:**
```bash
node manage-agents.js add-block <agent> <label> <value>

# Example:
node manage-agents.js add-block GRAPH custom_notes "Remember to focus on performance"
```

**Delete a memory block:**
```bash
node manage-agents.js delete-block <agent> <label>

# Example:
node manage-agents.js delete-block GRAPH custom_notes
```

### Tool Management

**List tools attached to an agent:**
```bash
node manage-agents.js list-tools <agent>

# Example:
node manage-agents.js list-tools GRAPH
```

**Attach a tool to an agent:**
```bash
node manage-agents.js attach-tool <agent> <tool-id>

# Example:
node manage-agents.js attach-tool GRAPH tool-12345678-1234-1234-1234-123456789abc
```

**Detach a tool from an agent:**
```bash
node manage-agents.js detach-tool <agent> <tool-id>

# Example:
node manage-agents.js detach-tool GRAPH tool-12345678-1234-1234-1234-123456789abc
```

### Persona Management

**Update persona for one agent:**
```bash
node manage-agents.js update-persona <agent>

# Example:
node manage-agents.js update-persona GRAPH
```

**Update persona for ALL agents:**
```bash
node manage-agents.js update-persona-all
```

This is useful when you've modified the persona template in `lib/LettaService.js` and want to update all agents.

## Common Workflows

### Updating Agent Persona

If you modify the persona template in `lib/LettaService.js`:

```bash
# Preview changes for one agent
node manage-agents.js show-agent GRAPH

# Update one agent to test
node manage-agents.js update-persona GRAPH

# If satisfied, update all agents
node manage-agents.js update-persona-all
```

### Updating Board Configuration

After changing status mappings or workflow rules:

```bash
# Update all agents at once
node manage-agents.js update-block-all board_config
```

### Updating Project Metadata

If a project's filesystem path or git URL changes:

```bash
# Update database first
sqlite3 logs/sync-state.db "UPDATE projects SET filesystem_path='/new/path' WHERE identifier='GRAPH';"

# Update agent memory
node manage-agents.js update-block GRAPH project
```

### Adding Custom Context

Add custom notes or context to specific agents:

```bash
# Add custom block
node manage-agents.js add-block GRAPH team_notes "Team is focused on Q4 performance goals"

# Verify it was added
node manage-agents.js show-agent GRAPH
```

### Inspecting Agent State

To debug or understand what an agent knows:

```bash
# Show all memory blocks
node manage-agents.js show-agent GRAPH

# Check attached tools
node manage-agents.js list-tools GRAPH
```

## Safety Features

- **Confirmation prompts**: Destructive operations (delete, bulk updates) require 3-5 second confirmation
- **Content hashing**: Updates are skipped if content hasn't changed (you'll see "No changes needed")
- **Database validation**: Commands verify project exists in database before proceeding
- **Preview mode**: Block updates show content preview before applying

## Troubleshooting

**"Agent not found" error:**
- Check spelling of agent name
- Use `list-agents` to see all available agents
- Try using project ID instead of full name (e.g., `GRAPH` instead of `Huly-GRAPH-PM`)

**"Block already exists" error when adding:**
- Use `update-block` instead of `add-block`
- Use `show-agent` to see existing blocks

**"Project not found in database" error:**
- Ensure the sync service has run at least once
- Check database: `sqlite3 logs/sync-state.db "SELECT identifier, name FROM projects;"`

**Content hashing says "No changes needed":**
- This is normal if the content is identical
- The system is working correctly - no API call was made

## Performance Tips

- Use `update-block-all` for bulk changes instead of scripting individual updates
- Memory blocks are automatically optimized with content hashing - unchanged blocks are skipped
- Large operations show progress: "Updated: X, Skipped: Y, Errors: Z"

## Integration with Sync Service

The management CLI operates independently of the sync service:

- **Sync service**: Updates dynamic blocks (metrics, hotspots, changelog) based on issue data
- **Management CLI**: Updates static blocks (persona, config, metadata) based on code/config changes

Both use the same underlying database and API, ensuring consistency.

## Examples

**Full agent inspection:**
```bash
# See everything about an agent
node manage-agents.js show-agent GRAPH

# Output includes:
# - Agent ID, type, model
# - All memory blocks with sizes
# - All attached tools
```

**Bulk persona update after code change:**
```bash
# Edit persona in lib/LettaService.js
vim lib/LettaService.js

# Test on one agent
node manage-agents.js update-persona GRAPH

# Looks good? Update all
node manage-agents.js update-persona-all
```

**Custom agent tuning:**
```bash
# Add project-specific guidance
node manage-agents.js add-block GRAPH focus_areas "1. Code quality\n2. Documentation\n3. Test coverage"

# Add team context
node manage-agents.js add-block GRAPH team_info "Team lead: Alice\nBackend: Bob, Carol\nFrontend: Dave, Eve"
```

## Architecture Notes

The management CLI:
- Uses the same `LettaService` as the sync service
- Reads from the same SQLite database (`logs/sync-state.db`)
- Leverages existing content hashing to avoid unnecessary updates
- Operates safely while sync service is running (no conflicts)

Memory blocks are independent - updating one block doesn't affect others.
