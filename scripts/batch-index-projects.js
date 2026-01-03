#!/usr/bin/env node
/**
 * Batch index all projects with full source code to Letta folders
 *
 * Run: node scripts/batch-index-projects.js
 */

import path from 'path';
import fs from 'fs';
import { createSyncDatabase } from '../lib/database.js';
import { createLettaService } from '../lib/LettaService.js';
import dotenv from 'dotenv';

dotenv.config();

const DB_PATH = path.join(process.cwd(), 'logs', 'sync-state.db');

// File extensions to track
const SOURCE_EXTENSIONS = [
  '.md', '.txt', '.json', '.yaml', '.yml', '.toml',
  '.py', '.js', '.ts', '.tsx', '.jsx', '.rs', '.go',
  '.sql', '.sh', '.html', '.css', '.scss', '.vue',
  '.svelte', '.astro', '.graphql', '.prisma',
];

// Directories to exclude
const EXCLUDE_DIRS = [
  'node_modules', '.git', 'target', 'dist', 'build', '__pycache__',
  '.next', '.nuxt', 'coverage', '.cache', 'vendor', '.venv', 'venv',
  '.serena', '.letta', '.sqlx',
];

// Files to exclude
const EXCLUDE_FILES = [
  'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'Cargo.lock',
  '.DS_Store', 'Thumbs.db',
];

function discoverProjectFiles(projectPath, maxFiles = 500) {
  const files = [];
  const seenPaths = new Set();

  function walkDir(dir, depth = 0) {
    if (depth > 10 || files.length >= maxFiles) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(projectPath, fullPath);

      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.includes(entry.name) && !entry.name.startsWith('.')) {
          walkDir(fullPath, depth + 1);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();

        if (SOURCE_EXTENSIONS.includes(ext) &&
            !EXCLUDE_FILES.includes(entry.name) &&
            !seenPaths.has(relativePath)) {

          try {
            const stats = fs.statSync(fullPath);
            if (stats.size <= 512000) {
              seenPaths.add(relativePath);
              files.push(relativePath);
            }
          } catch (e) {
            // Skip files we can't stat
          }
        }
      }
    }
  }

  walkDir(projectPath);
  return files;
}

async function main() {
  console.log('=== Batch Index Projects ===\n');

  const db = createSyncDatabase(DB_PATH);
  const lettaService = createLettaService();

  // Get all projects with filesystem paths and folder IDs
  const projects = db.getAllProjects().filter(p =>
    p.filesystem_path &&
    fs.existsSync(p.filesystem_path) &&
    p.letta_folder_id,
  );

  console.log(`Found ${projects.length} projects to index\n`);

  const results = { success: 0, failed: 0, skipped: 0, totalUploaded: 0 };

  for (const project of projects) {
    try {
      console.log(`\n[${project.identifier}] Processing ${project.name}...`);
      console.log(`  Path: ${project.filesystem_path}`);
      console.log(`  Folder: ${project.letta_folder_id}`);

      // Discover current files
      const currentFiles = discoverProjectFiles(project.filesystem_path);
      console.log(`  Files on disk: ${currentFiles.length}`);

      if (currentFiles.length === 0) {
        console.log(`  -> No files found, skipping`);
        results.skipped++;
        continue;
      }

      // Run incremental sync
      const stats = await lettaService.syncProjectFilesIncremental(
        project.letta_folder_id,
        project.filesystem_path,
        currentFiles,
        db,
        project.identifier,
      );

      console.log(`  -> Uploaded: ${stats.uploaded}, Skipped: ${stats.skipped}, Deleted: ${stats.deleted}`);

      results.success++;
      results.totalUploaded += stats.uploaded;

      // Small delay between projects to avoid overwhelming the API
      await new Promise(r => setTimeout(r, 500));

    } catch (error) {
      console.error(`  -> ERROR: ${error.message}`);
      results.failed++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Successful: ${results.success}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Skipped: ${results.skipped}`);
  console.log(`Total files uploaded: ${results.totalUploaded}`);

  db.close();
}

main().catch(console.error);
