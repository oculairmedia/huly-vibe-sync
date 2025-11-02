# Control Agent Configuration Guide

## Overview

The **Huly PM Control Agent** serves as a template for all Huly PM agents. By modifying this single control agent, you can control the tools and persona of all PM agents in the system.

## Concept

Instead of manually configuring each PM agent individually, all agents sync their configuration from the control agent:

- **Tools**: PM agents MUST have all tools from the control agent (they may have additional tools)
- **Persona**: PM agents use the persona from the control agent (project-specific customizations are applied)

## Control Agent Details

**Name**: `Huly-PM-Control`  
**ID**: `agent-686e0cb2-7862-471d-8e6a-026fcd1626e8`  
**Location**: https://letta.oculair.ca

### Current Configuration

**Persona**: Experienced PM/Developer Veteran (2101 chars)
- 15+ years in software development and project management
- Deep understanding of technical and business domains
- Expert in Agile, Kanban, and pragmatic delivery

**Tools** (10 total):
1. `huly_query` - Search and query Huly issues
2. `huly_issue_ops` - Create, update, delete Huly issues
3. `huly_entity` - Manage Huly entities
4. `list_projects` - List Vibe Kanban projects
5. `list_tasks` - List tasks in a project
6. `get_task` - Get task details
7. `update_task` - Update task status/details
8. `memory_replace` - Edit memory blocks (Letta core)
9. `memory_insert` - Insert into memory blocks (Letta core)
10. `conversation_search` - Search conversation history (Letta core)

## How to Modify the Control Agent

### Option 1: Via Letta UI (Recommended)

1. Go to https://letta.oculair.ca
2. Find agent "Huly-PM-Control"
3. Modify tools or persona as needed
4. Changes will sync to all PM agents on next creation/restart

### Option 2: Via API

```bash
# Get control agent
curl -X GET "https://letta.oculair.ca/v1/agents/agent-686e0cb2-7862-471d-8e6a-026fcd1626e8" \
  -H "Authorization: Bearer letta"

# Attach a new tool to control agent
curl -X POST "https://letta.oculair.ca/v1/agents/agent-686e0cb2-7862-471d-8e6a-026fcd1626e8/tools/attach/{tool_id}" \
  -H "Authorization: Bearer letta"

# Update persona block
curl -X PUT "https://letta.oculair.ca/v1/blocks/{persona_block_id}" \
  -H "Authorization: Bearer letta" \
  -H "Content-Type: application/json" \
  -d '{"value": "Your new persona content..."}'
```

### Option 3: Via npm Script

```bash
# View control agent configuration
npm run control-agent

# Recreate control agent (if needed)
npm run create-control-agent
```

## How PM Agents Sync from Control Agent

When a PM agent is created or restarted, the sync service:

1. Calls `ensureControlAgent()` to get/create the control agent
2. Fetches the control agent's tools and persona via `getControlAgentConfig()`
3. Caches the configuration for performance
4. Applies control agent's persona to the new PM agent
5. Attaches all tools from the control agent to the PM agent
6. PM agent may have additional tools, but MUST have all control agent tools

## Configuration

The control agent name can be customized via environment variable:

```bash
# .env
LETTA_CONTROL_AGENT=Huly-PM-Control  # Default value
```

## Benefits

### ✅ Centralized Configuration
- Modify one agent, control all PM agents
- No need to update 40+ agents individually

### ✅ Consistency
- All PM agents have the same base tools and persona
- Ensures uniform capabilities across projects

### ✅ Flexibility
- PM agents can still have project-specific tools
- Control agent sets the minimum required tools

### ✅ Easy Updates
- Add a new tool to control agent
- All new PM agents automatically get it
- Existing agents can be updated on next sync

## Example Use Cases

### Adding a New Tool to All Agents

1. Identify the tool ID you want to add
2. Attach it to the control agent via UI or API
3. All newly created PM agents will have this tool
4. Optionally restart the sync service to update existing agents

### Updating the Persona

1. Edit the persona block of the control agent
2. All newly created PM agents will use the new persona
3. Existing agents keep their persona until next sync/restart

### Creating Project-Specific Tools

1. PM agents can have additional tools beyond control agent
2. Use `attachPmTools()` first (from control agent)
3. Then attach project-specific tools separately
4. PM agent will have: control agent tools + project tools

## Troubleshooting

### Control Agent Not Found

Run the creation script:
```bash
npm run create-control-agent
```

### Tools Not Syncing

1. Check control agent exists: `npm run control-agent`
2. Verify tools are attached to control agent
3. Clear cache and restart sync service
4. Check logs for `[Letta] Control agent config:` messages

### Performance Issues

The control agent configuration is cached to avoid repeated API calls. Clear cache:
```javascript
lettaService.clearCache();
```

## Architecture

```
┌─────────────────────────────────┐
│   Huly-PM-Control (Template)   │
│                                 │
│  - Persona Block (PM/Developer) │
│  - 10 Essential Tools           │
│  - Human Block (Meridian)       │
└─────────────┬───────────────────┘
              │ Sync
              ├─────────────────────┬──────────────┬──────────────┐
              ▼                     ▼              ▼              ▼
    ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
    │ Huly-GRAPH-PM   │  │ Huly-OPCDE-PM   │  │ Huly-VIBEK-PM   │
    │                 │  │                 │  │                 │
    │ Control Tools + │  │ Control Tools + │  │ Control Tools + │
    │ Project Blocks  │  │ Project Blocks  │  │ Project Blocks  │
    └─────────────────┘  └─────────────────┘  └─────────────────┘
```

## Code References

**Control Agent Management**:
- `lib/LettaService.js:ensureControlAgent()` - Get/create control agent
- `lib/LettaService.js:getControlAgentConfig()` - Fetch tools and persona
- `lib/LettaService.js:attachPmTools()` - Sync tools to PM agents

**Control Agent Creation**:
- `create-control-agent.js` - Standalone script to create/view control agent

**PM Agent Creation**:
- `lib/LettaService.js:ensureAgent()` - Creates PM agents using control agent config

---

**Last Updated**: 2025-11-02  
**Control Agent ID**: `agent-686e0cb2-7862-471d-8e6a-026fcd1626e8`  
**Status**: Active ✅
