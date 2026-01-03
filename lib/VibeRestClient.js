/**
 * Vibe Kanban REST API Client
 *
 * Direct REST API client for Vibe Kanban platform that provides centralized
 * API access with consistent error handling and performance monitoring
 */

import { fetchWithPool } from './http.js';

/**
 * REST API client for Vibe Kanban platform
 */
export class VibeRestClient {
  constructor(baseUrl, options = {}) {
    // Ensure we have the correct REST API URL
    // The REST API runs on port 3105
    // Remove any existing path suffixes, set port to 3105, and add /api
    this.baseUrl =
      baseUrl
        .replace(/\/mcp$/, '') // Remove /mcp suffix if present
        .replace(/\/api$/, '') // Remove /api suffix if present
        .replace(/:\d+/, ':3105') + // Set port to 3105
      '/api'; // Add /api suffix
    this.name = options.name || 'Vibe REST';
    this.timeout = options.timeout || 60000; // 60 second default timeout
  }

  /**
   * Initialize the client (test connectivity)
   */
  async initialize() {
    console.log(`[${this.name}] Initializing REST API client...`);
    console.log(`[${this.name}] API URL: ${this.baseUrl}`);

    // Test connectivity via health check or list projects
    try {
      // Try health endpoint first
      const healthUrl = this.baseUrl.replace('/api', '/health');
      console.log(`[${this.name}] Testing health endpoint: ${healthUrl}`);

      const response = await fetchWithPool(healthUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      console.log(`[${this.name}] Response status: ${response?.status}`);

      if (!response.ok) {
        // Health endpoint might not exist, try listing projects instead
        console.log(`[${this.name}] Health endpoint not available, testing with list projects...`);
        await this.listProjects();
        console.log(`[${this.name}] Connected successfully via projects endpoint`);
        return true;
      }

      // Try to parse as JSON, but if it fails (e.g., HTML response), fall back to list projects
      try {
        const result = await response.json();
        console.log(`[${this.name}] Health check result:`, JSON.stringify(result));
        console.log(`[${this.name}] Connected successfully`);
        return true;
      } catch (jsonError) {
        console.log(
          `[${this.name}] Health endpoint returned non-JSON response, testing with list projects...`,
        );
        await this.listProjects();
        console.log(`[${this.name}] Connected successfully via projects endpoint`);
        return true;
      }
    } catch (error) {
      console.error(`[${this.name}] Failed to connect:`, error.message);
      throw error;
    }
  }

  /**
   * Health check endpoint (if available)
   */
  async healthCheck() {
    try {
      const healthUrl = this.baseUrl.replace('/api', '/health');
      const response = await fetchWithPool(healthUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      // Health endpoint might not exist on all Vibe installations
      // Return a synthetic health status
      return { status: 'unknown', message: error.message };
    }
  }

  /**
   * Make a REST API request with consistent error handling
   * @private
   */
  async makeRequest(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const startTime = Date.now();

    try {
      const response = await fetchWithPool(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();

      // Vibe API returns: { success: boolean, data: any, message?: string }
      if (result.success === false) {
        throw new Error(`API call failed: ${result.message || 'Unknown error'}`);
      }

      // Log slow calls for performance monitoring
      if (executionTime > 5000) {
        console.log(`[${this.name}] Slow API call: ${endpoint} took ${executionTime}ms`);
      }

      return result.data || result;
    } catch (error) {
      console.error(`[${this.name}] API call failed:`, {
        endpoint,
        method: options.method || 'GET',
        error: error.message,
      });
      throw error;
    }
  }

  // ============================================================
  // PROJECT OPERATIONS
  // ============================================================

  /**
   * List all projects
   * @returns {Promise<Array>} Array of projects
   */
  async listProjects() {
    return await this.makeRequest('/projects', {
      method: 'GET',
    });
  }

  /**
   * Get project by ID
   * @param {string} projectId - UUID of project
   * @returns {Promise<Object>} Project details
   */
  async getProject(projectId) {
    return await this.makeRequest(`/projects/${projectId}`, {
      method: 'GET',
    });
  }

  /**
   * Create a new project
   * @param {Object} projectData - Project data
   * @param {string} projectData.name - Project name
   * @param {string} projectData.git_repo_path - Git repository path
   * @param {boolean} projectData.use_existing_repo - Whether to use existing repo
   * @returns {Promise<Object>} Created project
   */
  async createProject(projectData) {
    return await this.makeRequest('/projects', {
      method: 'POST',
      body: JSON.stringify(projectData),
    });
  }

  /**
   * Update a project
   * @param {string} projectId - UUID of project
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated project
   */
  async updateProject(projectId, updates) {
    return await this.makeRequest(`/projects/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  /**
   * Delete a project
   * @param {string} projectId - UUID of project
   * @returns {Promise<Object>} Deletion result
   */
  async deleteProject(projectId) {
    return await this.makeRequest(`/projects/${projectId}`, {
      method: 'DELETE',
    });
  }

  // ============================================================
  // TASK OPERATIONS
  // ============================================================

  /**
   * List tasks for a project
   * @param {string} projectId - UUID of project
   * @param {Object} options - Query options
   * @param {string} options.status - Filter by status (todo, inprogress, inreview, done, cancelled)
   * @param {number} options.limit - Maximum number of tasks to return
   * @returns {Promise<Array>} Array of tasks
   */
  async listTasks(projectId, options = {}) {
    const params = new URLSearchParams({ project_id: projectId });

    if (options.status) {
      params.append('status', options.status);
    }
    if (options.limit) {
      params.append('limit', options.limit.toString());
    }

    return await this.makeRequest(`/tasks?${params}`, {
      method: 'GET',
    });
  }

  /**
   * Get task by ID
   * @param {string} taskId - UUID of task
   * @returns {Promise<Object>} Task details
   */
  async getTask(taskId) {
    return await this.makeRequest(`/tasks/${taskId}`, {
      method: 'GET',
    });
  }

  /**
   * Create a new task
   * @param {string} projectId - UUID of project
   * @param {Object} taskData - Task data
   * @param {string} taskData.title - Task title
   * @param {string} taskData.description - Task description
   * @param {string} taskData.status - Task status
   * @param {string} taskData.priority - Task priority
   * @returns {Promise<Object>} Created task
   */
  async createTask(projectId, taskData) {
    return await this.makeRequest('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        ...taskData,
      }),
    });
  }

  /**
   * Update a task field
   * @param {string} taskId - UUID of task
   * @param {string} field - Field to update (status, title, description, priority)
   * @param {string} value - New value
   * @returns {Promise<Object>} Updated task
   */
  async updateTask(taskId, field, value) {
    return await this.makeRequest(`/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ [field]: value }),
    });
  }

  /**
   * Delete a task
   * @param {string} taskId - UUID of task
   * @returns {Promise<Object>} Deletion result
   */
  async deleteTask(taskId) {
    return await this.makeRequest(`/tasks/${taskId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Bulk update multiple tasks
   * @param {Array} updates - Array of {task_id, field, value} objects
   * @returns {Promise<Object>} Update results
   */
  async bulkUpdateTasks(updates) {
    return await this.makeRequest('/tasks/bulk', {
      method: 'PUT',
      body: JSON.stringify({ updates }),
    });
  }

  // ============================================================
  // TASK ATTEMPT OPERATIONS
  // ============================================================

  /**
   * Start a task attempt (execute with coding agent)
   * @param {string} taskId - UUID of task
   * @param {string} executor - Executor type (CLAUDE_CODE, CODEX, GEMINI, etc.)
   * @param {string} baseBranch - Base branch for attempt
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Task attempt details
   */
  async startTaskAttempt(taskId, executor, baseBranch, options = {}) {
    return await this.makeRequest('/attempts/start', {
      method: 'POST',
      body: JSON.stringify({
        task_id: taskId,
        executor,
        base_branch: baseBranch,
        ...options,
      }),
    });
  }

  /**
   * List all attempts for a task
   * @param {string} taskId - UUID of task
   * @returns {Promise<Array>} Array of attempts
   */
  async listTaskAttempts(taskId) {
    return await this.makeRequest(`/attempts?task_id=${taskId}`, {
      method: 'GET',
    });
  }

  /**
   * Get task attempt details
   * @param {string} attemptId - UUID of attempt
   * @returns {Promise<Object>} Attempt details
   */
  async getTaskAttempt(attemptId) {
    return await this.makeRequest(`/attempts/${attemptId}`, {
      method: 'GET',
    });
  }

  /**
   * Merge a task attempt into target branch
   * @param {string} attemptId - UUID of attempt
   * @returns {Promise<Object>} Merge result
   */
  async mergeTaskAttempt(attemptId) {
    return await this.makeRequest(`/attempts/${attemptId}/merge`, {
      method: 'POST',
    });
  }

  /**
   * Create a follow-up attempt based on previous attempt
   * @param {string} previousAttemptId - UUID of previous attempt
   * @param {Object} options - Follow-up options
   * @returns {Promise<Object>} New attempt details
   */
  async createFollowupAttempt(previousAttemptId, options = {}) {
    return await this.makeRequest('/attempts/followup', {
      method: 'POST',
      body: JSON.stringify({
        previous_attempt_id: previousAttemptId,
        ...options,
      }),
    });
  }

  // ============================================================
  // EXECUTION PROCESS OPERATIONS
  // ============================================================

  /**
   * Get execution process details
   * @param {string} processId - UUID of execution process
   * @returns {Promise<Object>} Process details
   */
  async getExecutionProcess(processId) {
    return await this.makeRequest(`/processes/${processId}`, {
      method: 'GET',
    });
  }

  /**
   * Stop a running execution process
   * @param {string} processId - UUID of execution process
   * @returns {Promise<Object>} Stop result
   */
  async stopExecutionProcess(processId) {
    return await this.makeRequest(`/processes/${processId}/stop`, {
      method: 'POST',
    });
  }

  /**
   * Get execution process logs
   * @param {string} processId - UUID of execution process
   * @param {boolean} normalized - Return normalized logs (default: false)
   * @returns {Promise<Object>} Process logs
   */
  async getProcessLogs(processId, normalized = false) {
    const endpoint = normalized
      ? `/processes/${processId}/logs/normalized`
      : `/processes/${processId}/logs/raw`;

    return await this.makeRequest(endpoint, {
      method: 'GET',
    });
  }

  /**
   * List execution processes for a task attempt
   * @param {string} taskAttemptId - UUID of task attempt
   * @param {boolean} showSoftDeleted - Include soft-deleted processes
   * @returns {Promise<Array>} Array of execution processes
   */
  async listExecutionProcesses(taskAttemptId, showSoftDeleted = false) {
    const params = new URLSearchParams({ task_attempt_id: taskAttemptId });
    if (showSoftDeleted) {
      params.append('show_soft_deleted', 'true');
    }

    return await this.makeRequest(`/processes?${params}`, {
      method: 'GET',
    });
  }

  // ============================================================
  // BRANCH OPERATIONS
  // ============================================================

  /**
   * Get branch synchronization status for a task attempt
   * @param {string} attemptId - UUID of attempt
   * @returns {Promise<Object>} Branch status (ahead, behind, conflicts, etc.)
   */
  async getBranchStatus(attemptId) {
    return await this.makeRequest(`/attempts/${attemptId}/branch-status`, {
      method: 'GET',
    });
  }

  /**
   * Get commits for a task attempt
   * @param {string} attemptId - UUID of attempt
   * @returns {Promise<Array>} Array of commits with metadata
   */
  async getAttemptCommits(attemptId) {
    return await this.makeRequest(`/attempts/${attemptId}/commits`, {
      method: 'GET',
    });
  }

  /**
   * Compare a commit to the current HEAD
   * @param {string} attemptId - UUID of attempt
   * @param {string} commitSha - Commit SHA to compare
   * @returns {Promise<Object>} Comparison result
   */
  async compareCommitToHead(attemptId, commitSha) {
    return await this.makeRequest(`/attempts/${attemptId}/compare/${commitSha}`, {
      method: 'GET',
    });
  }

  /**
   * Abort merge/rebase conflicts
   * @param {string} attemptId - UUID of attempt
   * @returns {Promise<Object>} Abort result
   */
  async abortConflicts(attemptId) {
    return await this.makeRequest(`/attempts/${attemptId}/abort-conflicts`, {
      method: 'POST',
    });
  }

  // ============================================================
  // DEV SERVER OPERATIONS
  // ============================================================

  /**
   * Start development server for a task attempt
   * @param {string} attemptId - UUID of attempt
   * @returns {Promise<Object>} Dev server details
   */
  async startDevServer(attemptId) {
    return await this.makeRequest(`/attempts/${attemptId}/dev-server/start`, {
      method: 'POST',
    });
  }

  /**
   * Stop development server
   * @param {string} attemptId - UUID of attempt
   * @returns {Promise<Object>} Stop result
   */
  async stopDevServer(attemptId) {
    return await this.makeRequest(`/attempts/${attemptId}/dev-server/stop`, {
      method: 'POST',
    });
  }

  // ============================================================
  // UTILITY METHODS
  // ============================================================

  /**
   * Get client statistics
   * @returns {Object} Client stats
   */
  getStats() {
    return {
      type: 'rest',
      baseUrl: this.baseUrl,
      timeout: this.timeout,
      name: this.name,
    };
  }
}

/**
 * Factory function to create Vibe REST client
 * @param {string} url - Base URL (can include /mcp suffix, will be converted)
 * @param {Object} options - Client options
 * @returns {VibeRestClient}
 */
export function createVibeRestClient(url, options = {}) {
  return new VibeRestClient(url, options);
}
