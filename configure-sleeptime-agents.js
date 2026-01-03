#!/usr/bin/env node

/**
 * Configure sleep-time agents to only work on scratchpad blocks
 *
 * This script:
 * 1. Finds all Huly PM agents with sleep-time enabled
 * 2. Identifies their sleep-time agent partners
 * 3. Detaches all memory blocks except scratchpad from sleep-time agents
 *
 * This ensures sleep-time agents can only modify the scratchpad block,
 * preventing them from corrupting important memory blocks like project metadata.
 */

import { createLettaService } from './lib/LettaService.js';
import dotenv from 'dotenv';

dotenv.config();

const lettaService = createLettaService();

async function configureSleeptimeAgent(primaryAgent) {
  try {
    console.log(`\nProcessing ${primaryAgent.name}...`);

    // Check if sleep-time is enabled
    if (!primaryAgent.multiAgentGroup) {
      console.log(`  ⏭️  No sleep-time agent (not in multi-agent group)`);
      return { status: 'no_sleeptime' };
    }

    const groupId = primaryAgent.multiAgentGroup.id;
    console.log(`  📋 Multi-agent group: ${groupId}`);

    // Get all agents in the group
    const group = await lettaService.client.groups.retrieve(groupId);

    if (!group.agents || group.agents.length < 2) {
      console.log(`  ⚠️  Group has ${group.agents?.length || 0} agents, expected 2`);
      return { status: 'invalid_group' };
    }

    // Find the sleep-time agent (not the primary agent)
    const sleeptimeAgent = group.agents.find(id => id !== primaryAgent.id);

    if (!sleeptimeAgent) {
      console.log(`  ⚠️  Could not find sleep-time agent in group`);
      return { status: 'no_sleeptime_agent' };
    }

    console.log(`  💤 Sleep-time agent: ${sleeptimeAgent}`);

    // Get all blocks attached to sleep-time agent
    const blocks = await lettaService.client.agents.blocks.list(sleeptimeAgent);
    console.log(`  📦 Sleep-time agent has ${blocks.length} blocks`);

    // Find blocks that are NOT scratchpad
    const blocksToDetach = blocks.filter(b => b.label !== 'scratchpad');

    if (blocksToDetach.length === 0) {
      console.log(`  ✅ Already configured (only scratchpad attached)`);
      return { status: 'already_configured', sleeptimeAgent };
    }

    console.log(`  🔧 Detaching ${blocksToDetach.length} non-scratchpad blocks...`);

    let detached = 0;
    let errors = 0;

    for (const block of blocksToDetach) {
      try {
        console.log(`    - Detaching "${block.label}" (${block.id})`);
        await lettaService.client.agents.blocks.detach(sleeptimeAgent, block.id);
        detached++;
      } catch (error) {
        console.error(`    ❌ Failed to detach ${block.label}: ${error.message}`);
        errors++;
      }
    }

    console.log(`  ✅ Detached ${detached} blocks, ${errors} errors`);

    // Verify final state
    const finalBlocks = await lettaService.client.agents.blocks.list(sleeptimeAgent);
    const remainingNonScratchpad = finalBlocks.filter(b => b.label !== 'scratchpad');

    if (remainingNonScratchpad.length > 0) {
      console.log(`  ⚠️  Warning: ${remainingNonScratchpad.length} non-scratchpad blocks still attached`);
    } else {
      console.log(`  ✅ Verified: Sleep-time agent only has scratchpad access`);
    }

    return {
      status: 'configured',
      sleeptimeAgent,
      detached,
      errors,
    };

  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
    return { status: 'error', error: error.message };
  }
}

async function main() {
  console.log('\n🔧 CONFIGURING SLEEP-TIME AGENTS\n');
  console.log('Restricting sleep-time agents to only modify scratchpad blocks.\n');
  console.log('This prevents them from modifying:');
  console.log('  - persona (agent role)');
  console.log('  - human (user context)');
  console.log('  - project (metadata)');
  console.log('  - board_config (status mappings)');
  console.log('  - board_metrics (current metrics)');
  console.log('  - hotspots (issues & risks)');
  console.log('  - backlog_summary (backlog overview)');
  console.log('  - change_log (recent changes)\n');

  try {
    const agents = await lettaService.listAgents();
    const hulyAgents = agents.filter(a => a.name.startsWith('Huly-'));

    console.log(`Found ${hulyAgents.length} Huly agents\n`);

    let configured = 0;
    let alreadyConfigured = 0;
    let noSleeptime = 0;
    let errors = 0;
    let totalDetached = 0;

    for (const agent of hulyAgents) {
      const result = await configureSleeptimeAgent(agent);

      switch (result.status) {
        case 'configured':
          configured++;
          totalDetached += result.detached || 0;
          break;
        case 'already_configured':
          alreadyConfigured++;
          break;
        case 'no_sleeptime':
          noSleeptime++;
          break;
        case 'error':
        case 'invalid_group':
        case 'no_sleeptime_agent':
          errors++;
          break;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`\n✅ Configured: ${configured} (detached ${totalDetached} blocks)`);
    console.log(`✓  Already configured: ${alreadyConfigured}`);
    console.log(`⏭️  No sleep-time: ${noSleeptime}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📊 Total: ${hulyAgents.length}\n`);

    if (noSleeptime > 0) {
      console.log(`ℹ️  ${noSleeptime} agents don't have sleep-time enabled yet.`);
      console.log('New agents will automatically be configured with sleep-time.\n');
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
