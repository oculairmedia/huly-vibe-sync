# BUG: Agent Reuse Issue

## Problem

Multiple projects are being assigned the same agent ID, causing:
1. Memory blocks being overwritten constantly (wasting tokens)
2. One agent serving multiple projects (incorrect behavior)
3. Control agent being used as a PM agent

## Root Cause

When agents are looked up by name and duplicates exist, the first duplicate is returned and reused for multiple projects. This happens when:
1. Database is cleared but `.letta/settings.local.json` persists
2. Agent lookup finds duplicates and uses first one
3. That agent ID gets saved for multiple projects

## Evidence

```json
{
  "GRAPH": "agent-4d6cbff7-20f3-4ec1-9d46-6e00f19d9a82",
  "OPCDE": "agent-4d6cbff7-20f3-4ec1-9d46-6e00f19d9a82",  // Same ID!
  "SFMCP": "agent-4d6cbff7-20f3-4ec1-9d46-6e00f19d9a82",  // Same ID!
  "BKMCP": "agent-4d6cbff7-20f3-4ec1-9d46-6e00f19d9a82"   // Same ID!
}
```

## Solution

The `ensureAgent()` method needs to:
1. Filter out the control agent when searching for PM agents
2. If duplicates exist, delete them instead of reusing
3. Always create a new agent if persisted ID doesn't match
4. Never save control agent ID to project mappings

## Temporary Workaround

1. Stop service
2. Delete `.letta/settings.local.json`
3. Delete `logs/sync-state.db`
4. Clean all agents: `node cleanup-agents.js`
5. Start fresh

## Fix Required

Update `lib/LettaService.js:ensureAgent()` to exclude control agent from PM agent search:

```javascript
// Try to find existing agent by name using server-side filtering
const agents = await this.client.agents.list({ 
  name: agentName,
  limit: 100
});

// Filter out control agent
const pmAgents = agents.filter(a => a.id !== this._controlAgentCache?.agentId);

if (pmAgents && pmAgents.length > 0) {
  // Use first PM agent, delete duplicates
  ...
}
```
