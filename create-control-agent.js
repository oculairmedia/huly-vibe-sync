#!/usr/bin/env node

/**
 * Create the Huly PM Control Agent
 * This agent serves as a template for all PM agents
 */

import { createLettaService } from './lib/LettaService.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('\n🎛️  CREATING HULY PM CONTROL AGENT\n');

  const lettaService = createLettaService();

  try {
    const controlConfig = await lettaService.ensureControlAgent();

    console.log('\n✅ Control Agent Created/Found:\n');
    console.log(`Name: ${controlConfig.agentName}`);
    console.log(`ID: ${controlConfig.agentId}`);
    console.log(`Tools: ${controlConfig.toolIds.length}`);
    console.log(`Persona: ${controlConfig.persona ? 'Yes (' + controlConfig.persona.length + ' chars)' : 'No'}\n`);

    console.log('Tool IDs:');
    controlConfig.toolIds.forEach((toolId, idx) => {
      console.log(`  ${idx + 1}. ${toolId}`);
    });

    console.log('\n📋 All PM agents will now sync from this control agent.');
    console.log('You can modify this agent\'s tools and persona, and changes will reflect in all PM agents.\n');

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

main();
