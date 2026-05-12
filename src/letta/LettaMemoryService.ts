import { buildScratchpad, buildExpression } from '../LettaMemoryBuilders.js';

const AGENT_ROLE_OVERRIDES: Record<string, string> = {
  Kitchen: 'companion', Incognito: 'developer', Memo: 'developer',
};

type Client = Record<string, any>;
type BlockRecord = { label?: string; value?: unknown; id?: string };

export class LettaMemoryService {
  config: { client: Client; sharedHumanBlockId?: string };
  private _blockHashCache = new Map<string, Map<string, any>>();

  constructor(config: { client: Client; sharedHumanBlockId?: string }) {
    this.config = config;
  }

  clearBlockHashCache(): void { this._blockHashCache.clear(); }

  async _updatePersonaBlock(agentId: string, personaContent: string): Promise<void> {
    const client = this.config.client;
    try {
      const agent = await client.agents.retrieve(agentId) as { memory?: { blocks?: BlockRecord[] } };
      const existingBlock = agent.memory?.blocks?.find(b => b.label === 'persona');
      if (existingBlock) {
        await client.blocks.modify(existingBlock.id, { value: personaContent });
        console.log(`[Letta] Persona block updated (${existingBlock.id})`);
      } else {
        const block = await client.blocks.create({ label: 'persona', value: personaContent, limit: 20000 }) as { id: string };
        await client.agents.blocks.attach(agentId, block.id);
        console.log(`[Letta] Persona block created and attached (${block.id})`);
      }
    } catch (error) { console.error('[Letta] Error updating persona block:', (error as Error).message); }
  }

  async _ensureTemplateBlocks(agentId: string, options: { agentName?: string } = {}): Promise<void> {
    try {
      const role = (options.agentName && AGENT_ROLE_OVERRIDES[options.agentName]) || 'pm';
      await this.upsertMemoryBlocks(agentId, [{ label: 'expression', value: buildExpression(role) }]);
      await this._attachSharedHumanBlock(agentId);
      await this.initializeScratchpad(agentId);
    } catch (error) { console.warn(`[Letta] Template block update failed for ${agentId}: ${(error as Error).message}`); }
  }

  async _attachSharedHumanBlock(agentId: string): Promise<void> {
    if (!this.config.sharedHumanBlockId) return;
    try {
      await this.config.client.agents.blocks.attach(agentId, this.config.sharedHumanBlockId);
      console.log(`[Letta] Shared human block attached to ${agentId}`);
    } catch (error) { console.warn('[Letta] Could not attach shared human block:', (error as Error).message); }
  }

  async upsertMemoryBlocks(agentId: string, blocks: { label: string; value: unknown }[]): Promise<void> {
    const MAX_BLOCK_SIZE = 50000; const CONCURRENCY_LIMIT = 2;
    const client = this.config.client;
    console.log(`[Letta] Upserting ${blocks.length} memory blocks for agent ${agentId}`);

    try {
      const newBlockHashes = new Map<string, { hash: number; value: string }>();
      for (const block of blocks) {
        let serializedValue = typeof block.value === 'string' ? block.value : JSON.stringify(block.value, null, 2);
        if (serializedValue.length > MAX_BLOCK_SIZE) {
          console.warn(`[Letta] Block "${block.label}" exceeds size limit (${serializedValue.length} chars), truncating...`);
          serializedValue = serializedValue.substring(0, MAX_BLOCK_SIZE - 100) + '\n\n... [truncated]';
        }
        newBlockHashes.set(block.label, { hash: this._hashContent(serializedValue), value: serializedValue });
      }

      const cachedHashes = this._blockHashCache.get(agentId) || new Map();
      let allMatchCache = true;
      for (const [label, { hash }] of newBlockHashes) { if (cachedHashes.get(label) !== hash) { allMatchCache = false; break; } }
      if (allMatchCache && cachedHashes.size === newBlockHashes.size) { console.log(`[Letta] All blocks match cache - skipping (${blocks.length} blocks)`); return; }

      const existingBlocks = await client.agents.blocks.list(agentId, { limit: 50 }) as BlockRecord[];
      const existingBlockMap = new Map(existingBlocks.map((b: BlockRecord) => [b.label, b]));

      const updateOperations: { type: string; label: string; blockId?: string; value: string; hash: number }[] = [];
      let skippedCount = 0;

      for (const block of blocks) {
        const { hash: contentHash, value: serializedValue } = newBlockHashes.get(block.label)!;
        const existingBlock = existingBlockMap.get(block.label);
        if (existingBlock) {
          if (this._hashContent(String(existingBlock.value)) !== contentHash) {
            console.log(`[Letta] Upserting block "${block.label}" (${serializedValue.length} chars)`);
            updateOperations.push({ type: 'update', label: block.label, blockId: existingBlock.id!, value: serializedValue, hash: contentHash });
          } else { skippedCount++; }
        } else {
          console.log(`[Letta] Upserting block "${block.label}" (${serializedValue.length} chars)`);
          updateOperations.push({ type: 'create', label: block.label, value: serializedValue, hash: contentHash });
        }
      }

      if (skippedCount > 0) console.log(`[Letta] Skipped ${skippedCount} unchanged blocks`);
      if (updateOperations.length === 0) { console.log('[Letta] No changes needed, all blocks up to date'); this._blockHashCache.set(agentId, newBlockHashes); return; }

      console.log(`[Letta] Executing ${updateOperations.length} operations with concurrency limit of ${CONCURRENCY_LIMIT}`);
      for (let i = 0; i < updateOperations.length; i += CONCURRENCY_LIMIT) {
        const batch = updateOperations.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.allSettled(batch.map(async op => {
          if (op.type === 'update') { await client.blocks.modify(op.blockId, { value: op.value }); console.log(`[Letta] Updated block "${op.label}" (id: ${op.blockId})`); }
          else { const nb = await client.blocks.create({ label: op.label, value: op.value }) as { id: string }; await client.agents.blocks.attach(agentId, nb.id); console.log(`[Letta] Created and attached block "${op.label}" (id: ${nb.id})`); }
        }));
      }

      console.log(`[Letta] Successfully upserted all ${blocks.length} memory blocks`);
      const cacheMap = new Map<string, number>();
      for (const [label, { hash }] of newBlockHashes) cacheMap.set(label, hash);
      this._blockHashCache.set(agentId, cacheMap as any);
    } catch (error) { console.error('[Letta] Error upserting memory blocks:', (error as Error).message); throw error; }
  }

  _hashContent(content: string): number {
    let hash = 0; if (!content || content.length === 0) return hash;
    for (let i = 0; i < content.length; i++) { const char = content.charCodeAt(i); hash = (hash << 5) - hash + char; hash = hash & hash; }
    return hash;
  }

  async initializeScratchpad(agentId: string): Promise<void> {
    const client = this.config.client;
    console.log(`[Letta] Initializing scratchpad for agent ${agentId}`);
    try {
      const blocks = await client.agents.blocks.list(agentId) as BlockRecord[];
      if (blocks.find(b => b.label === 'scratchpad')) { console.log('[Letta] Scratchpad already exists, skipping'); return; }
      const scratchpadContent = buildScratchpad();
      const serializedValue = JSON.stringify(scratchpadContent, null, 2);
      const newBlock = await client.blocks.create({ label: 'scratchpad', value: serializedValue }) as { id: string };
      await client.agents.blocks.attach(agentId, newBlock.id);
      console.log(`[Letta] Scratchpad initialized: ${newBlock.id}`);
    } catch (error) { console.error('[Letta] Error initializing scratchpad:', (error as Error).message); }
  }
}
