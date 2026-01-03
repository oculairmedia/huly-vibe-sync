#!/usr/bin/env node

/**
 * Delete all Huly PM agents
 * This allows for a clean rebuild with new configuration
 */

import { createLettaService } from './lib/LettaService.js';
import { createSyncDatabase } from './lib/database.js';
import dotenv from 'dotenv';

dotenv.config();

const lettaService = createLettaService();
const db = createSyncDatabase('./logs/sync-state.db');

async function main() {
  console.log('\n🗑️  DELETING ALL HULY PM AGENTS\n');
  console.log('This will:');
  console.log('  - Delete all Huly-* agents from Letta');
  console.log('  - Clear agent IDs from database');
  console.log('  - Allow clean rebuild with new configuration\n');

  console.log('⚠️  Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
  await new Promise(resolve => setTimeout(resolve, 5000));

  try {
    const agents = await lettaService.listAgents();
    const hulyAgents = agents.filter(a => a.name.startsWith('Huly-'));

    console.log(`Found ${hulyAgents.length} Huly agents\n`);

    let deleted = 0;
    let errors = 0;

    for (const agent of hulyAgents) {
      try {
        console.log(`Deleting ${agent.name}...`);
        await lettaService.client.agents.delete(agent.id);
        deleted++;
      } catch (error) {
        console.error(`  ❌ Error: ${error.message}`);
        errors++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`\n✅ Deleted: ${deleted}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📊 Total: ${hulyAgents.length}\n`);

    // Clear agent IDs from database
    console.log('Clearing agent IDs from database...');
    const result = db.db.prepare(`
      UPDATE projects 
      SET letta_agent_id = NULL, 
          letta_folder_id = NULL, 
          letta_source_id = NULL,
          letta_last_sync_at = NULL
    `).run();

    console.log(`✅ Cleared ${result.changes} project records\n`);

    console.log('🎉 Cleanup complete! Restart the sync service to rebuild agents.\n');

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
