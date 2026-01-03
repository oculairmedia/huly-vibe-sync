#!/usr/bin/env node

/**
 * Attach Meridian's human memory block to all Huly PM agents
 * This seeds all agents with information about Emmanuel
 */

import { createLettaService } from './lib/LettaService.js';
import dotenv from 'dotenv';

dotenv.config();

const lettaService = createLettaService();
const MERIDIAN_ID = 'agent-597b5756-2915-4560-ba6b-91005f085166';
const HUMAN_BLOCK_ID = 'block-3da80889-c509-4c68-b502-a3f54c28c137';

async function main() {
  console.log('\n👤 ATTACHING MERIDIAN HUMAN BLOCK TO ALL HULY AGENTS\n');

  try {
    // Get Meridian's human block
    const meridianBlocks = await lettaService.client.agents.blocks.list(MERIDIAN_ID);
    const humanBlock = meridianBlocks.find(b => b.id === HUMAN_BLOCK_ID);

    if (!humanBlock) {
      console.error('❌ Meridian human block not found');
      process.exit(1);
    }

    console.log(`Found human block (${humanBlock.value.length} chars)\n`);
    console.log('Preview:');
    console.log(humanBlock.value.substring(0, 200) + '...\n');

    // Get all Huly agents
    const agents = await lettaService.listAgents();
    const hulyAgents = agents.filter(a => a.name.startsWith('Huly-'));

    console.log(`Found ${hulyAgents.length} Huly agents\n`);
    console.log('⚠️  This will update the "human" block for all agents');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
    await new Promise(resolve => setTimeout(resolve, 2000));

    let updated = 0;
    let created = 0;
    let errors = 0;

    for (const agent of hulyAgents) {
      try {
        console.log(`Processing ${agent.name}...`);

        // Check if agent already has human block
        const agentBlocks = await lettaService.client.agents.blocks.list(agent.id);
        const existingHuman = agentBlocks.find(b => b.label === 'human');

        if (existingHuman) {
          // Update existing block
          await lettaService.client.blocks.modify(existingHuman.id, {
            value: humanBlock.value,
          });
          console.log(`  ✅ Updated existing human block`);
          updated++;
        } else {
          // Create and attach new block
          const newBlock = await lettaService.client.blocks.create({
            label: 'human',
            value: humanBlock.value,
          });
          await lettaService.client.agents.blocks.attach(agent.id, newBlock.id);
          console.log(`  ✅ Created and attached human block`);
          created++;
        }

      } catch (error) {
        console.error(`  ❌ Error: ${error.message}`);
        errors++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`\n✅ Updated: ${updated}`);
    console.log(`➕ Created: ${created}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📊 Total: ${hulyAgents.length}\n`);

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
