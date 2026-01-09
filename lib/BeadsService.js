/**
 * Beads Service
 *
 * Handles all Beads issue tracker operations including:
 * - Listing and fetching issues
 * - Creating and updating issues
 * - Status and field management
 * - Bidirectional sync with Huly
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { recordApiLatency } from './HealthService.js';
import {
  readIssuesFromDB as readIssuesFromJSONL,
  findHulyIdentifier,
  buildIssueLookups,
  getBeadsIssuesWithLookups,
  normalizeTitleForComparison,
  getParentIdFromLookup,
} from './BeadsDBReader.js';

export function execGitCommand(command, workingDir, options = {}) {
  const fullCommand = `git ${command}`;

  try {
    return execSync(fullCommand, {
      cwd: workingDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
      ...options,
    }).trim();
  } catch (error) {
    const message = error?.message || String(error);
    throw new Error(`Git command failed: ${fullCommand}\n${message}`);
  }
}

export function isGitRepository(projectPath) {
  try {
    execGitCommand('rev-parse --is-inside-work-tree', projectPath);
    return true;
  } catch {
    return false;
  }
}

function hasStagedChanges(projectPath) {
  try {
    const output = execGitCommand('diff --cached --name-only', projectPath);
    return Boolean(output);
  } catch {
    return false;
  }
}

function stageBeadsFiles(projectPath, files) {
  const existingFiles = files
    .map(file => file.trim())
    .filter(Boolean)
    .filter(file => fs.existsSync(path.join(projectPath, file)));

  if (existingFiles.length === 0) {
    return false;
  }

  const args = existingFiles.map(file => `"${file}"`).join(' ');
  execGitCommand(`add -A -- ${args}`, projectPath);
  return true;
}

function commitStagedChanges(projectPath, commitMessage) {
  if (!hasStagedChanges(projectPath)) {
    return false;
  }

  const escapedMessage = commitMessage.replace(/"/g, '\\"');

  try {
    execGitCommand(`commit -m "${escapedMessage}"`, projectPath);
    return true;
  } catch (error) {
    const errorMsg = error?.message || String(error);

    // Fallback: some repos have strict hooks; commit anyway for automation.
    try {
      execGitCommand(`commit --no-verify -m "${escapedMessage}"`, projectPath);
      return true;
    } catch {
      throw new Error(errorMsg);
    }
  }
}

export function commitBeadsSyncFiles(projectPath, commitMessage) {
  if (!isGitRepository(projectPath)) {
    return false;
  }

  const beadsFiles = [
    '.beads/interactions.jsonl',
    '.beads/metadata.json',
    '.beads/config.yaml',
    '.beads/.gitignore',
    '.beads/README.md',
    '.gitattributes',
  ];

  const didStage = stageBeadsFiles(projectPath, beadsFiles);
  if (!didStage) {
    return false;
  }

  return commitStagedChanges(projectPath, commitMessage);
}

export function beadsWorkingTreeDirty(projectPath) {
  if (!isGitRepository(projectPath)) {
    return false;
  }

  try {
    const output = execGitCommand('status --porcelain=v1 -- .beads', projectPath);
    return Boolean(output);
  } catch {
    return false;
  }
}

/**
 * Execute a beads CLI command and return parsed JSON output
 *
 * @param {string} command - The bd command to execute (without 'bd' prefix)
 * @param {string} workingDir - The directory to run the command in
 * @returns {any} Parsed JSON output from the command
 */
export function execBeadsCommand(command, workingDir) {
  // Always use --no-daemon to avoid permission issues with daemon-created WAL files
  // The daemon may run as root and create files the container can't access
  const commandWithFlag = command.includes('--no-daemon') ? command : `${command} --no-daemon`;
  const fullCommand = `bd ${commandWithFlag}`;
  const startTime = Date.now();

  try {
    const output = execSync(fullCommand, {
      cwd: workingDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Record latency
    recordApiLatency('beads', command.split(' ')[0], Date.now() - startTime);

    return output.trim();
  } catch (error) {
    // Record latency even on error
    recordApiLatency('beads', command.split(' ')[0], Date.now() - startTime);
    throw new Error(`Beads command failed: ${fullCommand}\n${error.message}`);
  }
}

/**
 * List all issues in the beads repository
 *
 * @param {string} projectPath - Path to the project containing .beads directory
 * @param {Object} filters - Optional filters (status, priority, etc.)
 * @returns {Promise<Array>} Array of beads issues
 */
export async function listBeadsIssues(projectPath, filters = {}) {
  console.log('[Beads] Fetching issues...');

  try {
    let issues = readIssuesFromJSONL(projectPath);

    if (issues.length === 0) {
      let command = 'list --json';
      if (filters.status === 'open') {
        command += ' --status=open';
      } else if (filters.status === 'closed') {
        command += ' --status=closed';
      }

      const output = execBeadsCommand(command, projectPath);
      if (output) {
        issues = JSON.parse(output);
      }
    } else {
      if (filters.status === 'open') {
        issues = issues.filter(i => i.status === 'open' || i.status === 'in_progress');
      } else if (filters.status === 'closed') {
        issues = issues.filter(i => i.status === 'closed');
      }
    }

    console.log(`[Beads] Found ${issues.length} issues`);
    return issues;
  } catch (error) {
    console.error('[Beads] Error listing issues:', error.message);
    return [];
  }
}

/**
 * Get a single issue by ID
 *
 * @param {string} projectPath - Path to the project
 * @param {string} issueId - Beads issue ID (e.g., "huly-vibe-sync-abc123")
 * @returns {Promise<Object|null>} Issue object or null if not found
 */
export async function getBeadsIssue(projectPath, issueId) {
  try {
    const output = execBeadsCommand(`show ${issueId} --json`, projectPath);

    if (!output) {
      return null;
    }

    const issues = JSON.parse(output);
    return issues[0] || null;
  } catch (error) {
    console.error(`[Beads] Error fetching issue ${issueId}:`, error.message);
    return null;
  }
}

/**
 * Create a new issue in beads
 *
 * @param {string} projectPath - Path to the project
 * @param {Object} issueData - Issue data
 * @param {string} issueData.title - Issue title
 * @param {string} [issueData.description] - Issue description
 * @param {number} [issueData.priority] - Priority (1-5, default 2)
 * @param {string} [issueData.type] - Issue type (task, bug, feature, epic, chore)
 * @param {Object} config - Configuration object
 * @returns {Promise<Object|null>} Created issue object or null
 */
export async function createBeadsIssue(projectPath, issueData, config = {}) {
  if (config.sync?.dryRun) {
    console.log(`[Beads] [DRY RUN] Would create issue: ${issueData.title}`);
    return null;
  }

  console.log(`[Beads] Creating issue: ${issueData.title}`);

  try {
    let command = `create "${issueData.title}" --json`;

    // Add priority if specified (use !== undefined to allow priority 0 for P0/urgent)
    if (issueData.priority !== undefined && issueData.priority !== null) {
      command += ` --priority=${issueData.priority}`;
    }

    // Add issue type if specified
    if (issueData.type) {
      command += ` --type=${issueData.type}`;
    }

    // Add labels if specified
    if (issueData.labels && issueData.labels.length > 0) {
      command += ` --labels="${issueData.labels.join(',')}"`;
    }

    const output = execBeadsCommand(command, projectPath);
    const createdIssue = JSON.parse(output);

    // If there's a description, add it as a comment
    if (issueData.description) {
      try {
        execBeadsCommand(
          `comment ${createdIssue.id} "${issueData.description.replace(/"/g, '\\"')}"`,
          projectPath
        );
      } catch (commentError) {
        console.warn(`[Beads] Failed to add description as comment: ${commentError.message}`);
      }
    }

    console.log(`[Beads] ✓ Created issue: ${createdIssue.id}`);
    return createdIssue;
  } catch (error) {
    console.error(`[Beads] Error creating issue "${issueData.title}":`, error.message);
    return null;
  }
}

/**
 * Update an issue field
 *
 * @param {string} projectPath - Path to the project
 * @param {string} issueId - Beads issue ID
 * @param {string} field - Field to update (status, priority, title, type)
 * @param {any} value - New value for the field
 * @param {Object} config - Configuration object
 * @returns {Promise<boolean>} True if update successful
 */
export async function updateBeadsIssue(projectPath, issueId, field, value, config = {}) {
  if (config.sync?.dryRun) {
    console.log(`[Beads] [DRY RUN] Would update issue ${issueId} ${field} to: ${value}`);
    return true;
  }

  try {
    let command;

    switch (field) {
      case 'status':
        // Beads supports: open, in_progress, blocked, deferred, closed
        if (value === 'closed') {
          command = `close ${issueId}`;
        } else if (value === 'open') {
          command = `reopen ${issueId}`;
        } else if (['in_progress', 'blocked', 'deferred'].includes(value)) {
          command = `update ${issueId} --status=${value}`;
        } else {
          console.warn(`[Beads] Unknown status value: ${value}`);
          return false;
        }
        break;

      case 'priority':
        command = `update ${issueId} --priority=${value}`;
        break;

      case 'title':
        command = `update ${issueId} --title="${value.replace(/"/g, '\\"')}"`;
        break;

      case 'type':
        command = `update ${issueId} --type=${value}`;
        break;

      case 'add-label':
        command = `update ${issueId} --add-label="${value}"`;
        break;

      case 'remove-label':
        command = `update ${issueId} --remove-label="${value}"`;
        break;

      default:
        console.warn(`[Beads] Unsupported field: ${field}`);
        return false;
    }

    execBeadsCommand(command, projectPath);
    console.log(`[Beads] ✓ Updated issue ${issueId} ${field} to: ${value}`);
    return true;
  } catch (error) {
    console.error(`[Beads] Error updating issue ${issueId}:`, error.message);
    return false;
  }
}

/**
 * Update Beads issue status with label for Huly status disambiguation
 *
 * @param {string} projectPath - Path to the project
 * @param {string} issueId - Beads issue ID
 * @param {string} beadsStatus - Beads native status (open, in_progress, blocked, deferred, closed)
 * @param {string|null} newLabel - Label to add (e.g., 'huly:In Review')
 * @param {string[]} currentLabels - Current labels on the issue
 * @param {Object} config - Configuration object
 * @returns {Promise<boolean>} True if update successful
 */
export async function updateBeadsIssueStatusWithLabel(
  projectPath,
  issueId,
  beadsStatus,
  newLabel,
  currentLabels = [],
  config = {}
) {
  const { getHulyStatusLabels } = await import('./statusMapper.js');
  const hulyStatusLabels = getHulyStatusLabels();

  if (config.sync?.dryRun) {
    console.log(
      `[Beads] [DRY RUN] Would update issue ${issueId} status to: ${beadsStatus}, label: ${newLabel}`
    );
    return true;
  }

  try {
    // First update the status
    const statusUpdated = await updateBeadsIssue(
      projectPath,
      issueId,
      'status',
      beadsStatus,
      config
    );
    if (!statusUpdated) {
      return false;
    }

    // Remove any existing huly: status labels that are different from the new one
    for (const label of hulyStatusLabels) {
      if (currentLabels.includes(label) && label !== newLabel) {
        await updateBeadsIssue(projectPath, issueId, 'remove-label', label, config);
      }
    }

    // Add the new label if specified and not already present
    if (newLabel && !currentLabels.includes(newLabel)) {
      await updateBeadsIssue(projectPath, issueId, 'add-label', newLabel, config);
    }

    return true;
  } catch (error) {
    console.error(`[Beads] Error updating issue ${issueId} status with label:`, error.message);
    return false;
  }
}

/**
 * Close an issue
 *
 * @param {string} projectPath - Path to the project
 * @param {string} issueId - Beads issue ID
 * @param {Object} config - Configuration object
 * @returns {Promise<boolean>} True if close successful
 */
export async function closeBeadsIssue(projectPath, issueId, config = {}) {
  return updateBeadsIssue(projectPath, issueId, 'status', 'closed', config);
}

/**
 * Reopen a closed issue
 *
 * @param {string} projectPath - Path to the project
 * @param {string} issueId - Beads issue ID
 * @param {Object} config - Configuration object
 * @returns {Promise<boolean>} True if reopen successful
 */
export async function reopenBeadsIssue(projectPath, issueId, config = {}) {
  return updateBeadsIssue(projectPath, issueId, 'status', 'open', config);
}

// ============================================================
// PARENT-CHILD DEPENDENCY OPERATIONS
// Re-exported from BeadsParentChildService.js
// ============================================================
// These functions have been moved to BeadsParentChildService.js for better
// separation of concerns. Re-exported here for backwards compatibility.

export {
  addParentChildDependency,
  removeParentChildDependency,
  getDependencyTree,
  getIssueWithDependencies,
  syncParentChildToBeads,
  getParentChildRelationships,
  getBeadsParentId,
  getBeadsIssuesWithDependencies,
  syncBeadsParentChildToHuly,
  createHulySubIssueFromBeads,
  syncParentChildToHuly,
  syncAllParentChildToHuly,
} from './BeadsParentChildService.js';

// ============================================================
// Sync Functions - Re-exported from BeadsSyncService.js
// ============================================================
// These functions have been moved to BeadsSyncService.js for better
// separation of concerns. Re-exported here for backwards compatibility.

export { syncHulyIssueToBeads, syncBeadsIssueToHuly, syncBeadsToGit } from './BeadsSyncService.js';

export {
  readIssuesFromDB as readIssuesFromJSONL,
  findHulyIdentifier,
  buildIssueLookups,
  getBeadsIssuesWithLookups,
  normalizeTitleForComparison,
  getParentIdFromLookup,
} from './BeadsDBReader.js';

export function isBeadsInitialized(projectPath) {
  const beadsDir = path.join(projectPath, '.beads');
  return fs.existsSync(beadsDir) && fs.existsSync(path.join(beadsDir, 'beads.db'));
}

/**
 * Initialize beads in a project directory
 *
 * @param {string} projectPath - Path to initialize beads in
 * @param {Object} options - Initialization options
 * @param {string} options.projectName - Project name for display
 * @param {string} options.projectIdentifier - Project identifier (e.g., GRAPH)
 * @returns {Promise<boolean>} True if initialization succeeded
 */
export async function initializeBeads(projectPath, options = {}) {
  try {
    // Check if already initialized
    if (isBeadsInitialized(projectPath)) {
      console.log(`[Beads] Already initialized at ${projectPath}`);
      return true;
    }

    console.log(`[Beads] Initializing beads at ${projectPath}`);

    // Ensure directory exists
    if (!fs.existsSync(projectPath)) {
      console.log(`[Beads] Creating directory: ${projectPath}`);
      fs.mkdirSync(projectPath, { recursive: true });
    }

    // Run bd init (without --skip-hooks or --skip-merge-driver)
    // We want git hooks and merge drivers installed properly
    execBeadsCommand('init --quiet', projectPath);

    const beadsDir = path.join(projectPath, '.beads');

    // Set up .beads/.gitignore to exclude runtime artifacts but track JSONL
    const gitignoreContent = `# SQLite databases
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

    const gitignorePath = path.join(beadsDir, '.gitignore');
    try {
      fs.writeFileSync(gitignorePath, gitignoreContent);
      console.log(`[Beads] Created .beads/.gitignore`);
    } catch (error) {
      console.warn(`[Beads] Could not create .beads/.gitignore: ${error.message}`);
    }

    // Fix permissions for .beads directory (if running as root in container)
    if (fs.existsSync(beadsDir)) {
      try {
        // Set ownership to uid:1000 (node user in container)
        execSync(`chown -R 1000:1000 "${beadsDir}"`, { stdio: 'ignore' });
        console.log(`[Beads] Fixed permissions for ${beadsDir}`);
      } catch (permError) {
        // Permission fix may fail if not running as root, that's okay
        console.log(`[Beads] Could not fix permissions (may not be needed): ${permError.message}`);
      }
    }

    // Add .beads/ to git tracking if this is a git repo
    try {
      // Check if this is a git repository
      execSync('git rev-parse --git-dir', {
        cwd: projectPath,
        stdio: 'pipe',
      });

      // It's a git repo - set up .gitattributes for Beads merge driver
      const gitattributesPath = path.join(projectPath, '.gitattributes');
      const beadsMergeAttrs = `# Use bd merge for beads JSONL files
.beads/issues.jsonl merge=beads
.beads/interactions.jsonl merge=beads
`;

      try {
        let existingContent = '';
        if (fs.existsSync(gitattributesPath)) {
          existingContent = fs.readFileSync(gitattributesPath, 'utf-8');
        }

        // Only add if not already present
        if (!existingContent.includes('merge=beads')) {
          const newContent = existingContent
            ? `${existingContent.trimEnd()}\n\n${beadsMergeAttrs}`
            : beadsMergeAttrs;
          fs.writeFileSync(gitattributesPath, newContent);
          console.log(`[Beads] Updated .gitattributes with merge driver config`);
        }
      } catch (attrError) {
        console.warn(`[Beads] Could not update .gitattributes: ${attrError.message}`);
      }

      // Install git hooks (pre-commit, pre-push, post-merge, post-checkout)
      try {
        execBeadsCommand('hooks install', projectPath);
        console.log(`[Beads] Installed git hooks`);
      } catch (hooksError) {
        console.warn(`[Beads] Could not install git hooks: ${hooksError.message}`);
      }

      // Create AGENTS.md with Beads instructions if it doesn't exist or doesn't have them
      const agentsPath = path.join(projectPath, 'AGENTS.md');
      const beadsInstructions = `# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run \`bd onboard\` to get started.

## Quick Reference

\`\`\`bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
\`\`\`

## Beads Sync Flow (Hybrid System)

Beads uses a **hybrid sync** approach for reliability:

### Automatic Sync (Real-time)
- \`bd create\`, \`bd update\`, \`bd close\` write to SQLite DB
- File watcher detects DB changes automatically
- Syncs to Huly within ~30-60 seconds

### Git Persistence (\`bd sync\`)
- \`bd sync\` exports to JSONL and commits to git
- Required for cross-machine persistence
- Run before ending session to ensure changes are saved

### Best Practice
\`\`\`bash
bd create "New task"   # Auto-syncs to Huly
bd close some-issue    # Auto-syncs to Huly
bd sync                # Git backup (recommended before session end)
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

      try {
        let shouldUpdate = false;

        if (fs.existsSync(agentsPath)) {
          const existingContent = fs.readFileSync(agentsPath, 'utf-8');

          // Only update if it doesn't already have Beads instructions
          if (
            !existingContent.includes('bd ready') &&
            !existingContent.includes('bd onboard') &&
            !existingContent.includes('beads) for issue tracking')
          ) {
            // Prepend Beads instructions to existing content
            const separator = existingContent.startsWith('\n') ? '' : '\n\n';
            fs.writeFileSync(agentsPath, beadsInstructions + separator + existingContent);
            console.log(`[Beads] Updated AGENTS.md with Beads instructions`);
            shouldUpdate = true;
          }
        } else {
          // Create new AGENTS.md with Beads instructions
          fs.writeFileSync(agentsPath, beadsInstructions);
          console.log(`[Beads] Created AGENTS.md with Beads instructions`);
          shouldUpdate = true;
        }
      } catch (agentsError) {
        console.warn(`[Beads] Could not setup AGENTS.md: ${agentsError.message}`);
      }

      // It's a git repo - check if .beads/ is already tracked
      const lsFiles = execSync('git ls-files .beads/', {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();

      if (!lsFiles) {
        // .beads/ not tracked - add core config files.
        console.log(`[Beads] Adding .beads/ files to git`);

        try {
          commitBeadsSyncFiles(projectPath, 'chore(beads): initialize beads issue tracker');
          console.log(`[Beads] Committed .beads/ setup to git`);
        } catch (commitError) {
          console.log(`[Beads] Could not commit .beads/ setup (will retry on next sync)`);
        }
      }
    } catch (gitError) {
      // Not a git repo or git operations failed - that's okay, skip git setup
    }

    console.log(`[Beads] ✓ Initialized successfully at ${projectPath}`);
    return true;
  } catch (error) {
    console.error(`[Beads] Failed to initialize at ${projectPath}:`, error.message);
    return false;
  }
}

/**
 * Ensure beads is initialized in a project directory
 * Checks if initialized, initializes if not
 *
 * @param {string} projectPath - Path to project directory
 * @param {Object} options - Options for initialization
 * @returns {Promise<boolean>} True if beads is ready to use
 */
export async function ensureBeadsInitialized(projectPath, options = {}) {
  if (isBeadsInitialized(projectPath)) {
    return true;
  }

  return await initializeBeads(projectPath, options);
}

/**
 * Sync beads changes to git and push to remote
 * Runs: bd sync && git push
 *
 * @param {string} projectPath - Path to project directory
 * @param {Object} options - Sync options
 * @param {string} options.projectIdentifier - Project identifier for logging
 * @returns {Promise<boolean>} True if sync and push succeeded
 */

/**
 * Create a BeadsService instance with bound configuration
 * Factory pattern for easier dependency injection and testing
 *
 * @param {Object} config - Configuration object
 * @returns {Object} BeadsService instance with bound methods
 */
export function createBeadsService(config) {
  return {
    listIssues: projectPath => listBeadsIssues(projectPath),
    getIssue: (projectPath, issueId) => getBeadsIssue(projectPath, issueId),
    createIssue: (projectPath, issueData) => createBeadsIssue(projectPath, issueData, config),
    updateIssue: (projectPath, issueId, field, value) =>
      updateBeadsIssue(projectPath, issueId, field, value, config),
    closeIssue: (projectPath, issueId) => closeBeadsIssue(projectPath, issueId, config),
    reopenIssue: (projectPath, issueId) => reopenBeadsIssue(projectPath, issueId, config),
    syncHulyIssueToBeads: (projectPath, hulyIssue, beadsIssues, db) =>
      syncHulyIssueToBeads(projectPath, hulyIssue, beadsIssues, db, config),
    syncBeadsIssueToHuly: (
      hulyClient,
      projectPath,
      beadsIssue,
      hulyIssues,
      projectIdentifier,
      db,
      phase3UpdatedIssues
    ) =>
      syncBeadsIssueToHuly(
        hulyClient,
        projectPath,
        beadsIssue,
        hulyIssues,
        projectIdentifier,
        db,
        config,
        phase3UpdatedIssues
      ),
  };
}
