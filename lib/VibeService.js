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

/**
 * List all existing projects in Vibe Kanban
 * 
 * @param {Object} vibeClient - Vibe REST API client
 * @returns {Promise<Array>} Array of Vibe projects
 */
export async function listVibeProjects(vibeClient) {
  console.log('\n[Vibe] Listing existing projects...');

  try {
    const projects = await vibeClient.listProjects();
    console.log(`[Vibe] Found ${projects.length} existing projects`);
    return projects;
  } catch (error) {
    console.error('[Vibe] Error listing projects:', error.message);
    return [];
  }
}

/**
 * Create a new project in Vibe Kanban
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

  console.log(`[Vibe] Creating project: ${hulyProject.name}`);

  try {
    const gitRepoPath = determineGitRepoPath(hulyProject);

    const project = await vibeClient.createProject({
      name: hulyProject.name,
      git_repo_path: gitRepoPath,
      use_existing_repo: fs.existsSync(gitRepoPath),
    });

    console.log(`[Vibe] ✓ Created project: ${hulyProject.name}`);
    return project;
  } catch (error) {
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
  try {
    const tasks = await vibeClient.listTasks(projectId);
    return tasks || [];
  } catch (error) {
    console.error(`[Vibe] Error listing tasks for project ${projectId}:`, error.message);
    return [];
  }
}

/**
 * Create a new task in Vibe Kanban
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

  console.log(`[Vibe] Creating task: ${hulyIssue.title}`);

  try {
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

    console.log(`[Vibe] ✓ Created task: ${hulyIssue.title}`);
    return task;
  } catch (error) {
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

  try {
    await vibeClient.updateTask(taskId, 'status', status);
    console.log(`[Vibe] ✓ Updated task ${taskId} status to: ${status}`);
  } catch (error) {
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

  try {
    await vibeClient.updateTask(taskId, 'description', description);
    console.log(`[Vibe] ✓ Updated task ${taskId} description`);
  } catch (error) {
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
    createProject: (vibeClient, hulyProject) => createVibeProject(vibeClient, hulyProject, config),
    listTasks: (vibeClient, projectId) => listVibeTasks(vibeClient, projectId),
    createTask: (vibeClient, vibeProjectId, hulyIssue) => 
      createVibeTask(vibeClient, vibeProjectId, hulyIssue, config),
    updateTaskStatus: (vibeClient, taskId, status) => 
      updateVibeTaskStatus(vibeClient, taskId, status, config),
    updateTaskDescription: (vibeClient, taskId, description) => 
      updateVibeTaskDescription(vibeClient, taskId, description, config),
  };
}
