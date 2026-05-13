#!/usr/bin/env node

/**
 * Provision all Huly PM agents with minimal PM toolset
 */

import 'dotenv/config';
import { createLettaService } from './lib/LettaService.js';

async function provisionAllAgents() {
  console.log('=== Provisioning All Huly PM Agents ===\n');

  // Initialize Letta service
  const lettaService = createLettaService();
  console.log('[✓] Letta service initialized\n');

  // Get all agents
  console.log('Fetching all agents...');
  const allAgents = await lettaService.client.agents.list({ limit: 100 });
  const hulyAgents = allAgents.filter(a => a.name && a.name.startsWith('Huly-'));

  console.log(`[✓] Found ${hulyAgents.length} Huly PM agents\n`);

  if (hulyAgents.length === 0) {
    console.error('[✗] No Huly PM agents found');
    process.exit(1);
  }

  // Statistics
  const stats = {
    total: hulyAgents.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    toolsAttached: 0,
    toolsSkipped: 0,
    errors: [],
  };

  // Process each agent
  for (const agent of hulyAgents) {
    stats.processed++;
    console.log(`[${stats.processed}/${stats.total}] Processing: ${agent.name}`);

    try {
      const result = await lettaService.attachPmTools(agent.id);

      stats.succeeded++;
      stats.toolsAttached += result.attached;
      stats.toolsSkipped += result.skipped;

      if (result.errors.length > 0) {
        stats.errors.push({
          agent: agent.name,
          errors: result.errors,
        });
      }

      console.log(`  ✓ Success: ${result.attached} attached, ${result.skipped} skipped\n`);

    } catch (error) {
      stats.failed++;
      stats.errors.push({
        agent: agent.name,
        errors: [{ error: error.message }],
      });
      console.error(`  ✗ Failed: ${error.message}\n`);
    }

    // Longer delay to avoid overwhelming API (2 seconds between agents)
    console.log(`  ⏸  Waiting 2 seconds before next agent...`);
    await new Promise(r => setTimeout(r, 2000));
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('=== Provisioning Complete ===');
  console.log('='.repeat(60));
  console.log(`\nTotal agents: ${stats.total}`);
  console.log(`Processed: ${stats.processed}`);
  console.log(`Succeeded: ${stats.succeeded}`);
  console.log(`Failed: ${stats.failed}`);
  console.log(`\nTools attached: ${stats.toolsAttached}`);
  console.log(`Tools skipped: ${stats.toolsSkipped}`);
  console.log(`Total tool operations: ${stats.toolsAttached + stats.toolsSkipped}`);

  if (stats.errors.length > 0) {
    console.log(`\n⚠️  Errors encountered: ${stats.errors.length}`);
    console.log('\nError details:');
    for (const err of stats.errors) {
      console.log(`\n  Agent: ${err.agent}`);
      for (const e of err.errors) {
        console.log(`    - ${e.toolId || 'general'}: ${e.error}`);
      }
    }
  }

  console.log('\n[✓] Provisioning complete!');

  // Return non-zero if there were failures
  if (stats.failed > 0) {
    process.exit(1);
  }
}

provisionAllAgents().catch(error => {
  console.error('\n[✗] Provisioning failed:', error.message);
  console.error(error.stack);
  process.exit(1);
});
