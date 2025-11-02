# Letta Agent Persistence

This directory maintains Letta PM agent state in a Letta-Code-compatible format.

## Files

### `settings.json` (Shared, Committable)
Project-level configuration shared across all instances:
- Project metadata and context
- Default agent configuration (model, embedding, tools)
- Shared memory blocks

This file **can be committed** to git and shared with the team.

### `settings.local.json` (Local, Gitignored)
Instance-specific agent persistence:
- Maps project identifiers to agent IDs
- Auto-generated and updated during sync runs
- One agent ID per Huly project

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

## Usage

### Local Development with Letta Code

You can use the Letta CLI to interact with agents directly:

```bash
# Navigate to project directory
cd /opt/stacks/huly-vibe-sync

# List available agents
letta agents list

# Resume a specific project's agent
export AGENT_ID=$(cat .letta/settings.local.json | jq -r '.agents.VIBEK')
letta --agent $AGENT_ID

# Or use the project identifier
letta --agent $(cat .letta/settings.local.json | jq -r '.agents.VIBEK')
```

### Querying Agent State

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
1. **SQLite Database** (`huly-vibe-sync.db`) - Primary storage
2. **`.letta/settings.local.json`** - Letta-Code compatible format

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

## Benefits

1. **Letta-Code Compatibility**: Direct CLI access to PM agents
2. **Human-Readable**: JSON format for easy inspection and debugging  
3. **Portable**: Can be backed up, copied, or version controlled (via settings.json)
4. **Dual Persistence**: Redundancy with database ensures no data loss
5. **Fast Lookup**: Quick agent ID resolution without database queries

## See Also

- Letta Code Documentation: https://docs.letta.com/letta-code
- Letta API Documentation: https://docs.letta.com/api-reference
- Project README: ../README.md
