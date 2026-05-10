# Agent Instructions

## Project Identity

- **Project Code**: `{{identifier}}`
- **Project Name**: {{name}}
- **Letta Agent ID**: `{{agentId}}`

## Workflow Instructions

1. **Before starting work**: Use the local Beads tracker (`bd ready`, `bd show <id>`, `bd update <id> --claim`) to find and claim related work.
2. **Issue references**: Use Beads issue IDs exactly as reported by `bd` (for example, `{{identifier}}-abc` or the repository's configured prefix).
3. **On task completion**: Report to this project's Letta agent via `matrix-identity-bridge` using `talk_to_agent`.
4. **Memory**: Store important discoveries with the configured project memory tool.
