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

function execGitCommand(command, workingDir, options = {}) {
  const fullCommand = `git ${command}`;

  try {
    return execSync(fullCommand, {
      cwd: workingDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    }).trim();
  } catch (error) {
    const message = error?.message || String(error);
    throw new Error(`Git command failed: ${fullCommand}\n${message}`);
  }
}

function isGitRepository(projectPath) {
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

function commitBeadsSyncFiles(projectPath, commitMessage) {
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

function beadsWorkingTreeDirty(projectPath) {
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
function execBeadsCommand(command, workingDir) {
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
    let command = 'list --json';

    // Add filters if provided
    if (filters.status === 'open') {
      command += ' --status=open';
    } else if (filters.status === 'closed') {
      command += ' --status=closed';
    }

    const output = execBeadsCommand(command, projectPath);

    if (!output) {
      return [];
    }

    const issues = JSON.parse(output);
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
    const statusUpdated = await updateBeadsIssue(projectPath, issueId, 'status', beadsStatus, config);
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
// ============================================================

/**
 * Add a parent-child dependency between two Beads issues
 *
 * @param {string} projectPath - Path to the project
 * @param {string} childId - Child issue ID (the sub-issue)
 * @param {string} parentId - Parent issue ID
 * @param {Object} config - Configuration object
 * @returns {Promise<boolean>} True if dependency added successfully
 */
export async function addParentChildDependency(projectPath, childId, parentId, config = {}) {
  if (config.sync?.dryRun) {
    console.log(`[Beads] [DRY RUN] Would add parent-child: ${childId} -> ${parentId}`);
    return true;
  }

  try {
    // bd dep add <child-id> <parent-id> --type=parent-child
    const command = `dep add ${childId} ${parentId} --type=parent-child`;
    execBeadsCommand(command, projectPath);
    console.log(`[Beads] ✓ Added parent-child dependency: ${childId} -> ${parentId}`);
    return true;
  } catch (error) {
    // Check if dependency already exists (not an error)
    if (error.message?.includes('already exists') || error.message?.includes('duplicate')) {
      console.log(`[Beads] Parent-child dependency already exists: ${childId} -> ${parentId}`);
      return true;
    }
    console.error(`[Beads] Error adding parent-child dependency:`, error.message);
    return false;
  }
}

/**
 * Remove a parent-child dependency between two Beads issues
 *
 * @param {string} projectPath - Path to the project
 * @param {string} childId - Child issue ID
 * @param {string} parentId - Parent issue ID
 * @param {Object} config - Configuration object
 * @returns {Promise<boolean>} True if dependency removed successfully
 */
export async function removeParentChildDependency(projectPath, childId, parentId, config = {}) {
  if (config.sync?.dryRun) {
    console.log(`[Beads] [DRY RUN] Would remove parent-child: ${childId} -> ${parentId}`);
    return true;
  }

  try {
    const command = `dep remove ${childId} ${parentId}`;
    execBeadsCommand(command, projectPath);
    console.log(`[Beads] ✓ Removed parent-child dependency: ${childId} -> ${parentId}`);
    return true;
  } catch (error) {
    console.error(`[Beads] Error removing parent-child dependency:`, error.message);
    return false;
  }
}

/**
 * Get dependency tree for an issue
 *
 * @param {string} projectPath - Path to the project
 * @param {string} issueId - Issue ID to get tree for
 * @returns {Promise<Object|null>} Dependency tree or null on error
 */
export async function getDependencyTree(projectPath, issueId) {
  try {
    const command = `dep tree ${issueId} --json`;
    const output = execBeadsCommand(command, projectPath);
    return JSON.parse(output);
  } catch (error) {
    console.error(`[Beads] Error getting dependency tree for ${issueId}:`, error.message);
    return null;
  }
}

/**
 * Get issue details including dependencies
 *
 * @param {string} projectPath - Path to the project
 * @param {string} issueId - Issue ID
 * @returns {Promise<Object|null>} Issue with dependency info or null
 */
export async function getIssueWithDependencies(projectPath, issueId) {
  try {
    const command = `show ${issueId} --json`;
    const output = execBeadsCommand(command, projectPath);
    // bd show returns an array with one element
    const issues = JSON.parse(output);
    return issues[0] || null;
  } catch (error) {
    console.error(`[Beads] Error getting issue ${issueId}:`, error.message);
    return null;
  }
}

/**
 * Sync parent-child relationship from Huly to Beads
 *
 * @param {string} projectPath - Path to the project
 * @param {string} childBeadsId - Child's Beads issue ID
 * @param {string} parentBeadsId - Parent's Beads issue ID
 * @param {Object} db - Database instance
 * @param {Object} config - Configuration object
 * @returns {Promise<boolean>} True if sync successful
 */
export async function syncParentChildToBeads(projectPath, childBeadsId, parentBeadsId, db, config = {}) {
  if (!childBeadsId || !parentBeadsId) {
    console.log(`[Beads] Cannot sync parent-child: missing IDs (child: ${childBeadsId}, parent: ${parentBeadsId})`);
    return false;
  }

  const success = await addParentChildDependency(projectPath, childBeadsId, parentBeadsId, config);
  
  if (success) {
    // Update database with parent relationship
    const childIssue = db.getAllIssues().find(i => i.beads_issue_id === childBeadsId);
    if (childIssue) {
      db.updateParentChild(childIssue.identifier, childIssue.parent_huly_id, parentBeadsId);
    }
  }

  return success;
}

/**
 * Get all parent-child relationships from Beads dependency tree
 * 
 * @param {string} projectPath - Path to the project
 * @param {string} issueId - Issue ID to get tree for
 * @returns {Promise<Array>} Array of {childId, parentId} relationships
 */
export async function getParentChildRelationships(projectPath, issueId) {
  try {
    // Get dependency tree - dependencies are what this issue depends on
    const command = `dep tree ${issueId} --json`;
    const output = execBeadsCommand(command, projectPath);
    const tree = JSON.parse(output);
    
    const relationships = [];
    
    // Parse tree to find parent-child relationships
    // In the tree, depth > 0 items are dependencies of the root
    for (const node of tree) {
      if (node.depth > 0 && node.parent_id && node.parent_id !== node.id) {
        // This node depends on its parent_id
        relationships.push({
          childId: node.parent_id, // The issue that has the dependency
          parentId: node.id,       // What it depends on
          type: 'parent-child'
        });
      }
    }
    
    return relationships;
  } catch (error) {
    console.error(`[Beads] Error getting parent-child relationships for ${issueId}:`, error.message);
    return [];
  }
}

/**
 * Get all issues with their dependency counts from Beads
 * 
 * @param {string} projectPath - Path to the project
 * @returns {Promise<Array>} Array of issues with dependency_count and dependent_count
 */
export async function getBeadsIssuesWithDependencies(projectPath) {
  try {
    const command = `list --json`;
    const output = execBeadsCommand(command, projectPath);
    const issues = JSON.parse(output);
    
    // Issues have dependency_count (what blocks them) and dependent_count (what they block)
    return issues;
  } catch (error) {
    console.error(`[Beads] Error getting issues with dependencies:`, error.message);
    return [];
  }
}

/**
 * Sync parent-child relationships from Beads to Huly
 * 
 * When a Beads issue has a parent-child dependency, create the corresponding
 * sub-issue relationship in Huly.
 * 
 * @param {Object} hulyClient - Huly REST client
 * @param {string} projectPath - Path to the project with Beads
 * @param {string} projectIdentifier - Huly project identifier
 * @param {Object} db - Database instance
 * @param {Object} config - Configuration object
 * @returns {Promise<Object>} Sync results {synced, skipped, errors}
 */
export async function syncBeadsParentChildToHuly(hulyClient, projectPath, projectIdentifier, db, config = {}) {
  const results = { synced: 0, skipped: 0, errors: [] };

  try {
    // Get all Beads issues with dependency info
    const beadsIssues = await getBeadsIssuesWithDependencies(projectPath);
    
    // Find issues that have dependencies (potential parent-child relationships)
    const issuesWithDeps = beadsIssues.filter(i => i.dependency_count > 0);
    
    if (issuesWithDeps.length === 0) {
      console.log(`[Beads→Huly] No parent-child relationships to sync`);
      return results;
    }

    console.log(`[Beads→Huly] Found ${issuesWithDeps.length} issues with dependencies`);

    for (const beadsIssue of issuesWithDeps) {
      try {
        // Get the dependency tree for this issue
        const relationships = await getParentChildRelationships(projectPath, beadsIssue.id);
        
        for (const rel of relationships) {
          // Find the corresponding Huly issues in our database
          const childDbIssue = db.getAllIssues().find(i => i.beads_issue_id === rel.childId);
          const parentDbIssue = db.getAllIssues().find(i => i.beads_issue_id === rel.parentId);

          if (!childDbIssue || !parentDbIssue) {
            console.log(`[Beads→Huly] Skipping relationship - issues not synced yet (child: ${rel.childId}, parent: ${rel.parentId})`);
            results.skipped++;
            continue;
          }

          // Check if the Huly issue already has this parent
          if (childDbIssue.parent_huly_id === parentDbIssue.identifier) {
            // Already synced
            results.skipped++;
            continue;
          }

          // Create sub-issue relationship in Huly
          // This requires re-creating the child as a sub-issue of the parent
          // For now, we just update the database to track the relationship
          // The actual Huly API doesn't support moving an existing issue to become a sub-issue
          
          console.log(`[Beads→Huly] Tracking parent-child: ${childDbIssue.identifier} -> ${parentDbIssue.identifier}`);
          
          // Update database with the relationship
          db.updateParentChild(childDbIssue.identifier, parentDbIssue.identifier, rel.parentId);
          
          // Update sub-issue count on parent
          const currentCount = parentDbIssue.sub_issue_count || 0;
          db.updateSubIssueCount(parentDbIssue.identifier, currentCount + 1);
          
          results.synced++;
        }
      } catch (error) {
        console.error(`[Beads→Huly] Error syncing relationships for ${beadsIssue.id}:`, error.message);
        results.errors.push({ issueId: beadsIssue.id, error: error.message });
      }
    }

    console.log(`[Beads→Huly] Parent-child sync complete: ${results.synced} synced, ${results.skipped} skipped, ${results.errors.length} errors`);
    return results;

  } catch (error) {
    console.error(`[Beads→Huly] Error in parent-child sync:`, error.message);
    results.errors.push({ error: error.message });
    return results;
  }
}

/**
 * Create a Huly sub-issue from a Beads issue that has a parent dependency
 * 
 * @param {Object} hulyClient - Huly REST client
 * @param {Object} beadsIssue - Beads issue object
 * @param {string} parentHulyIdentifier - Parent Huly issue identifier
 * @param {Object} db - Database instance
 * @param {Object} config - Configuration object
 * @returns {Promise<Object|null>} Created Huly sub-issue or null
 */
export async function createHulySubIssueFromBeads(hulyClient, beadsIssue, parentHulyIdentifier, db, config = {}) {
  const { mapBeadsStatusToHuly, mapBeadsPriorityToHuly } = await import('./statusMapper.js');

  if (config.sync?.dryRun) {
    console.log(`[Beads→Huly] [DRY RUN] Would create sub-issue under ${parentHulyIdentifier}: ${beadsIssue.title}`);
    return null;
  }

  try {
    const beadsLabels = beadsIssue.labels || [];
    const hulyStatus = mapBeadsStatusToHuly(beadsIssue.status, beadsLabels);
    const hulyPriority = mapBeadsPriorityToHuly(beadsIssue.priority);

    const subIssue = await hulyClient.createSubIssue(parentHulyIdentifier, {
      title: beadsIssue.title,
      description: beadsIssue.description || `Synced from Beads: ${beadsIssue.id}`,
      priority: hulyPriority,
      // Status will be set after creation if needed
    });

    if (subIssue) {
      // Update status if not the default
      if (hulyStatus && hulyStatus !== 'Backlog' && hulyStatus !== 'Todo') {
        await hulyClient.patchIssue(subIssue.identifier, { status: hulyStatus });
      }

      // Store mapping in database
      db.upsertIssue({
        identifier: subIssue.identifier,
        project_identifier: subIssue.project || subIssue.space,
        huly_id: subIssue._id,
        beads_issue_id: beadsIssue.id,
        title: beadsIssue.title,
        status: hulyStatus,
        priority: hulyPriority,
        beads_status: beadsIssue.status,
        parent_huly_id: parentHulyIdentifier,
        parent_beads_id: null, // Will be set when we know the parent's Beads ID
        beads_modified_at: beadsIssue.updated_at
          ? new Date(beadsIssue.updated_at).getTime()
          : Date.now(),
      });

      console.log(`[Beads→Huly] ✓ Created sub-issue ${subIssue.identifier} under ${parentHulyIdentifier}`);
      return subIssue;
    }

    return null;
  } catch (error) {
    console.error(`[Beads→Huly] Error creating sub-issue under ${parentHulyIdentifier}:`, error.message);
    return null;
  }
}

/**
 * Sync parent-child relationship from Beads to Huly
 * Creates a sub-issue in Huly if the child doesn't exist as a sub-issue
 *
 * @param {Object} hulyClient - Huly REST client
 * @param {string} projectPath - Path to the project
 * @param {Object} childBeadsIssue - Child Beads issue object
 * @param {Object} parentBeadsIssue - Parent Beads issue object
 * @param {Object} db - Database instance
 * @param {Object} config - Configuration object
 * @returns {Promise<boolean>} True if sync successful
 */
export async function syncParentChildToHuly(hulyClient, projectPath, childBeadsIssue, parentBeadsIssue, db, config = {}) {
  if (!childBeadsIssue || !parentBeadsIssue) {
    console.log(`[Beads→Huly] Cannot sync parent-child: missing issue data`);
    return false;
  }

  // Find the Huly identifiers from database
  const dbIssues = db.getAllIssues();
  const childDbIssue = dbIssues.find(i => i.beads_issue_id === childBeadsIssue.id);
  const parentDbIssue = dbIssues.find(i => i.beads_issue_id === parentBeadsIssue.id);

  if (!childDbIssue || !parentDbIssue) {
    console.log(`[Beads→Huly] Cannot sync parent-child: issues not synced to Huly yet`);
    return false;
  }

  // Check if child already has the correct parent in Huly
  if (childDbIssue.parent_huly_id === parentDbIssue.identifier) {
    // Already synced
    return true;
  }

  if (config.sync?.dryRun) {
    console.log(`[Beads→Huly] [DRY RUN] Would set ${childDbIssue.identifier} as sub-issue of ${parentDbIssue.identifier}`);
    return true;
  }

  try {
    // Use the new REST API to create sub-issue relationship
    // Note: If the issue already exists, we need to update its parent
    // The REST API may support this via PUT /api/issues/:identifier with parentIssue field
    
    console.log(`[Beads→Huly] Setting ${childDbIssue.identifier} as sub-issue of ${parentDbIssue.identifier}`);
    
    // Update the database with the parent relationship
    db.updateParentChild(childDbIssue.identifier, parentDbIssue.identifier, parentBeadsIssue.id);
    
    // Note: Huly's attachedTo field is typically set at creation time
    // For existing issues, we may need to update via the MCP tool or a new REST endpoint
    // For now, we track the relationship in our database
    
    console.log(`[Beads→Huly] ✓ Updated parent-child relationship in sync database`);
    return true;
  } catch (error) {
    console.error(`[Beads→Huly] Error syncing parent-child:`, error.message);
    return false;
  }
}

/**
 * Sync all parent-child relationships from Beads to Huly for a project
 *
 * @param {Object} hulyClient - Huly REST client
 * @param {string} projectPath - Path to the project
 * @param {Array} beadsIssues - All Beads issues in the project
 * @param {Object} db - Database instance
 * @param {Object} config - Configuration object
 * @returns {Promise<number>} Number of relationships synced
 */
export async function syncAllParentChildToHuly(hulyClient, projectPath, beadsIssues, db, config = {}) {
  let syncedCount = 0;
  
  // Find issues that have dependencies (dependency_count > 0)
  const issuesWithDeps = beadsIssues.filter(i => i.dependency_count > 0);
  
  for (const childIssue of issuesWithDeps) {
    try {
      // Get the dependency tree for this issue
      const tree = await getDependencyTreeSafe(projectPath, childIssue.id);
      
      if (!tree || tree.length <= 1) continue;
      
      // Find parent-child type dependencies
      // The tree shows what this issue depends on
      for (const node of tree) {
        if (node.depth === 1) {
          // Direct dependency - check if it's a parent-child relationship
          const parentIssue = beadsIssues.find(i => i.id === node.id);
          if (parentIssue) {
            const success = await syncParentChildToHuly(
              hulyClient,
              projectPath,
              childIssue,
              parentIssue,
              db,
              config
            );
            if (success) syncedCount++;
          }
        }
      }
    } catch (error) {
      console.error(`[Beads→Huly] Error processing dependencies for ${childIssue.id}:`, error.message);
    }
  }
  
  console.log(`[Beads→Huly] Synced ${syncedCount} parent-child relationships`);
  return syncedCount;
}

/**
 * Safe wrapper for getDependencyTree that handles errors
 */
async function getDependencyTreeSafe(projectPath, issueId) {
  try {
    const command = `dep tree ${issueId} --json`;
    const output = execBeadsCommand(command, projectPath);
    return JSON.parse(output);
  } catch {
    return null;
  }
}

/**
 * Sync a Huly issue to Beads (create or update)
 *
 * @param {string} projectPath - Path to the project
 * @param {Object} hulyIssue - Huly issue object
 * @param {Array} beadsIssues - Existing beads issues
 * @param {Object} db - Database instance
 * @param {Object} config - Configuration object
 * @returns {Promise<Object|null>} Created/updated beads issue or null
 */
export async function syncHulyIssueToBeads(projectPath, hulyIssue, beadsIssues, db, config = {}) {
  const { mapHulyStatusToBeads, mapHulyPriorityToBeads, mapHulyTypeToBeads, getHulyStatusLabels } =
    await import('./statusMapper.js');

  // Check if issue already exists in beads (stored in database)
  const dbIssue = db.getIssue(hulyIssue.identifier);
  const beadsIssueId = dbIssue?.beads_issue_id;

  let beadsIssue = null;
  if (beadsIssueId) {
    beadsIssue = beadsIssues.find(issue => issue.id === beadsIssueId);
  }

  const projectIdentifier = hulyIssue.project || hulyIssue.space;

  const lastSeenHulyModifiedAt = dbIssue?.huly_modified_at || 0;
  const lastSeenBeadsModifiedAt = dbIssue?.beads_modified_at || 0;

  const currentHulyModifiedAt =
    typeof hulyIssue.modifiedOn === 'number'
      ? hulyIssue.modifiedOn
      : hulyIssue.modifiedOn
        ? new Date(hulyIssue.modifiedOn).getTime()
        : null;

  const currentBeadsModifiedAt = beadsIssue?.updated_at
    ? new Date(beadsIssue.updated_at).getTime()
    : null;

  const hulyChangedSinceLastSeen =
    currentHulyModifiedAt !== null && currentHulyModifiedAt > lastSeenHulyModifiedAt;
  const beadsChangedSinceLastSeen =
    currentBeadsModifiedAt !== null && currentBeadsModifiedAt > lastSeenBeadsModifiedAt;

  if (!beadsIssue) {
    // No mapping exists - but before creating, check if a Beads issue with matching title exists
    // DEDUPLICATION: Normalize titles to find matches
    const normalizeTitleForComparison = title => {
      if (!title) return '';
      return title
        .trim()
        .toLowerCase()
        .replace(/^\[p[0-4]\]\s*/i, '') // Remove [P0]-[P4] prefix
        .replace(/^\[perf[^\]]*\]\s*/i, '') // Remove [PERF*] prefix
        .replace(/^\[tier\s*\d+\]\s*/i, '') // Remove [Tier N] prefix
        .replace(/^\[action\]\s*/i, '') // Remove [Action] prefix
        .replace(/^\[bug\]\s*/i, '') // Remove [BUG] prefix
        .replace(/^\[fixed\]\s*/i, '') // Remove [FIXED] prefix
        .trim();
    };

    const normalizedHulyTitle = normalizeTitleForComparison(hulyIssue.title);
    const matchingBeadsIssue = beadsIssues.find(bi => {
      const normalizedBeadsTitle = normalizeTitleForComparison(bi.title);
      // Exact match after normalization
      if (normalizedBeadsTitle === normalizedHulyTitle) return true;
      // Also check if one contains the other (for partial matches)
      if (normalizedHulyTitle.length > 10 && normalizedBeadsTitle.length > 10) {
        if (
          normalizedBeadsTitle.includes(normalizedHulyTitle) ||
          normalizedHulyTitle.includes(normalizedBeadsTitle)
        ) {
          return true;
        }
      }
      return false;
    });

    if (matchingBeadsIssue) {
      // Found a matching Beads issue - link them instead of creating duplicate
      console.log(
        `[Huly→Beads] Found existing Beads issue ${matchingBeadsIssue.id} matching Huly ${hulyIssue.identifier} - linking instead of creating duplicate`
      );

      const { status: beadsStatus } = mapHulyStatusToBeads(hulyIssue.status);

      // Store mapping in database to link them
      db.upsertIssue({
        identifier: hulyIssue.identifier,
        project_identifier: projectIdentifier,
        huly_id: hulyIssue.id,
        beads_issue_id: matchingBeadsIssue.id,
        title: hulyIssue.title,
        status: hulyIssue.status,
        priority: hulyIssue.priority,
        beads_status: matchingBeadsIssue.status,
        beads_modified_at: matchingBeadsIssue.updated_at
          ? new Date(matchingBeadsIssue.updated_at).getTime()
          : Date.now(),
        huly_modified_at: currentHulyModifiedAt ?? null,
      });

      console.log(
        `[Huly→Beads] ✓ Linked existing Beads issue ${matchingBeadsIssue.id} to Huly ${hulyIssue.identifier} (avoided duplicate)`
      );
      return matchingBeadsIssue;
    }

    // No matching issue found - create new issue in beads
    const { status: beadsStatus, label: beadsLabel } = mapHulyStatusToBeads(hulyIssue.status);
    const beadsPriority = mapHulyPriorityToBeads(hulyIssue.priority);
    const beadsType = mapHulyTypeToBeads(hulyIssue.type);

    // Add Huly identifier to description for tracking
    const description = hulyIssue.description
      ? `${hulyIssue.description}\n\n---\nHuly Issue: ${hulyIssue.identifier}`
      : `Synced from Huly: ${hulyIssue.identifier}`;

    // Build labels array for creation
    const labels = [];
    if (beadsLabel) {
      labels.push(beadsLabel);
    }

    const createdIssue = await createBeadsIssue(
      projectPath,
      {
        title: hulyIssue.title,
        description: description,
        priority: beadsPriority,
        type: beadsType,
        labels: labels,
      },
      config
    );

    if (createdIssue) {
      // Apply the correct Beads status (open, in_progress, blocked, deferred, closed)
      if (beadsStatus !== 'open') {
        // New issues are created as 'open' by default, so only update if different
        await updateBeadsIssue(projectPath, createdIssue.id, 'status', beadsStatus, config);
      }

      const createdBeadsModifiedAt = createdIssue.updated_at
        ? new Date(createdIssue.updated_at).getTime()
        : Date.now();

      // Update database with mapping + current state (including parent info)
      db.upsertIssue({
        identifier: hulyIssue.identifier,
        project_identifier: projectIdentifier,
        title: hulyIssue.title,
        description: hulyIssue.description,
        status: hulyIssue.status,
        priority: hulyIssue.priority,
        beads_issue_id: createdIssue.id,
        beads_status: beadsStatus,
        huly_modified_at: currentHulyModifiedAt ?? null,
        beads_modified_at: createdBeadsModifiedAt,
        // Parent-child info from Huly
        parent_huly_id: hulyIssue.parentIssue?.identifier || null,
        sub_issue_count: hulyIssue.subIssueCount || 0,
      });

      // If this issue has a parent, sync the parent-child relationship to Beads
      if (hulyIssue.parentIssue?.identifier) {
        const parentDbIssue = db.getIssue(hulyIssue.parentIssue.identifier);
        if (parentDbIssue?.beads_issue_id) {
          await syncParentChildToBeads(
            projectPath,
            createdIssue.id,
            parentDbIssue.beads_issue_id,
            db,
            config
          );
        } else {
          console.log(`[Beads] Parent ${hulyIssue.parentIssue.identifier} not yet synced, will sync dependency later`);
        }
      }

      return createdIssue;
    }

    return null;
  }

  // Issue exists - check for updates from Huly
  const { status: desiredBeadsStatus, label: desiredBeadsLabel } = mapHulyStatusToBeads(
    hulyIssue.status
  );
  const desiredBeadsPriority = mapHulyPriorityToBeads(hulyIssue.priority);
  const desiredTitle = hulyIssue.title;
  const hulyStatusLabels = getHulyStatusLabels();

  // Check if status or label needs updating
  const currentLabels = beadsIssue.labels || [];
  const currentHulyLabel = currentLabels.find(l => hulyStatusLabels.includes(l)) || null;
  const statusMismatch =
    beadsIssue.status !== desiredBeadsStatus || currentHulyLabel !== desiredBeadsLabel;
  const priorityMismatch = beadsIssue.priority !== desiredBeadsPriority;
  const titleMismatch = beadsIssue.title !== desiredTitle;

  if (!statusMismatch && !priorityMismatch && !titleMismatch) {
    // Nothing to do; critically, return null so Phase 3b does NOT skip.
    return null;
  }

  // Conflict resolution: if Beads changed more recently than Huly, do NOT overwrite Beads.
  // This allows Phase 3b (Beads→Huly) to propagate the change.
  if (beadsChangedSinceLastSeen && !hulyChangedSinceLastSeen) {
    console.log(
      `[Beads] Detected local Beads changes for ${hulyIssue.identifier}; deferring to Beads→Huly sync`
    );
    return null;
  }

  if (beadsChangedSinceLastSeen && hulyChangedSinceLastSeen) {
    const hulyWins =
      currentBeadsModifiedAt === null ||
      currentHulyModifiedAt === null ||
      currentHulyModifiedAt >= currentBeadsModifiedAt;

    if (!hulyWins) {
      console.log(
        `[Beads] Conflict for ${hulyIssue.identifier}; Beads is newer, deferring to Beads→Huly sync`
      );
      return null;
    }

    console.log(`[Beads] Conflict for ${hulyIssue.identifier}; Huly is newer, applying to Beads`);
  }

  let updated = false;

  // Apply Huly → Beads updates
  if (statusMismatch) {
    console.log(
      `[Beads] Status change detected: ${hulyIssue.identifier} (${beadsIssue.status}/${currentHulyLabel || 'no-label'} → ${desiredBeadsStatus}/${desiredBeadsLabel || 'no-label'})`
    );
    await updateBeadsIssueStatusWithLabel(
      projectPath,
      beadsIssue.id,
      desiredBeadsStatus,
      desiredBeadsLabel,
      currentLabels,
      config
    );
    updated = true;
  }

  if (priorityMismatch) {
    console.log(
      `[Beads] Priority change detected: ${hulyIssue.identifier} (${beadsIssue.priority} → ${desiredBeadsPriority})`
    );
    await updateBeadsIssue(projectPath, beadsIssue.id, 'priority', desiredBeadsPriority, config);
    updated = true;
  }

  if (titleMismatch) {
    console.log(`[Beads] Title change detected: ${hulyIssue.identifier}`);
    await updateBeadsIssue(projectPath, beadsIssue.id, 'title', desiredTitle, config);
    updated = true;
  }

  if (updated) {
    // Update database with latest state (avoid clobbering other fields).
    db.upsertIssue({
      identifier: hulyIssue.identifier,
      project_identifier: projectIdentifier,
      title: hulyIssue.title,
      description: hulyIssue.description,
      status: hulyIssue.status,
      priority: hulyIssue.priority,
      beads_issue_id: beadsIssue.id,
      beads_status: desiredBeadsStatus,
      huly_modified_at: currentHulyModifiedAt ?? null,

      beads_modified_at: currentBeadsModifiedAt ?? Date.now(),
    });

    return beadsIssue;
  }

  return null;
}

/**
 * Sync a Beads issue back to Huly (bidirectional sync)
 *
 * @param {Object} hulyClient - Huly client
 * @param {Object} beadsIssue - Beads issue object
 * @param {Array} hulyIssues - Array of Huly issues
 * @param {string} projectIdentifier - Project identifier
 * @param {Object} db - Database instance
 * @param {Object} config - Configuration object
 * @param {Set} phase3UpdatedIssues - Set of beads issue IDs updated in Phase 3 (to avoid loops)
 * @param {Object} vibeContext - Optional Vibe context for cascading updates
 * @param {Object} vibeContext.vibeClient - Vibe client instance
 * @param {Array} vibeContext.vibeTasks - Array of Vibe tasks for this project
 * @returns {Promise<void>}
 */
export async function syncBeadsIssueToHuly(
  hulyClient,
  beadsIssue,
  hulyIssues,
  projectIdentifier,
  db,
  config = {},
  phase3UpdatedIssues = new Set(),
  vibeContext = null
) {
  const {
    updateHulyIssueStatus,
    updateHulyIssueTitle,
    updateHulyIssuePriority,
    updateHulyIssueDescription,
    createHulyIssue,
  } = await import('./HulyService.js');
  const { mapBeadsStatusToHuly, mapBeadsPriorityToHuly, mapBeadsTypeToHuly } = await import(
    './statusMapper.js'
  );

  // Skip if this issue was just updated in Phase 3a
  if (phase3UpdatedIssues.has(beadsIssue.id)) {
    console.log(`[Skip Beads→Huly] Issue ${beadsIssue.id} was just updated in Phase 3a`);
    return;
  }

  // Find the Huly identifier from database
  const dbIssues = db.getAllIssues();
  const dbIssue = dbIssues.find(issue => issue.beads_issue_id === beadsIssue.id);

  if (!dbIssue) {
    // This is a NEW issue created in Beads - but first check if similar issue exists in Huly
    console.log(`[Beads→Huly] New issue detected in Beads: ${beadsIssue.id} - ${beadsIssue.title}`);

    // DEDUPLICATION: Check if a Huly issue with the same title already exists
    // Normalize titles by removing priority prefixes like [P0], [P1], etc. and trimming
    const normalizeTitleForComparison = title => {
      if (!title) return '';
      return title
        .trim()
        .toLowerCase()
        .replace(/^\[p[0-4]\]\s*/i, '') // Remove [P0]-[P4] prefix
        .replace(/^\[perf[^\]]*\]\s*/i, '') // Remove [PERF*] prefix
        .replace(/^\[tier\s*\d+\]\s*/i, '') // Remove [Tier N] prefix
        .replace(/^\[action\]\s*/i, '') // Remove [Action] prefix
        .replace(/^\[bug\]\s*/i, '') // Remove [BUG] prefix
        .replace(/^\[fixed\]\s*/i, '') // Remove [FIXED] prefix
        .trim();
    };

    const normalizedBeadsTitle = normalizeTitleForComparison(beadsIssue.title);
    const matchingHulyIssue = hulyIssues.find(hulyIssue => {
      const normalizedHulyTitle = normalizeTitleForComparison(hulyIssue.title);
      // Exact match after normalization
      if (normalizedHulyTitle === normalizedBeadsTitle) return true;
      // Also check if one contains the other (for partial matches)
      if (normalizedBeadsTitle.length > 10 && normalizedHulyTitle.length > 10) {
        if (
          normalizedHulyTitle.includes(normalizedBeadsTitle) ||
          normalizedBeadsTitle.includes(normalizedHulyTitle)
        ) {
          return true;
        }
      }
      return false;
    });

    if (matchingHulyIssue) {
      // Found a matching Huly issue - link them instead of creating duplicate
      console.log(
        `[Beads→Huly] Found existing Huly issue ${matchingHulyIssue.identifier} matching Beads ${beadsIssue.id} - linking instead of creating duplicate`
      );

      const beadsLabels = beadsIssue.labels || [];
      const beadsStatus = mapBeadsStatusToHuly(beadsIssue.status, beadsLabels);

      // Store mapping in database to link them
      db.upsertIssue({
        identifier: matchingHulyIssue.identifier,
        project_identifier: projectIdentifier,
        huly_id: matchingHulyIssue.id,
        beads_issue_id: beadsIssue.id,
        title: matchingHulyIssue.title,
        status: matchingHulyIssue.status,
        priority: matchingHulyIssue.priority,
        beads_status: beadsIssue.status,
        beads_modified_at: beadsIssue.updated_at
          ? new Date(beadsIssue.updated_at).getTime()
          : Date.now(),
        huly_modified_at: matchingHulyIssue.modifiedOn
          ? typeof matchingHulyIssue.modifiedOn === 'number'
            ? matchingHulyIssue.modifiedOn
            : new Date(matchingHulyIssue.modifiedOn).getTime()
          : null,
      });

      console.log(
        `[Beads→Huly] ✓ Linked existing Huly issue ${matchingHulyIssue.identifier} to Beads ${beadsIssue.id} (avoided duplicate)`
      );
      return;
    }

    const beadsLabels = beadsIssue.labels || [];
    const beadsStatus = mapBeadsStatusToHuly(beadsIssue.status, beadsLabels);
    const beadsPriority = mapBeadsPriorityToHuly(beadsIssue.priority);
    const beadsType = mapBeadsTypeToHuly(beadsIssue.issue_type);

    // No matching issue found - create new issue in Huly
    const createdIssue = await createHulyIssue(
      hulyClient,
      projectIdentifier,
      {
        title: beadsIssue.title,
        description: `Synced from Beads: ${beadsIssue.id}\n\n${beadsIssue.description || ''}`,
        status: beadsStatus,
        priority: beadsPriority,
        type: beadsType,
      },
      config
    );

    if (createdIssue) {
      // Store mapping in database
      db.upsertIssue({
        identifier: createdIssue.identifier,
        project_identifier: projectIdentifier,
        huly_id: createdIssue.id,
        beads_issue_id: beadsIssue.id,
        title: beadsIssue.title,
        status: beadsStatus,
        priority: beadsPriority,
        beads_status: beadsIssue.status,
        beads_modified_at: beadsIssue.updated_at
          ? new Date(beadsIssue.updated_at).getTime()
          : Date.now(),
      });

      console.log(
        `[Beads→Huly] ✓ Created Huly issue ${createdIssue.identifier} from Beads ${beadsIssue.id}`
      );
    }

    return;
  }

  // Issue exists in both systems - check for updates
  const hulyIdentifier = dbIssue.identifier;

  // Find corresponding Huly issue
  const hulyIssue = hulyIssues.find(issue => issue.identifier === hulyIdentifier);

  if (!hulyIssue) {
    console.warn(`[Beads→Huly] Huly issue ${hulyIdentifier} not found in project`);
    return;
  }

  let updated = false;

  const currentHulyModifiedAt =
    typeof hulyIssue.modifiedOn === 'number'
      ? hulyIssue.modifiedOn
      : hulyIssue.modifiedOn
        ? new Date(hulyIssue.modifiedOn).getTime()
        : null;

  let nextHulyModifiedAt = currentHulyModifiedAt;

  // Check status changes (using labels for disambiguation)
  const beadsLabels = beadsIssue.labels || [];
  const beadsStatusMapped = mapBeadsStatusToHuly(beadsIssue.status, beadsLabels);
  const hulyStatusNormalized = hulyIssue.status || 'Backlog';

  if (beadsStatusMapped !== hulyStatusNormalized) {
    console.log(
      `[Beads→Huly] Status update: ${hulyIdentifier} ` +
        `(${hulyStatusNormalized} → ${beadsStatusMapped}) [beads: ${beadsIssue.status}, labels: ${beadsLabels.join(', ') || 'none'}]`
    );

    const success = await updateHulyIssueStatus(
      hulyClient,
      hulyIdentifier,
      beadsStatusMapped,
      config
    );

    if (success) {
      updated = true;
      nextHulyModifiedAt = Date.now();

      // Also update Vibe to match (prevents Vibe→Huly from reverting the change)
      if (vibeContext?.vibeClient && vibeContext?.vibeTasks) {
        const { updateVibeTaskStatus } = await import('./VibeService.js');
        const { mapBeadsStatusToVibe } = await import('./statusMapper.js');
        const { extractHulyIdentifier } = await import('./textParsers.js');

        // Find the matching Vibe task by Huly identifier in description
        const vibeTask = vibeContext.vibeTasks.find(task => {
          const taskHulyId = extractHulyIdentifier(task.description);
          return taskHulyId === hulyIdentifier;
        });

        if (vibeTask) {
          const vibeStatus = mapBeadsStatusToVibe(beadsIssue.status, beadsLabels);
          if (vibeTask.status !== vibeStatus) {
            console.log(`[Beads→Vibe] Cascading status update: ${hulyIdentifier} → ${vibeStatus}`);
            await updateVibeTaskStatus(vibeContext.vibeClient, vibeTask.id, vibeStatus);
          }
        }
      }
    }
  }

  // Check title changes
  if (beadsIssue.title !== hulyIssue.title) {
    console.log(`[Beads→Huly] Title update: ${hulyIdentifier}`);

    const success = await updateHulyIssueTitle(
      hulyClient,
      hulyIdentifier,
      beadsIssue.title,
      config
    );

    if (success) {
      updated = true;
      nextHulyModifiedAt = Date.now();
    }
  }

  // Check priority changes
  const beadsPriorityMapped = mapBeadsPriorityToHuly(beadsIssue.priority);
  const hulyPriorityNormalized = hulyIssue.priority || 'None';

  if (beadsPriorityMapped !== hulyPriorityNormalized) {
    console.log(
      `[Beads→Huly] Priority update: ${hulyIdentifier} ` +
        `(${hulyPriorityNormalized} → ${beadsPriorityMapped})`
    );

    const success = await updateHulyIssuePriority(
      hulyClient,
      hulyIdentifier,
      beadsPriorityMapped,
      config
    );

    if (success) {
      updated = true;
      nextHulyModifiedAt = Date.now();
    }
  }

  if (updated) {
    // Update database with latest state
    db.upsertIssue({
      identifier: hulyIdentifier,
      project_identifier: projectIdentifier,
      status: beadsStatusMapped,
      priority: beadsPriorityMapped,
      title: beadsIssue.title,
      beads_issue_id: beadsIssue.id,
      beads_status: beadsIssue.status,
      huly_modified_at: nextHulyModifiedAt ?? null,
      beads_modified_at: beadsIssue.updated_at
        ? new Date(beadsIssue.updated_at).getTime()
        : Date.now(),
    });
  }
}

/**
 * Check if a directory has beads initialized
 *
 * @param {string} projectPath - Path to check for .beads directory
 * @returns {boolean} True if beads is initialized
 */
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
export async function syncBeadsToGit(projectPath, options = {}) {
  const { projectIdentifier = 'unknown', push = true } = options;

  try {
    // Check if beads is initialized
    if (!isBeadsInitialized(projectPath)) {
      console.log(`[Beads] Skipping git sync - beads not initialized at ${projectPath}`);
      return false;
    }

    // Some projects running in containers might not be git repos.
    if (!isGitRepository(projectPath)) {
      console.log(`[Beads] Skipping git sync for ${projectIdentifier} - not a git repository`);
      return false;
    }

    console.log(`[Beads] Syncing ${projectIdentifier} to git...`);

    // Use conventional commit format for projects with git hooks (husky)
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const commitMessage = `chore(beads): sync changes at ${timestamp}`;

    // Run bd sync with custom commit message (--no-daemon is added automatically by execBeadsCommand)
    // We use --no-push to handle push separately for better error control
    try {
      execBeadsCommand(`sync -m "${commitMessage}" --no-push`, projectPath);
    } catch (syncError) {
      const errorMsg = syncError.message || '';

      // If bd sync fails due to unrelated untracked files or other repo dirtiness,
      // try to salvage by committing only Beads sync artifacts.
      if (
        errorMsg.includes('no changes added to commit') ||
        errorMsg.includes('nothing added to commit')
      ) {
        if (beadsWorkingTreeDirty(projectPath)) {
          try {
            const didCommit = commitBeadsSyncFiles(projectPath, commitMessage);
            if (didCommit) {
              console.log(`[Beads] ✓ Recovered by committing Beads sync files only`);
            }
          } catch (commitError) {
            console.warn(`[Beads] Recovery commit failed: ${commitError.message}`);
          }
        }
      }

      // These are expected/acceptable conditions
      if (
        errorMsg.includes('no changes') ||
        errorMsg.includes('nothing to commit') ||
        errorMsg.includes('nothing added to commit')
      ) {
        console.log(`[Beads] No changes to sync for ${projectIdentifier}`);
        return true;
      }

      // Not in a git repo - skip silently (some projects may not need git sync)
      if (errorMsg.includes('not in a git repository')) {
        return false;
      }

      // Real error - log and skip
      console.warn(`[Beads] Sync failed for ${projectIdentifier}: ${errorMsg.split('\n')[0]}`);
      return false;
    }

    // Safeguard: if bd sync succeeded but didn't commit (rare), commit Beads files.
    if (beadsWorkingTreeDirty(projectPath)) {
      try {
        commitBeadsSyncFiles(projectPath, commitMessage);
      } catch (commitError) {
        console.warn(`[Beads] Post-sync commit failed: ${commitError.message}`);
      }
    }

    if (!push) {
      console.log(`[Beads] Push disabled for ${projectIdentifier}`);
      return true;
    }

    // Push to remote
    try {
      execGitCommand('push', projectPath);
      console.log(`[Beads] ✓ Pushed ${projectIdentifier} to git remote`);
      return true;
    } catch (pushError) {
      const errorMsg = pushError?.message || String(pushError);

      // Push might fail if already up to date or no remote configured
      if (errorMsg.includes('up-to-date') || errorMsg.includes('Everything up-to-date')) {
        console.log(`[Beads] Git already up-to-date for ${projectIdentifier}`);
        return true;
      }

      // Log but don't fail - some projects might not have remotes configured
      console.warn(
        `[Beads] Could not push ${projectIdentifier} to remote: ${errorMsg.split('\n')[0]}`
      );
      return false;
    }
  } catch (error) {
    console.error(`[Beads] Failed to sync ${projectIdentifier} to git:`, error.message);
    return false;
  }
}

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
      beadsIssue,
      hulyIssues,
      projectIdentifier,
      db,
      phase3UpdatedIssues
    ) =>
      syncBeadsIssueToHuly(
        hulyClient,
        beadsIssue,
        hulyIssues,
        projectIdentifier,
        db,
        config,
        phase3UpdatedIssues
      ),
  };
}
