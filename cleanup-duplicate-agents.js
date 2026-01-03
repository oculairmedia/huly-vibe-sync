#!/usr/bin/env node
/**
 * Cleanup Duplicate Letta Agents
 *
 * Scans for duplicate agents (multiple agents with same project name)
 * and removes duplicates, keeping only the canonical agent from DB.
 */

import 'dotenv/config';
import { createLettaService } from './lib/LettaService.js';
import { createSyncDatabase } from './lib/database.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'logs', 'sync-state.db');

async function main() {
  console.log('='.repeat(60));
  console.log('Duplicate Letta Agent Cleanup');
  console.log('='.repeat(60));
  console.log();

  // Initialize services
  const db = createSyncDatabase(DB_PATH);
  const lettaService = createLettaService();

  console.log('✓ Services initialized\n');

  // Get all projects from DB
  const projects = db.getAllProjects();
  const projectMap = new Map(projects.map(p => [p.identifier, p]));

  console.log(`Found ${projects.length} projects in database\n`);

  // Get all agents from Letta
  console.log('Fetching all agents from Letta...');
  const allAgents = await lettaService.listAgents({ limit: 1000 });
  console.log(`Found ${allAgents.length} total agents in Letta\n`);

  // Group agents by project identifier
  const agentGroups = {};
  for (const agent of allAgents) {
    const match = agent.name.match(/^Huly-([A-Z]+)-PM(-sleeptime)?$/);
    if (match) {
      const identifier = match[1];
      const isSleeptime = !!match[2];

      if (!agentGroups[identifier]) {
        agentGroups[identifier] = { primary: [], sleeptime: [] };
      }

      if (isSleeptime) {
        agentGroups[identifier].sleeptime.push(agent);
      } else {
        agentGroups[identifier].primary.push(agent);
      }
    }
  }

  console.log(`Grouped agents by project: ${Object.keys(agentGroups).length} projects\n`);
  console.log('='.repeat(60));

  // Track statistics
  let duplicatesFound = 0;
  let agentsDeleted = 0;
  let dbUpdated = 0;

  // Process each project
  for (const [identifier, group] of Object.entries(agentGroups)) {
    const dbProject = projectMap.get(identifier);
    const canonicalAgentId = dbProject?.letta_agent_id;

    console.log(`\n[${identifier}] ${dbProject?.name || 'Unknown Project'}`);
    console.log(`  Primary agents: ${group.primary.length}`);
    console.log(`  Sleeptime agents: ${group.sleeptime.length}`);
    console.log(`  DB agent ID: ${canonicalAgentId || 'none'}`);

    if (group.primary.length === 0) {
      console.log(`  ⚠️  No primary agents found, skipping`);
      continue;
    }

    if (group.primary.length === 1) {
      console.log(`  ✓ No duplicates found`);
      const agent = group.primary[0];

      // Ensure DB has correct ID
      if (canonicalAgentId !== agent.id) {
        console.log(`  → Updating DB with correct agent ID: ${agent.id}`);
        db.setProjectLettaAgent(identifier, { agentId: agent.id });
        lettaService.saveAgentId(identifier, agent.id);
        dbUpdated++;
      }
      continue;
    }

    // Multiple primary agents - DUPLICATES DETECTED
    duplicatesFound++;
    console.log(`  🚨 DUPLICATES DETECTED - ${group.primary.length} primary agents:`);
    group.primary.forEach((a, i) => {
      const isCanonical = a.id === canonicalAgentId;
      console.log(`    ${i + 1}. ${a.id} ${isCanonical ? '(DB canonical)' : ''} (created: ${a.created_at || 'unknown'})`);
    });

    // Determine which agent to keep
    let keepAgent;
    if (canonicalAgentId) {
      keepAgent = group.primary.find(a => a.id === canonicalAgentId);
      if (keepAgent) {
        console.log(`  → Keeping DB-recorded agent: ${keepAgent.id}`);
      }
    }

    if (!keepAgent) {
      // Keep the most recently created
      const sorted = group.primary.sort((a, b) =>
        new Date(b.created_at || 0) - new Date(a.created_at || 0),
      );
      keepAgent = sorted[0];
      console.log(`  → Keeping most recent agent: ${keepAgent.id}`);

      // Update DB with this agent
      console.log(`  → Updating DB with kept agent ID`);
      db.setProjectLettaAgent(identifier, { agentId: keepAgent.id });
      lettaService.saveAgentId(identifier, keepAgent.id);
      dbUpdated++;
    }

    // Delete the duplicates
    for (const agent of group.primary) {
      if (agent.id !== keepAgent.id) {
        try {
          console.log(`  → Deleting duplicate agent: ${agent.id}`);
          await lettaService.client.agents.delete(agent.id);
          agentsDeleted++;
          console.log(`     ✓ Deleted`);
        } catch (error) {
          console.error(`     ✗ Error deleting: ${error.message}`);
        }
      }
    }
  }

  // Summary
  console.log();
  console.log('='.repeat(60));
  console.log('Cleanup Summary');
  console.log('='.repeat(60));
  console.log(`Projects with duplicates found: ${duplicatesFound}`);
  console.log(`Duplicate agents deleted: ${agentsDeleted}`);
  console.log(`DB records updated: ${dbUpdated}`);
  console.log();

  if (duplicatesFound === 0) {
    console.log('✓ No duplicates found - all clean!');
  } else {
    console.log(`✓ Cleanup complete - ${agentsDeleted} duplicates removed`);
  }

  console.log();

  // Close DB
  db.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
