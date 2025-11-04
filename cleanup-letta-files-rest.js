#!/usr/bin/env node
/**
 * Cleanup Script: Delete all folders and their files from Letta (REST API)
 * 
 * This clears all uploaded files and folders to allow a fresh start.
 * Agents will be preserved - only file storage is cleaned.
 */

import 'dotenv/config';
import { fetchWithPool } from './lib/http.js';

const LETTA_API_URL = process.env.LETTA_BASE_URL.endsWith('/v1') 
  ? process.env.LETTA_BASE_URL 
  : `${process.env.LETTA_BASE_URL}/v1`;
const LETTA_PASSWORD = process.env.LETTA_PASSWORD;

async function main() {
  console.log('\n=== Letta File Storage Cleanup (REST API) ===\n');

  // Step 1: Get all folders
  console.log('[1/3] Fetching all folders...');
  const foldersResp = await fetchWithPool(`${LETTA_API_URL}/folders?limit=200`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${LETTA_PASSWORD}`,
      'Content-Type': 'application/json',
    },
  });

  if (!foldersResp.ok) {
    throw new Error(`Failed to fetch folders: ${foldersResp.status} ${await foldersResp.text()}`);
  }

  const folders = await foldersResp.json();
  console.log(`Found ${folders.length} folders\n`);

  if (folders.length === 0) {
    console.log('No folders to delete\n');
    return;
  }

  // Step 2: Delete all files in each folder
  console.log('[2/3] Deleting files from folders...');
  let totalFilesDeleted = 0;
  let totalFileErrors = 0;

  for (const folder of folders) {
    console.log(`\nProcessing folder: ${folder.name} (${folder.id})`);
    
    // Get files in this folder
    const filesResp = await fetchWithPool(`${LETTA_API_URL}/folders/${folder.id}/files?limit=1000`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${LETTA_PASSWORD}`,
        'Content-Type': 'application/json',
      },
    });

    if (!filesResp.ok) {
      console.error(`  ✗ Failed to list files: ${filesResp.status}`);
      continue;
    }

    const files = await filesResp.json();
    console.log(`  Found ${files.length} files`);

    // Delete each file
    for (const file of files) {
      try {
        const deleteResp = await fetchWithPool(`${LETTA_API_URL}/folders/${folder.id}/${file.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${LETTA_PASSWORD}`,
          },
        });

        if (deleteResp.ok || deleteResp.status === 204) {
          totalFilesDeleted++;
          console.log(`    ✓ Deleted file: ${file.file_name || file.id}`);
        } else {
          totalFileErrors++;
          console.error(`    ✗ Failed to delete ${file.id}: ${deleteResp.status}`);
        }
      } catch (error) {
        totalFileErrors++;
        console.error(`    ✗ Error deleting ${file.id}:`, error.message);
      }
    }
  }

  console.log(`\nFiles: ${totalFilesDeleted} deleted, ${totalFileErrors} errors\n`);

  // Step 3: Delete all folders
  console.log('[3/3] Deleting folders...');
  let foldersDeleted = 0;
  let folderErrors = 0;

  for (const folder of folders) {
    try {
      const deleteResp = await fetchWithPool(`${LETTA_API_URL}/folders/${folder.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${LETTA_PASSWORD}`,
        },
      });

      if (deleteResp.ok || deleteResp.status === 204) {
        foldersDeleted++;
        console.log(`  ✓ Deleted folder: ${folder.name} (${folder.id})`);
      } else {
        folderErrors++;
        const errorText = await deleteResp.text();
        console.error(`  ✗ Failed to delete ${folder.name}: ${deleteResp.status} - ${errorText}`);
      }
    } catch (error) {
      folderErrors++;
      console.error(`  ✗ Error deleting ${folder.name}:`, error.message);
    }
  }

  console.log(`\nFolders: ${foldersDeleted} deleted, ${folderErrors} errors\n`);

  // Summary
  console.log('=== Cleanup Complete ===');
  console.log(`Total deleted: ${totalFilesDeleted} files, ${foldersDeleted} folders`);
  console.log(`Total errors: ${totalFileErrors + folderErrors}`);
  
  if (totalFileErrors + folderErrors > 0) {
    console.log('\n⚠️  Some items could not be deleted. Check errors above.');
    process.exit(1);
  }
  
  console.log('\n✓ All file storage cleaned successfully');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
