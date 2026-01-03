#!/usr/bin/env node

/**
 * Add Beads Instructions to Existing AGENTS.md Files
 *
 * Migrates existing project AGENTS.md files to include Beads workflow instructions.
 * This makes projects portable with embedded instructions for AI assistants.
 */

import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get projects path from environment or use default
const PROJECTS_PATH = process.env.PROJECTS_PATH || '/opt/stacks';

const BEADS_INSTRUCTIONS = `# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run \`bd onboard\` to get started.

## Quick Reference

\`\`\`bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
\`\`\`

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until \`git push\` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   \`\`\`bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   \`\`\`
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until \`git push\` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

`;

function hasBeadsInstructions(content) {
  return (
    content.includes('bd ready') ||
    content.includes('bd onboard') ||
    content.includes('beads) for issue tracking')
  );
}

function addBeadsInstructions(projectPath, dryRun = false) {
  const agentsPath = path.join(projectPath, 'AGENTS.md');
  const beadsDir = path.join(projectPath, '.beads');

  // Only process projects with .beads directory
  if (!fs.existsSync(beadsDir)) {
    return { status: 'skip', reason: 'no_beads_dir' };
  }

  let existingContent = '';
  let fileExists = false;

  if (fs.existsSync(agentsPath)) {
    fileExists = true;
    existingContent = fs.readFileSync(agentsPath, 'utf-8');

    // Check if it already has Beads instructions
    if (hasBeadsInstructions(existingContent)) {
      return { status: 'skip', reason: 'already_has_beads' };
    }
  }

  let newContent;

  if (fileExists) {
    // Prepend Beads instructions to existing content
    // Add a separator if the existing content doesn't start with a newline
    const separator = existingContent.startsWith('\n') ? '' : '\n\n';
    newContent = BEADS_INSTRUCTIONS + separator + existingContent;
  } else {
    // Create new file with just Beads instructions
    newContent = BEADS_INSTRUCTIONS;
  }

  if (!dryRun) {
    try {
      fs.writeFileSync(agentsPath, newContent, 'utf-8');
      return { status: 'updated', fileExists };
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  }

  return { status: 'would_update', fileExists };
}

function processProject(projectPath, dryRun = false) {
  const projectName = path.basename(projectPath);
  const result = addBeadsInstructions(projectPath, dryRun);

  const icon =
    {
      updated: '✓',
      would_update: '→',
      skip: '⏭',
      error: '✗',
    }[result.status] || '?';

  const action =
    {
      updated: result.fileExists ? 'Updated existing' : 'Created new',
      would_update: result.fileExists ? 'Would update existing' : 'Would create new',
      skip: result.reason === 'no_beads_dir' ? 'No .beads directory' : 'Already has instructions',
      error: `Error: ${result.error}`,
    }[result.status] || 'Unknown';

  console.log(`${icon} ${projectName.padEnd(35)} ${action}`);

  return result.status;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const mode = dryRun ? 'DRY RUN' : 'LIVE';

  console.log(`\n🔄 Add Beads Instructions to AGENTS.md Files (${mode})\n`);
  console.log(`Projects directory: ${PROJECTS_PATH}\n`);

  if (dryRun) {
    console.log('⚠️  DRY RUN MODE - No files will be modified\n');
  }

  if (!fs.existsSync(PROJECTS_PATH)) {
    console.error(`❌ Projects directory not found: ${PROJECTS_PATH}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(PROJECTS_PATH, { withFileTypes: true });
  const projectDirs = entries
    .filter(entry => entry.isDirectory())
    .filter(entry => !entry.name.startsWith('.')) // Skip hidden directories
    .map(entry => path.join(PROJECTS_PATH, entry.name))
    .sort();

  console.log(`Found ${projectDirs.length} project directories\n`);
  console.log('='.repeat(80));
  console.log('\n');

  const stats = {
    updated: 0,
    would_update: 0,
    skip: 0,
    error: 0,
    total: 0,
  };

  for (const projectPath of projectDirs) {
    try {
      const status = processProject(projectPath, dryRun);
      stats[status]++;
      stats.total++;
    } catch (error) {
      console.error(`\n❌ Error processing ${path.basename(projectPath)}: ${error.message}`);
      stats.error++;
      stats.total++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\n📊 Summary:`);
  console.log(`   Total processed: ${stats.total}`);

  if (dryRun) {
    console.log(`   Would update: ${stats.would_update}`);
  } else {
    console.log(`   Updated: ${stats.updated}`);
  }

  console.log(`   Skipped: ${stats.skip}`);

  if (stats.error > 0) {
    console.log(`   Errors: ${stats.error}`);
  }

  if (dryRun) {
    console.log(`\n💡 Run without --dry-run to apply changes`);
  } else if (stats.updated > 0) {
    console.log(`\n💡 Next steps:`);
    console.log(`   1. Review changes in affected projects`);
    console.log(`   2. Test with an AI assistant in one project`);
    console.log(`   3. Commit the updated AGENTS.md files`);
  }

  console.log('');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
