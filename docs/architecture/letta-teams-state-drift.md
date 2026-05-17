# letta-teams state drift runbook

letta-teams keeps a sidecar of teammate metadata under `~/.lteams/`
(`<name>.json` per teammate: agentId, conversation targets, status).
That store and the Letta server's database can diverge in two
directions; both are operationally visible and both have explicit
cleanups.

This runbook is the doc half of `vibesync-6wn.10`. The detector
half lives at `src/letta/TeammateDriftAuditor.ts`; wire its
`auditTeammateState()` into startup or a CLI sweep to surface the
findings before they bite.

## Symptoms

| What you see | Likely drift |
|---|---|
| `seed()` 404s when LettaTeamsProvider.start() succeeded | `orphan_local` — local entry points at a deleted agent |
| Two server agents named `<molecule>-<role>`, identical roles, different agentIds | `orphan_server` with `conflicts_with_local_agent_id` — local was wiped and re-spawned |
| HealthPatrol restart loop on a teammate that "just worked" yesterday | `orphan_local` after a server-side `DELETE /v1/agents/<id>` |
| TUI shows a teammate the daemon doesn't know about | `orphan_server` with no local match — agent was created via REST without going through teams |
| `bd events` shows repeated `runtime/teammate.drift` rows | the auditor is doing its job — read the payload |

## Detection

```ts
import { auditTeammateState } from '../src/letta/TeammateDriftAuditor.js';
import { LettaTeamsBackendConfig } from '../src/letta/LettaTeamsBackendConfig.js';

const backend = new LettaTeamsBackendConfig();   // reads env
backend.applyToProcessEnv();                     // daemon will inherit

const report = await auditTeammateState({
  local: { listLocal: async () => /* runtime.teammates.list().map(...) */ },
  server: { listAgents: async () => /* await client.agents.list() */ },
  bus,                                            // optional; emits findings
});
console.log(report);
```

Findings drop onto the orchestration EventBus as
`runtime/teammate.drift` events with one of two payload shapes:

```jsonc
// orphan_local: local store points at an agentId the server doesn't have
{ "reason": "orphan_local", "teammate": "reviewer", "agent_id": "agent-deleted" }

// orphan_server: server has an agent whose name a local entry should own
{ "reason": "orphan_server", "agent_name": "reviewer", "agent_id": "agent-new",
  "conflicts_with_local_agent_id": "agent-old" }      // optional — present only when local also has a stale entry
```

`bd events --kind 'runtime/teammate.drift'` is the obvious tail.

## Cleanup recipes

### `orphan_local` — local entry points at a missing agent

1. Confirm the agent is gone:
   `curl -H "Authorization: Bearer $LETTA_API_KEY" $LETTA_BASE_URL/v1/agents/<agent_id>`
   → expect `404 Not Found`.
2. Remove the local entry:
   `rm ~/.lteams/<teammate>.json` (or use `letta-teams remove <teammate>`
   when the CLI is installed).
3. Re-spawn through `LettaTeamsProvider.start({ role, extra: { moleculeId } })`.
   The new agentId lands in the store; future dispatches resolve.

### `orphan_server` — server has an agent with no matching local entry

Two sub-cases, picked by whether `conflicts_with_local_agent_id` is
present in the payload:

- **No conflict:** the agent was created out-of-band (REST script,
  another machine, manual creation). If it should belong to teams,
  recreate the local entry; if not, leave it alone or delete it on
  the server.
- **Conflict present:** classic "wiped local, re-spawned" pattern.
  Two agents now share a name on the server. Pick one to keep:
  - If the local entry is the canonical one: delete the
    `conflicts_with_local_agent_id` agent on the server:
    `curl -X DELETE -H "Authorization: Bearer $LETTA_API_KEY" $LETTA_BASE_URL/v1/agents/<conflicts_with_local_agent_id>`.
  - If the new server agent is canonical: rewrite `~/.lteams/<name>.json`
    so `agentId` matches the new id, then delete the original local-
    referenced agent on the server.

After cleanup, re-run the auditor; the next report should be empty
on the affected name.

## Prevention rules

1. **Never `rm -rf ~/.lteams/` without first deleting the agents on
   the server.** If you must reset, do it in this order:
   1. List the local teammates: `ls ~/.lteams/`
   2. For each, read `agentId` from the json
   3. `DELETE /v1/agents/<agentId>` on the server
   4. Only then remove the local files
2. **Wire `auditTeammateState()` into VibeSync startup.** Findings
   on the bus catch the issue before HealthPatrol starts emitting
   restart-loop noise.
3. **Don't share `~/.lteams/` across machines.** Each host should
   own its local store. Symlinks or NFS-mounting it across hosts
   gives you duplicate-spawn races by design.
4. **`LETTA_BASE_URL` is sticky.** Once a teammate is spawned, its
   `agentId` lives on whichever Letta server `LETTA_BASE_URL`
   pointed at *at spawn time*. Switching the env var after spawn
   strands the teammate on the original server — see
   `LettaTeamsBackendConfig` for the single-source-of-truth helper.

## References

- `src/letta/TeammateDriftAuditor.ts` — detector
- `src/letta/LettaTeamsBackendConfig.ts` — single-source env helper
- `src/letta/LettaTeamsMemoryBlockSeeder.ts` — REST client uses the
  same backend
- Beads: `vibesync-6wn.10` (this), `vibesync-6wn.11` (config),
  `vibesync-brd` (the decision that made teams the primary path)
