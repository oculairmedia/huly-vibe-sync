/**
 * LettaTeamsMemoryBlockSeeder — concrete MemoryBlockSeeder backed by
 * `@letta-ai/letta-client`.
 *
 * Lives in src/letta/ on purpose: the orchestration plane defines the
 * MemoryBlockSeeder interface but never imports the Letta client; this
 * file is the one place we cross that boundary. Wire one of these at
 * application startup and pass it into LettaTeamsProvider's
 * constructor.
 *
 * Idempotency contract (per MemoryBlockSeeder): seeding the same
 * (agentId, blocks) twice is a no-op on the second call. We diff
 * against the agent's existing blocks and only POST/PATCH the ones
 * whose value changed.
 *
 * See vibesync-6wn.9.
 */

import type { MemoryBlockInput, MemoryBlockSeedOptions, MemoryBlockSeeder } from '../orchestration/runtime/index.js';

interface BlocksApi {
  create(input: { label: string; value: string; limit?: number }): Promise<{ id: string }>;
  modify(blockId: string, patch: { value: string; limit?: number }): Promise<unknown>;
}

interface AgentsBlocksApi {
  list(agentId: string, opts?: { limit?: number }): Promise<{ id?: string; label?: string; value?: string; limit?: number }[]>;
  attach(agentId: string, blockId: string): Promise<unknown>;
  detach(agentId: string, blockId: string): Promise<unknown>;
}

interface LettaClientShape {
  blocks: BlocksApi;
  agents: { blocks: AgentsBlocksApi };
}

export class LettaTeamsMemoryBlockSeeder implements MemoryBlockSeeder {
  constructor(private readonly client: LettaClientShape) {}

  async seed(agentId: string, blocks: readonly MemoryBlockInput[], opts: MemoryBlockSeedOptions = {}): Promise<void> {
    if (blocks.length === 0 && opts.mode !== 'replace') return;
    const existing = await this.client.agents.blocks.list(agentId, { limit: 200 });
    const byLabel = new Map<string, { id?: string; value?: string; limit?: number }>();
    for (const b of existing) {
      if (typeof b.label === 'string') byLabel.set(b.label, b);
    }

    for (const block of blocks) {
      const prior = byLabel.get(block.label);
      if (prior?.id) {
        const valueChanged = String(prior.value ?? '') !== block.value;
        const limitChanged = block.limit !== undefined && prior.limit !== block.limit;
        if (!valueChanged && !limitChanged) continue;
        const patch: { value: string; limit?: number } = { value: block.value };
        if (block.limit !== undefined) patch.limit = block.limit;
        await this.client.blocks.modify(prior.id, patch);
        continue;
      }
      const created = await this.client.blocks.create({
        label: block.label,
        value: block.value,
        ...(block.limit !== undefined ? { limit: block.limit } : {}),
      });
      await this.client.agents.blocks.attach(agentId, created.id);
    }

    if (opts.mode === 'replace') {
      const allowedLabels = new Set(blocks.map((block) => block.label));
      for (const block of existing) {
        if (!block.id || typeof block.label !== 'string') continue;
        if (allowedLabels.has(block.label)) continue;
        await this.client.agents.blocks.detach(agentId, block.id);
      }
    }
  }
}
