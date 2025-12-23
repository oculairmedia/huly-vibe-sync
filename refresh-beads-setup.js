#!/usr/bin/env node

/**
 * Refresh Beads Setup for All Projects
 *
 * Applies the latest Beads auto-setup to all existing project folders:
 * - .beads/.gitignore for runtime artifacts
 * - .gitattributes with merge driver config
 * - Git hooks installation
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get projects path from environment or use default
const PROJECTS_PATH = process.env.PROJECTS_PATH || '/opt/stacks';

const BEADS_GITIGNORE = `# SQLite databases
*.db
*.db?*
*.db-journal
*.db-wal
*.db-shm

# Daemon runtime files
daemon.lock
daemon.log
daemon.pid
bd.sock

# Local version tracking (prevents upgrade notification spam after git ops)
.local_version

# Legacy database files
db.sqlite
bd.db

# Merge artifacts (temporary files from 3-way merge)
beads.base.jsonl
beads.base.meta.json
beads.left.jsonl
beads.left.meta.json
beads.right.jsonl
beads.right.meta.json

# Keep JSONL exports and config (source of truth for git)
!issues.jsonl
!interactions.jsonl
!metadata.json
!config.json
`;

const BEADS_MERGE_ATTRS = `# Use bd merge for beads JSONL files
.beads/issues.jsonl merge=beads
.beads/interactions.jsonl merge=beads
`;

function isGitRepository(projectPath) {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: projectPath,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function setupBeadsGitignore(projectPath) {
  const beadsDir = path.join(projectPath, '.beads');

  if (!fs.existsSync(beadsDir)) {
    console.log(`  ⏭  No .beads directory, skipping`);
    return false;
  }

  const gitignorePath = path.join(beadsDir, '.gitignore');

  try {
    fs.writeFileSync(gitignorePath, BEADS_GITIGNORE);
    console.log(`  ✓ Created/updated .beads/.gitignore`);
    return true;
  } catch (error) {
    console.error(`  ✗ Failed to create .beads/.gitignore: ${error.message}`);
    return false;
  }
}

function setupGitattributes(projectPath) {
  if (!isGitRepository(projectPath)) {
    console.log(`  ⏭  Not a git repository, skipping .gitattributes`);
    return false;
  }

  const gitattributesPath = path.join(projectPath, '.gitattributes');

  try {
    let existingContent = '';
    if (fs.existsSync(gitattributesPath)) {
      existingContent = fs.readFileSync(gitattributesPath, 'utf-8');
    }

    // Only add if not already present
    if (existingContent.includes('merge=beads')) {
      console.log(`  ⏭  .gitattributes already configured`);
      return false;
    }

    const newContent = existingContent
      ? `${existingContent.trimEnd()}\n\n${BEADS_MERGE_ATTRS}`
      : BEADS_MERGE_ATTRS;

    fs.writeFileSync(gitattributesPath, newContent);
    console.log(`  ✓ Updated .gitattributes with merge driver config`);
    return true;
  } catch (error) {
    console.error(`  ✗ Failed to update .gitattributes: ${error.message}`);
    return false;
  }
}

function installGitHooks(projectPath) {
  if (!isGitRepository(projectPath)) {
    console.log(`  ⏭  Not a git repository, skipping hooks`);
    return false;
  }

  const beadsDir = path.join(projectPath, '.beads');
  if (!fs.existsSync(beadsDir)) {
    console.log(`  ⏭  No .beads directory, skipping hooks`);
    return false;
  }

  try {
    execSync('bd hooks install --no-daemon', {
      cwd: projectPath,
      stdio: 'pipe',
    });
    console.log(`  ✓ Installed git hooks`);
    return true;
  } catch (error) {
    console.error(`  ✗ Failed to install git hooks: ${error.message}`);
    return false;
  }
}

function processProject(projectPath) {
  const projectName = path.basename(projectPath);
  console.log(`\n📦 ${projectName}`);

  let changes = 0;

  if (setupBeadsGitignore(projectPath)) changes++;
  if (setupGitattributes(projectPath)) changes++;
  if (installGitHooks(projectPath)) changes++;

  if (changes === 0) {
    console.log(`  ℹ  No changes needed`);
  }

  return changes;
}

async function main() {
  console.log('🔄 Refreshing Beads Setup for All Projects\n');
  console.log(`Projects directory: ${PROJECTS_PATH}\n`);

  if (!fs.existsSync(PROJECTS_PATH)) {
    console.error(`❌ Projects directory not found: ${PROJECTS_PATH}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(PROJECTS_PATH, { withFileTypes: true });
  const projectDirs = entries
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(PROJECTS_PATH, entry.name));

  console.log(`Found ${projectDirs.length} project directories\n`);
  console.log('='.repeat(60));

  let totalChanges = 0;
  let processedCount = 0;

  for (const projectPath of projectDirs) {
    try {
      const changes = processProject(projectPath);
      totalChanges += changes;
      processedCount++;
    } catch (error) {
      console.error(`\n❌ Error processing ${path.basename(projectPath)}: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`\n✅ Complete!`);
  console.log(`   Processed: ${processedCount}/${projectDirs.length} projects`);
  console.log(`   Changes made: ${totalChanges}`);

  if (totalChanges > 0) {
    console.log(`\n💡 Next steps:`);
    console.log(`   1. Review changes in each project`);
    console.log(`   2. Commit updated .beads/.gitignore and .gitattributes files`);
    console.log(`   3. Test git operations to verify hooks work correctly`);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
