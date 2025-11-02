#!/usr/bin/env node

/**
 * Add scratchpad blocks to all existing agents
 * Run this once to initialize scratchpads for agents created before this feature
 */

import { createLettaService } from './lib/LettaService.js';
import dotenv from 'dotenv';

dotenv.config();

const lettaService = createLettaService();

async function main() {
  console.log('\n📝 ADDING SCRATCHPADS TO ALL AGENTS\n');
  
  try {
    const agents = await lettaService.listAgents();
    const hulyAgents = agents.filter(a => a.name.startsWith('Huly-'));
    
    console.log(`Found ${hulyAgents.length} Huly agents\n`);
    
    let added = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const agent of hulyAgents) {
      try {
        console.log(`Processing ${agent.name}...`);
        await lettaService.initializeScratchpad(agent.id);
        added++;
      } catch (error) {
        console.error(`  ❌ Error: ${error.message}`);
        errors++;
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log(`\n✅ Added: ${added}`);
    console.log(`⏭️  Skipped (already exists): ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📊 Total: ${hulyAgents.length}\n`);
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
