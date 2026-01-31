/**
 * Beads Sync Service
 *
 * Handles bidirectional synchronization between Beads and Huly issue trackers.
 * This module provides sync operations for:
 * - Huly → Beads: Sync Huly issues to Beads
 * - Beads → Huly: Sync Beads issues back to Huly
 * - Git: Commit and push Beads changes
 *
 * @module BeadsSyncService
 */

// Per-project mutexes to prevent concurrent issue creation
const projectMutexes = new Map();

/**
 * Acquire a mutex for a project to prevent concurrent issue creation
 * @param {string} projectPath - Path to the project
 * @returns {Promise<Function>} Release function to call when done
 */
async function acquireProjectMutex(projectPath) {
  if (!projectMutexes.has(projectPath)) {
    projectMutexes.set(projectPath, { locked: false, queue: [] });
  }

  const mutex = projectMutexes.get(projectPath);

  if (!mutex.locked) {
    mutex.locked = true;
    return () => {
      mutex.locked = false;
      if (mutex.queue.length > 0) {
        const next = mutex.queue.shift();
        next();
      }
    };
  }

  // Wait for lock to be released
  return new Promise(resolve => {
    mutex.queue.push(() => {
      mutex.locked = true;
      resolve(() => {
        mutex.locked = false;
        if (mutex.queue.length > 0) {
          const next = mutex.queue.shift();
          next();
        }
      });
    });
  });
}

// Import dependencies from BeadsService
import {
  createBeadsIssue,
  updateBeadsIssue,
  updateBeadsIssueStatusWithLabel,
  isBeadsInitialized,
  isGitRepository,
  execBeadsCommand,
  execGitCommand,
  beadsWorkingTreeDirty,
  commitBeadsSyncFiles,
} from './BeadsService.js';

import {
  syncParentChildToBeads,
  addParentChildDependency,
  removeParentChildDependency,
  getBeadsParentId,
} from './BeadsService.js';

import { findHulyIdentifier, buildIssueLookups, getParentIdFromLookup } from './BeadsDBReader.js';
import fs from 'fs';
import path from 'path';

function isValidProjectPath(projectPath) {
  if (!projectPath || typeof projectPath !== 'string') {
    return false;
  }

  if (!path.isAbsolute(projectPath)) {
    return false;
  }

  return fs.existsSync(projectPath);
}

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
const getBatchDelay = config => config?.beads?.batchDelay ?? 200;

/**
 * Sync configuration options
 * @typedef {Object} SyncConfig
 * @property {Object} [sync] - Sync settings
 * @property {boolean} [sync.dryRun] - If true, log actions without executing
 * @property {Object} [sync.beads] - Beads-specific settings
 * @property {boolean} [sync.beads.enabled] - Whether Beads sync is enabled
 */

/**
 * Sync result for batch operations
 * @typedef {Object} SyncResult
 * @property {number} synced - Number of items successfully synced
 * @property {number} skipped - Number of items skipped
 * @property {number} errors - Number of items that failed
 * @property {Array<string>} errorMessages - Error messages for failed items
 */

/**
 * Normalize title for deduplication comparison
 * Removes priority prefixes and normalizes case
 *
 * @param {string} title - Title to normalize
 * @returns {string} Normalized title
 */
function normalizeTitleForComparison(title) {
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
}

/**
 * Find matching issue by normalized title
 *
 * @param {Array<Object>} issues - Issues to search
 * @param {string} targetTitle - Title to match
 * @param {Function} getTitleFn - Function to extract title from issue
 * @returns {Object|null} Matching issue or null
 */
function findMatchingIssueByTitle(issues, targetTitle, getTitleFn = i => i.title) {
  const normalizedTarget = normalizeTitleForComparison(targetTitle);

  return issues.find(issue => {
    const normalizedTitle = normalizeTitleForComparison(getTitleFn(issue));
    // Exact match after normalization
    if (normalizedTitle === normalizedTarget) return true;
    // Also check if one contains the other (for partial matches)
    if (normalizedTarget.length > 10 && normalizedTitle.length > 10) {
      if (
        normalizedTitle.includes(normalizedTarget) ||
        normalizedTarget.includes(normalizedTitle)
      ) {
        return true;
      }
    }
    return false;
  });
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
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for sync: ${projectPath}`);
    return null;
  }

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
    let matchingBeadsIssue = null;
    const lookups = config.lookups;

    if (lookups) {
      matchingBeadsIssue = lookups.byHulyId.get(hulyIssue.identifier);
      if (matchingBeadsIssue) {
        console.log(
          `[Huly→Beads] Found existing Beads issue ${matchingBeadsIssue.id} linked to Huly ${hulyIssue.identifier}`
        );
      }

      if (!matchingBeadsIssue) {
        const normalizedTitle = normalizeTitleForComparison(hulyIssue.title);
        matchingBeadsIssue = lookups.byTitle.get(normalizedTitle);
        if (matchingBeadsIssue) {
          console.log(
            `[Huly→Beads] Found existing Beads issue ${matchingBeadsIssue.id} matching title "${hulyIssue.title}"`
          );
        }
      }
    } else {
      matchingBeadsIssue = findMatchingIssueByTitle(beadsIssues, hulyIssue.title);

      if (!matchingBeadsIssue) {
        matchingBeadsIssue = beadsIssues.find(issue => {
          const hulyId = findHulyIdentifier(issue);
          return hulyId === hulyIssue.identifier;
        });
        if (matchingBeadsIssue) {
          console.log(
            `[Huly→Beads] Found Beads issue ${matchingBeadsIssue.id} with Huly identifier ${hulyIssue.identifier}`
          );
        }
      }
    }

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
          console.log(
            `[Beads] Parent ${hulyIssue.parentIssue.identifier} not yet synced, will sync dependency later`
          );
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

  // Reparenting detection: check if parent changed in Huly
  const storedParentHulyId = dbIssue?.parent_huly_id || null;
  const currentParentHulyId = hulyIssue.parentIssue?.identifier || null;

  if (storedParentHulyId !== currentParentHulyId) {
    console.log(
      `[Beads] Reparenting detected: ${hulyIssue.identifier} (${storedParentHulyId || 'top-level'} → ${currentParentHulyId || 'top-level'})`
    );

    // Remove old parent-child dependency if there was one
    if (storedParentHulyId) {
      const oldParentDbIssue = db.getIssue(storedParentHulyId);
      if (oldParentDbIssue?.beads_issue_id) {
        await removeParentChildDependency(
          projectPath,
          beadsIssue.id,
          oldParentDbIssue.beads_issue_id,
          config
        );
        console.log(
          `[Beads] ✓ Removed old parent dependency: ${beadsIssue.id} -> ${oldParentDbIssue.beads_issue_id}`
        );
      }
    }

    // Add new parent-child dependency if there is one
    if (currentParentHulyId) {
      const newParentDbIssue = db.getIssue(currentParentHulyId);
      if (newParentDbIssue?.beads_issue_id) {
        await addParentChildDependency(
          projectPath,
          beadsIssue.id,
          newParentDbIssue.beads_issue_id,
          config
        );
        console.log(
          `[Beads] ✓ Added new parent dependency: ${beadsIssue.id} -> ${newParentDbIssue.beads_issue_id}`
        );

        // Update database with new parent relationship
        db.updateParentChild(
          hulyIssue.identifier,
          currentParentHulyId,
          newParentDbIssue.beads_issue_id
        );
      } else {
        console.log(`[Beads] New parent ${currentParentHulyId} not yet synced to Beads`);
        // Still update the Huly parent ID in database
        db.updateParentChild(hulyIssue.identifier, currentParentHulyId, null);
      }
    } else {
      // Issue moved to top-level (no parent)
      db.updateParentChild(hulyIssue.identifier, null, null);
    }

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
 * @param {string} projectPath - Path to the project with Beads
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
  projectPath,
  beadsIssue,
  hulyIssues,
  projectIdentifier,
  db,
  config = {},
  phase3UpdatedIssues = new Set(),
  vibeContext = null
) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for sync: ${projectPath}`);
    return;
  }

  const { updateHulyIssueStatus, updateHulyIssueTitle, updateHulyIssuePriority, createHulyIssue } =
    await import('./HulyService.js');
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

  if (dbIssue?.deleted_from_huly) {
    return;
  }

  if (!dbIssue) {
    // This is a NEW issue created in Beads - check if similar issue exists in Huly
    console.log(`[Beads→Huly] New issue detected in Beads: ${beadsIssue.id} - ${beadsIssue.title}`);

    // DEDUPLICATION: Check if a Huly issue with the same title already exists
    let matchingHulyIssue = findMatchingIssueByTitle(hulyIssues, beadsIssue.title);

    // Also check if any Huly issue was synced from this Beads ID (check description)
    if (!matchingHulyIssue) {
      matchingHulyIssue = hulyIssues.find(issue => {
        const desc = issue.description || '';
        return desc.includes(`Synced from Beads: ${beadsIssue.id}`);
      });
      if (matchingHulyIssue) {
        console.log(
          `[Beads→Huly] Found Huly issue ${matchingHulyIssue.identifier} with Beads ID ${beadsIssue.id} in description`
        );
      }
    }

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

  // Find corresponding Huly issue in cached array first
  let hulyIssue = hulyIssues.find(issue => issue.identifier === hulyIdentifier);

  // If not found in cached array (e.g., due to incremental sync), fetch it directly
  if (!hulyIssue) {
    console.log(`[Beads→Huly] Issue ${hulyIdentifier} not in cache, fetching from Huly API...`);
    try {
      hulyIssue = await hulyClient.getIssue(hulyIdentifier);
      if (!hulyIssue) {
        console.warn(
          `[Beads→Huly] Huly issue ${hulyIdentifier} deleted - marking to skip future syncs`
        );
        db.markDeletedFromHuly(hulyIdentifier);
        return;
      }
    } catch (error) {
      console.warn(
        `[Beads→Huly] Huly issue ${hulyIdentifier} not found - marking to skip future syncs`
      );
      db.markDeletedFromHuly(hulyIdentifier);
      return;
    }
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

  // Reparenting detection: check if parent changed in Beads
  const storedParentBeadsId = dbIssue?.parent_beads_id || null;
  // Use cached parentMap if available (O(1)), otherwise fall back to CLI call (O(n) spawn)
  const currentParentBeadsId = config.parentMap
    ? getParentIdFromLookup(config.parentMap, beadsIssue.id)
    : await getBeadsParentId(projectPath, beadsIssue.id);

  if (storedParentBeadsId !== currentParentBeadsId) {
    console.log(
      `[Beads→Huly] Reparenting detected: ${hulyIdentifier} (beads parent: ${storedParentBeadsId || 'none'} → ${currentParentBeadsId || 'none'})`
    );

    // Find the new parent's Huly identifier
    let newParentHulyId = null;
    if (currentParentBeadsId) {
      const parentDbIssue = dbIssues.find(i => i.beads_issue_id === currentParentBeadsId);
      if (parentDbIssue) {
        newParentHulyId = parentDbIssue.identifier;
      } else {
        console.log(`[Beads→Huly] New parent ${currentParentBeadsId} not yet synced to Huly`);
      }
    }

    // Update the database with the new parent relationship
    // Note: Actually moving the issue in Huly requires API support for reparenting
    // which may not be available. For now, we track the relationship in the database.
    const storedParentHulyId = dbIssue?.parent_huly_id || null;

    if (newParentHulyId !== storedParentHulyId) {
      console.log(
        `[Beads→Huly] Tracking reparent: ${hulyIdentifier} parent ${storedParentHulyId || 'none'} → ${newParentHulyId || 'none'}`
      );

      // Update database with new parent relationship
      db.updateParentChild(hulyIdentifier, newParentHulyId, currentParentBeadsId);

      // TODO: When Huly API supports reparenting, add:
      // await hulyClient.moveIssue(hulyIdentifier, newParentHulyId);

      updated = true;
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
 * Sync beads changes to git and push to remote
 * Runs: bd sync && git push
 *
 * @param {string} projectPath - Path to project directory
 * @param {Object} options - Sync options
 * @param {string} [options.projectIdentifier] - Project identifier for logging
 * @param {boolean} [options.push] - Whether to push after sync
 * @returns {Promise<boolean>} True if sync and push succeeded
 */
export async function syncBeadsToGit(projectPath, options = {}) {
  if (!isValidProjectPath(projectPath)) {
    console.log(`[Beads] Invalid project path for git sync: ${projectPath}`);
    return false;
  }

  const { projectIdentifier = 'unknown', push = true } = options;

  try {
    // Check if beads is initialized
    if (!isBeadsInitialized(projectPath)) {
      console.log(`[Beads] Skipping git sync - beads not initialized at ${projectPath}`);
      return false;
    }

    // Some projects running in containers might not be git repos.
    if (!(await isGitRepository(projectPath))) {
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
      await execBeadsCommand(`sync -m "${commitMessage}" --no-push`, projectPath);
    } catch (syncError) {
      const errorMsg = syncError.message || '';

      // If bd sync fails due to unrelated untracked files or other repo dirtiness,
      // try to salvage by committing only Beads sync artifacts.
      if (
        errorMsg.includes('no changes added to commit') ||
        errorMsg.includes('nothing added to commit')
      ) {
        if (await beadsWorkingTreeDirty(projectPath)) {
          try {
            const didCommit = await commitBeadsSyncFiles(projectPath, commitMessage);
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
    if (await beadsWorkingTreeDirty(projectPath)) {
      try {
        await commitBeadsSyncFiles(projectPath, commitMessage);
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
      await execGitCommand('push', projectPath);
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

// ============================================================
// Batch Operations
// ============================================================

/**
 * Batch sync Huly issues to Beads
 *
 * @param {string} projectPath - Path to the project
 * @param {Array<Object>} hulyIssues - Array of Huly issues to sync
 * @param {Array<Object>} beadsIssues - Existing Beads issues
 * @param {Object} db - Database instance
 * @param {SyncConfig} config - Sync configuration
 * @returns {Promise<SyncResult>} Sync result summary
 */
export async function batchSyncHulyToBeads(projectPath, hulyIssues, beadsIssues, db, config = {}) {
  const result = {
    synced: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
  };

  const lookups = buildIssueLookups(beadsIssues);
  const configWithLookups = { ...config, lookups };

  const opDelay = getOperationDelay(config);

  for (const hulyIssue of hulyIssues) {
    try {
      const synced = await syncHulyIssueToBeads(
        projectPath,
        hulyIssue,
        beadsIssues,
        db,
        configWithLookups
      );
      if (synced) {
        result.synced++;
        if (opDelay > 0) await delay(opDelay);
      } else {
        result.skipped++;
      }
    } catch (error) {
      result.errors++;
      result.errorMessages.push(`${hulyIssue.identifier}: ${error.message}`);
    }
  }

  return result;
}

/**
 * Batch sync Beads issues to Huly
 *
 * @param {Object} hulyClient - Huly REST client
 * @param {string} projectPath - Path to the project
 * @param {Array<Object>} beadsIssues - Array of Beads issues to sync
 * @param {Array<Object>} hulyIssues - Existing Huly issues
 * @param {string} projectIdentifier - Project identifier
 * @param {Object} db - Database instance
 * @param {SyncConfig} config - Sync configuration
 * @param {Set<string>} phase3UpdatedIssues - Set of issue IDs updated in Phase 3
 * @returns {Promise<SyncResult>} Sync result summary
 */
export async function batchSyncBeadsToHuly(
  hulyClient,
  projectPath,
  beadsIssues,
  hulyIssues,
  projectIdentifier,
  db,
  config = {},
  phase3UpdatedIssues = new Set()
) {
  const result = {
    synced: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
  };

  const lookups = buildIssueLookups(beadsIssues);
  const configWithParentMap = { ...config, parentMap: lookups.parentMap };

  const opDelay = getOperationDelay(config);

  // PRE-FETCH: Identify and bulk-fetch issues that would cause cache misses
  const hulyIssueMap = new Map(hulyIssues.map(i => [i.identifier, i]));
  const dbIssues = db.getAllIssues();
  const beadsIdToDbIssue = new Map(
    dbIssues.filter(i => i.beads_issue_id).map(i => [i.beads_issue_id, i])
  );
  const missingIdentifiers = [];

  for (const beadsIssue of beadsIssues) {
    const dbIssue = beadsIdToDbIssue.get(beadsIssue.id);
    if (dbIssue && dbIssue.identifier && !hulyIssueMap.has(dbIssue.identifier)) {
      missingIdentifiers.push(dbIssue.identifier);
    }
  }

  console.log(
    `[Beads→Huly] Pre-fetch analysis: ${beadsIssues.length} beads issues, ${hulyIssues.length} cached huly issues, ${dbIssues.length} db issues, ${missingIdentifiers.length} missing`
  );

  if (missingIdentifiers.length > 0) {
    console.log(`[Beads→Huly] Pre-fetching ${missingIdentifiers.length} missing issues in bulk...`);
    try {
      // Batch in chunks of 50 to avoid URL length limits
      const BATCH_SIZE = 50;
      for (let i = 0; i < missingIdentifiers.length; i += BATCH_SIZE) {
        const batch = missingIdentifiers.slice(i, i + BATCH_SIZE);
        const fetched = await hulyClient.getIssuesBulk(batch);
        for (const issue of fetched) {
          hulyIssueMap.set(issue.identifier, issue);
          hulyIssues.push(issue); // Add to array so syncBeadsIssueToHuly finds it
        }
        console.log(
          `[Beads→Huly] Bulk fetched ${fetched.length}/${batch.length} issues (batch ${Math.floor(i / BATCH_SIZE) + 1})`
        );
      }
    } catch (error) {
      console.warn(
        `[Beads→Huly] Bulk pre-fetch failed, falling back to individual fetches: ${error.message}`
      );
    }
  }

  for (const beadsIssue of beadsIssues) {
    try {
      await syncBeadsIssueToHuly(
        hulyClient,
        projectPath,
        beadsIssue,
        hulyIssues,
        projectIdentifier,
        db,
        configWithParentMap,
        phase3UpdatedIssues
      );
      result.synced++;
      // Throttle between operations
      if (opDelay > 0) await delay(opDelay);
    } catch (error) {
      result.errors++;
      result.errorMessages.push(`${beadsIssue.id}: ${error.message}`);
    }
  }

  return result;
}

/**
 * Full bidirectional sync between Huly and Beads
 *
 * Performs sync in the following order:
 * 1. Huly → Beads: Sync Huly issues to Beads
 * 2. Beads → Huly: Sync Beads issues back to Huly
 * 3. Git: Commit and push Beads changes
 *
 * @param {Object} hulyClient - Huly REST client
 * @param {string} projectPath - Path to the project
 * @param {Array<Object>} hulyIssues - Huly issues
 * @param {Array<Object>} beadsIssues - Beads issues
 * @param {string} projectIdentifier - Project identifier
 * @param {Object} db - Database instance
 * @param {SyncConfig} config - Sync configuration
 * @returns {Promise<Object>} Combined sync results
 */
export async function fullBidirectionalSync(
  hulyClient,
  projectPath,
  hulyIssues,
  beadsIssues,
  projectIdentifier,
  db,
  config = {}
) {
  const results = {
    hulyToBeads: null,
    beadsToHuly: null,
    gitSync: false,
    timestamp: new Date().toISOString(),
  };

  // Phase 1: Huly → Beads
  console.log(`[Sync] Starting Huly → Beads sync for ${projectIdentifier}`);
  results.hulyToBeads = await batchSyncHulyToBeads(
    projectPath,
    hulyIssues,
    beadsIssues,
    db,
    config
  );

  // Phase 2: Beads → Huly
  console.log(`[Sync] Starting Beads → Huly sync for ${projectIdentifier}`);
  results.beadsToHuly = await batchSyncBeadsToHuly(
    hulyClient,
    projectPath,
    beadsIssues,
    hulyIssues,
    projectIdentifier,
    db,
    config
  );

  // Phase 3: Git sync
  if (!config.sync?.dryRun) {
    console.log(`[Sync] Syncing ${projectIdentifier} to Git`);
    results.gitSync = await syncBeadsToGit(projectPath, { projectIdentifier });
  }

  return results;
}
