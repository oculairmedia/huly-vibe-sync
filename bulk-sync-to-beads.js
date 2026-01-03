#!/usr/bin/env node
/**
 * Bulk sync: Copy all Huly GRAPH issues to beads
 * Uses the container's database
 */

import { listBeadsIssues, syncHulyIssueToBeads } from './lib/BeadsService.js';
import Database from 'better-sqlite3';
import { loadConfig } from './lib/config.js';

const config = loadConfig();
const projectPath = '/opt/stacks/graphiti';

console.log('\n=== Bulk Sync: Huly → Beads ===\n');

// Open container database
const containerDb = new Database('/tmp/container-sync-state.db', { readonly: true });

// Get GRAPH issues
const issues = containerDb.prepare(`
  SELECT identifier, title, description, status, priority 
  FROM issues 
  WHERE project_identifier = 'GRAPH'
  ORDER BY identifier
`).all();

console.log(`Found ${issues.length} Huly issues for GRAPH project`);

// List current beads issues
const beadsIssues = await listBeadsIssues(projectPath);
console.log(`Current beads issues: ${beadsIssues.length}\n`);

// Create a simple in-memory database for tracking
class SimpleDb {
  constructor() {
    this.issues = new Map();
  }

  getIssue(identifier) {
    return this.issues.get(identifier);
  }

  upsertIssue(issue) {
    this.issues.set(issue.identifier, issue);
  }

  getAllIssues() {
    return Array.from(this.issues.values());
  }
}

const db = new SimpleDb();

// Sync issues (limit to first 10 for testing)
const limit = parseInt(process.argv[2]) || 10;
console.log(`Syncing first ${limit} issues...\n`);

let synced = 0;
let skipped = 0;

for (const issue of issues.slice(0, limit)) {
  // Convert to Huly issue format
  const hulyIssue = {
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description || '',
    status: issue.status || 'Backlog',
    priority: issue.priority || 'Medium',
    type: 'Task',
  };

  try {
    const result = await syncHulyIssueToBeads(
      projectPath,
      hulyIssue,
      beadsIssues,
      db,
      config,
    );

    if (result) {
      console.log(`✓ ${hulyIssue.identifier}: ${hulyIssue.title.substring(0, 60)}`);
      synced++;
    } else {
      console.log(`- ${hulyIssue.identifier}: already exists`);
      skipped++;
    }
  } catch (error) {
    console.error(`✗ ${hulyIssue.identifier}: ${error.message}`);
  }

  // Small delay to avoid overwhelming beads
  await new Promise(resolve => setTimeout(resolve, 200));
}

// List beads issues after sync
const finalBeadsIssues = await listBeadsIssues(projectPath);

console.log(`\n=== Summary ===`);
console.log(`Synced: ${synced}`);
console.log(`Skipped: ${skipped}`);
console.log(`Total beads issues: ${finalBeadsIssues.length}`);
console.log(`\nRun 'bd list' in /opt/stacks/graphiti to see all issues`);

containerDb.close();
process.exit(0);
