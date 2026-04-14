# Agent Management Guide

This page previously documented the retired `manage-agents.js` maintenance CLI.

## Status

That CLI and the one-off scripts around it are no longer present in this repository. The old command list was removed because it pointed operators at tools that no longer exist.

## Current guidance

- Start from [README.md](./README.md) for the supported agent-management documentation in this repo.
- Use project-local `.letta/settings.local.json` files to verify which Letta agent is linked to a project.
- Use the running sync service and current Letta integration flow for agent lifecycle operations.
- Treat older session notes and fix docs as historical records, not current runbooks.

## Safe verification examples

```bash
# Check which agent a project is linked to
cat /opt/stacks/graphiti/.letta/settings.local.json

# Inspect current service state
docker-compose ps
docker-compose logs --tail=100 huly-vibe-sync
```

## Related docs

- [README.md](./README.md)
- [../../features/letta-integration/SCRATCHPAD_AND_HUMAN_BLOCK.md](../../features/letta-integration/SCRATCHPAD_AND_HUMAN_BLOCK.md)
- [../../status/SYSTEM_STATUS.md](../../status/SYSTEM_STATUS.md)
