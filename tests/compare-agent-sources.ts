#!/usr/bin/env node
/**
 * Test comparing agent lookups between file and database sources
 * Ensures both are in sync and return consistent results
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SyncDatabase } from '../src/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function loadAgentStateFromFile(): Record<string, string> {
  const lettaDir = path.join(__dirname, '..', '.letta');
  const settingsPath = path.join(lettaDir, 'settings.local.json');

  if (!fs.existsSync(settingsPath)) {
    return {};
  }

  const data = fs.readFileSync(settingsPath, 'utf8');
  const state = JSON.parse(data) as { agents?: Record<string, string> };
  return state.agents ?? {};
}

function loadAgentStateFromDB(dbPath: string): Record<string, string> {
  const db = new SyncDatabase(dbPath);
  db.initialize();

  if (!db.db) {
    throw new Error('Database not initialized');
  }

  const rows = db.db.prepare(`
    SELECT identifier, letta_agent_id 
    FROM projects 
    WHERE letta_agent_id IS NOT NULL
  `).all() as Array<{ identifier: string; letta_agent_id: string }>;

  const agents: Record<string, string> = {};
  for (const row of rows) {
    agents[row.identifier] = row.letta_agent_id;
  }

  db.close();
  return agents;
}

function main() {
  console.log('=== Agent Source Comparison Test ===\n');

  // Load from both sources
  const fileAgents = loadAgentStateFromFile();
  const dbPath = path.join(__dirname, '..', 'logs', 'sync-state.db');
  const dbAgents = loadAgentStateFromDB(dbPath);

  console.log(`File source: ${Object.keys(fileAgents).length} agents`);
  console.log(`DB source:   ${Object.keys(dbAgents).length} agents\n`);

  // Compare
  const allIdentifiers = new Set([
    ...Object.keys(fileAgents),
    ...Object.keys(dbAgents),
  ]);

  let matches = 0;
  let mismatches = 0;
  let fileOnly = 0;
  let dbOnly = 0;

  console.log('=== Comparison Results ===\n');

  for (const identifier of [...allIdentifiers].sort()) {
    const fileAgent = fileAgents[identifier];
    const dbAgent = dbAgents[identifier];

    if (fileAgent && dbAgent) {
      if (fileAgent === dbAgent) {
        matches++;
      } else {
        mismatches++;
        console.log(`❌ MISMATCH ${identifier}:`);
        console.log(`   File: ${fileAgent}`);
        console.log(`   DB:   ${dbAgent}`);
      }
    } else if (fileAgent && !dbAgent) {
      fileOnly++;
      console.log(`📁 FILE ONLY: ${identifier} -> ${fileAgent}`);
    } else if (!fileAgent && dbAgent) {
      dbOnly++;
      console.log(`🗄️  DB ONLY: ${identifier} -> ${dbAgent}`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`✅ Matches:    ${matches}`);
  console.log(`❌ Mismatches: ${mismatches}`);
  console.log(`📁 File only:  ${fileOnly}`);
  console.log(`🗄️  DB only:    ${dbOnly}`);

  // Exit with error if any issues
  if (mismatches > 0) {
    console.log('\n⚠️  FAIL: Agent IDs differ between sources!');
    process.exit(1);
  }

  if (fileOnly > 0 || dbOnly > 0) {
    console.log('\n⚠️  WARNING: Sources are not fully synchronized');
    process.exit(0);
  }

  console.log('\n✅ PASS: All agents match between file and database');
  process.exit(0);
}

main();
