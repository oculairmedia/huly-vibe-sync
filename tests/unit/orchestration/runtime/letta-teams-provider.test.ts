import { describe, expect, it, vi } from 'vitest';

import { LettaTeamsProvider } from '../../../../src/orchestration/runtime/index.js';
import type { SessionEvent } from '../../../../src/orchestration/runtime/provider.js';
import { EventBus, type Event } from '../../../../src/orchestration/events/bus.js';

/**
 * Unit-tests for LettaTeamsProvider. The SDK import is real; we inject
 * a fake runtime via the private `runtime` field for isolation. The
 * full integration (real SDK daemon + real Letta agents) is exercised
 * out-of-band; here we pin the interface contract.
 */

type TaskStateLike = {
  id: string;
  status: 'pending' | 'running' | 'done' | 'error';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  error?: string;
  toolCalls?: { name: string; input?: string; success: boolean; error?: string }[];
};

function fakeRuntime(opts: { taskTimeline?: TaskStateLike[] } = {}) {
  const exists = vi.fn(async (_name: string) => false);
  const spawn = vi.fn(async (input: { name: string; role: string }) => ({
    name: input.name,
    role: input.role,
  }));
  const remove = vi.fn(async (_name: string) => true);
  const dispatch = vi.fn(async (input: { target: string; message: string }) => ({
    taskId: `task-${input.target}`,
  }));
  const ensureRunning = vi.fn(async () => undefined);

  // tasks.get returns successive states from the supplied timeline,
  // sticking on the last entry once exhausted. Default: a single
  // done state so observe() short-circuits quickly.
  const timeline = opts.taskTimeline ?? [
    {
      id: 'task-default',
      status: 'done',
      createdAt: '2026-05-17T00:00:00.000Z',
      completedAt: '2026-05-17T00:00:01.000Z',
    },
  ];
  let cursor = 0;
  const get = vi.fn(async (_id: string): Promise<TaskStateLike> => {
    const state = timeline[Math.min(cursor, timeline.length - 1)]!;
    cursor = Math.min(cursor + 1, timeline.length - 1);
    return state;
  });

  return {
    runtime: {
      daemon: { ensureRunning },
      teammates: { exists, spawn, remove },
      tasks: { dispatch, get },
    },
    spies: { exists, spawn, remove, dispatch, ensureRunning, get },
  };
}

function newProvider(opts: ConstructorParameters<typeof LettaTeamsProvider>[0] = {}): LettaTeamsProvider {
  return new LettaTeamsProvider({
    pollIntervalMs: 0,
    initialTaskTimeoutMs: 50,
    sleep: async () => undefined,
    ...opts,
  });
}

function inject(provider: LettaTeamsProvider, runtime: unknown): void {
  (provider as unknown as { runtime: unknown }).runtime = runtime;
}

describe('LettaTeamsProvider', () => {
  it('spawns a teammate on first start and reuses it on second start', async () => {
    const provider = newProvider();
    const { runtime, spies } = fakeRuntime();
    inject(provider, runtime);

    const h1 = await provider.start({ role: 'reviewer' });
    expect(spies.spawn).toHaveBeenCalledTimes(1);
    expect(spies.spawn.mock.calls[0]![0]).toMatchObject({ name: 'reviewer', role: 'reviewer' });
    expect(h1.providerKind).toBe('letta-teams');
    expect(h1.id).toBe('letta-teams:reviewer');

    spies.exists.mockResolvedValueOnce(true);
    await provider.start({ role: 'reviewer' });
    expect(spies.spawn).toHaveBeenCalledTimes(1); // not re-spawned
  });

  it('uses an explicit target from spec.extra over the role', async () => {
    const provider = newProvider();
    const { runtime, spies } = fakeRuntime();
    inject(provider, runtime);
    const h = await provider.start({ role: 'reviewer', extra: { target: 'reviewer-prime' } });
    expect(spies.spawn.mock.calls[0]![0]).toMatchObject({ name: 'reviewer-prime' });
    expect(h.id).toBe('letta-teams:reviewer-prime');
  });

  it('forwards model/contextWindowLimit/spawnPrompt/memfsEnabled when provided', async () => {
    const provider = newProvider();
    const { runtime, spies } = fakeRuntime();
    inject(provider, runtime);
    await provider.start({
      role: 'reviewer',
      extra: {
        model: 'letta/auto',
        contextWindowLimit: 50_000,
        spawnPrompt: 'Read carefully.',
        memfsEnabled: true,
      },
    });
    expect(spies.spawn.mock.calls[0]![0]).toMatchObject({
      model: 'letta/auto',
      contextWindowLimit: 50_000,
      spawnPrompt: 'Read carefully.',
      memfsEnabled: true,
    });
  });

  it('prompt joins text content blocks and dispatches to the target', async () => {
    const provider = newProvider();
    const { runtime, spies } = fakeRuntime();
    inject(provider, runtime);
    const h = await provider.start({ role: 'reviewer' });
    await provider.prompt(h, [
      { type: 'text', text: 'review this:' },
      { type: 'text', text: 'foo bar' },
    ]);
    expect(spies.dispatch).toHaveBeenCalledWith({
      target: 'reviewer',
      message: 'review this:\nfoo bar',
    });
  });

  it('prompt surfaces an [image: <mime>] placeholder for image content', async () => {
    const provider = newProvider();
    const { runtime, spies } = fakeRuntime();
    inject(provider, runtime);
    const h = await provider.start({ role: 'reviewer' });
    await provider.prompt(h, [
      { type: 'text', text: 'look:' },
      { type: 'image', mimeType: 'image/jpeg', data: 'ZmFrZQ==' },
    ]);
    expect(spies.dispatch.mock.calls[0]![0]).toMatchObject({
      message: 'look:\n[image: image/jpeg]',
    });
  });

  it('rejects handles from other providers', async () => {
    const provider = newProvider();
    inject(provider, fakeRuntime().runtime);
    await expect(
      provider.prompt({ id: 'x', providerKind: 'letta-pm-agent' } as never, [
        { type: 'text', text: 'hi' },
      ]),
    ).rejects.toThrow(/handle from wrong provider/);
  });

  it('observe yields stopped when no task is dispatched before the timeout', async () => {
    const provider = newProvider();
    inject(provider, fakeRuntime().runtime);
    const h = await provider.start({ role: 'r' });
    const kinds: string[] = [];
    for await (const ev of provider.observe(h)) {
      kinds.push(ev.kind);
    }
    expect(kinds).toEqual(['stopped']);
  });

  it('observe maps pending → running → done to started/first-token/turn-done', async () => {
    const provider = newProvider();
    const { runtime } = fakeRuntime({
      taskTimeline: [
        { id: 'task-r', status: 'pending', createdAt: '2026-05-17T00:00:00.000Z' },
        {
          id: 'task-r',
          status: 'running',
          createdAt: '2026-05-17T00:00:00.000Z',
          startedAt: '2026-05-17T00:00:01.000Z',
        },
        {
          id: 'task-r',
          status: 'done',
          createdAt: '2026-05-17T00:00:00.000Z',
          startedAt: '2026-05-17T00:00:01.000Z',
          completedAt: '2026-05-17T00:00:02.000Z',
          result: 'ok',
        },
      ],
    });
    inject(provider, runtime);
    const h = await provider.start({ role: 'r' });
    await provider.prompt(h, [{ type: 'text', text: 'go' }]);
    const events: SessionEvent[] = [];
    for await (const ev of provider.observe(h)) events.push(ev);

    expect(events.map((e) => e.kind)).toEqual(['started', 'first-token', 'turn-done']);
    expect(events[0]!.ts).toBe('2026-05-17T00:00:00.000Z');
    expect(events[1]!.ts).toBe('2026-05-17T00:00:01.000Z');
    const last = events[2] as Extract<SessionEvent, { kind: 'turn-done' }>;
    expect(last.ts).toBe('2026-05-17T00:00:02.000Z');
    expect(last.stopReason).toBe('done');
  });

  it('observe emits tool-call + tool-result frames as toolCalls grow', async () => {
    const provider = newProvider();
    const { runtime } = fakeRuntime({
      taskTimeline: [
        {
          id: 'task-r',
          status: 'running',
          createdAt: '2026-05-17T00:00:00.000Z',
          startedAt: '2026-05-17T00:00:00.500Z',
        },
        {
          id: 'task-r',
          status: 'running',
          createdAt: '2026-05-17T00:00:00.000Z',
          startedAt: '2026-05-17T00:00:00.500Z',
          toolCalls: [{ name: 'read_file', input: 'src/foo.ts', success: true }],
        },
        {
          id: 'task-r',
          status: 'done',
          createdAt: '2026-05-17T00:00:00.000Z',
          startedAt: '2026-05-17T00:00:00.500Z',
          completedAt: '2026-05-17T00:00:02.000Z',
          toolCalls: [
            { name: 'read_file', input: 'src/foo.ts', success: true },
            { name: 'write_file', input: 'src/foo.ts', success: false, error: 'EACCES' },
          ],
        },
      ],
    });
    inject(provider, runtime);
    const h = await provider.start({ role: 'r' });
    await provider.prompt(h, [{ type: 'text', text: 'edit' }]);
    const events: SessionEvent[] = [];
    for await (const ev of provider.observe(h)) events.push(ev);

    expect(events.map((e) => e.kind)).toEqual([
      'started',
      'first-token',
      'tool-call',
      'tool-result',
      'tool-call',
      'tool-result',
      'turn-done',
    ]);
    const firstToolCall = events[2] as Extract<SessionEvent, { kind: 'tool-call' }>;
    expect(firstToolCall.tool).toBe('read_file');
    expect(firstToolCall.args).toBe('src/foo.ts');
    const firstResult = events[3] as Extract<SessionEvent, { kind: 'tool-result' }>;
    expect(firstResult.ok).toBe(true);
    const secondResult = events[5] as Extract<SessionEvent, { kind: 'tool-result' }>;
    expect(secondResult.ok).toBe(false);
    expect(secondResult.result).toBe('EACCES');
  });

  it('observe surfaces a terminal error when the task fails', async () => {
    const provider = newProvider();
    const { runtime } = fakeRuntime({
      taskTimeline: [
        {
          id: 'task-r',
          status: 'error',
          createdAt: '2026-05-17T00:00:00.000Z',
          completedAt: '2026-05-17T00:00:01.000Z',
          error: 'agent crashed',
        },
      ],
    });
    inject(provider, runtime);
    const h = await provider.start({ role: 'r' });
    await provider.prompt(h, [{ type: 'text', text: 'go' }]);
    const events: SessionEvent[] = [];
    for await (const ev of provider.observe(h)) events.push(ev);

    expect(events.map((e) => e.kind)).toEqual(['started', 'error']);
    const err = events[1] as Extract<SessionEvent, { kind: 'error' }>;
    expect(err.code).toBe('task_error');
    expect(err.message).toBe('agent crashed');
  });

  it('observe ends with stopped when stop() is called mid-stream', async () => {
    const provider = newProvider();
    const { runtime } = fakeRuntime({
      taskTimeline: [
        { id: 'task-r', status: 'pending', createdAt: '2026-05-17T00:00:00.000Z' },
        {
          id: 'task-r',
          status: 'running',
          createdAt: '2026-05-17T00:00:00.000Z',
          startedAt: '2026-05-17T00:00:01.000Z',
        },
        // After this point, the timeline keeps repeating 'running' so
        // observe() would loop forever without an external stop.
      ],
    });
    inject(provider, runtime);
    const h = await provider.start({ role: 'r' });
    await provider.prompt(h, [{ type: 'text', text: 'go' }]);

    const events: SessionEvent[] = [];
    const consumer = (async () => {
      for await (const ev of provider.observe(h)) {
        events.push(ev);
        if (ev.kind === 'first-token') {
          await provider.stop(h);
        }
      }
    })();

    await consumer;
    expect(events.map((e) => e.kind)).toEqual(['started', 'first-token', 'stopped']);
  });

  it('a second turn re-streams events without re-emitting prior turn-done', async () => {
    const provider = newProvider();
    const timeline: TaskStateLike[] = [
      { id: 'task-r', status: 'pending', createdAt: '2026-05-17T00:00:00.000Z' },
      {
        id: 'task-r',
        status: 'done',
        createdAt: '2026-05-17T00:00:00.000Z',
        completedAt: '2026-05-17T00:00:01.000Z',
      },
    ];
    const { runtime, spies } = fakeRuntime({ taskTimeline: timeline });
    inject(provider, runtime);
    const h = await provider.start({ role: 'r' });

    await provider.prompt(h, [{ type: 'text', text: 'turn 1' }]);
    const first: SessionEvent[] = [];
    for await (const ev of provider.observe(h)) first.push(ev);
    expect(first.map((e) => e.kind)).toEqual(['started', 'turn-done']);

    // Reset the get-cursor so a second turn replays the pending → done arc.
    spies.get.mockClear();
    let cursor = 0;
    spies.get.mockImplementation(async () => {
      const state = timeline[Math.min(cursor, timeline.length - 1)]!;
      cursor = Math.min(cursor + 1, timeline.length - 1);
      return state as never;
    });

    await provider.prompt(h, [{ type: 'text', text: 'turn 2' }]);
    const second: SessionEvent[] = [];
    for await (const ev of provider.observe(h)) second.push(ev);
    expect(second.map((e) => e.kind)).toEqual(['started', 'turn-done']);
  });

  it('ensureDaemonRunning calls daemon.ensureRunning', async () => {
    const provider = newProvider();
    const { runtime, spies } = fakeRuntime();
    inject(provider, runtime);
    await provider.ensureDaemonRunning();
    expect(spies.ensureRunning).toHaveBeenCalled();
  });

  it('stop calls teammates.remove', async () => {
    const provider = newProvider();
    const { runtime, spies } = fakeRuntime();
    inject(provider, runtime);
    const h = await provider.start({ role: 'r' });
    await provider.stop(h);
    expect(spies.remove).toHaveBeenCalledWith('r');
  });

  describe('EventBus integration', () => {
    function makeBus(): { bus: EventBus; events: Event[] } {
      const bus = new EventBus({ noPersist: true });
      const events: Event[] = [];
      bus.subscribe((e) => events.push(e));
      return { bus, events };
    }

    it('publishes one runtime/session.* event per yielded SessionEvent', async () => {
      const { bus, events } = makeBus();
      const provider = newProvider({ eventBus: bus });
      const { runtime } = fakeRuntime({
        taskTimeline: [
          { id: 'task-r', status: 'pending', createdAt: '2026-05-17T00:00:00.000Z' },
          {
            id: 'task-r',
            status: 'running',
            createdAt: '2026-05-17T00:00:00.000Z',
            startedAt: '2026-05-17T00:00:01.000Z',
          },
          {
            id: 'task-r',
            status: 'done',
            createdAt: '2026-05-17T00:00:00.000Z',
            startedAt: '2026-05-17T00:00:01.000Z',
            completedAt: '2026-05-17T00:00:02.000Z',
          },
        ],
      });
      inject(provider, runtime);
      const h = await provider.start({ role: 'r' });
      await provider.prompt(h, [{ type: 'text', text: 'go' }]);
      const yielded: SessionEvent[] = [];
      for await (const ev of provider.observe(h)) yielded.push(ev);

      expect(events.map((e) => e.kind)).toEqual([
        'runtime/session.started',
        'runtime/session.first-token',
        'runtime/session.turn-done',
      ]);
      expect(events.length).toBe(yielded.length);
      for (const e of events) {
        expect(e.layer).toBe('runtime');
        expect(e.teammate).toBe('r');
        expect(e.task_id).toBe('task-r');
      }
    });

    it('carries molecule_id from SessionSpec.extra into every published event', async () => {
      const { bus, events } = makeBus();
      const provider = newProvider({ eventBus: bus });
      const { runtime } = fakeRuntime({
        taskTimeline: [
          {
            id: 'task-r',
            status: 'done',
            createdAt: '2026-05-17T00:00:00.000Z',
            completedAt: '2026-05-17T00:00:01.000Z',
          },
        ],
      });
      inject(provider, runtime);
      const h = await provider.start({ role: 'r', extra: { moleculeId: 'mol-42' } });
      await provider.prompt(h, [{ type: 'text', text: 'go' }]);
      for await (const _ of provider.observe(h)) void _;

      expect(events.length).toBeGreaterThan(0);
      for (const e of events) expect(e.molecule_id).toBe('mol-42');
    });

    it('carries tool-call args + tool-result ok/result into payload', async () => {
      const { bus, events } = makeBus();
      const provider = newProvider({ eventBus: bus });
      const { runtime } = fakeRuntime({
        taskTimeline: [
          {
            id: 'task-r',
            status: 'running',
            createdAt: '2026-05-17T00:00:00.000Z',
            startedAt: '2026-05-17T00:00:00.500Z',
            toolCalls: [{ name: 'read_file', input: 'src/foo.ts', success: true }],
          },
          {
            id: 'task-r',
            status: 'done',
            createdAt: '2026-05-17T00:00:00.000Z',
            completedAt: '2026-05-17T00:00:02.000Z',
            toolCalls: [
              { name: 'read_file', input: 'src/foo.ts', success: true },
              { name: 'write_file', input: 'src/foo.ts', success: false, error: 'EACCES' },
            ],
          },
        ],
      });
      inject(provider, runtime);
      const h = await provider.start({ role: 'r' });
      await provider.prompt(h, [{ type: 'text', text: 'edit' }]);
      for await (const _ of provider.observe(h)) void _;

      const toolCalls = events.filter((e) => e.kind === 'runtime/session.tool-call');
      const toolResults = events.filter((e) => e.kind === 'runtime/session.tool-result');
      expect(toolCalls.map((e) => e.payload?.['tool'])).toEqual(['read_file', 'write_file']);
      expect(toolResults.map((e) => e.payload?.['ok'])).toEqual([true, false]);
      expect(toolResults[1]!.payload?.['result']).toBe('EACCES');
    });

    it('publishes nothing when no bus is supplied', async () => {
      const provider = newProvider();
      const { runtime } = fakeRuntime({
        taskTimeline: [
          {
            id: 'task-r',
            status: 'done',
            createdAt: '2026-05-17T00:00:00.000Z',
            completedAt: '2026-05-17T00:00:01.000Z',
          },
        ],
      });
      inject(provider, runtime);
      const h = await provider.start({ role: 'r' });
      await provider.prompt(h, [{ type: 'text', text: 'go' }]);
      // Sanity check: observe() still yields events to the consumer.
      const yielded: SessionEvent[] = [];
      for await (const ev of provider.observe(h)) yielded.push(ev);
      expect(yielded.length).toBeGreaterThan(0);
      // No assertion against a bus — there is none. This case just
      // pins the no-op contract under the type checker.
    });
  });
});
