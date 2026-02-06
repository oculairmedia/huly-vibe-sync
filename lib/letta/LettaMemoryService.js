/**
 * LettaMemoryService — memory block management (upsert, scratchpad, templates).
 */

import { buildScratchpad, buildExpression } from '../LettaMemoryBuilders.js';

export class LettaMemoryService {
  constructor(config) {
    this.config = config;
    this._blockHashCache = new Map();
  }

  clearBlockHashCache() {
    // Block hash cache is intentionally retained across sync runs for performance.
    // This method is available for explicit full resets.
    this._blockHashCache.clear();
  }

  async _updatePersonaBlock(agentId, personaContent) {
    const client = this.config.client;
    try {
      const agent = await client.agents.retrieve(agentId);
      const existingBlock = agent.memory?.blocks?.find(b => b.label === 'persona');

      if (existingBlock) {
        await client.blocks.modify(existingBlock.id, { value: personaContent });
        console.log(`[Letta] ✓ Persona block updated (${existingBlock.id})`);
      } else {
        const block = await client.blocks.create({
          label: 'persona',
          value: personaContent,
          limit: 20000,
        });
        await client.agents.blocks.attach(agentId, block.id);
        console.log(`[Letta] ✓ Persona block created and attached (${block.id})`);
      }
    } catch (error) {
      console.error(`[Letta] Error updating persona block:`, error.message);
    }
  }

  async _ensureTemplateBlocks(agentId) {
    try {
      const templateBlocks = [{ label: 'expression', value: buildExpression('pm') }];
      await this.upsertMemoryBlocks(agentId, templateBlocks);
      await this._attachSharedHumanBlock(agentId);
      await this.initializeScratchpad(agentId);
    } catch (error) {
      console.warn(`[Letta] Template block update failed for ${agentId}: ${error.message}`);
    }
  }

  async _attachSharedHumanBlock(agentId) {
    if (!this.config.sharedHumanBlockId) {
      return;
    }

    try {
      await this.config.client.agents.blocks.attach(agentId, this.config.sharedHumanBlockId);
      console.log(`[Letta] ✓ Shared human block attached to ${agentId}`);
    } catch (error) {
      console.warn(`[Letta] Could not attach shared human block:`, error.message);
    }
  }

  async upsertMemoryBlocks(agentId, blocks) {
    const MAX_BLOCK_SIZE = 50000;
    const CONCURRENCY_LIMIT = 2;
    const client = this.config.client;

    console.log(`[Letta] Upserting ${blocks.length} memory blocks for agent ${agentId}`);

    try {
      const newBlockHashes = new Map();
      for (const block of blocks) {
        const { label, value } = block;
        let serializedValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2);

        if (serializedValue.length > MAX_BLOCK_SIZE) {
          console.warn(
            `[Letta] Block "${label}" exceeds size limit (${serializedValue.length} chars), truncating...`
          );
          serializedValue =
            serializedValue.substring(0, MAX_BLOCK_SIZE - 100) + '\n\n... [truncated]';
        }

        const contentHash = this._hashContent(serializedValue);
        newBlockHashes.set(label, { hash: contentHash, value: serializedValue });
      }

      const cachedHashes = this._blockHashCache.get(agentId) || new Map();

      let allMatchCache = true;
      for (const [label, { hash }] of newBlockHashes) {
        if (cachedHashes.get(label) !== hash) {
          allMatchCache = false;
          break;
        }
      }

      if (allMatchCache && cachedHashes.size === newBlockHashes.size) {
        console.log(
          `[Letta] ✓ All blocks match cache - skipping API calls (${blocks.length} blocks)`
        );
        return;
      }

      const existingBlocks = await client.agents.blocks.list(agentId, { limit: 50 });
      const existingBlockMap = new Map(existingBlocks.map(b => [b.label, b]));

      const updateOperations = [];
      let skippedCount = 0;

      for (const block of blocks) {
        const { label } = block;
        const { hash: contentHash, value: serializedValue } = newBlockHashes.get(label);
        const existingBlock = existingBlockMap.get(label);

        if (existingBlock) {
          const existingHash = this._hashContent(existingBlock.value);
          if (existingHash !== contentHash) {
            console.log(`[Letta] Upserting block "${label}" (${serializedValue.length} chars)`);
            updateOperations.push({
              type: 'update',
              label,
              blockId: existingBlock.id,
              value: serializedValue,
              hash: contentHash,
            });
          } else {
            skippedCount++;
          }
        } else {
          console.log(`[Letta] Upserting block "${label}" (${serializedValue.length} chars)`);
          updateOperations.push({
            type: 'create',
            label,
            value: serializedValue,
            hash: contentHash,
          });
        }
      }

      if (skippedCount > 0) {
        console.log(`[Letta] Skipped ${skippedCount} unchanged blocks`);
      }

      if (updateOperations.length === 0) {
        console.log(`[Letta] No changes needed, all blocks up to date`);
        this._blockHashCache.set(agentId, newBlockHashes);
        return;
      }

      console.log(
        `[Letta] Executing ${updateOperations.length} operations with concurrency limit of ${CONCURRENCY_LIMIT}`
      );

      for (let i = 0; i < updateOperations.length; i += CONCURRENCY_LIMIT) {
        const batch = updateOperations.slice(i, i + CONCURRENCY_LIMIT);

        await Promise.allSettled(
          batch.map(async op => {
            if (op.type === 'update') {
              await client.blocks.modify(op.blockId, { value: op.value });
              console.log(`[Letta] Updated block "${op.label}" (id: ${op.blockId})`);
            } else {
              const newBlock = await client.blocks.create({
                label: op.label,
                value: op.value,
              });
              await client.agents.blocks.attach(agentId, newBlock.id);
              console.log(`[Letta] Created and attached block "${op.label}" (id: ${newBlock.id})`);
            }
          })
        );
      }

      console.log(`[Letta] Successfully upserted all ${blocks.length} memory blocks`);

      const cacheMap = new Map();
      for (const [label, { hash }] of newBlockHashes) {
        cacheMap.set(label, hash);
      }
      this._blockHashCache.set(agentId, cacheMap);
    } catch (error) {
      console.error(`[Letta] Error upserting memory blocks:`, error.message);
      throw error;
    }
  }

  _hashContent(content) {
    let hash = 0;
    if (!content || content.length === 0) return hash;

    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }

    return hash;
  }

  async initializeScratchpad(agentId) {
    const client = this.config.client;
    console.log(`[Letta] Initializing scratchpad for agent ${agentId}`);

    try {
      const blocks = await client.agents.blocks.list(agentId);
      const existingScratchpad = blocks.find(b => b.label === 'scratchpad');

      if (existingScratchpad) {
        console.log(`[Letta] Scratchpad already exists, skipping initialization`);
        return;
      }

      const scratchpadContent = buildScratchpad();
      const serializedValue = JSON.stringify(scratchpadContent, null, 2);

      const newBlock = await client.blocks.create({
        label: 'scratchpad',
        value: serializedValue,
      });

      await client.agents.blocks.attach(agentId, newBlock.id);
      console.log(`[Letta] ✓ Scratchpad initialized: ${newBlock.id}`);
    } catch (error) {
      console.error(`[Letta] Error initializing scratchpad:`, error.message);
    }
  }
}
