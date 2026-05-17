import { describe, expect, it, vi } from 'vitest';

import { LettaTeamsMemoryBlockSeeder } from '../../../src/letta/LettaTeamsMemoryBlockSeeder.js';

function fakeClient(opts: { existing?: { id: string; label: string; value: string; limit?: number }[] } = {}) {
  const list = vi.fn(async () => opts.existing ?? []);
  const attach = vi.fn(async () => undefined);
  const create = vi.fn(async (input: { label: string; value: string; limit?: number }) => ({
    id: `block-${input.label}`,
  }));
  const modify = vi.fn(async () => undefined);
  return {
    client: {
      blocks: { create, modify },
      agents: { blocks: { list, attach } },
    },
    spies: { list, attach, create, modify },
  };
}

describe('LettaTeamsMemoryBlockSeeder', () => {
  it('creates + attaches new blocks the agent does not already have', async () => {
    const { client, spies } = fakeClient();
    const seeder = new LettaTeamsMemoryBlockSeeder(client);
    await seeder.seed('agent-1', [
      { label: 'persona', value: 'You are a reviewer.', limit: 2000 },
      { label: 'guardrails', value: 'Block PRs that miss tests.' },
    ]);

    expect(spies.create).toHaveBeenCalledTimes(2);
    expect(spies.create).toHaveBeenNthCalledWith(1, {
      label: 'persona',
      value: 'You are a reviewer.',
      limit: 2000,
    });
    expect(spies.create).toHaveBeenNthCalledWith(2, {
      label: 'guardrails',
      value: 'Block PRs that miss tests.',
    });
    expect(spies.attach).toHaveBeenCalledTimes(2);
    expect(spies.attach).toHaveBeenNthCalledWith(1, 'agent-1', 'block-persona');
    expect(spies.attach).toHaveBeenNthCalledWith(2, 'agent-1', 'block-guardrails');
  });

  it('modifies an existing block when the value differs', async () => {
    const { client, spies } = fakeClient({
      existing: [{ id: 'b1', label: 'persona', value: 'OLD' }],
    });
    const seeder = new LettaTeamsMemoryBlockSeeder(client);
    await seeder.seed('agent-1', [{ label: 'persona', value: 'NEW' }]);
    expect(spies.modify).toHaveBeenCalledWith('b1', { value: 'NEW' });
    expect(spies.create).not.toHaveBeenCalled();
    expect(spies.attach).not.toHaveBeenCalled();
  });

  it('is a no-op when the existing value matches and limit is unchanged', async () => {
    const { client, spies } = fakeClient({
      existing: [{ id: 'b1', label: 'persona', value: 'SAME', limit: 1000 }],
    });
    const seeder = new LettaTeamsMemoryBlockSeeder(client);
    await seeder.seed('agent-1', [{ label: 'persona', value: 'SAME', limit: 1000 }]);
    expect(spies.modify).not.toHaveBeenCalled();
    expect(spies.create).not.toHaveBeenCalled();
    expect(spies.attach).not.toHaveBeenCalled();
  });

  it('updates when the limit changes even if the value matches', async () => {
    const { client, spies } = fakeClient({
      existing: [{ id: 'b1', label: 'persona', value: 'SAME', limit: 500 }],
    });
    const seeder = new LettaTeamsMemoryBlockSeeder(client);
    await seeder.seed('agent-1', [{ label: 'persona', value: 'SAME', limit: 1000 }]);
    expect(spies.modify).toHaveBeenCalledWith('b1', { value: 'SAME', limit: 1000 });
  });

  it('does nothing when blocks is empty', async () => {
    const { client, spies } = fakeClient();
    const seeder = new LettaTeamsMemoryBlockSeeder(client);
    await seeder.seed('agent-1', []);
    expect(spies.list).not.toHaveBeenCalled();
    expect(spies.create).not.toHaveBeenCalled();
  });

  it('routes through agents.blocks.list with a higher list limit', async () => {
    const { client, spies } = fakeClient();
    const seeder = new LettaTeamsMemoryBlockSeeder(client);
    await seeder.seed('agent-1', [{ label: 'p', value: 'v' }]);
    expect(spies.list).toHaveBeenCalledWith('agent-1', { limit: 200 });
  });
});
