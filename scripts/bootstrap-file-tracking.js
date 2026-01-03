#!/usr/bin/env node
/**
 * Bootstrap project_files table with existing uploaded files
 *
 * This script:
 * 1. Gets all projects with filesystem_path and letta_folder_id from DB
 * 2. Discovers files that would be uploaded based on current filters
 * 3. Computes content hashes for each file
 * 4. Inserts records into project_files table
 *
 * Run: node scripts/bootstrap-file-tracking.js
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createSyncDatabase } from '../lib/database.js';

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

function computeFileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(content).digest('hex');
}

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
              files.push({
                relativePath,
                fullPath,
                size: stats.size,
              });
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
  console.log('=== Bootstrap File Tracking ===\n');

  const db = createSyncDatabase(DB_PATH);

  // Get projects with filesystem paths and folder IDs
  const projects = db.getAllProjects().filter(p =>
    p.filesystem_path &&
    fs.existsSync(p.filesystem_path) &&
    p.letta_folder_id,
  );

  console.log(`Found ${projects.length} projects with filesystem paths and Letta folders\n`);

  let totalFiles = 0;
  let totalProjects = 0;

  for (const project of projects) {
    // Check if already has tracked files
    const existingFiles = db.getProjectFiles(project.identifier);
    if (existingFiles.length > 0) {
      console.log(`[${project.identifier}] Already has ${existingFiles.length} tracked files, skipping`);
      continue;
    }

    console.log(`[${project.identifier}] Discovering files in ${project.filesystem_path}...`);

    // Discover files
    const files = discoverProjectFiles(project.filesystem_path);

    if (files.length === 0) {
      console.log(`  -> No files found`);
      continue;
    }

    console.log(`  -> Found ${files.length} files, computing hashes...`);

    // Insert file records
    let inserted = 0;
    for (const file of files) {
      try {
        const hash = computeFileHash(file.fullPath);

        db.upsertProjectFile({
          project_identifier: project.identifier,
          relative_path: file.relativePath,
          content_hash: hash,
          letta_file_id: null, // We don't have this from Letta
          file_size: file.size,
          uploaded_at: Date.now(),
        });

        inserted++;
      } catch (e) {
        console.error(`  -> Error processing ${file.relativePath}: ${e.message}`);
      }
    }

    console.log(`  -> Inserted ${inserted} file tracking records`);
    totalFiles += inserted;
    totalProjects++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Projects processed: ${totalProjects}`);
  console.log(`Files tracked: ${totalFiles}`);

  // Show sample of tracked files
  const sample = db.db.prepare(`
    SELECT project_identifier, COUNT(*) as file_count 
    FROM project_files 
    GROUP BY project_identifier 
    ORDER BY file_count DESC 
    LIMIT 10
  `).all();

  console.log(`\nTop projects by tracked files:`);
  for (const row of sample) {
    console.log(`  ${row.project_identifier}: ${row.file_count} files`);
  }

  db.close();
}

main().catch(console.error);
