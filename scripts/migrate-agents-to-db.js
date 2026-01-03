#!/usr/bin/env node
/**
 * Migration script to populate database with agent IDs from file
 * This runs in parallel with the file-based system for testing
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SyncDatabase } from './lib/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment
import dotenv from 'dotenv';
dotenv.config();

function loadAgentStateFromFile() {
  const lettaDir = path.join(__dirname, '.letta');
  const settingsPath = path.join(lettaDir, 'settings.local.json');

  if (!fs.existsSync(settingsPath)) {
    console.error('No settings.local.json found at:', settingsPath);
    return null;
  }

  const data = fs.readFileSync(settingsPath, 'utf8');
  return JSON.parse(data);
}

async function main() {
  console.log('=== Agent DB Migration ===\n');

  // Load agent state from file
  const agentState = loadAgentStateFromFile();
  if (!agentState || !agentState.agents) {
    console.error('No agents found in file');
    process.exit(1);
  }

  const agents = agentState.agents;
  console.log(`Found ${Object.keys(agents).length} agents in file\n`);

  // Initialize database (use logs/ subdirectory where Docker mounts it)
  const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'logs', 'sync-state.db');
  const db = new SyncDatabase(dbPath);
  db.initialize();

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const [projectIdentifier, agentId] of Object.entries(agents)) {
    try {
      // Check if project exists in DB
      const existingProject = db.getProject(projectIdentifier);

      if (!existingProject) {
        console.log(`⏭️  ${projectIdentifier}: Project not in DB, skipping`);
        skipped++;
        continue;
      }

      // Check if agent ID already set
      if (existingProject.letta_agent_id === agentId) {
        console.log(`✓  ${projectIdentifier}: Already in sync`);
        skipped++;
        continue;
      }

      // Update the database
      db.setProjectLettaAgent(projectIdentifier, { agentId });
      console.log(`✅ ${projectIdentifier}: Migrated agent ${agentId}`);
      migrated++;
    } catch (error) {
      console.error(`❌ ${projectIdentifier}: ${error.message}`);
      errors++;
    }
  }

  console.log('\n=== Migration Complete ===');
  console.log(`Migrated: ${migrated}`);
  console.log(`Skipped:  ${skipped}`);
  console.log(`Errors:   ${errors}`);

  // Verify
  console.log('\n=== Verification ===');
  const dbAgents = db.db.prepare(`
    SELECT identifier, letta_agent_id 
    FROM projects 
    WHERE letta_agent_id IS NOT NULL
  `).all();
  console.log(`Database now has ${dbAgents.length} projects with agent IDs`);

  db.close();
}

main().catch(console.error);
