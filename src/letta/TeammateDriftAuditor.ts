/**
 * TeammateDriftAuditor — detects divergence between letta-teams'
 * local sidecar (~/.lteams/) and the Letta server's view of agents.
 *
 * The foot-gun (documented in LettaTeamsBackendConfig and tracked in
 * vibesync-6wn.10): letta-teams keeps a local store of teammate name
 * → agentId mappings. The store and the server can drift in two
 * directions:
 *
 *   - orphan_local: ~/.lteams/<name>.json points at an agentId that
 *     no longer exists on the server (deleted out from under teams,
 *     or pointed at a backend that does not host that agent).
 *
 *   - orphan_server: the server hosts an agent whose name matches a
 *     teammate target, but the local store either does not reference
 *     it OR references a DIFFERENT agentId — the classic "wipe
 *     ~/.lteams/, re-spawn, end up with two server agents" pattern.
 *
 * Detection runs at startup (or on demand from a CLI sweep) and
 * publishes one `runtime/teammate.drift` event per finding onto the
 * orchestration EventBus, so HealthPatrol / TUI / oncall subscribers
 * can react instead of polling.
 *
 * Discipline: this file imports @letta-ai/letta-client and reads the
 * local store via a small interface; nothing else in the
 * orchestration plane talks to either. The auditor returns a
 * structured report so callers (CLI, daemon startup) can decide
 * what to do.
 *
 * See vibesync-6wn.10, vibesync-6wn.11.
 */

import type { EventBus } from '../orchestration/events/index.js';

/** One row from ~/.lteams/<name>.json — name + the Letta agentId it points at. */
export interface LocalTeammateEntry {
  readonly name: string;
  readonly agentId: string;
}

/** One row the Letta server returned for a real agent. */
export interface ServerAgentEntry {
  readonly id: string;
  readonly name: string;
}

/**
 * Adapter for the local store (teams sidecar). The auditor calls
 * `listLocal()`; production wiring delegates to
 * `runtime.teammates.list()` and filters to `{ name, agentId }`.
 */
export interface LocalTeammateStore {
  listLocal(): Promise<readonly LocalTeammateEntry[]>;
}

/**
 * Adapter for the Letta server. The auditor calls `listAgents()`;
 * production wiring delegates to letta-client (`client.agents.list`
 * — see vibesync-6wn.11 for how the client is constructed). The
 * server adapter should return every agent the configured token can
 * see, scoped naturally by the X-Project header.
 */
export interface LettaAgentDirectory {
  listAgents(): Promise<readonly ServerAgentEntry[]>;
}

export type DriftFinding =
  | { readonly kind: 'orphan_local'; readonly teammate: string; readonly agentId: string }
  | {
      readonly kind: 'orphan_server';
      readonly agentName: string;
      readonly agentId: string;
      /** Present when a local entry exists for the same name but points at a different agentId. */
      readonly conflicts_with_local_agent_id?: string;
    };

export interface DriftReport {
  readonly scannedAt: string;
  readonly localCount: number;
  readonly serverCount: number;
  readonly findings: readonly DriftFinding[];
  readonly healthy: readonly { readonly name: string; readonly agentId: string }[];
}

/**
 * Compute a drift report. Side-effect: when `bus` is supplied, emit
 * one `runtime/teammate.drift` event per finding.
 */
export async function auditTeammateState(args: {
  readonly local: LocalTeammateStore;
  readonly server: LettaAgentDirectory;
  readonly bus?: EventBus;
}): Promise<DriftReport> {
  const [localList, serverList] = await Promise.all([
    args.local.listLocal(),
    args.server.listAgents(),
  ]);
  const serverById = new Map(serverList.map((a) => [a.id, a]));
  const serverByName = new Map<string, ServerAgentEntry[]>();
  for (const a of serverList) {
    const bucket = serverByName.get(a.name);
    if (bucket) bucket.push(a);
    else serverByName.set(a.name, [a]);
  }
  const localByName = new Map(localList.map((t) => [t.name, t]));

  const findings: DriftFinding[] = [];
  const healthy: { name: string; agentId: string }[] = [];

  for (const teammate of localList) {
    if (serverById.has(teammate.agentId)) {
      healthy.push({ name: teammate.name, agentId: teammate.agentId });
    } else {
      findings.push({ kind: 'orphan_local', teammate: teammate.name, agentId: teammate.agentId });
    }
  }

  for (const agent of serverList) {
    const localEntry = localByName.get(agent.name);
    if (!localEntry) {
      findings.push({ kind: 'orphan_server', agentName: agent.name, agentId: agent.id });
      continue;
    }
    if (localEntry.agentId !== agent.id) {
      findings.push({
        kind: 'orphan_server',
        agentName: agent.name,
        agentId: agent.id,
        conflicts_with_local_agent_id: localEntry.agentId,
      });
    }
  }

  const report: DriftReport = {
    scannedAt: new Date().toISOString(),
    localCount: localList.length,
    serverCount: serverList.length,
    findings,
    healthy,
  };

  if (args.bus) {
    for (const finding of findings) {
      const payload: Record<string, unknown> =
        finding.kind === 'orphan_local'
          ? { reason: 'orphan_local', teammate: finding.teammate, agent_id: finding.agentId }
          : {
              reason: 'orphan_server',
              agent_name: finding.agentName,
              agent_id: finding.agentId,
              ...(finding.conflicts_with_local_agent_id
                ? { conflicts_with_local_agent_id: finding.conflicts_with_local_agent_id }
                : {}),
            };
      args.bus.emit({
        layer: 'runtime',
        kind: 'runtime/teammate.drift',
        ...(finding.kind === 'orphan_local'
          ? { teammate: finding.teammate, task_id: finding.agentId }
          : { teammate: finding.agentName, task_id: finding.agentId }),
        payload,
      });
    }
  }

  return report;
}
