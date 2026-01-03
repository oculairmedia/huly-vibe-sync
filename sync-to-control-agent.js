#!/usr/bin/env node

/**
 * Sync all existing Huly PM agents to match the Control Agent
 *
 * This script:
 * 1. Gets control agent configuration (tools and persona)
 * 2. Updates all existing Huly PM agents to match
 * 3. Ensures all agents have control agent tools
 * 4. Updates personas to match control agent
 */

import { createLettaService } from './lib/LettaService.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('\n🔄 SYNCING PM AGENTS TO CONTROL AGENT\n');

  const lettaService = createLettaService();

  try {
    // Get control agent configuration
    console.log('Fetching control agent configuration...');
    const controlConfig = await lettaService.ensureControlAgent();

    console.log(`\nControl Agent: ${controlConfig.agentName}`);
    console.log(`Tools: ${controlConfig.toolIds.length}`);
    console.log(`Persona: ${controlConfig.persona ? 'Yes' : 'No'}\n`);

    // Get all PM agents
    const agents = await lettaService.client.agents.list();
    const pmAgents = agents.filter(a =>
      a.name.startsWith('Huly-') &&
      a.name !== controlConfig.agentName,
    );

    console.log(`Found ${pmAgents.length} PM agents to sync\n`);

    if (pmAgents.length === 0) {
      console.log('No PM agents found to sync.');
      return;
    }

    console.log('⚠️  This will:');
    console.log('  1. Update persona block on all PM agents');
    console.log('  2. Attach any missing tools from control agent');
    console.log('  3. Keep existing project-specific blocks\n');

    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));

    let updated = 0;
    let errors = 0;

    for (const agent of pmAgents) {
      try {
        console.log(`\nSyncing: ${agent.name} (${agent.id})`);

        // Update persona block
        if (controlConfig.persona) {
          await lettaService._updatePersonaBlock(agent.id, controlConfig.persona);
          console.log('  ✓ Persona updated');
        }

        // Get current tools
        const currentTools = await lettaService.client.agents.tools.list(agent.id);
        const currentToolIds = currentTools.map(t => t.id);

        // Attach missing tools
        let toolsAdded = 0;
        for (const toolId of controlConfig.toolIds) {
          if (!currentToolIds.includes(toolId)) {
            try {
              await lettaService.client.agents.tools.attach(agent.id, toolId);
              toolsAdded++;
              console.log(`  ✓ Added tool: ${toolId}`);
            } catch (error) {
              if (!error.message.includes('already attached')) {
                console.log(`  ⚠️  Tool attach error: ${error.message}`);
              }
            }
          }
        }

        if (toolsAdded === 0) {
          console.log('  - All tools already present');
        } else {
          console.log(`  ✓ Added ${toolsAdded} tools`);
        }

        updated++;

        // Small delay to avoid overwhelming server
        await new Promise(r => setTimeout(r, 500));

      } catch (error) {
        console.error(`  ❌ Error syncing ${agent.name}: ${error.message}`);
        errors++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`\n✅ Updated: ${updated}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📊 Total: ${pmAgents.length}\n`);

    console.log('All PM agents are now synced with the control agent! 🎉\n');

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

main();
