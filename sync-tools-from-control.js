#!/usr/bin/env node
/**
 * Sync Tools from Control Agent to All PM Agents
 *
 * This script:
 * 1. Gets the tool list from Huly-PM-Control agent
 * 2. Syncs those tools to all Huly PM agents
 * 3. Reports on changes made
 *
 * Usage:
 *   node sync-tools-from-control.js [--dry-run]
 */

import 'dotenv/config';
import { createLettaService } from './lib/LettaService.js';
import { createSyncDatabase } from './lib/database.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('\n=== Sync Tools from Control Agent to All PM Agents ===\n');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  // Initialize services
  const letta = createLettaService();
  const db = createSyncDatabase('./logs/sync-state.db');

  // Step 1: Get control agent configuration
  console.log('[1/4] Fetching Control Agent configuration...');
  const controlConfig = await letta.ensureControlAgent();
  console.log(`✓ Control Agent: ${controlConfig.agentName} (${controlConfig.agentId})`);
  console.log(`✓ Tools configured: ${controlConfig.toolIds.length}`);

  if (controlConfig.toolIds.length === 0) {
    console.log('\n⚠️  Control Agent has no tools configured. Exiting.');
    return;
  }

  console.log('\nControl Agent Tools:');
  const controlTools = await letta.client.agents.tools.list(controlConfig.agentId);
  controlTools.forEach((tool, idx) => {
    console.log(`  ${idx + 1}. ${tool.name} (${tool.id})`);
  });

  // Step 2: Get all PM agents from database
  console.log('\n[2/4] Loading PM agents from database...');
  const allProjects = db.getAllProjects();
  console.log(`✓ Found ${allProjects.length} projects in database`);

  // Get agent IDs from Letta state
  const agentIds = [];
  for (const project of allProjects) {
    const agentId = letta.getPersistedAgentId(project.identifier);
    if (agentId && agentId !== controlConfig.agentId) {
      agentIds.push({
        projectId: project.identifier,
        projectName: project.name,
        agentId: agentId,
      });
    }
  }

  console.log(`✓ Found ${agentIds.length} PM agents (excluding control agent)`);

  if (agentIds.length === 0) {
    console.log('\n⚠️  No PM agents found. Exiting.');
    return;
  }

  // Step 3: Sync tools to each PM agent
  console.log(`\n[3/4] Syncing tools to ${agentIds.length} PM agents...`);

  const results = {
    total: agentIds.length,
    synced: 0,
    skipped: 0,
    errors: [],
    changes: [],
  };

  for (const { projectId, projectName, agentId } of agentIds) {
    try {
      console.log(`\nProcessing: ${projectName} (${projectId})`);
      console.log(`  Agent ID: ${agentId}`);

      // Get current tools
      const currentTools = await letta.client.agents.tools.list(agentId);
      const currentToolIds = new Set(currentTools.map(t => t.id));

      console.log(`  Current tools: ${currentTools.length}`);

      // Calculate changes needed
      const toAttach = controlConfig.toolIds.filter(id => !currentToolIds.has(id));
      const toDetach = [...currentToolIds].filter(id => !controlConfig.toolIds.includes(id));

      if (toAttach.length === 0 && toDetach.length === 0) {
        console.log(`  ✓ Already in sync - no changes needed`);
        results.skipped++;
        continue;
      }

      console.log(`  Changes needed:`);
      console.log(`    - Attach: ${toAttach.length} tools`);
      console.log(`    - Detach: ${toDetach.length} tools`);

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would sync tools`);
        results.changes.push({
          project: projectName,
          attach: toAttach.length,
          detach: toDetach.length,
        });
        continue;
      }

      // Detach tools not in control agent
      for (const toolId of toDetach) {
        try {
          await letta.client.agents.tools.detach(agentId, toolId);
          console.log(`    ✓ Detached: ${toolId}`);
        } catch (error) {
          console.error(`    ✗ Failed to detach ${toolId}:`, error.message);
        }
      }

      // Attach tools from control agent
      for (const toolId of toAttach) {
        try {
          await letta.client.agents.tools.attach(agentId, toolId);
          console.log(`    ✓ Attached: ${toolId}`);
        } catch (error) {
          if (error.message && error.message.includes('already attached')) {
            console.log(`    - Already attached: ${toolId}`);
          } else {
            console.error(`    ✗ Failed to attach ${toolId}:`, error.message);
          }
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 200));
      }

      results.synced++;
      results.changes.push({
        project: projectName,
        attached: toAttach.length,
        detached: toDetach.length,
      });

      console.log(`  ✓ Sync complete`);

    } catch (error) {
      console.error(`  ✗ Error syncing ${projectName}:`, error.message);
      results.errors.push({
        project: projectName,
        error: error.message,
      });
    }
  }

  // Step 4: Summary
  console.log('\n[4/4] Summary\n');
  console.log(`Total agents: ${results.total}`);
  console.log(`Synced: ${results.synced}`);
  console.log(`Skipped (already in sync): ${results.skipped}`);
  console.log(`Errors: ${results.errors.length}`);

  if (results.changes.length > 0) {
    console.log('\nChanges made:');
    results.changes.forEach(change => {
      if (DRY_RUN) {
        console.log(`  - ${change.project}: ${change.attach} to attach, ${change.detach} to detach`);
      } else {
        console.log(`  - ${change.project}: ${change.attached} attached, ${change.detached} detached`);
      }
    });
  }

  if (results.errors.length > 0) {
    console.log('\nErrors:');
    results.errors.forEach(err => {
      console.log(`  - ${err.project}: ${err.error}`);
    });
  }

  console.log('\n=== Tool Sync Complete ===');

  if (DRY_RUN) {
    console.log('\n💡 Run without --dry-run to apply changes');
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
