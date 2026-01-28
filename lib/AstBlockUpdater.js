/**
 * AstBlockUpdater - Updates PM agent memory blocks with AST summaries
 */

import { logger } from './logger.js';

const CODEBASE_AST_LABEL = 'codebase_ast';

export class AstBlockUpdater {
  constructor(lettaService) {
    this.letta = lettaService;
    this.log = logger.child({ service: 'AstBlockUpdater' });
  }

  async updateAgentBlock(agentId, summary) {
    if (!summary) return false;

    try {
      const agent = await this.letta.client.agents.retrieve(agentId);
      const existingBlock = agent.memory?.blocks?.find(b => b.label === CODEBASE_AST_LABEL);
      const value = JSON.stringify(summary, null, 2);

      if (existingBlock) {
        await this.letta.client.blocks.modify(existingBlock.id, { value });
        this.log.info({ agentId, blockId: existingBlock.id }, 'Updated codebase_ast block');
      } else {
        const block = await this.letta.client.blocks.create({
          label: CODEBASE_AST_LABEL,
          value,
          limit: 20000,
        });
        await this.letta.client.agents.blocks.attach(agentId, block.id);
        this.log.info({ agentId, blockId: block.id }, 'Created and attached codebase_ast block');
      }
      return true;
    } catch (err) {
      this.log.error({ err, agentId }, 'Failed to update codebase_ast block');
      return false;
    }
  }
}

export default AstBlockUpdater;
