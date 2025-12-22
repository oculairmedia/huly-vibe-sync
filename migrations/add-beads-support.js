#!/usr/bin/env node

/**
 * Migration: Add Beads Support
 * 
 * Adds beads_issue_id, beads_status, and beads_modified_at columns to the issues table
 * to support bidirectional sync with Beads issue tracker.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', 'sync-state.db');

console.log('[Migration] Adding Beads support to database schema...');
console.log(`[Migration] Database: ${DB_PATH}`);

try {
  const db = new Database(DB_PATH);
  
  // Check if columns already exist
  const tableInfo = db.prepare("PRAGMA table_info(issues)").all();
  const columnNames = tableInfo.map(col => col.name);
  
  console.log(`[Migration] Current issues table columns: ${columnNames.join(', ')}`);
  
  // Add beads_issue_id column if it doesn't exist
  if (!columnNames.includes('beads_issue_id')) {
    console.log('[Migration] Adding beads_issue_id column...');
    db.prepare('ALTER TABLE issues ADD COLUMN beads_issue_id TEXT').run();
    console.log('[Migration] ✓ Added beads_issue_id column');
  } else {
    console.log('[Migration] ✓ beads_issue_id column already exists');
  }
  
  // Add beads_status column if it doesn't exist
  if (!columnNames.includes('beads_status')) {
    console.log('[Migration] Adding beads_status column...');
    db.prepare('ALTER TABLE issues ADD COLUMN beads_status TEXT').run();
    console.log('[Migration] ✓ Added beads_status column');
  } else {
    console.log('[Migration] ✓ beads_status column already exists');
  }
  
  // Add beads_modified_at column if it doesn't exist
  if (!columnNames.includes('beads_modified_at')) {
    console.log('[Migration] Adding beads_modified_at column...');
    db.prepare('ALTER TABLE issues ADD COLUMN beads_modified_at INTEGER').run();
    console.log('[Migration] ✓ Added beads_modified_at column');
  } else {
    console.log('[Migration] ✓ beads_modified_at column already exists');
  }
  
  // Add huly_modified_at and vibe_modified_at if they don't exist (from earlier schema)
  if (!columnNames.includes('huly_modified_at')) {
    console.log('[Migration] Adding huly_modified_at column...');
    db.prepare('ALTER TABLE issues ADD COLUMN huly_modified_at INTEGER').run();
    console.log('[Migration] ✓ Added huly_modified_at column');
  }
  
  if (!columnNames.includes('vibe_modified_at')) {
    console.log('[Migration] Adding vibe_modified_at column...');
    db.prepare('ALTER TABLE issues ADD COLUMN vibe_modified_at INTEGER').run();
    console.log('[Migration] ✓ Added vibe_modified_at column');
  }
  
  // Create index on beads_issue_id for faster lookups
  try {
    db.prepare('CREATE INDEX IF NOT EXISTS idx_issues_beads_id ON issues(beads_issue_id)').run();
    console.log('[Migration] ✓ Created index on beads_issue_id');
  } catch (indexError) {
    console.log('[Migration] ✓ Index on beads_issue_id already exists');
  }
  
  // Verify the migration
  const updatedTableInfo = db.prepare("PRAGMA table_info(issues)").all();
  const updatedColumnNames = updatedTableInfo.map(col => col.name);
  
  console.log('[Migration] Updated issues table columns:', updatedColumnNames.join(', '));
  
  db.close();
  
  console.log('[Migration] ✅ Migration completed successfully!');
  process.exit(0);
} catch (error) {
  console.error('[Migration] ❌ Migration failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
