import { describe, expect, it, vi } from 'vitest';

import { LettaTeamsProvider } from '../../../../src/orchestration/runtime/index.js';

/**
 * Unit-tests for LettaTeamsProvider. The SDK import is real; we inject
 * a fake runtime via the private `runtime` field for isolation. The
 * full integration (real SDK daemon + real Letta agents) is exercised
 * out-of-band; here we pin the interface contract.
 */

function fakeRuntime() {
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
  return {
    runtime: {
      daemon: { ensureRunning },
      teammates: { exists, spawn, remove },
      tasks: { dispatch },
    },
    spies: { exists, spawn, remove, dispatch, ensureRunning },
  };
}

function inject(provider: LettaTeamsProvider, runtime: unknown): void {
  (provider as unknown as { runtime: unknown }).runtime = runtime;
}

describe('LettaTeamsProvider', () => {
  it('spawns a teammate on first start and reuses it on second start', async () => {
    const provider = new LettaTeamsProvider();
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
    const provider = new LettaTeamsProvider();
    const { runtime, spies } = fakeRuntime();
    inject(provider, runtime);
    const h = await provider.start({ role: 'reviewer', extra: { target: 'reviewer-prime' } });
    expect(spies.spawn.mock.calls[0]![0]).toMatchObject({ name: 'reviewer-prime' });
    expect(h.id).toBe('letta-teams:reviewer-prime');
  });

  it('forwards model/contextWindowLimit/spawnPrompt/memfsEnabled when provided', async () => {
    const provider = new LettaTeamsProvider();
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
    const provider = new LettaTeamsProvider();
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
    const provider = new LettaTeamsProvider();
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
    const provider = new LettaTeamsProvider();
    inject(provider, fakeRuntime().runtime);
    await expect(
      provider.prompt({ id: 'x', providerKind: 'letta-pm-agent' } as never, [
        { type: 'text', text: 'hi' },
      ]),
    ).rejects.toThrow(/handle from wrong provider/);
  });

  it('observe yields started → turn-done (skeleton)', async () => {
    const provider = new LettaTeamsProvider();
    inject(provider, fakeRuntime().runtime);
    const h = await provider.start({ role: 'r' });
    const kinds: string[] = [];
    for await (const ev of provider.observe(h)) {
      kinds.push(ev.kind);
    }
    expect(kinds).toEqual(['started', 'turn-done']);
  });

  it('ensureDaemonRunning calls daemon.ensureRunning', async () => {
    const provider = new LettaTeamsProvider();
    const { runtime, spies } = fakeRuntime();
    inject(provider, runtime);
    await provider.ensureDaemonRunning();
    expect(spies.ensureRunning).toHaveBeenCalled();
  });

  it('stop calls teammates.remove', async () => {
    const provider = new LettaTeamsProvider();
    const { runtime, spies } = fakeRuntime();
    inject(provider, runtime);
    const h = await provider.start({ role: 'r' });
    await provider.stop(h);
    expect(spies.remove).toHaveBeenCalledWith('r');
  });
});
