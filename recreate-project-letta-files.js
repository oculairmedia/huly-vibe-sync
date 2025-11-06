#!/usr/bin/env node

/**
 * Recreate .letta/settings.local.json files in all project directories
 * Uses agent IDs from the central database and settings file
 */

import { createSyncDatabase } from './lib/database.js';
import { determineGitRepoPath } from './lib/textParsers.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function recreateProjectLettaFiles() {
  console.log('='.repeat(60));
  console.log('Recreating .letta/settings.local.json in project folders');
  console.log('='.repeat(60));

  // Initialize database
  const DB_PATH = path.join(__dirname, 'logs', 'sync-state.db');
  const db = createSyncDatabase(DB_PATH);

  // Get all projects with agent IDs
  const allProjects = db.getAllProjects();
  const projects = allProjects.filter(p => p.letta_agent_id);

  console.log(`\nFound ${projects.length} projects with Letta agents\n`);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const project of projects) {
    try {
      const { identifier, name, letta_agent_id, filesystem_path } = project;

      // Determine project path
      let projectPath = filesystem_path;

      // If no filesystem path in DB, try to extract from Huly project
      // This requires fetching from Huly API, so we'll skip if not available
      if (!projectPath) {
        console.log(`[${identifier}] No filesystem path, skipping`);
        skipped++;
        continue;
      }

      // Create .letta directory
      const lettaDir = path.join(projectPath, '.letta');
      const settingsPath = path.join(lettaDir, 'settings.local.json');

      // Check if path exists
      if (!fs.existsSync(projectPath)) {
        console.log(`[${identifier}] Project path does not exist: ${projectPath}`);
        skipped++;
        continue;
      }

      // Create .letta directory if it doesn't exist
      if (!fs.existsSync(lettaDir)) {
        fs.mkdirSync(lettaDir, { recursive: true, mode: 0o777 });
      }

      // Check if settings file exists
      const exists = fs.existsSync(settingsPath);

      // Create settings.local.json in Letta Code format
      const settings = {
        lastAgent: letta_agent_id,
      };

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o666 });

      // Create .gitignore if it doesn't exist
      const gitignorePath = path.join(lettaDir, '.gitignore');
      if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(
          gitignorePath,
          '# Local agent state\nsettings.local.json\n*.log\n',
          'utf8'
        );
      }

      if (exists) {
        console.log(`[${identifier}] ✓ Updated: ${settingsPath}`);
        updated++;
      } else {
        console.log(`[${identifier}] ✓ Created: ${settingsPath}`);
        created++;
      }
    } catch (error) {
      console.error(`[${project.identifier}] ✗ Error: ${error.message}`);
      errors++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Summary:');
  console.log(`  Created: ${created}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Errors:  ${errors}`);
  console.log('='.repeat(60));
}

recreateProjectLettaFiles().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
