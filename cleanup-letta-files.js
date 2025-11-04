#!/usr/bin/env node
/**
 * Cleanup Script: Delete all sources and folders from Letta
 * 
 * This clears all uploaded files and folders to allow a fresh start.
 * Agents will be preserved - only file storage is cleaned.
 */

import 'dotenv/config';
import { LettaClient } from '@letta-ai/letta-client';

const LETTA_BASE_URL = process.env.LETTA_BASE_URL;
const LETTA_PASSWORD = process.env.LETTA_PASSWORD;

async function main() {
  const client = new LettaClient({
    baseUrl: LETTA_BASE_URL,
    token: LETTA_PASSWORD,
  });

  console.log('\n=== Letta File Storage Cleanup ===\n');

  // Step 1: Delete all sources
  console.log('[1/2] Fetching all sources...');
  const sources = await client.sources.list();
  console.log(`Found ${sources.length} sources to delete`);

  let deletedSources = 0;
  let erroredSources = 0;

  for (const source of sources) {
    try {
      await client.sources.delete(source.id);
      deletedSources++;
      console.log(`  ✓ Deleted source: ${source.name} (${source.id})`);
    } catch (error) {
      erroredSources++;
      console.error(`  ✗ Failed to delete ${source.name}:`, error.message);
    }
  }

  console.log(`\nSources: ${deletedSources} deleted, ${erroredSources} errors\n`);

  // Step 2: Delete all folders
  console.log('[2/2] Fetching all folders...');
  const folders = await client.folders.list();
  console.log(`Found ${folders.length} folders to delete`);

  let deletedFolders = 0;
  let erroredFolders = 0;

  for (const folder of folders) {
    try {
      await client.folders.delete(folder.id);
      deletedFolders++;
      console.log(`  ✓ Deleted folder: ${folder.name} (${folder.id})`);
    } catch (error) {
      erroredFolders++;
      console.error(`  ✗ Failed to delete ${folder.name}:`, error.message);
    }
  }

  console.log(`\nFolders: ${deletedFolders} deleted, ${erroredFolders} errors\n`);

  // Summary
  console.log('=== Cleanup Complete ===');
  console.log(`Total deleted: ${deletedSources} sources, ${deletedFolders} folders`);
  console.log(`Total errors: ${erroredSources + erroredFolders}`);
  
  if (erroredSources + erroredFolders > 0) {
    console.log('\n⚠️  Some items could not be deleted. Check errors above.');
    process.exit(1);
  }
  
  console.log('\n✓ All file storage cleaned successfully');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
