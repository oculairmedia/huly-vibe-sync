#!/usr/bin/env node

/**
 * Sync all existing Huly PM agents to match the Control Agent.
 *
 * Updates persona (project-specific), attaches missing tools.
 * Rebuilds control agent persona from template if it changed.
 */

import { createLettaService } from './lib/LettaService.js';
import Database from 'better-sqlite3';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

function getProjectsByAgentId() {
  const dbPath = path.join(process.cwd(), 'logs', 'sync-state.db');
  const db = new Database(dbPath, { readonly: true });
  const rows = db
    .prepare(
      `SELECT identifier, name, letta_agent_id FROM projects WHERE letta_agent_id IS NOT NULL`
    )
    .all();
  db.close();
  const map = {};
  for (const row of rows) {
    map[row.letta_agent_id] = { identifier: row.identifier, name: row.name };
  }
  return map;
}

async function main() {
  console.log('\n🔄 SYNCING PM AGENTS TO CONTROL AGENT\n');

  const lettaService = createLettaService();
  const projectsByAgentId = getProjectsByAgentId();

  try {
    console.log('Fetching control agent configuration...');
    const controlConfig = await lettaService.ensureControlAgent();

    const freshControlPersona = lettaService._buildPersonaBlock(
      'CONTROL',
      'Huly PM Control Template'
    );
    if (controlConfig.persona !== freshControlPersona) {
      console.log('Persona template changed — updating control agent...');
      await lettaService._updatePersonaBlock(controlConfig.agentId, freshControlPersona);
      controlConfig.persona = freshControlPersona;
      console.log('Control agent persona updated.');
    }

    console.log(`\nControl Agent: ${controlConfig.agentName}`);
    console.log(`Tools: ${controlConfig.toolIds.length}\n`);

    const agents = await lettaService.client.agents.list();
    const pmAgents = agents.filter(
      a => a.name.startsWith('Huly - ') && a.name !== controlConfig.agentName
    );

    console.log(`Found ${pmAgents.length} PM agents to sync\n`);

    if (pmAgents.length === 0) {
      console.log('No PM agents found to sync.');
      return;
    }

    console.log('This will:');
    console.log('  1. Update persona block on all PM agents (project-specific)');
    console.log('  2. Attach any missing tools from control agent\n');

    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));

    let updated = 0;
    let errors = 0;

    for (const agent of pmAgents) {
      try {
        console.log(`\nSyncing: ${agent.name} (${agent.id})`);

        const project = projectsByAgentId[agent.id];
        if (project) {
          const persona = lettaService._buildPersonaBlock(project.identifier, project.name);
          await lettaService._updatePersonaBlock(agent.id, persona);
          console.log(`  ✓ Persona updated (${project.identifier})`);
        } else {
          console.log(`  ⚠ No project mapping — skipping persona`);
        }

        const currentTools = await lettaService.client.agents.tools.list(agent.id);
        const currentToolIds = currentTools.map(t => t.id);

        let toolsAdded = 0;
        for (const toolId of controlConfig.toolIds) {
          if (!currentToolIds.includes(toolId)) {
            try {
              await lettaService.client.agents.tools.attach(agent.id, toolId);
              toolsAdded++;
              console.log(`  ✓ Added tool: ${toolId}`);
            } catch (error) {
              if (!error.message.includes('already attached')) {
                console.log(`  ⚠ Tool attach error: ${error.message}`);
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

        await new Promise(r => setTimeout(r, 500));
      } catch (error) {
        console.error(`  ❌ Error syncing ${agent.name}: ${error.message}`);
        errors++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`\nUpdated: ${updated} | Errors: ${errors} | Total: ${pmAgents.length}\n`);
  } catch (error) {
    console.error(`\nError: ${error.message}\n`);
    process.exit(1);
  }
}

main();
