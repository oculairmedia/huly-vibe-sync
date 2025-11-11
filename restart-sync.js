#!/usr/bin/env node

/**
 * Restart Sync Script
 * 
 * This script helps restart the sync process by clearing sync state.
 * Options:
 * - Clear all sync state (full resync)
 * - Clear specific project sync state
 * - Clear only Vibe Kanban mappings (keeps Huly data)
 */

import { createSyncDatabase } from './lib/database.js';
import { createSyncLogger } from './lib/logger.js';
import fs from 'fs';
import path from 'path';

const logger = createSyncLogger('restart-sync');
const DB_PATH = process.env.DB_PATH || './logs/sync-state.db';

function printUsage() {
  console.log(`
Usage: node restart-sync.js [options]

Options:
  --all                    Clear all sync state (full resync of everything)
  --project <identifier>   Clear sync state for specific project
  --vibe-only              Clear only Vibe Kanban IDs (keeps Huly mappings)
  --help                   Show this help message

Examples:
  # Full resync of everything
  node restart-sync.js --all

  # Resync specific project
  node restart-sync.js --project "my-project"

  # Clear Vibe mappings only (useful after deleting projects in Vibe)
  node restart-sync.js --vibe-only

  # Clear Vibe mapping for specific project
  node restart-sync.js --project "my-project" --vibe-only
`);
}

async function clearAllSyncState(db) {
  logger.info('Clearing all sync state...');
  
  const transaction = db.db.transaction(() => {
    // Clear project mappings
    const projectResult = db.db.prepare(`
      UPDATE projects 
      SET 
        vibe_id = NULL,
        last_sync_at = NULL,
        last_checked_at = NULL
    `).run();
    
    // Clear issue mappings
    const issueResult = db.db.prepare(`
      UPDATE issues 
      SET 
        vibe_task_id = NULL,
        last_sync_at = NULL,
        vibe_status = NULL
    `).run();
    
    // Clear last sync timestamp
    db.db.prepare(`DELETE FROM sync_metadata WHERE key = 'last_sync'`).run();
    
    return { projects: projectResult.changes, issues: issueResult.changes };
  });
  
  const result = transaction();
  logger.info({ 
    projectsCleared: result.projects, 
    issuesCleared: result.issues 
  }, 'All sync state cleared');
  
  console.log('\n✅ All sync state cleared!');
  console.log(`   - ${result.projects} projects will be resynced`);
  console.log(`   - ${result.issues} issues will be resynced`);
  console.log('\nNext sync will recreate everything in Vibe Kanban.\n');
}

async function clearProjectSyncState(db, projectIdentifier, vibeOnly = false) {
  logger.info({ projectIdentifier, vibeOnly }, 'Clearing project sync state...');
  
  const project = db.getProject(projectIdentifier);
  if (!project) {
    console.error(`\n❌ Project "${projectIdentifier}" not found in database.\n`);
    console.log('Available projects:');
    const projects = db.getAllProjects();
    projects.forEach(p => console.log(`  - ${p.identifier}`));
    console.log('');
    process.exit(1);
  }
  
  const transaction = db.db.transaction(() => {
    if (vibeOnly) {
      // Clear only Vibe mappings
      db.db.prepare(`
        UPDATE projects 
        SET 
          vibe_id = NULL,
          last_sync_at = NULL
        WHERE identifier = ?
      `).run(projectIdentifier);
      
      db.db.prepare(`
        UPDATE issues 
        SET 
          vibe_task_id = NULL,
          vibe_status = NULL
        WHERE project_identifier = ?
      `).run(projectIdentifier);
    } else {
      // Clear all sync state
      db.db.prepare(`
        UPDATE projects 
        SET 
          vibe_id = NULL,
          last_sync_at = NULL,
          last_checked_at = NULL
        WHERE identifier = ?
      `).run(projectIdentifier);
      
      db.db.prepare(`
        UPDATE issues 
        SET 
          vibe_task_id = NULL,
          last_sync_at = NULL,
          vibe_status = NULL
        WHERE project_identifier = ?
      `).run(projectIdentifier);
    }
  });
  
  transaction();
  logger.info({ projectIdentifier }, 'Project sync state cleared');
  
  console.log(`\n✅ Sync state cleared for project: ${project.name}`);
  console.log(`   Identifier: ${projectIdentifier}`);
  if (vibeOnly) {
    console.log('   Mode: Vibe mappings only');
  } else {
    console.log('   Mode: Full sync state');
  }
  console.log('\nNext sync will recreate this project in Vibe Kanban.\n');
}

async function clearVibeOnlyState(db) {
  logger.info('Clearing all Vibe Kanban mappings...');
  
  const transaction = db.db.transaction(() => {
    const projectResult = db.db.prepare(`
      UPDATE projects 
      SET vibe_id = NULL
    `).run();
    
    const issueResult = db.db.prepare(`
      UPDATE issues 
      SET 
        vibe_task_id = NULL,
        vibe_status = NULL
    `).run();
    
    return { projects: projectResult.changes, issues: issueResult.changes };
  });
  
  const result = transaction();
  logger.info({ 
    projectsCleared: result.projects, 
    issuesCleared: result.issues 
  }, 'Vibe mappings cleared');
  
  console.log('\n✅ All Vibe Kanban mappings cleared!');
  console.log(`   - ${result.projects} projects will be remapped`);
  console.log(`   - ${result.issues} issues will be remapped`);
  console.log('\nNext sync will recreate mappings to existing Vibe projects.\n');
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.length === 0) {
    printUsage();
    process.exit(0);
  }
  
  // Check if database exists
  if (!fs.existsSync(DB_PATH)) {
    console.error(`\n❌ Database not found at: ${DB_PATH}\n`);
    process.exit(1);
  }
  
  // Initialize database
  const db = createSyncDatabase(DB_PATH);
  
  try {
    if (args.includes('--all')) {
      await clearAllSyncState(db);
    } else if (args.includes('--project')) {
      const projectIndex = args.indexOf('--project');
      const projectIdentifier = args[projectIndex + 1];
      
      if (!projectIdentifier) {
        console.error('\n❌ --project requires a project identifier\n');
        printUsage();
        process.exit(1);
      }
      
      const vibeOnly = args.includes('--vibe-only');
      await clearProjectSyncState(db, projectIdentifier, vibeOnly);
    } else if (args.includes('--vibe-only')) {
      await clearVibeOnlyState(db);
    } else {
      console.error('\n❌ Invalid arguments\n');
      printUsage();
      process.exit(1);
    }
  } finally {
    db.close();
  }
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});

