# Agent Instructions

## Huly Integration

- **Project Code**: `{{identifier}}`
- **Project Name**: {{name}}
- **Letta Agent ID**: `{{agentId}}`

## Workflow Instructions

1. **Before starting work**: Search Huly for related issues using `huly-mcp` with project code `{{identifier}}`
2. **Issue references**: All issues for this project use the format `{{identifier}}-XXX` (e.g., `{{identifier}}-123`)
3. **On task completion**: Report to this project's Letta agent via `matrix-identity-bridge` using `talk_to_agent`
4. **Memory**: Store important discoveries in Graphiti with `graphiti-mcp_add_memory`
