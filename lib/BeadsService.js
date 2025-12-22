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
import { recordApiLatency } from './HealthService.js';

/**
 * Execute a beads CLI command and return parsed JSON output
 * 
 * @param {string} command - The bd command to execute (without 'bd' prefix)
 * @param {string} workingDir - The directory to run the command in
 * @returns {any} Parsed JSON output from the command
 */
function execBeadsCommand(command, workingDir) {
  const fullCommand = `bd ${command}`;
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
    
    // Add priority if specified
    if (issueData.priority) {
      command += ` --priority=${issueData.priority}`;
    }
    
    // Add issue type if specified
    if (issueData.type) {
      command += ` --type=${issueData.type}`;
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
        // Status is handled by close/reopen commands
        if (value === 'closed') {
          command = `close ${issueId}`;
        } else if (value === 'open') {
          command = `reopen ${issueId}`;
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
export async function syncHulyIssueToBeads(
  projectPath,
  hulyIssue,
  beadsIssues,
  db,
  config = {}
) {
  const { mapHulyStatusToBeads, mapHulyPriorityToBeads, mapHulyTypeToBeads } = await import(
    './statusMapper.js'
  );
  
  // Check if issue already exists in beads (stored in database)
  const dbIssue = db.getIssue(hulyIssue.identifier);
  const beadsIssueId = dbIssue?.beads_issue_id;
  
  let beadsIssue = null;
  if (beadsIssueId) {
    beadsIssue = beadsIssues.find(issue => issue.id === beadsIssueId);
  }
  
  if (!beadsIssue) {
    // Create new issue in beads
    const beadsStatus = mapHulyStatusToBeads(hulyIssue.status);
    const beadsPriority = mapHulyPriorityToBeads(hulyIssue.priority);
    const beadsType = mapHulyTypeToBeads(hulyIssue.type);
    
    // Add Huly identifier to description for tracking
    const description = hulyIssue.description
      ? `${hulyIssue.description}\n\n---\nHuly Issue: ${hulyIssue.identifier}`
      : `Synced from Huly: ${hulyIssue.identifier}`;
    
    const createdIssue = await createBeadsIssue(
      projectPath,
      {
        title: hulyIssue.title,
        description: description,
        priority: beadsPriority,
        type: beadsType,
      },
      config
    );
    
    if (createdIssue) {
      // If issue should be closed, close it
      if (beadsStatus === 'closed') {
        await closeBeadsIssue(projectPath, createdIssue.id, config);
      }
      
      // Update database with beads issue ID
      db.upsertIssue({
        identifier: hulyIssue.identifier,
        project_identifier: hulyIssue.project || hulyIssue.space,
        beads_issue_id: createdIssue.id,
        beads_status: beadsStatus,
      });
      
      return createdIssue;
    }
  } else {
    // Issue exists - check for updates from Huly
    const beadsStatus = mapHulyStatusToBeads(hulyIssue.status);
    const beadsPriority = mapHulyPriorityToBeads(hulyIssue.priority);
    
    let updated = false;
    
    // Check status changes
    if (beadsIssue.status !== beadsStatus) {
      console.log(
        `[Beads] Status change detected: ${hulyIssue.identifier} ` +
        `(${beadsIssue.status} → ${beadsStatus})`
      );
      await updateBeadsIssue(projectPath, beadsIssue.id, 'status', beadsStatus, config);
      updated = true;
    }
    
    // Check priority changes
    if (beadsIssue.priority !== beadsPriority) {
      console.log(
        `[Beads] Priority change detected: ${hulyIssue.identifier} ` +
        `(${beadsIssue.priority} → ${beadsPriority})`
      );
      await updateBeadsIssue(projectPath, beadsIssue.id, 'priority', beadsPriority, config);
      updated = true;
    }
    
    // Check title changes
    if (beadsIssue.title !== hulyIssue.title) {
      console.log(`[Beads] Title change detected: ${hulyIssue.identifier}`);
      await updateBeadsIssue(projectPath, beadsIssue.id, 'title', hulyIssue.title, config);
      updated = true;
    }
    
    if (updated) {
      // Update database with latest state
      db.upsertIssue({
        identifier: hulyIssue.identifier,
        project_identifier: hulyIssue.project || hulyIssue.space,
        beads_issue_id: beadsIssue.id,
        beads_status: beadsStatus,
      });
    }
    
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
 * @returns {Promise<void>}
 */
export async function syncBeadsIssueToHuly(
  hulyClient,
  beadsIssue,
  hulyIssues,
  projectIdentifier,
  db,
  config = {},
  phase3UpdatedIssues = new Set()
) {
  const { updateHulyIssueStatus, updateHulyIssueTitle, updateHulyIssuePriority, updateHulyIssueDescription, createHulyIssue } = await import('./HulyService.js');
  const { mapBeadsStatusToHuly, mapBeadsPriorityToHuly, mapBeadsTypeToHuly } = await import('./statusMapper.js');
  
  // Skip if this issue was just updated in Phase 3a
  if (phase3UpdatedIssues.has(beadsIssue.id)) {
    console.log(`[Skip Beads→Huly] Issue ${beadsIssue.id} was just updated in Phase 3a`);
    return;
  }
  
  // Find the Huly identifier from database
  const dbIssues = db.getAllIssues();
  const dbIssue = dbIssues.find(issue => issue.beads_issue_id === beadsIssue.id);
  
  if (!dbIssue) {
    // This is a NEW issue created in Beads - create it in Huly
    console.log(`[Beads→Huly] New issue detected in Beads: ${beadsIssue.id} - ${beadsIssue.title}`);
    
    const beadsStatus = mapBeadsStatusToHuly(beadsIssue.status);
    const beadsPriority = mapBeadsPriorityToHuly(beadsIssue.priority);
    const beadsType = mapBeadsTypeToHuly(beadsIssue.issue_type);
    
    // Create issue in Huly
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
        beads_modified_at: beadsIssue.updated_at ? new Date(beadsIssue.updated_at).getTime() : Date.now(),
      });
      
      console.log(`[Beads→Huly] ✓ Created Huly issue ${createdIssue.identifier} from Beads ${beadsIssue.id}`);
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
  
  // Check status changes
  const beadsStatusMapped = mapBeadsStatusToHuly(beadsIssue.status);
  const hulyStatusNormalized = hulyIssue.status || 'Backlog';
  
  if (beadsStatusMapped !== hulyStatusNormalized) {
    console.log(
      `[Beads→Huly] Status update: ${hulyIdentifier} ` +
      `(${hulyStatusNormalized} → ${beadsStatusMapped})`
    );
    
    const success = await updateHulyIssueStatus(
      hulyClient,
      hulyIdentifier,
      beadsStatusMapped,
      config
    );
    
    if (success) {
      updated = true;
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
      beads_modified_at: beadsIssue.updated_at ? new Date(beadsIssue.updated_at).getTime() : Date.now(),
    });
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
