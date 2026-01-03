#!/usr/bin/env node

/**
 * Agent Management CLI
 *
 * Allows modification of deployed Letta agents without recreation:
 * - Add/update/delete memory blocks
 * - Attach/detach tools
 * - Update agent configuration
 * - Bulk operations across all agents
 *
 * Usage:
 *   node manage-agents.js <command> [options]
 *
 * Commands:
 *   list-agents                     - List all Huly agents
 *   show-agent <name|id>           - Show agent details with memory blocks
 *   update-block <agent> <label>   - Update a memory block for one agent
 *   update-block-all <label>       - Update a memory block for all agents
 *   add-block <agent> <label>      - Add new memory block to agent
 *   delete-block <agent> <label>   - Delete memory block from agent
 *   update-persona <agent>         - Update agent persona block
 *   update-persona-all             - Update persona for all agents
 *   list-tools <agent>             - List tools attached to agent
 *   attach-tool <agent> <tool-id>  - Attach tool to agent
 *   detach-tool <agent> <tool-id>  - Detach tool from agent
 */

import { LettaService, buildProjectMeta, buildBoardConfig, buildBoardMetrics, buildHotspots, buildBacklogSummary, buildChangeLog } from './lib/LettaService.js';
import { SyncDatabase } from './lib/database.js';
import dotenv from 'dotenv';

dotenv.config();

const lettaService = new LettaService(
  process.env.LETTA_BASE_URL,
  process.env.LETTA_PASSWORD,
  {
    model: process.env.LETTA_MODEL,
    embedding: process.env.LETTA_EMBEDDING,
  },
);

const db = new SyncDatabase('./logs/sync-state.db');
db.initialize();

/**
 * List all Huly agents
 */
async function listAgents() {
  console.log('\n📋 LISTING ALL HULY AGENTS\n');

  const agents = await lettaService.listAgents();
  const hulyAgents = agents.filter(a => a.name.startsWith('Huly-'));

  console.log(`Found ${hulyAgents.length} Huly agents:\n`);

  for (const agent of hulyAgents) {
    const project = agent.name.replace('Huly-', '').replace('-PM', '');
    console.log(`  ${agent.name}`);
    console.log(`    ID: ${agent.id}`);
    console.log(`    Type: ${agent.agent_type}`);
    console.log(`    Model: ${agent.model}`);
    console.log(`    Project: ${project}`);
    console.log('');
  }
}

/**
 * Show agent details with memory blocks
 */
async function showAgent(nameOrId) {
  console.log(`\n🔍 SHOWING AGENT: ${nameOrId}\n`);

  let agent;

  // Try to find by name or ID
  if (nameOrId.startsWith('agent-')) {
    agent = await lettaService.getAgent(nameOrId);
  } else {
    const agents = await lettaService.listAgents();
    const agentName = nameOrId.startsWith('Huly-') ? nameOrId : `Huly-${nameOrId}-PM`;
    agent = agents.find(a => a.name === agentName);

    if (!agent) {
      console.error(`❌ Agent not found: ${nameOrId}`);
      process.exit(1);
    }
  }

  console.log(`Name: ${agent.name}`);
  console.log(`ID: ${agent.id}`);
  console.log(`Type: ${agent.agent_type}`);
  console.log(`Model: ${agent.model}`);
  console.log(`Embedding: ${agent.embedding_config?.embedding_model || 'N/A'}`);
  console.log('');

  // Get memory blocks
  const blocks = await lettaService.client.agents.blocks.list(agent.id, { limit: 50 });

  console.log(`📦 MEMORY BLOCKS (${blocks.length}):\n`);

  for (const block of blocks) {
    const valuePreview = typeof block.value === 'string'
      ? block.value.substring(0, 100).replace(/\n/g, ' ')
      : JSON.stringify(block.value).substring(0, 100);

    console.log(`  ${block.label}`);
    console.log(`    ID: ${block.id}`);
    console.log(`    Size: ${block.value?.length || 0} chars`);
    console.log(`    Preview: ${valuePreview}...`);
    console.log('');
  }

  // Get attached tools
  const tools = await lettaService.client.agents.tools.list(agent.id);
  console.log(`🔧 ATTACHED TOOLS (${tools.length}):\n`);

  for (const tool of tools) {
    console.log(`  ${tool.name} (${tool.id})`);
  }
  console.log('');
}

/**
 * Update a memory block for a single agent
 */
async function updateBlock(agentNameOrId, blockLabel, interactive = true) {
  console.log(`\n✏️  UPDATING BLOCK: ${blockLabel} for ${agentNameOrId}\n`);

  // Find agent
  let agent;
  if (agentNameOrId.startsWith('agent-')) {
    agent = await lettaService.getAgent(agentNameOrId);
  } else {
    const agents = await lettaService.listAgents();
    const agentName = agentNameOrId.startsWith('Huly-') ? agentNameOrId : `Huly-${agentNameOrId}-PM`;
    agent = agents.find(a => a.name === agentName);

    if (!agent) {
      console.error(`❌ Agent not found: ${agentNameOrId}`);
      process.exit(1);
    }
  }

  // Get project data from database
  const projectId = agent.name.replace('Huly-', '').replace('-PM', '');
  const project = db.getProject(projectId);

  if (!project) {
    console.error(`❌ Project not found in database: ${projectId}`);
    process.exit(1);
  }

  // Build the block content based on label
  let blockValue;

  switch (blockLabel) {
    case 'project':
      // Need Huly and Vibe project data
      console.log('Building project metadata...');
      blockValue = buildProjectMeta(
        { name: project.name, identifier: project.identifier, id: project.huly_id },
        { id: project.vibe_id },
        project.filesystem_path,
        project.git_url,
      );
      break;

    case 'board_config':
      console.log('Building board configuration...');
      blockValue = buildBoardConfig();
      break;

    case 'persona':
      console.log('Building persona...');
      blockValue = lettaService._buildPersonaBlock(project.identifier, project.name);
      break;

    default:
      console.error(`❌ Unknown block label: ${blockLabel}`);
      console.log('Supported blocks: project, board_config, persona');
      console.log('For other blocks (board_metrics, hotspots, backlog_summary, change_log), use the main sync');
      process.exit(1);
  }

  // Show preview
  const preview = typeof blockValue === 'string'
    ? blockValue.substring(0, 200)
    : JSON.stringify(blockValue, null, 2).substring(0, 200);

  console.log(`\nBlock preview:\n${preview}...\n`);

  if (interactive) {
    // Confirm before updating
    console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // Update the block
  await lettaService.upsertMemoryBlocks(agent.id, [{ label: blockLabel, value: blockValue }]);

  console.log(`✅ Block "${blockLabel}" updated for agent ${agent.name}`);
}

/**
 * Update a memory block for all agents
 */
async function updateBlockAll(blockLabel) {
  console.log(`\n✏️  UPDATING BLOCK: ${blockLabel} for ALL agents\n`);

  const agents = await lettaService.listAgents();
  const hulyAgents = agents.filter(a => a.name.startsWith('Huly-'));

  console.log(`Found ${hulyAgents.length} Huly agents`);
  console.log(`\n⚠️  This will update the "${blockLabel}" block for ALL agents`);
  console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
  await new Promise(resolve => setTimeout(resolve, 5000));

  let updated = 0;
  const skipped = 0;
  let errors = 0;

  for (const agent of hulyAgents) {
    try {
      console.log(`\nProcessing ${agent.name}...`);
      await updateBlock(agent.id, blockLabel, false);
      updated++;
    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
      errors++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\n✅ Updated: ${updated}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`❌ Errors: ${errors}`);
  console.log(`📊 Total: ${hulyAgents.length}\n`);
}

/**
 * Add a new memory block to an agent
 */
async function addBlock(agentNameOrId, blockLabel, blockValue) {
  console.log(`\n➕ ADDING BLOCK: ${blockLabel} to ${agentNameOrId}\n`);

  // Find agent
  let agent;
  if (agentNameOrId.startsWith('agent-')) {
    agent = await lettaService.getAgent(agentNameOrId);
  } else {
    const agents = await lettaService.listAgents();
    const agentName = agentNameOrId.startsWith('Huly-') ? agentNameOrId : `Huly-${agentNameOrId}-PM`;
    agent = agents.find(a => a.name === agentName);

    if (!agent) {
      console.error(`❌ Agent not found: ${agentNameOrId}`);
      process.exit(1);
    }
  }

  // Check if block already exists
  const blocks = await lettaService.client.agents.blocks.list(agent.id);
  const existing = blocks.find(b => b.label === blockLabel);

  if (existing) {
    console.error(`❌ Block "${blockLabel}" already exists. Use update-block to modify it.`);
    process.exit(1);
  }

  // Add the block
  await lettaService.upsertMemoryBlocks(agent.id, [{ label: blockLabel, value: blockValue }]);

  console.log(`✅ Block "${blockLabel}" added to agent ${agent.name}`);
}

/**
 * Delete a memory block from an agent
 */
async function deleteBlock(agentNameOrId, blockLabel) {
  console.log(`\n🗑️  DELETING BLOCK: ${blockLabel} from ${agentNameOrId}\n`);

  // Find agent
  let agent;
  if (agentNameOrId.startsWith('agent-')) {
    agent = await lettaService.getAgent(agentNameOrId);
  } else {
    const agents = await lettaService.listAgents();
    const agentName = agentNameOrId.startsWith('Huly-') ? agentNameOrId : `Huly-${agentNameOrId}-PM`;
    agent = agents.find(a => a.name === agentName);

    if (!agent) {
      console.error(`❌ Agent not found: ${agentNameOrId}`);
      process.exit(1);
    }
  }

  // Find the block
  const blocks = await lettaService.client.agents.blocks.list(agent.id);
  const block = blocks.find(b => b.label === blockLabel);

  if (!block) {
    console.error(`❌ Block "${blockLabel}" not found on agent ${agent.name}`);
    process.exit(1);
  }

  console.log(`⚠️  About to delete block "${blockLabel}" (${block.value?.length || 0} chars)`);
  console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Detach and delete the block
  await lettaService.client.agents.blocks.detach(agent.id, block.id);
  await lettaService.client.blocks.delete(block.id);

  console.log(`✅ Block "${blockLabel}" deleted from agent ${agent.name}`);
}

/**
 * List tools attached to an agent
 */
async function listTools(agentNameOrId) {
  console.log(`\n🔧 LISTING TOOLS for ${agentNameOrId}\n`);

  // Find agent
  let agent;
  if (agentNameOrId.startsWith('agent-')) {
    agent = await lettaService.getAgent(agentNameOrId);
  } else {
    const agents = await lettaService.listAgents();
    const agentName = agentNameOrId.startsWith('Huly-') ? agentNameOrId : `Huly-${agentNameOrId}-PM`;
    agent = agents.find(a => a.name === agentName);

    if (!agent) {
      console.error(`❌ Agent not found: ${agentNameOrId}`);
      process.exit(1);
    }
  }

  const tools = await lettaService.client.agents.tools.list(agent.id);

  console.log(`Agent: ${agent.name}`);
  console.log(`Tools: ${tools.length}\n`);

  for (const tool of tools) {
    console.log(`  ${tool.name}`);
    console.log(`    ID: ${tool.id}`);
    console.log(`    Source: ${tool.source_type || 'N/A'}`);
    console.log('');
  }
}

/**
 * Attach a tool to an agent
 */
async function attachTool(agentNameOrId, toolId) {
  console.log(`\n🔗 ATTACHING TOOL ${toolId} to ${agentNameOrId}\n`);

  // Find agent
  let agent;
  if (agentNameOrId.startsWith('agent-')) {
    agent = await lettaService.getAgent(agentNameOrId);
  } else {
    const agents = await lettaService.listAgents();
    const agentName = agentNameOrId.startsWith('Huly-') ? agentNameOrId : `Huly-${agentNameOrId}-PM`;
    agent = agents.find(a => a.name === agentName);

    if (!agent) {
      console.error(`❌ Agent not found: ${agentNameOrId}`);
      process.exit(1);
    }
  }

  // Check if already attached
  const tools = await lettaService.client.agents.tools.list(agent.id);
  const alreadyAttached = tools.some(t => t.id === toolId);

  if (alreadyAttached) {
    console.log(`⏭️  Tool already attached to agent`);
    return;
  }

  // Attach the tool
  await lettaService.client.agents.tools.attach(agent.id, toolId);

  console.log(`✅ Tool ${toolId} attached to agent ${agent.name}`);
}

/**
 * Detach a tool from an agent
 */
async function detachTool(agentNameOrId, toolId) {
  console.log(`\n🔓 DETACHING TOOL ${toolId} from ${agentNameOrId}\n`);

  // Find agent
  let agent;
  if (agentNameOrId.startsWith('agent-')) {
    agent = await lettaService.getAgent(agentNameOrId);
  } else {
    const agents = await lettaService.listAgents();
    const agentName = agentNameOrId.startsWith('Huly-') ? agentNameOrId : `Huly-${agentNameOrId}-PM`;
    agent = agents.find(a => a.name === agentName);

    if (!agent) {
      console.error(`❌ Agent not found: ${agentNameOrId}`);
      process.exit(1);
    }
  }

  // Check if attached
  const tools = await lettaService.client.agents.tools.list(agent.id);
  const isAttached = tools.some(t => t.id === toolId);

  if (!isAttached) {
    console.log(`⏭️  Tool not attached to agent`);
    return;
  }

  console.log(`⚠️  About to detach tool ${toolId}`);
  console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Detach the tool
  await lettaService.client.agents.tools.detach(agent.id, toolId);

  console.log(`✅ Tool ${toolId} detached from agent ${agent.name}`);
}

/**
 * Main CLI handler
 */
async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  try {
    switch (command) {
      case 'list-agents':
        await listAgents();
        break;

      case 'show-agent':
        if (args.length < 1) {
          console.error('Usage: manage-agents.js show-agent <name|id>');
          process.exit(1);
        }
        await showAgent(args[0]);
        break;

      case 'update-block':
        if (args.length < 2) {
          console.error('Usage: manage-agents.js update-block <agent> <label>');
          process.exit(1);
        }
        await updateBlock(args[0], args[1]);
        break;

      case 'update-block-all':
        if (args.length < 1) {
          console.error('Usage: manage-agents.js update-block-all <label>');
          process.exit(1);
        }
        await updateBlockAll(args[0]);
        break;

      case 'add-block':
        if (args.length < 3) {
          console.error('Usage: manage-agents.js add-block <agent> <label> <value>');
          process.exit(1);
        }
        await addBlock(args[0], args[1], args[2]);
        break;

      case 'delete-block':
        if (args.length < 2) {
          console.error('Usage: manage-agents.js delete-block <agent> <label>');
          process.exit(1);
        }
        await deleteBlock(args[0], args[1]);
        break;

      case 'update-persona':
        if (args.length < 1) {
          console.error('Usage: manage-agents.js update-persona <agent>');
          process.exit(1);
        }
        await updateBlock(args[0], 'persona');
        break;

      case 'update-persona-all':
        await updateBlockAll('persona');
        break;

      case 'list-tools':
        if (args.length < 1) {
          console.error('Usage: manage-agents.js list-tools <agent>');
          process.exit(1);
        }
        await listTools(args[0]);
        break;

      case 'attach-tool':
        if (args.length < 2) {
          console.error('Usage: manage-agents.js attach-tool <agent> <tool-id>');
          process.exit(1);
        }
        await attachTool(args[0], args[1]);
        break;

      case 'detach-tool':
        if (args.length < 2) {
          console.error('Usage: manage-agents.js detach-tool <agent> <tool-id>');
          process.exit(1);
        }
        await detachTool(args[0], args[1]);
        break;

      default:
        console.log(`
🤖 AGENT MANAGEMENT CLI

Commands:
  list-agents                     - List all Huly agents
  show-agent <name|id>           - Show agent details with memory blocks
  update-block <agent> <label>   - Update a memory block for one agent
  update-block-all <label>       - Update a memory block for all agents
  add-block <agent> <label> <val> - Add new memory block to agent
  delete-block <agent> <label>   - Delete memory block from agent
  update-persona <agent>         - Update agent persona block
  update-persona-all             - Update persona for all agents
  list-tools <agent>             - List tools attached to agent
  attach-tool <agent> <tool-id>  - Attach tool to agent
  detach-tool <agent> <tool-id>  - Detach tool from agent

Agent names can be:
  - Full name: Huly-VIBEK-PM
  - Project ID: VIBEK
  - Agent ID: agent-xxx-xxx-xxx

Supported block labels for update:
  - project       (project metadata)
  - board_config  (status mapping and workflow)
  - persona       (agent personality and role)

Examples:
  node manage-agents.js list-agents
  node manage-agents.js show-agent VIBEK
  node manage-agents.js update-persona VIBEK
  node manage-agents.js update-block-all board_config
  node manage-agents.js list-tools VIBEK
`);
        process.exit(1);
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
