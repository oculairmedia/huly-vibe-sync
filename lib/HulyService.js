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
import { recordApiLatency } from './HealthService.js';

/**
 * Fetch all projects from Huly
 * 
 * @param {Object} hulyClient - Huly REST API client
 * @param {Object} config - Configuration object
 * @returns {Promise<Array>} Array of Huly projects
 */
export async function fetchHulyProjects(hulyClient, config = {}) {
  console.log('\n[Huly] Fetching projects...');
  const startTime = Date.now();

  try {
    // Use the REST API's listProjects method
    const projects = await hulyClient.listProjects();
    
    // Record API latency
    recordApiLatency('huly', 'listProjects', Date.now() - startTime);

    console.log(`[Huly] Found ${projects.length} projects`);

    // Debug: show first project structure
    if (projects.length > 0 && config.sync?.dryRun) {
      console.log('[Huly] Sample project:', JSON.stringify(projects[0], null, 2));
    }

    return projects;
  } catch (error) {
    // Record latency even on error
    recordApiLatency('huly', 'listProjects', Date.now() - startTime);
    console.error('[Huly] Error fetching projects:', error.message);
    return [];
  }
}

/**
 * Fetch issues from a Huly project with incremental sync support
 * 
 * @param {Object} hulyClient - Huly REST API client
 * @param {string} projectIdentifier - Project identifier (e.g., "PROJ")
 * @param {Object} config - Configuration object
 * @param {Object} db - Database instance (optional, for cursor-based incremental sync)
 * @returns {Promise<Object>} { issues: Array, syncMeta: { latestModified, serverTime } }
 */
export async function fetchHulyIssues(hulyClient, projectIdentifier, config = {}, db = null) {
  const startTime = Date.now();
  
  // Get sync cursor from database for true incremental sync
  const syncCursor = db?.getHulySyncCursor?.(projectIdentifier);
  const isIncremental = config.sync?.incremental !== false && syncCursor;

  if (isIncremental) {
    console.log(`[Huly] Incremental fetch for ${projectIdentifier} (modified since ${syncCursor})`);
  } else {
    console.log(`[Huly] Full fetch for project ${projectIdentifier}...`);
  }

  try {
    const options = {
      limit: 1000,
      includeSyncMeta: true, // Get syncMeta for cursor update
    };

    // Use modifiedSince for incremental sync
    if (isIncremental) {
      options.modifiedSince = syncCursor;
    }

    // Fetch issues with syncMeta
    const result = await hulyClient.listIssues(projectIdentifier, options);
    
    // Record API latency
    recordApiLatency('huly', 'listIssues', Date.now() - startTime);

    const issues = result.issues || result;
    const syncMeta = result.syncMeta || { latestModified: null, serverTime: new Date().toISOString() };

    console.log(`[Huly] Found ${issues.length} issues in ${projectIdentifier}${isIncremental ? ' (incremental)' : ''}`);

    // Update sync cursor for next incremental sync
    if (db && syncMeta.latestModified) {
      db.setHulySyncCursor(projectIdentifier, syncMeta.latestModified);
      console.log(`[Huly] Updated sync cursor for ${projectIdentifier}: ${syncMeta.latestModified}`);
    }

    return { issues, syncMeta };
  } catch (error) {
    recordApiLatency('huly', 'listIssues', Date.now() - startTime);
    console.error(`[Huly] Error fetching issues for ${projectIdentifier}:`, error.message);
    return { issues: [], syncMeta: { latestModified: null, serverTime: new Date().toISOString() } };
  }
}

/**
 * Fetch issues (backward compatible - returns just the array)
 * @deprecated Use fetchHulyIssues with db parameter for incremental sync
 */
export async function fetchHulyIssuesSimple(hulyClient, projectIdentifier, config = {}) {
  const result = await fetchHulyIssues(hulyClient, projectIdentifier, config, null);
  return result.issues;
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

  const startTime = Date.now();
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

    // Record API latency
    recordApiLatency('huly', 'updateIssue', Date.now() - startTime);
    
    console.log(`[Huly] ✓ Updated issue ${issueIdentifier} status to: ${status}`);
    return true;
  } catch (error) {
    // Record latency even on error
    recordApiLatency('huly', 'updateIssue', Date.now() - startTime);
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

  const startTime = Date.now();
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

    // Record API latency
    recordApiLatency('huly', 'updateIssue', Date.now() - startTime);
    
    console.log(`[Huly] ✓ Updated issue ${issueIdentifier} description`);
    return true;
  } catch (error) {
    // Record latency even on error
    recordApiLatency('huly', 'updateIssue', Date.now() - startTime);
    console.error(`[Huly] Error updating issue ${issueIdentifier} description:`, error.message);
    return false;
  }
}

/**
 * Create a new Huly issue
 * 
 * @param {Object} hulyClient - Huly client (REST or MCP)
 * @param {string} projectIdentifier - Project identifier (e.g., "PROJ")
 * @param {Object} issueData - Issue data {title, description, priority, status, type}
 * @param {Object} config - Configuration object
 * @returns {Promise<Object|null>} Created issue object or null if failed
 */
export async function createHulyIssue(hulyClient, projectIdentifier, issueData, config = {}) {
  if (config.sync?.dryRun) {
    console.log(`[Huly] [DRY RUN] Would create issue in ${projectIdentifier}: ${issueData.title}`);
    return { identifier: `${projectIdentifier}-DRY`, ...issueData };
  }

  const startTime = Date.now();
  try {
    let result;
    
    // Check if using REST API client or MCP client
    if (typeof hulyClient.createIssue === 'function') {
      // HulyRestClient
      result = await hulyClient.createIssue(projectIdentifier, issueData);
    } else if (typeof hulyClient.callTool === 'function') {
      // MCPClient
      result = await hulyClient.callTool('huly_issue_ops', {
        operation: 'create',
        project_identifier: projectIdentifier,
        issue_data: issueData
      });
    } else {
      throw new Error('Unsupported client type');
    }

    // Record API latency
    recordApiLatency('huly', 'createIssue', Date.now() - startTime);
    
    console.log(`[Huly] ✓ Created issue: ${result.identifier} - ${issueData.title}`);
    return result;
  } catch (error) {
    // Record latency even on error
    recordApiLatency('huly', 'createIssue', Date.now() - startTime);
    console.error(`[Huly] Error creating issue in ${projectIdentifier}:`, error.message);
    return null;
  }
}

/**
 * Update Huly issue priority
 * 
 * @param {Object} hulyClient - Huly client (REST or MCP)
 * @param {string} issueIdentifier - Issue identifier (e.g., "PROJ-123")
 * @param {string} priority - New priority (Urgent, High, Medium, Low, None)
 * @param {Object} config - Configuration object
 * @returns {Promise<boolean>} True if update successful
 */
export async function updateHulyIssuePriority(hulyClient, issueIdentifier, priority, config = {}) {
  if (config.sync?.dryRun) {
    console.log(`[Huly] [DRY RUN] Would update issue ${issueIdentifier} priority to: ${priority}`);
    return true;
  }

  const startTime = Date.now();
  try {
    // Check if using REST API client or MCP client
    if (typeof hulyClient.updateIssue === 'function') {
      // HulyRestClient
      await hulyClient.updateIssue(issueIdentifier, 'priority', priority);
    } else if (typeof hulyClient.callTool === 'function') {
      // MCPClient
      await hulyClient.callTool('huly_issue_ops', {
        operation: 'update',
        issue_identifier: issueIdentifier,
        update: {
          field: 'priority',
          value: priority
        }
      });
    } else {
      throw new Error('Unsupported client type');
    }

    // Record API latency
    recordApiLatency('huly', 'updateIssue', Date.now() - startTime);
    
    console.log(`[Huly] ✓ Updated issue ${issueIdentifier} priority to: ${priority}`);
    return true;
  } catch (error) {
    // Record latency even on error
    recordApiLatency('huly', 'updateIssue', Date.now() - startTime);
    console.error(`[Huly] Error updating issue ${issueIdentifier} priority:`, error.message);
    return false;
  }
}

/**
 * Update Huly issue title
 * 
 * @param {Object} hulyClient - Huly client (REST or MCP)
 * @param {string} issueIdentifier - Issue identifier (e.g., "PROJ-123")
 * @param {string} title - New title
 * @param {Object} config - Configuration object
 * @returns {Promise<boolean>} True if update successful
 */
export async function updateHulyIssueTitle(hulyClient, issueIdentifier, title, config = {}) {
  if (config.sync?.dryRun) {
    console.log(`[Huly] [DRY RUN] Would update issue ${issueIdentifier} title to: ${title}`);
    return true;
  }

  const startTime = Date.now();
  try {
    // Check if using REST API client or MCP client
    if (typeof hulyClient.updateIssue === 'function') {
      // HulyRestClient
      await hulyClient.updateIssue(issueIdentifier, 'title', title);
    } else if (typeof hulyClient.callTool === 'function') {
      // MCPClient
      await hulyClient.callTool('huly_issue_ops', {
        operation: 'update',
        issue_identifier: issueIdentifier,
        update: {
          field: 'title',
          value: title
        }
      });
    } else {
      throw new Error('Unsupported client type');
    }

    // Record API latency
    recordApiLatency('huly', 'updateIssue', Date.now() - startTime);
    
    console.log(`[Huly] ✓ Updated issue ${issueIdentifier} title`);
    return true;
  } catch (error) {
    // Record latency even on error
    recordApiLatency('huly', 'updateIssue', Date.now() - startTime);
    console.error(`[Huly] Error updating issue ${issueIdentifier} title:`, error.message);
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
    // db parameter is optional - can pass null for simple use cases
    fetchIssues: (hulyClient, projectIdentifier, db = null) =>
      fetchHulyIssues(hulyClient, projectIdentifier, config, db),
    updateIssueStatus: (hulyClient, issueIdentifier, status) =>
      updateHulyIssueStatus(hulyClient, issueIdentifier, status, config),
    updateIssueDescription: (hulyClient, issueIdentifier, description) =>
      updateHulyIssueDescription(hulyClient, issueIdentifier, description, config),
    syncVibeTaskToHuly: (hulyClient, vibeTask, hulyIssues, projectIdentifier, phase1UpdatedTasks) =>
      syncVibeTaskToHuly(hulyClient, vibeTask, hulyIssues, projectIdentifier, config, phase1UpdatedTasks),
  };
}
