# Letta Agent Persistence

This directory maintains Letta PM-agent state for Vibesync deployments.

## Files

### `settings.json` (Shared, Committable)
Project-level configuration shared across all instances:
- **Project metadata and context** - Service description and purpose
- **Control agent configuration** - Template for all PM agents
- **Default agent settings** - Model, embedding, tools configuration
- **Memory block definitions** - Persona, human, project blocks
- **Permissions** - Tool access control (allow/deny patterns)
- **Shared memory blocks** - Block IDs for team-wide context

This file **can be committed** to git and shared with the team.


### `settings.local.json` (Local, Gitignored)
Instance-specific agent persistence:
- Maps project identifiers to agent IDs
- Auto-generated and updated during sync runs
- One agent ID per Legacy project

This file is **gitignored** and personal to each deployment instance.


## Agent ID Mapping

Example structure:
```json
{
  "version": "1.0.0",
  "agents": {
    "VIBEK": "agent-da65c0ef-9588-4795-87ec-519ca9b96bf7",
    "LETTA": "agent-37816371-0239-4858-95f3-bf58da972e9e",
    "HULLY": "agent-9588d326-cbe8-43b8-9080-41382958ab01"
  }
}
```

## Querying Agent State


```bash
# Get all agent IDs
cat .letta/settings.local.json | jq '.agents'

# Get specific project agent
cat .letta/settings.local.json | jq -r '.agents.VIBEK'

# Count agents
cat .letta/settings.local.json | jq '.agents | length'
```

### Backup and Restore

```bash
# Backup agent mappings
cp .letta/settings.local.json .letta/settings.local.backup.json

# Restore from backup
cp .letta/settings.local.backup.json .letta/settings.local.json
docker-compose restart
```

## Integration

Agent IDs are automatically synchronized between:
1. **SQLite Database** (`vibesync.db`) - Primary storage
2. **`.letta/settings.local.json`** - Local agent ID cache

Both sources are kept in sync during every sync cycle.

## Permissions

The `.letta` directory must be writable by the container's `node` user (UID 1000):

```bash
chmod 777 .letta/
chmod 666 .letta/settings.local.json
```

## Agent Lifecycle

1. **First Run**: Agent created via Letta API, ID saved to both DB and `.letta/settings.local.json`
2. **Subsequent Runs**: Agent ID retrieved from file, agent resumed with existing context
3. **Agent Deleted**: Automatically recreated and new ID persisted
4. **New Project**: New agent created, ID immediately persisted

## Troubleshooting

### No agents in settings.local.json

Check logs for permission errors:
```bash
docker-compose logs | grep "Error saving agent state"
```

Fix permissions:
```bash
chmod 777 .letta/
chmod 666 .letta/settings.local.json
docker-compose restart
```

### Agent not found in Letta

The sync service will automatically recreate missing agents and update the ID in both storage locations.

### Stale agent IDs

Delete `settings.local.json` and restart - it will be regenerated from the database:
```bash
rm .letta/settings.local.json
docker-compose restart
```

## PM Agent Configuration Features

### Control Agent System
The `control_agent` section in `settings.json` defines a template agent that:
- **Centralizes configuration** - All PM agents inherit tools and persona
- **Enables consistent behavior** - Same persona across all project agents
- **Simplifies updates** - Change once, affects all new agents
- **Auto-provisions on startup** - Creates control agent if missing

### Memory Block Hierarchy
1. **Global blocks** (`persona`, `human`) - Shared across all agents
2. **Project blocks** - Service-specific context
3. **Per-agent blocks** - Project-specific scraperchpad

### Permission System
```json
{
  "permissions": {
    "allow": ["legacy_*", "vibe_*", "filesystem_read_file(*)"],
    "deny": ["filesystem_write_file(*)", "filesystem_delete_file(*)"],
    "default_mode": "prompt"
  }
}
```

## Benefits

1. **Hierarchical Memory**: Global + project + agent-specific blocks
2. **Control Agent Pattern**: Centralized configuration management
3. **Permission Control**: Fine-grained tool access (allow/deny patterns)
4. **Human-Readable**: JSON format for easy inspection and debugging
5. **Portable**: Can be backed up, copied, or version controlled (via settings.json)
6. **Dual Persistence**: Redundancy with database ensures no data loss
7. **Fast Lookup**: Quick agent ID resolution without database queries

## See Also

- **Letta API Documentation**: https://docs.letta.com/api-reference
- **Control Agent Guide**: ../CONTROL_AGENT_GUIDE.md
- **Project README**: ../README.md
