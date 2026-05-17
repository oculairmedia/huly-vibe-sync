import { describe, expect, it } from 'vitest';

import { EventBus, type Event } from '../../../src/orchestration/events/index.js';
import {
  auditTeammateState,
  type LettaAgentDirectory,
  type LocalTeammateEntry,
  type LocalTeammateStore,
  type ServerAgentEntry,
} from '../../../src/letta/TeammateDriftAuditor.js';

function fakeLocal(entries: readonly LocalTeammateEntry[]): LocalTeammateStore {
  return { listLocal: async () => entries };
}

function fakeServer(entries: readonly ServerAgentEntry[]): LettaAgentDirectory {
  return { listAgents: async () => entries };
}

function makeBus(): { bus: EventBus; events: Event[] } {
  const bus = new EventBus({ noPersist: true });
  const events: Event[] = [];
  bus.subscribe((e) => events.push(e));
  return { bus, events };
}

describe('auditTeammateState', () => {
  it('reports healthy when every local entry has a matching server agent and no extras', async () => {
    const report = await auditTeammateState({
      local: fakeLocal([
        { name: 'reviewer', agentId: 'agent-r' },
        { name: 'coder', agentId: 'agent-c' },
      ]),
      server: fakeServer([
        { id: 'agent-r', name: 'reviewer' },
        { id: 'agent-c', name: 'coder' },
      ]),
    });
    expect(report.findings).toEqual([]);
    expect(report.healthy).toEqual([
      { name: 'reviewer', agentId: 'agent-r' },
      { name: 'coder', agentId: 'agent-c' },
    ]);
    expect(report.localCount).toBe(2);
    expect(report.serverCount).toBe(2);
  });

  it('flags orphan_local when the agentId is missing on the server', async () => {
    const report = await auditTeammateState({
      local: fakeLocal([{ name: 'reviewer', agentId: 'agent-deleted' }]),
      server: fakeServer([]),
    });
    expect(report.findings).toEqual([
      { kind: 'orphan_local', teammate: 'reviewer', agentId: 'agent-deleted' },
    ]);
    expect(report.healthy).toEqual([]);
  });

  it('flags orphan_server when a server agent has no local entry', async () => {
    const report = await auditTeammateState({
      local: fakeLocal([]),
      server: fakeServer([{ id: 'agent-x', name: 'reviewer' }]),
    });
    expect(report.findings).toEqual([
      { kind: 'orphan_server', agentName: 'reviewer', agentId: 'agent-x' },
    ]);
  });

  it('flags orphan_server with conflicts_with_local_agent_id when the names match but the IDs differ', async () => {
    const report = await auditTeammateState({
      local: fakeLocal([{ name: 'reviewer', agentId: 'agent-old' }]),
      server: fakeServer([{ id: 'agent-new', name: 'reviewer' }]),
    });
    // Local entry sees no agent-old → orphan_local; server sees
    // reviewer-named agent-new with a different local id → orphan_server.
    expect(report.findings).toEqual([
      { kind: 'orphan_local', teammate: 'reviewer', agentId: 'agent-old' },
      {
        kind: 'orphan_server',
        agentName: 'reviewer',
        agentId: 'agent-new',
        conflicts_with_local_agent_id: 'agent-old',
      },
    ]);
  });

  it('handles a partially-shared set (one healthy, one orphan_local, one orphan_server)', async () => {
    const report = await auditTeammateState({
      local: fakeLocal([
        { name: 'reviewer', agentId: 'agent-r' },
        { name: 'coder', agentId: 'agent-c-stale' },
      ]),
      server: fakeServer([
        { id: 'agent-r', name: 'reviewer' },
        { id: 'agent-tester', name: 'tester' },
      ]),
    });
    expect(report.findings).toContainEqual({ kind: 'orphan_local', teammate: 'coder', agentId: 'agent-c-stale' });
    expect(report.findings).toContainEqual({ kind: 'orphan_server', agentName: 'tester', agentId: 'agent-tester' });
    expect(report.healthy).toEqual([{ name: 'reviewer', agentId: 'agent-r' }]);
  });

  it('emits one runtime/teammate.drift event per finding when a bus is supplied', async () => {
    const { bus, events } = makeBus();
    await auditTeammateState({
      local: fakeLocal([{ name: 'reviewer', agentId: 'agent-old' }]),
      server: fakeServer([{ id: 'agent-new', name: 'reviewer' }]),
      bus,
    });
    expect(events.map((e) => e.kind)).toEqual([
      'runtime/teammate.drift',
      'runtime/teammate.drift',
    ]);
    expect(events[0]!.payload).toEqual({
      reason: 'orphan_local',
      teammate: 'reviewer',
      agent_id: 'agent-old',
    });
    expect(events[1]!.payload).toEqual({
      reason: 'orphan_server',
      agent_name: 'reviewer',
      agent_id: 'agent-new',
      conflicts_with_local_agent_id: 'agent-old',
    });
  });

  it('emits nothing when no drift is detected', async () => {
    const { bus, events } = makeBus();
    await auditTeammateState({
      local: fakeLocal([{ name: 'reviewer', agentId: 'agent-r' }]),
      server: fakeServer([{ id: 'agent-r', name: 'reviewer' }]),
      bus,
    });
    expect(events).toEqual([]);
  });
});
