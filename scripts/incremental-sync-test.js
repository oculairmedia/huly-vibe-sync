#!/usr/bin/env node
/**
 * Test incremental file sync for a single project
 *
 * Run: node scripts/test-incremental-sync.js VIBEK
 */

import path from 'path';
import fs from 'fs';
import { createSyncDatabase } from '../lib/database.js';
import { createLettaService } from '../lib/LettaService.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const DB_PATH = path.join(process.cwd(), 'logs', 'sync-state.db');

// File extensions to track (same as LettaService)
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
  '.serena', '.letta',
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

          // Skip large files (> 500KB)
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
  const projectId = process.argv[2];

  if (!projectId) {
    console.error('Usage: node scripts/test-incremental-sync.js <PROJECT_ID>');
    console.error('Example: node scripts/test-incremental-sync.js VIBEK');
    process.exit(1);
  }

  console.log(`=== Testing Incremental Sync for ${projectId} ===\n`);

  const db = createSyncDatabase(DB_PATH);

  // Get project info
  const project = db.getProject(projectId);
  if (!project) {
    console.error(`Project ${projectId} not found in database`);
    process.exit(1);
  }

  if (!project.filesystem_path || !fs.existsSync(project.filesystem_path)) {
    console.error(`Project filesystem path not set or doesn't exist: ${project.filesystem_path}`);
    process.exit(1);
  }

  if (!project.letta_folder_id) {
    console.error(`Project doesn't have a Letta folder ID`);
    process.exit(1);
  }

  console.log(`Project: ${project.name}`);
  console.log(`Path: ${project.filesystem_path}`);
  console.log(`Folder ID: ${project.letta_folder_id}`);

  // Get tracked files before sync
  const trackedBefore = db.getProjectFiles(projectId);
  console.log(`\nTracked files before: ${trackedBefore.length}`);

  // Discover current files
  const currentFiles = discoverProjectFiles(project.filesystem_path);
  console.log(`Current files on disk: ${currentFiles.length}`);

  // Initialize Letta service
  const lettaService = createLettaService();

  console.log(`\nRunning incremental sync...\n`);

  // Run incremental sync
  const stats = await lettaService.syncProjectFilesIncremental(
    project.letta_folder_id,
    project.filesystem_path,
    currentFiles,
    db,
    projectId,
  );

  console.log(`\n=== Results ===`);
  console.log(`Uploaded: ${stats.uploaded}`);
  console.log(`Deleted: ${stats.deleted}`);
  console.log(`Skipped (unchanged): ${stats.skipped}`);
  console.log(`Errors: ${stats.errors}`);

  // Get tracked files after sync
  const trackedAfter = db.getProjectFiles(projectId);
  console.log(`\nTracked files after: ${trackedAfter.length}`);

  db.close();
}

main().catch(console.error);
