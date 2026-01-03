#!/usr/bin/env node

/**
 * Migrate Agents to letta_v1_agent Architecture
 *
 * Deletes all existing Huly-*-PM agents that were created with the deprecated
 * memgpt_v2_agent architecture. The sync service will automatically recreate
 * them with the new architecture (no agent_type parameter = current architecture).
 *
 * Why: memgpt_v2_agent is deprecated. New agents use native model reasoning,
 * no send_message tool, and better performance on frontier models like GPT-5
 * and Claude Sonnet 4.5.
 */

import 'dotenv/config';
import fetch from 'node-fetch';
import { createSyncDatabase } from './lib/database.js';

const LETTA_API_URL = process.env.LETTA_BASE_URL || 'https://letta.oculair.ca';
const LETTA_PASSWORD = process.env.LETTA_PASSWORD;

if (!LETTA_PASSWORD) {
  console.error('❌ LETTA_PASSWORD not set in environment');
  process.exit(1);
}

async function listAllAgents() {
  try {
    const response = await fetch(`${LETTA_API_URL}/v1/agents`, {
      headers: {
        'Authorization': `Bearer ${LETTA_PASSWORD}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  } catch (error) {
    console.error('❌ Error listing agents:', error.message);
    throw error;
  }
}

async function deleteAgent(agentId) {
  try {
    const response = await fetch(`${LETTA_API_URL}/v1/agents/${agentId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${LETTA_PASSWORD}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return true;
  } catch (error) {
    console.error(`❌ Error deleting agent ${agentId}:`, error.message);
    return false;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('🔄 MIGRATING AGENTS TO letta_v1_agent ARCHITECTURE\n');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No agents will be deleted\n');
  }

  // List all agents
  console.log('📋 Fetching all agents from Letta...');
  const agents = await listAllAgents();

  // Filter Huly-*-PM agents (project management agents)
  const hulyAgents = agents.filter(agent =>
    agent.name && agent.name.startsWith('Huly-') && agent.name.endsWith('-PM'),
  );

  console.log(`Found ${agents.length} total agents`);
  console.log(`Found ${hulyAgents.length} Huly project agents\n`);

  if (hulyAgents.length === 0) {
    console.log('✓ No Huly agents to migrate');
    return;
  }

  console.log('🗑️  Agents to delete (will be recreated with new architecture):\n');
  hulyAgents.forEach((agent, idx) => {
    console.log(`   ${idx + 1}. ${agent.name} (${agent.id})`);
  });

  console.log('\n');

  if (dryRun) {
    console.log('✓ Dry run complete - no changes made');
    console.log('\nTo actually delete agents, run: node migrate-agents-to-v1.js');
    return;
  }

  // Confirm deletion
  console.log('⚠️  This will DELETE all Huly agents from Letta');
  console.log('⚠️  They will be recreated automatically on next sync with new architecture');
  console.log('\nPress Ctrl+C to cancel, or wait 5 seconds to continue...\n');

  await new Promise(resolve => setTimeout(resolve, 5000));

  // Delete agents
  let successCount = 0;
  let failCount = 0;

  console.log('🗑️  Deleting agents...\n');

  for (const agent of hulyAgents) {
    console.log(`Deleting ${agent.name} (${agent.id})...`);
    const success = await deleteAgent(agent.id);

    if (success) {
      console.log(`   ✅ Deleted`);
      successCount++;
    } else {
      console.log(`   ❌ Failed`);
      failCount++;
    }

    // Small delay to avoid overwhelming API
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('\n' + '='.repeat(60));
  console.log(`\n✅ Successfully deleted: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`📊 Total: ${hulyAgents.length}\n`);

  // Clear agent IDs from database
  console.log('🗄️  Clearing agent IDs from database...');
  const db = createSyncDatabase('./logs/sync-state.db');
  const projects = db.getAllProjects();

  let clearedCount = 0;
  for (const project of projects) {
    if (project.letta_agent_id) {
      db.setProjectLettaAgent(project.identifier, { agentId: null });
      clearedCount++;
    }
  }

  console.log(`✅ Cleared ${clearedCount} agent IDs from database\n`);

  // Clear .letta/settings.local.json files in project directories
  console.log('📁 Clearing .letta files in project directories...');
  let lettaFilesCleared = 0;

  for (const project of projects) {
    if (project.filesystem_path) {
      const lettaFile = `${project.filesystem_path}/.letta/settings.local.json`;
      try {
        const fs = await import('fs');
        if (fs.existsSync(lettaFile)) {
          fs.unlinkSync(lettaFile);
          lettaFilesCleared++;
        }
      } catch (error) {
        // Ignore errors (permission denied, etc.)
      }
    }
  }

  console.log(`✅ Cleared ${lettaFilesCleared} .letta files\n`);

  console.log('='.repeat(60));
  console.log('\n🎉 MIGRATION COMPLETE!\n');
  console.log('Next steps:');
  console.log('   1. Restart the sync service: docker-compose restart');
  console.log('   2. Wait for next sync cycle (5 minutes)');
  console.log('   3. New agents will be created with letta_v1_agent architecture');
  console.log('   4. Run audit: node audit-project-paths.js\n');
  console.log('Benefits of new architecture:');
  console.log('   ✓ Better performance on GPT-5 & Claude Sonnet 4.5');
  console.log('   ✓ Native model reasoning (no send_message tool)');
  console.log('   ✓ Simplified system prompts');
  console.log('   ✓ No more heartbeat parameters\n');
}

main().catch(error => {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});
