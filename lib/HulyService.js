/**
 * Huly Service
 * 
 * Handles all Huly-specific operations including:
 * - Fetching projects and issues
 * - Updating issue status and descriptions
 * - Syncing changes back to Huly
 */

import { extractHulyIdentifier } from './textParsers.js';
import { mapVibeStatusToHuly, normalizeStatus } from './statusMapper.js';

/**
 * Fetch all projects from Huly
 * 
 * @param {Object} hulyClient - Huly REST API client
 * @param {Object} config - Configuration object
 * @returns {Promise<Array>} Array of Huly projects
 */
export async function fetchHulyProjects(hulyClient, config = {}) {
  console.log('\n[Huly] Fetching projects...');

  try {
    // Use the REST API's listProjects method
    const projects = await hulyClient.listProjects();

    console.log(`[Huly] Found ${projects.length} projects`);

    // Debug: show first project structure
    if (projects.length > 0 && config.sync?.dryRun) {
      console.log('[Huly] Sample project:', JSON.stringify(projects[0], null, 2));
    }

    return projects;
  } catch (error) {
    console.error('[Huly] Error fetching projects:', error.message);
    return [];
  }
}

/**
 * Fetch issues from a Huly project
 * 
 * @param {Object} hulyClient - Huly REST API client
 * @param {string} projectIdentifier - Project identifier (e.g., "PROJ")
 * @param {Object} config - Configuration object
 * @param {number} lastSyncTime - Timestamp for incremental sync (optional)
 * @returns {Promise<Array>} Array of Huly issues
 */
export async function fetchHulyIssues(hulyClient, projectIdentifier, config = {}, lastSyncTime = null) {
  const isIncremental = config.sync?.incremental && lastSyncTime;

  if (isIncremental) {
    console.log(`[Huly] Incremental fetch for ${projectIdentifier} (modified after ${new Date(lastSyncTime).toISOString()})`);
  } else {
    console.log(`[Huly] Full fetch for project ${projectIdentifier}...`);
  }

  try {
    // Use the REST API's listIssues method which returns all issues with full details in one call
    const options = {
      limit: 1000, // Fetch up to 1000 issues
    };

    // Add time filter for incremental sync
    if (isIncremental) {
      options.modifiedAfter = new Date(lastSyncTime).toISOString();
    }

    // The REST API returns complete issue data with descriptions in a single call!
    const issues = await hulyClient.listIssues(projectIdentifier, options);

    console.log(`[Huly] Found ${issues.length} issues in ${projectIdentifier}`);

    return issues;
  } catch (error) {
    console.error(`[Huly] Error fetching issues for ${projectIdentifier}:`, error.message);
    return [];
  }
}

/**
 * Update Huly issue status
 * 
 * @param {Object} hulyClient - Huly client (REST or MCP)
 * @param {string} issueIdentifier - Issue identifier (e.g., "PROJ-123")
 * @param {string} status - New status value
 * @param {Object} config - Configuration object
 * @returns {Promise<boolean>} True if update successful
 */
export async function updateHulyIssueStatus(hulyClient, issueIdentifier, status, config = {}) {
  if (config.sync?.dryRun) {
    console.log(`[Huly] [DRY RUN] Would update issue ${issueIdentifier} status to: ${status}`);
    return true;
  }

  try {
    // Check if using REST API client or MCP client
    if (typeof hulyClient.updateIssue === 'function') {
      // HulyRestClient
      await hulyClient.updateIssue(issueIdentifier, 'status', status);
    } else if (typeof hulyClient.callTool === 'function') {
      // MCPClient
      await hulyClient.callTool('huly_issue_ops', {
        operation: 'update',
        issue_identifier: issueIdentifier,
        update: {
          field: 'status',
          value: status
        }
      });
    } else {
      throw new Error('Unsupported client type');
    }

    console.log(`[Huly] ✓ Updated issue ${issueIdentifier} status to: ${status}`);
    return true;
  } catch (error) {
    console.error(`[Huly] Error updating issue ${issueIdentifier} status:`, error.message);
    return false;
  }
}

/**
 * Update Huly issue description
 * 
 * @param {Object} hulyClient - Huly client (REST or MCP)
 * @param {string} issueIdentifier - Issue identifier (e.g., "PROJ-123")
 * @param {string} description - New description text
 * @param {Object} config - Configuration object
 * @returns {Promise<boolean>} True if update successful
 */
export async function updateHulyIssueDescription(hulyClient, issueIdentifier, description, config = {}) {
  if (config.sync?.dryRun) {
    console.log(`[Huly] [DRY RUN] Would update issue ${issueIdentifier} description`);
    return true;
  }

  try {
    // Check if using REST API client or MCP client
    if (typeof hulyClient.updateIssue === 'function') {
      // HulyRestClient
      await hulyClient.updateIssue(issueIdentifier, 'description', description);
    } else if (typeof hulyClient.callTool === 'function') {
      // MCPClient
      await hulyClient.callTool('huly_issue_ops', {
        operation: 'update',
        issue_identifier: issueIdentifier,
        update: {
          field: 'description',
          value: description
        }
      });
    } else {
      throw new Error('Unsupported client type');
    }

    console.log(`[Huly] ✓ Updated issue ${issueIdentifier} description`);
    return true;
  } catch (error) {
    console.error(`[Huly] Error updating issue ${issueIdentifier} description:`, error.message);
    return false;
  }
}

/**
 * Sync a Vibe task's changes back to Huly (bidirectional sync - Phase 2)
 * 
 * @param {Object} hulyClient - Huly client
 * @param {Object} vibeTask - Vibe task object
 * @param {Array} hulyIssues - Array of Huly issues for the project
 * @param {string} projectIdentifier - Project identifier
 * @param {Object} config - Configuration object
 * @param {Set} phase1UpdatedTasks - Set of task IDs updated in Phase 1 (to avoid loops)
 * @returns {Promise<void>}
 */
export async function syncVibeTaskToHuly(
  hulyClient,
  vibeTask,
  hulyIssues,
  projectIdentifier,
  config = {},
  phase1UpdatedTasks = new Set()
) {
  // Skip if this task was just updated in Phase 1
  if (phase1UpdatedTasks.has(vibeTask.id)) {
    console.log(`[Skip Phase 2] Task "${vibeTask.title}" was just updated in Phase 1`);
    return;
  }

  // Extract Huly identifier from task description
  const hulyIdentifier = extractHulyIdentifier(vibeTask.description);

  if (!hulyIdentifier) {
    // Task is not synced from Huly, skip
    return;
  }

  // Find corresponding Huly issue
  const hulyIssue = hulyIssues.find(issue => issue.identifier === hulyIdentifier);

  if (!hulyIssue) {
    console.warn(`[Phase 2] Huly issue ${hulyIdentifier} not found for task "${vibeTask.title}"`);
    return;
  }

  // Compare statuses (map both to normalized form)
  const vibeStatusMapped = mapVibeStatusToHuly(vibeTask.status);
  const hulyStatusNormalized = normalizeStatus(hulyIssue.status);

  if (vibeStatusMapped !== hulyStatusNormalized) {
    console.log(
      `[Phase 2] Status changed in Vibe: ${hulyIdentifier} ` +
      `(Huly: ${hulyIssue.status} → Vibe: ${vibeTask.status})`
    );

    // Update Huly issue status to match Vibe
    await updateHulyIssueStatus(hulyClient, hulyIdentifier, vibeStatusMapped, config);
  }

  // Compare descriptions (check if Vibe description was edited)
  const vibeDescWithoutFooter = vibeTask.description
    .split('\n\n---\n')[0]
    .trim();

  if (vibeDescWithoutFooter !== hulyIssue.description?.trim()) {
    console.log(`[Phase 2] Description changed in Vibe: ${hulyIdentifier}`);

    // Update Huly issue description (preserve Huly footer if it exists)
    const newDescription = vibeDescWithoutFooter;
    await updateHulyIssueDescription(hulyClient, hulyIdentifier, newDescription, config);
  }
}

/**
 * Create a HulyService instance with bound configuration
 * Factory pattern for easier dependency injection and testing
 * 
 * @param {Object} config - Configuration object
 * @returns {Object} HulyService instance with bound methods
 */
export function createHulyService(config) {
  return {
    fetchProjects: (hulyClient) => fetchHulyProjects(hulyClient, config),
    fetchIssues: (hulyClient, projectIdentifier, lastSyncTime) =>
      fetchHulyIssues(hulyClient, projectIdentifier, config, lastSyncTime),
    updateIssueStatus: (hulyClient, issueIdentifier, status) =>
      updateHulyIssueStatus(hulyClient, issueIdentifier, status, config),
    updateIssueDescription: (hulyClient, issueIdentifier, description) =>
      updateHulyIssueDescription(hulyClient, issueIdentifier, description, config),
    syncVibeTaskToHuly: (hulyClient, vibeTask, hulyIssues, projectIdentifier, phase1UpdatedTasks) =>
      syncVibeTaskToHuly(hulyClient, vibeTask, hulyIssues, projectIdentifier, config, phase1UpdatedTasks),
  };
}
