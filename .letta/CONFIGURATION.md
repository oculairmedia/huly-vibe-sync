# .letta Configuration Reference

## Overview

This project uses a **Letta-Code-inspired** configuration system with hierarchical memory blocks and a control agent pattern for managing PM agents.

## Configuration Files

### settings.json (Shared)
Team-wide configuration that can be committed to git.

```json
{
  "version": "1.0.0",
  "project": {
    "name": "huly-vibe-sync",
    "description": "Service description",
    "memory": {
      "project_context": "Context shared across all agents"
    }
  },
  "agent_settings": {
    "model": "anthropic/sonnet-4-5",
    "embedding": "letta/letta-free",
    "tools": { ... }
  },
  "control_agent": {
    "name": "Huly-PM-Control",
    "persona": "Agent role and behavior definition",
    "tools": [...],
    "sync_behavior": { ... }
  },
  "memory_blocks": {
    "persona": { ... },
    "human": { ... },
    "project": { ... }
  },
  "permissions": {
    "allow": [...],
    "deny": [...]
  }
}
```

### settings.local.json (Local)
Instance-specific agent mappings (gitignored).

```json
{
  "version": "1.0.0",
  "description": "Local Letta agent persistence",
  "agents": {
    "VIBEK": "agent-da65c0ef-9588-4795-87ec-519ca9b96bf7",
    "LETTA": "agent-37816371-0239-4858-95f3-bf58da972e9e"
  }
}
```

## Control Agent

The control agent acts as a **template** for all PM agents:

### Purpose
- **Centralized configuration** - Define persona, tools once
- **Consistent behavior** - All PM agents inherit same base config
- **Easy updates** - Modify control agent, new agents auto-sync
- **Version control** - Track configuration changes in git

### Configuration
Located in `settings.json` under `control_agent`:

```json
{
  "control_agent": {
    "name": "Huly-PM-Control",
    "description": "Template agent for PM agents",
    "persona": "You are a helpful PM assistant...",
    "tools": [
      "huly_query",
      "huly_issue_ops",
      "list_tasks"
    ],
    "sync_behavior": {
      "auto_provision": true,
      "update_on_restart": true,
      "propagate_to_existing_agents": false
    }
  }
}
```

### Sync Behavior
- `auto_provision`: Create control agent if missing on startup
- `update_on_restart`: Refresh control agent config on restart
- `propagate_to_existing_agents`: Update existing PM agents (dangerous!)

## Memory Blocks

Following **Letta Code's hierarchical pattern**:

### 1. Persona Block
- **Source**: Control agent's `persona` field
- **Scope**: Shared across all PM agents
- **Customizable**: Can be overridden per project
- **Purpose**: Define agent role and behavior

### 2. Human Block  
- **Block ID**: `block-3da80889-c509-4c68-b502-a3f54c28c137` (Meridian)
- **Scope**: Shared across all agents in deployment
- **Purpose**: User preferences and coding style
- **Management**: Managed externally (Meridian's human block)

### 3. Project Block
- **Block ID**: `block-986b6e48-08dc-46da-808b-c6bbc4f1a95b`
- **Scope**: Shared across all PM agents for this service
- **Purpose**: Service-wide context (architecture, patterns)
- **Committable**: Block ID committed, content managed in Letta

### 4. Per-Agent Blocks
Each PM agent gets 6 additional blocks:
- Scratchpad (working memory)
- 5 project-specific blocks (issues, components, milestones, etc.)

## Permissions

Inspired by Letta Code's `--allowedTools` / `--disallowedTools`:

```json
{
  "permissions": {
    "allow": [
      "huly_*",                         // All Huly tools
      "vibe_*",                         // All Vibe tools
      "filesystem_read_file(*)",        // Read any file
      "filesystem_list_directory(*)",   // List directories
      "filesystem_search_files(*)"      // Search files
    ],
    "deny": [
      "filesystem_write_file(*)",       // Block writes
      "filesystem_delete_file(*)"       // Block deletes
    ],
    "default_mode": "prompt"            // Prompt for unlisted tools
  }
}
```

### Pattern Syntax
- `tool_name` - Exact match
- `prefix_*` - Wildcard (all tools starting with prefix)
- `tool(pattern)` - Function argument pattern (future)

### Permission Modes
- `prompt` - Ask user for confirmation (default)
- `allow` - Auto-allow matched tools
- `deny` - Auto-deny matched tools

## Tool Configuration

Tools are defined at multiple levels:

### 1. Control Agent Tools (Base Set)
```json
{
  "control_agent": {
    "tools": [
      "huly_query",
      "huly_issue_ops",
      "list_tasks"
    ]
  }
}
```

### 2. Agent Settings Tools (Full Set)
```json
{
  "agent_settings": {
    "tools": {
      "huly": ["huly_query", "huly_issue_ops", "huly_entity"],
      "vibe": ["list_projects", "list_tasks", "get_task"]
    }
  }
}
```

### Resolution
- **Control agent** = Base set (what gets attached initially)
- **Agent settings** = Full set (documentation/reference)
- **PM agents** = Inherit from control agent + project-specific additions

## Usage Examples

### View Current Configuration
```bash
# View shared configuration
cat .letta/settings.json | jq .

# View control agent config
cat .letta/settings.json | jq '.control_agent'

# View memory block definitions
cat .letta/settings.json | jq '.memory_blocks'

# View permissions
cat .letta/settings.json | jq '.permissions'
```

### Check Agent Mappings
```bash
# List all project agents
cat .letta/settings.local.json | jq '.agents'

# Get specific project's agent ID
cat .letta/settings.local.json | jq -r '.agents.VIBEK'

# Count total agents
cat .letta/settings.local.json | jq '.agents | length'
```

### Interact with Control Agent
```bash
# Using Letta API
source .env
curl "${LETTA_API_URL}/agents/" -H "Authorization: Bearer ${LETTA_PASSWORD}" | jq '.[] | select(.name == "Huly-PM-Control")'

# Using scripts
node create-control-agent.js
```

### Modify Configuration
```bash
# Edit shared configuration
nano .letta/settings.json

# Restart to apply changes
docker-compose restart
```

## Migration from Previous Format

### Old Format (Pre-Control Agent)
```json
{
  "version": "1.0.0",
  "project": { ... },
  "agent_settings": { ... },
  "localSharedBlockIds": { ... }
}
```

### New Format (Control Agent)
```json
{
  "version": "1.0.0",
  "project": { ... },
  "agent_settings": { ... },
  "control_agent": { ... },        // NEW
  "memory_blocks": { ... },        // NEW
  "permissions": { ... },          // NEW
  "localSharedBlockIds": { ... }
}
```

### Backward Compatibility
- Old format still works (control agent optional)
- New features require `control_agent` section
- Migration is automatic on next restart

## Best Practices

### 1. Keep Persona in Sync
Update `control_agent.persona` in `settings.json`, not individual agents.

### 2. Document Tool Changes
When adding tools to control agent, update `agent_settings.tools` for reference.

### 3. Test Permission Patterns
Use narrow patterns first, expand as needed:
```json
"allow": ["huly_query"]           // Start specific
"allow": ["huly_*"]                // Expand when confident
```

### 4. Version Control Settings
```bash
git add .letta/settings.json      # Commit shared config
# .letta/settings.local.json is gitignored automatically
```

### 5. Backup Before Major Changes
```bash
cp .letta/settings.json .letta/settings.backup.json
# Make changes
# Test
# If successful, remove backup
```

## Troubleshooting

### Control Agent Not Found
Check logs for creation errors:
```bash
docker-compose logs | grep "Control agent"
```

### Permission Denied Errors
Review `permissions` in `settings.json` and add needed tools to `allow` list.

### Agent Reusing Same ID
This was a bug (fixed). If you see multiple projects with same agent ID:
```bash
# Clean up state
docker-compose down
rm .letta/settings.local.json
node cleanup-agents.js

# Rebuild
docker-compose up -d
```

### Memory Blocks Not Updating
Check that block IDs in `memory_blocks` match actual blocks in Letta:
```bash
# List blocks for an agent
source .env
curl "${LETTA_API_URL}/agents/{agent_id}/memory/blocks" \
  -H "Authorization: Bearer ${LETTA_PASSWORD}"
```

## See Also

- **Control Agent Guide**: ../CONTROL_AGENT_GUIDE.md
- **Letta Code**: https://github.com/letta-ai/letta-code
- **Project README**: ../README.md
