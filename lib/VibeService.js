/**
 * Vibe Service
 * 
 * Handles all Vibe Kanban-specific operations including:
 * - Listing and creating projects
 * - Creating and updating tasks
 * - Task status and description management
 */

import fs from 'fs';
import { mapHulyStatusToVibe } from './statusMapper.js';
import { determineGitRepoPath } from './textParsers.js';
import { recordApiLatency } from './HealthService.js';

/**
 * List all existing projects in Vibe Kanban
 * 
 * @param {Object} vibeClient - Vibe REST API client
 * @returns {Promise<Array>} Array of Vibe projects
 */
export async function listVibeProjects(vibeClient) {
  console.log('\n[Vibe] Listing existing projects...');
  const startTime = Date.now();

  try {
    const projects = await vibeClient.listProjects();
    
    // Record API latency
    recordApiLatency('vibe', 'listProjects', Date.now() - startTime);
    
    console.log(`[Vibe] Found ${projects.length} existing projects`);
    return projects;
  } catch (error) {
    // Record latency even on error
    recordApiLatency('vibe', 'listProjects', Date.now() - startTime);
    console.error('[Vibe] Error listing projects:', error.message);
    return [];
  }
}

/**
 * Normalize project name for comparison (case-insensitive, trimmed)
 * @param {string} name - Project name
 * @returns {string} Normalized name
 */
function normalizeProjectName(name) {
  if (!name) return '';
  return name.trim().toLowerCase();
}

/**
 * Find existing Vibe project by name (with deduplication)
 * 
 * @param {Object} vibeClient - Vibe REST API client
 * @param {string} projectName - Project name to search for
 * @returns {Promise<Object|null>} Existing project or null
 */
export async function findVibeProjectByName(vibeClient, projectName) {
  try {
    const projects = await vibeClient.listProjects();
    const normalizedSearch = normalizeProjectName(projectName);
    
    return projects.find(p => normalizeProjectName(p.name) === normalizedSearch) || null;
  } catch (error) {
    console.error(`[Vibe] Error searching for project ${projectName}:`, error.message);
    return null;
  }
}

/**
 * Create a new project in Vibe Kanban (with deduplication check)
 * 
 * @param {Object} vibeClient - Vibe REST API client
 * @param {Object} hulyProject - Huly project object
 * @param {Object} config - Configuration object
 * @returns {Promise<Object|null>} Created project or null
 */
export async function createVibeProject(vibeClient, hulyProject, config = {}) {
  if (config.sync?.dryRun) {
    console.log(`[Vibe] [DRY RUN] Would create project: ${hulyProject.name}`);
    return null;
  }

  const startTime = Date.now();

  try {
    // DEDUPLICATION: Check if project already exists before creating
    const existingProject = await findVibeProjectByName(vibeClient, hulyProject.name);
    
    if (existingProject) {
      console.log(`[Vibe] ✓ Found existing project: ${hulyProject.name} (ID: ${existingProject.id}) - skipping creation`);
      recordApiLatency('vibe', 'createProject', Date.now() - startTime);
      return existingProject;
    }

    console.log(`[Vibe] Creating project: ${hulyProject.name}`);
    
    const gitRepoPath = determineGitRepoPath(hulyProject);
    
    // Extract display name from path (last component)
    const displayName = gitRepoPath.split('/').pop() || hulyProject.name;

    // New Vibe API format (v0.0.141+) uses repositories array
    const project = await vibeClient.createProject({
      name: hulyProject.name,
      repositories: [
        {
          display_name: displayName,
          git_repo_path: gitRepoPath,
        }
      ],
    });

    // Record API latency
    recordApiLatency('vibe', 'createProject', Date.now() - startTime);
    
    console.log(`[Vibe] ✓ Created project: ${hulyProject.name}`);
    return project;
  } catch (error) {
    // Record latency even on error
    recordApiLatency('vibe', 'createProject', Date.now() - startTime);
    console.error(`[Vibe] ✗ Error creating project ${hulyProject.name}:`, error.message);
    return null;
  }
}

/**
 * List all tasks in a Vibe project
 * 
 * @param {Object} vibeClient - Vibe REST API client
 * @param {string} projectId - Vibe project ID
 * @returns {Promise<Array>} Array of Vibe tasks
 */
export async function listVibeTasks(vibeClient, projectId) {
  const startTime = Date.now();
  try {
    const tasks = await vibeClient.listTasks(projectId);
    
    // Record API latency
    recordApiLatency('vibe', 'listTasks', Date.now() - startTime);
    
    return tasks || [];
  } catch (error) {
    // Record latency even on error
    recordApiLatency('vibe', 'listTasks', Date.now() - startTime);
    console.error(`[Vibe] Error listing tasks for project ${projectId}:`, error.message);
    return [];
  }
}

/**
 * Normalize task title for comparison (case-insensitive, trimmed, without prefixes)
 * @param {string} title - Task title
 * @returns {string} Normalized title
 */
function normalizeTaskTitle(title) {
  if (!title) return '';
  return title
    .trim()
    .toLowerCase()
    .replace(/^\[p[0-4]\]\s*/i, '')      // Remove [P0]-[P4] prefix
    .replace(/^\[perf[^\]]*\]\s*/i, '')  // Remove [PERF*] prefix
    .replace(/^\[tier\s*\d+\]\s*/i, '')  // Remove [Tier N] prefix
    .replace(/^\[action\]\s*/i, '')      // Remove [Action] prefix
    .replace(/^\[bug\]\s*/i, '')         // Remove [BUG] prefix
    .replace(/^\[fixed\]\s*/i, '')       // Remove [FIXED] prefix
    .trim();
}

/**
 * Extract Huly identifier from task description
 * @param {string} description - Task description
 * @returns {string|null} Huly identifier or null
 */
function extractHulyIdFromDescription(description) {
  if (!description) return null;
  
  // Match "Huly Issue: PROJ-123" or "Synced from Huly: PROJ-123"
  const match = description.match(/(?:Huly Issue|Synced from Huly):\s*([A-Z]+-\d+)/i);
  return match ? match[1] : null;
}

/**
 * Find existing Vibe task by Huly identifier or title (with deduplication)
 * 
 * @param {Object} vibeClient - Vibe REST API client
 * @param {string} vibeProjectId - Vibe project ID
 * @param {Object} hulyIssue - Huly issue to match
 * @returns {Promise<Object|null>} Existing task or null
 */
export async function findVibeTaskByHulyIssue(vibeClient, vibeProjectId, hulyIssue) {
  try {
    const tasks = await vibeClient.listTasks(vibeProjectId);
    
    // First, try to find by Huly identifier in description (most reliable)
    const byIdentifier = tasks.find(task => {
      const taskHulyId = extractHulyIdFromDescription(task.description);
      return taskHulyId === hulyIssue.identifier;
    });
    
    if (byIdentifier) {
      return byIdentifier;
    }
    
    // Fallback: try to find by normalized title match
    const normalizedHulyTitle = normalizeTaskTitle(hulyIssue.title);
    const byTitle = tasks.find(task => {
      const normalizedTaskTitle = normalizeTaskTitle(task.title);
      // Exact match after normalization
      if (normalizedTaskTitle === normalizedHulyTitle) return true;
      // Also check if one contains the other (for partial matches on longer titles)
      if (normalizedHulyTitle.length > 15 && normalizedTaskTitle.length > 15) {
        if (normalizedTaskTitle.includes(normalizedHulyTitle) ||
            normalizedHulyTitle.includes(normalizedTaskTitle)) {
          return true;
        }
      }
      return false;
    });
    
    return byTitle || null;
  } catch (error) {
    console.error(`[Vibe] Error searching for task ${hulyIssue.identifier}:`, error.message);
    return null;
  }
}

/**
 * Create a new task in Vibe Kanban (with deduplication check)
 * 
 * @param {Object} vibeClient - Vibe REST API client
 * @param {string} vibeProjectId - Vibe project ID
 * @param {Object} hulyIssue - Huly issue object
 * @param {Object} config - Configuration object
 * @returns {Promise<Object|null>} Created task or null
 */
export async function createVibeTask(vibeClient, vibeProjectId, hulyIssue, config = {}) {
  if (config.sync?.dryRun) {
    console.log(`[Vibe] [DRY RUN] Would create task: ${hulyIssue.title}`);
    return null;
  }

  const startTime = Date.now();

  try {
    // DEDUPLICATION: Check if task already exists before creating
    const existingTask = await findVibeTaskByHulyIssue(vibeClient, vibeProjectId, hulyIssue);
    
    if (existingTask) {
      console.log(`[Vibe] ✓ Found existing task for ${hulyIssue.identifier}: "${existingTask.title}" (ID: ${existingTask.id}) - skipping creation`);
      recordApiLatency('vibe', 'createTask', Date.now() - startTime);
      return existingTask;
    }

    console.log(`[Vibe] Creating task: ${hulyIssue.title}`);
    
    // Add Huly issue ID to description for tracking
    const description = hulyIssue.description
      ? `${hulyIssue.description}\n\n---\nHuly Issue: ${hulyIssue.identifier}`
      : `Synced from Huly: ${hulyIssue.identifier}`;

    const vibeStatus = mapHulyStatusToVibe(hulyIssue.status);

    const task = await vibeClient.createTask(vibeProjectId, {
      title: hulyIssue.title,
      description: description,
      status: vibeStatus,
    });

    // Record API latency
    recordApiLatency('vibe', 'createTask', Date.now() - startTime);
    
    console.log(`[Vibe] ✓ Created task: ${hulyIssue.title}`);
    return task;
  } catch (error) {
    // Record latency even on error
    recordApiLatency('vibe', 'createTask', Date.now() - startTime);
    console.error(`[Vibe] ✗ Error creating task ${hulyIssue.title}:`, error.message);
    return null;
  }
}

/**
 * Update task status in Vibe Kanban
 * 
 * @param {Object} vibeClient - Vibe REST API client
 * @param {string} taskId - Vibe task ID
 * @param {string} status - New status value
 * @param {Object} config - Configuration object
 * @returns {Promise<void>}
 */
export async function updateVibeTaskStatus(vibeClient, taskId, status, config = {}) {
  if (config.sync?.dryRun) {
    console.log(`[Vibe] [DRY RUN] Would update task ${taskId} status to: ${status}`);
    return;
  }

  const startTime = Date.now();
  try {
    await vibeClient.updateTask(taskId, 'status', status);
    
    // Record API latency
    recordApiLatency('vibe', 'updateTask', Date.now() - startTime);
    
    console.log(`[Vibe] ✓ Updated task ${taskId} status to: ${status}`);
  } catch (error) {
    // Record latency even on error
    recordApiLatency('vibe', 'updateTask', Date.now() - startTime);
    console.error(`[Vibe] Error updating task ${taskId} status:`, error.message);
  }
}

/**
 * Update Vibe task description
 * 
 * @param {Object} vibeClient - Vibe REST API client
 * @param {string} taskId - Vibe task ID
 * @param {string} description - New description text
 * @param {Object} config - Configuration object
 * @returns {Promise<void>}
 */
export async function updateVibeTaskDescription(vibeClient, taskId, description, config = {}) {
  if (config.sync?.dryRun) {
    console.log(`[Vibe] [DRY RUN] Would update task ${taskId} description`);
    return;
  }

  const startTime = Date.now();
  try {
    await vibeClient.updateTask(taskId, 'description', description);
    
    // Record API latency
    recordApiLatency('vibe', 'updateTask', Date.now() - startTime);
    
    console.log(`[Vibe] ✓ Updated task ${taskId} description`);
  } catch (error) {
    // Record latency even on error
    recordApiLatency('vibe', 'updateTask', Date.now() - startTime);
    console.error(`[Vibe] Error updating task ${taskId} description:`, error.message);
  }
}

/**
 * Create a VibeService instance with bound configuration
 * Factory pattern for easier dependency injection and testing
 * 
 * @param {Object} config - Configuration object
 * @returns {Object} VibeService instance with bound methods
 */
export function createVibeService(config) {
  return {
    listProjects: (vibeClient) => listVibeProjects(vibeClient),
    findProjectByName: (vibeClient, projectName) => findVibeProjectByName(vibeClient, projectName),
    createProject: (vibeClient, hulyProject) => createVibeProject(vibeClient, hulyProject, config),
    listTasks: (vibeClient, projectId) => listVibeTasks(vibeClient, projectId),
    findTaskByHulyIssue: (vibeClient, vibeProjectId, hulyIssue) => 
      findVibeTaskByHulyIssue(vibeClient, vibeProjectId, hulyIssue),
    createTask: (vibeClient, vibeProjectId, hulyIssue) => 
      createVibeTask(vibeClient, vibeProjectId, hulyIssue, config),
    updateTaskStatus: (vibeClient, taskId, status) => 
      updateVibeTaskStatus(vibeClient, taskId, status, config),
    updateTaskDescription: (vibeClient, taskId, description) => 
      updateVibeTaskDescription(vibeClient, taskId, description, config),
  };
}
