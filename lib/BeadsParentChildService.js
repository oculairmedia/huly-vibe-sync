/**
 * Beads Parent-Child Service
 *
 * Handles parent-child (sub-issue) relationships between Beads and Huly.
 * This module provides functions for:
 * - Managing dependencies in Beads
 * - Syncing parent-child relationships bidirectionally
 * - Creating sub-issues in Huly from Beads dependencies
 *
 * @module BeadsParentChildService
 */

// Import the Beads command executor from BeadsService
import { execBeadsCommand } from './BeadsService.js';

/**
 * Delay execution for throttling
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Get throttle delay from config
 * @param {Object} config - Configuration object
 * @returns {number} Delay in milliseconds
 */
const getOperationDelay = config => config?.beads?.operationDelay ?? 50;

/**
 * Parent-child relationship result
 * @typedef {Object} ParentChildResult
 * @property {string} childId - Child issue identifier
 * @property {string} parentId - Parent issue identifier
 * @property {string} source - Source system ('beads' or 'huly')
 * @property {boolean} success - Whether the operation succeeded
 * @property {string} [error] - Error message if failed
 */

/**
 * Batch sync result
 * @typedef {Object} BatchParentChildResult
 * @property {number} synced - Number of relationships synced
 * @property {number} skipped - Number of relationships skipped
 * @property {Array<string>} errors - Error messages
 */

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
    if (error.message?.includes('already exists') || error.message?.includes('duplicate') || error.message?.includes('UNIQUE constraint')) {
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
 * Safe wrapper for getDependencyTree that handles errors silently
 *
 * @param {string} projectPath - Path to the project
 * @param {string} issueId - Issue ID to get tree for
 * @returns {Promise<Object|null>} Dependency tree or null on error
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
          parentId: node.id, // What it depends on
          type: 'parent-child',
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
 * Get the parent Beads issue ID for a given issue (if it has a parent-child dependency)
 *
 * @param {string} projectPath - Path to the project
 * @param {string} issueId - Issue ID to check
 * @returns {Promise<string|null>} Parent Beads issue ID or null if no parent
 */
export async function getBeadsParentId(projectPath, issueId) {
  try {
    const command = `dep tree ${issueId} --json`;
    const output = execBeadsCommand(command, projectPath);
    const tree = JSON.parse(output);

    // In the tree, depth=0 is the issue itself, depth=1 are its dependencies
    // A parent-child relationship means the issue depends on its parent
    for (const node of tree) {
      if (node.depth === 1 && node.id !== issueId) {
        // This is a direct dependency - could be the parent
        return node.id;
      }
    }

    return null;
  } catch (error) {
    // No dependencies or error fetching - return null
    return null;
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
            console.log(
              `[Beads→Huly] Skipping relationship - issues not synced yet (child: ${rel.childId}, parent: ${rel.parentId})`,
            );
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

    console.log(
      `[Beads→Huly] Parent-child sync complete: ${results.synced} synced, ${results.skipped} skipped, ${results.errors.length} errors`,
    );
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
        beads_modified_at: beadsIssue.updated_at ? new Date(beadsIssue.updated_at).getTime() : Date.now(),
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
  const opDelay = getOperationDelay(config);

  // Find issues that have dependencies (dependency_count > 0)
  const issuesWithDeps = beadsIssues.filter(i => i.dependency_count > 0);

  for (const childIssue of issuesWithDeps) {
    try {
      // Get the dependency tree for this issue
      const tree = await getDependencyTreeSafe(projectPath, childIssue.id);

      if (!tree || tree.length <= 1) continue;

      // Throttle after CLI call for dependency tree
      if (opDelay > 0) await delay(opDelay);

      // Find parent-child type dependencies
      // The tree shows what this issue depends on
      for (const node of tree) {
        if (node.depth === 1) {
          // Direct dependency - check if it's a parent-child relationship
          const parentIssue = beadsIssues.find(i => i.id === node.id);
          if (parentIssue) {
            const success = await syncParentChildToHuly(hulyClient, projectPath, childIssue, parentIssue, db, config);
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

// ============================================================
// Batch Operations
// ============================================================

/**
 * Get all parent-child relationships for a project
 *
 * @param {string} projectPath - Path to the project
 * @param {Array<Object>} beadsIssues - Array of Beads issues
 * @returns {Promise<Array<ParentChildResult>>} Array of parent-child relationships
 */
export async function getAllParentChildRelationships(projectPath, beadsIssues) {
  const relationships = [];

  for (const issue of beadsIssues) {
    if (issue.dependency_count > 0) {
      try {
        const parentId = await getBeadsParentId(projectPath, issue.id);
        if (parentId) {
          relationships.push({
            childId: issue.id,
            parentId,
            source: 'beads',
            success: true,
          });
        }
      } catch (error) {
        relationships.push({
          childId: issue.id,
          parentId: null,
          source: 'beads',
          success: false,
          error: error.message,
        });
      }
    }
  }

  return relationships;
}

/**
 * Validate parent-child relationship consistency between Beads and Huly
 *
 * @param {Object} db - Database instance
 * @param {string} projectIdentifier - Project identifier
 * @returns {Object} Validation result with mismatches
 */
export function validateParentChildConsistency(db, projectIdentifier) {
  const issues = db.getProjectIssues ? db.getProjectIssues(projectIdentifier) : db.getAllIssues();

  const mismatches = [];
  const orphans = [];

  for (const issue of issues) {
    // Check if issue has parent in one system but not the other
    if (issue.parent_huly_id && !issue.parent_beads_id) {
      mismatches.push({
        identifier: issue.identifier,
        type: 'huly_only_parent',
        parent_huly_id: issue.parent_huly_id,
      });
    }

    if (issue.parent_beads_id && !issue.parent_huly_id) {
      mismatches.push({
        identifier: issue.identifier,
        type: 'beads_only_parent',
        parent_beads_id: issue.parent_beads_id,
      });
    }

    // Check for orphaned children (parent doesn't exist in DB)
    if (issue.parent_huly_id) {
      const parent = issues.find(i => i.identifier === issue.parent_huly_id);
      if (!parent) {
        orphans.push({
          identifier: issue.identifier,
          parent_huly_id: issue.parent_huly_id,
        });
      }
    }
  }

  return {
    valid: mismatches.length === 0 && orphans.length === 0,
    mismatches,
    orphans,
    totalIssues: issues.length,
    issuesWithParent: issues.filter(i => i.parent_huly_id || i.parent_beads_id).length,
  };
}

/**
 * Batch create parent-child dependencies in Beads
 *
 * @param {string} projectPath - Path to the project
 * @param {Array<{childId: string, parentId: string}>} relationships - Relationships to create
 * @param {Object} db - Database instance
 * @param {Object} config - Configuration object
 * @returns {Promise<BatchParentChildResult>} Batch result
 */
export async function batchCreateDependencies(projectPath, relationships, db, config = {}) {
  const result = {
    synced: 0,
    skipped: 0,
    errors: [],
  };

  const opDelay = getOperationDelay(config);

  for (const { childId, parentId } of relationships) {
    try {
      const success = await addParentChildDependency(projectPath, childId, parentId, config);
      if (success) {
        result.synced++;
        // Throttle after successful CLI operations
        if (opDelay > 0) await delay(opDelay);
      } else {
        result.skipped++;
      }
    } catch (error) {
      result.errors.push(`${childId} -> ${parentId}: ${error.message}`);
    }
  }

  return result;
}

/**
 * Batch remove parent-child dependencies in Beads
 *
 * @param {string} projectPath - Path to the project
 * @param {Array<{childId: string, parentId: string}>} relationships - Relationships to remove
 * @param {Object} config - Configuration object
 * @returns {Promise<BatchParentChildResult>} Batch result
 */
export async function batchRemoveDependencies(projectPath, relationships, config = {}) {
  const result = {
    synced: 0,
    skipped: 0,
    errors: [],
  };

  const opDelay = getOperationDelay(config);

  for (const { childId, parentId } of relationships) {
    try {
      const success = await removeParentChildDependency(projectPath, childId, parentId, config);
      if (success) {
        result.synced++;
        // Throttle after successful CLI operations
        if (opDelay > 0) await delay(opDelay);
      } else {
        result.skipped++;
      }
    } catch (error) {
      result.errors.push(`${childId} -> ${parentId}: ${error.message}`);
    }
  }

  return result;
}

/**
 * Sync all parent-child relationships from Huly to Beads
 *
 * @param {string} projectPath - Path to the project
 * @param {Array<Object>} hulyIssues - Huly issues with parent info
 * @param {Object} db - Database instance
 * @param {Object} config - Configuration object
 * @returns {Promise<BatchParentChildResult>} Batch result
 */
export async function syncAllParentChildFromHuly(projectPath, hulyIssues, db, config = {}) {
  const result = {
    synced: 0,
    skipped: 0,
    errors: [],
  };

  const opDelay = getOperationDelay(config);

  // Find issues with parent relationships
  const issuesWithParent = hulyIssues.filter(i => i.parent);

  for (const issue of issuesWithParent) {
    try {
      // Get the Beads IDs from database
      const childDbIssue = db.getIssue(issue.identifier);
      const parentDbIssue = db.getIssue(issue.parent);

      if (!childDbIssue?.beads_issue_id || !parentDbIssue?.beads_issue_id) {
        result.skipped++;
        continue;
      }

      const success = await syncParentChildToBeads(
        projectPath,
        childDbIssue.beads_issue_id,
        parentDbIssue.beads_issue_id,
        db,
        config,
      );

      if (success) {
        result.synced++;
        // Throttle after successful CLI operations
        if (opDelay > 0) await delay(opDelay);
      } else {
        result.skipped++;
      }
    } catch (error) {
      result.errors.push(`${issue.identifier}: ${error.message}`);
    }
  }

  return result;
}
