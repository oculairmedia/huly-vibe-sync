/**
 * Huly REST API Client
 *
 * Direct REST API client for Huly platform that provides faster
 * access than MCP protocol and better support for incremental sync
 */

import fetch from 'node-fetch';
import { fetchWithPool } from './http.js';

/**
 * REST API client for Huly platform
 */
export class HulyRestClient {
  constructor(baseUrl, options = {}) {
    // Ensure we have the correct REST API URL
    // The REST API runs on port 3458
    // Remove any existing path suffixes, set port to 3458, and add /api
    this.baseUrl = baseUrl
      .replace(/\/mcp$/, '')   // Remove /mcp suffix if present
      .replace(/\/api$/, '')   // Remove /api suffix if present
      .replace(/:\d+/, ':3458') // Set port to 3458
      + '/api';                 // Add /api suffix
    this.name = options.name || 'Huly REST';
    this.timeout = options.timeout || 60000; // 60 second default timeout
  }

  /**
   * Initialize the client (for compatibility with MCP client interface)
   */
  async initialize() {
    console.log(`[${this.name}] Initializing REST API client...`);
    console.log(`[${this.name}] API URL: ${this.baseUrl}`);

    // Test connectivity
    try {
      const healthUrl = this.baseUrl.replace('/api', '/health');
      console.log(`[${this.name}] Testing health endpoint: ${healthUrl}`);
      
      const response = await fetchWithPool(healthUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      console.log(`[${this.name}] Response status: ${response?.status}`);

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Health check result:`, JSON.stringify(result));
      
      if (result && result.status) {
        console.log(`[${this.name}] Connected successfully - Status: ${result.status}, Connected: ${result.connected}`);
        return true;
      } else {
        throw new Error('Invalid health check response format');
      }
    } catch (error) {
      console.error(`[${this.name}] Failed to connect:`, error.message);
      console.error(`[${this.name}] Error stack:`, error.stack);
      throw error;
    }
  }

  /**
   * Health check endpoint
   */
  async healthCheck() {
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
  }

  /**
   * Call a Huly tool via REST API
   * @param {string} toolName - Name of the tool to call
   * @param {Object} args - Tool arguments
   * @returns {Promise<Object>} Tool result
   */
  async callTool(toolName, args = {}) {
    const url = `${this.baseUrl}/tools/${toolName}`;
    const startTime = Date.now();

    try {
      const response = await fetchWithPool(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: args }),
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(`Tool execution failed: ${JSON.stringify(result)}`);
      }

      // Log execution time for performance monitoring
      if (executionTime > 5000) {
        console.log(`[${this.name}] Slow tool execution: ${toolName} took ${executionTime}ms`);
      }

      // Extract text from MCP-style content array if present
      const toolResult = result.data.result;
      if (toolResult && toolResult.content && Array.isArray(toolResult.content)) {
        // MCP protocol format: {content: [{type: "text", text: "..."}]}
        const textContent = toolResult.content.find(c => c.type === 'text');
        if (textContent) {
          return textContent.text;
        }
      }

      // Return the result as-is if not in content array format
      return toolResult;

    } catch (error) {
      console.error(`[${this.name}] Tool call failed:`, {
        tool: toolName,
        args,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * List all available projects
   */
  async listProjects() {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/projects`;
      const response = await fetchWithPool(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();

      // Log execution time for performance monitoring
      if (executionTime > 5000) {
        console.log(`[${this.name}] Slow API call: list projects took ${executionTime}ms`);
      }

      return result.projects;

    } catch (error) {
      console.error(`[${this.name}] List projects failed:`, error.message);
      throw error;
    }
  }

  /**
   * List components for a project
   * @param {string} projectIdentifier - Project identifier
   * @returns {Promise<Array>} Array of components with label and description
   */
  async listComponents(projectIdentifier) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/projects/${projectIdentifier}/components`;
      
      const response = await fetchWithPool(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Fetched ${result.count || 0} components for ${projectIdentifier} in ${executionTime}ms`);
      
      return result.components || [];

    } catch (error) {
      console.error(`[${this.name}] List components failed for ${projectIdentifier}:`, error.message);
      throw error;
    }
  }

  /**
   * List issues for a project with optional incremental sync
   * @param {string} projectIdentifier - Project identifier
   * @param {Object} options - Query options
   * @param {string} options.modifiedSince - ISO timestamp for incremental sync (modifiedSince param)
   * @param {string} options.modifiedAfter - Alias for modifiedSince (deprecated)
   * @param {string} options.createdSince - ISO timestamp to filter by creation date
   * @param {number} options.limit - Maximum number of issues to return
   * @param {boolean} options.includeSyncMeta - Return {issues, syncMeta} instead of just issues
   * @returns {Promise<Array|Object>} Array of issues, or {issues, syncMeta} if includeSyncMeta=true
   */
  async listIssues(projectIdentifier, options = {}) {
    const startTime = Date.now();

    try {
      // Build query parameters
      const params = new URLSearchParams();
      
      // Support both modifiedSince (new) and modifiedAfter (old) parameter names
      const modifiedSince = options.modifiedSince || options.modifiedAfter;
      if (modifiedSince) {
        params.append('modifiedSince', modifiedSince);
      }
      if (options.createdSince) {
        params.append('createdSince', options.createdSince);
      }
      if (options.limit) {
        params.append('limit', options.limit.toString());
      }

      const queryString = params.toString();
      const url = `${this.baseUrl}/projects/${projectIdentifier}/issues${queryString ? '?' + queryString : ''}`;

      const response = await fetchWithPool(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();

      // Log execution time for performance monitoring
      const syncInfo = modifiedSince ? ` (incremental since ${modifiedSince})` : '';
      console.log(`[${this.name}] Fetched ${result.count} issues from ${projectIdentifier}${syncInfo} in ${executionTime}ms`);

      // Return full result with syncMeta if requested, otherwise just issues for backward compatibility
      if (options.includeSyncMeta) {
        return {
          issues: result.issues,
          syncMeta: result.syncMeta || {
            latestModified: null,
            serverTime: new Date().toISOString(),
          },
          count: result.count,
        };
      }

      return result.issues;

    } catch (error) {
      console.error(`[${this.name}] List issues failed for ${projectIdentifier}:`, error.message);
      throw error;
    }
  }

  /**
   * Bulk fetch issues from multiple projects in a single API call
   * @param {string[]} projectIdentifiers - Array of project identifiers
   * @param {Object} options - Query options
   * @param {string} options.modifiedSince - ISO timestamp for incremental sync
   * @param {number} options.limit - Maximum issues per project (default 1000)
   * @returns {Promise<Object>} Map of projectId -> {issues, count, syncMeta}
   */
  async listIssuesBulk(projectIdentifiers, options = {}) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/bulk-by-projects`;
      const body = {
        projects: projectIdentifiers,
      };

      if (options.modifiedSince) {
        body.modifiedSince = options.modifiedSince;
      }
      if (options.limit) {
        body.limit = options.limit;
      }

      const response = await fetchWithPool(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();

      const syncInfo = options.modifiedSince ? ` (incremental since ${options.modifiedSince})` : '';
      console.log(`[${this.name}] Bulk fetched ${result.totalIssues} issues from ${result.projectCount} projects${syncInfo} in ${executionTime}ms`);

      return result;

    } catch (error) {
      console.error(`[${this.name}] Bulk list issues failed:`, error.message);
      throw error;
    }
  }

  /**
   * Get detailed issue information
   * @param {string} issueIdentifier - Issue identifier (e.g., "PROJECT-123")
   */
  async getIssue(issueIdentifier) {
    const url = `${this.baseUrl}/issues/${issueIdentifier}`;
    
    try {
      const response = await fetchWithPool(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error(`[${this.name}] getIssue failed for ${issueIdentifier}:`, error.message);
      throw error;
    }
  }

  /**
   * Search issues across projects with filters
   * @param {Object} filters - Search filters
   * @param {string} filters.query - Search query text
   * @param {string} filters.status - Filter by status
   * @param {string} filters.priority - Filter by priority
   * @param {string} filters.modifiedAfter - ISO timestamp for incremental sync
   * @param {number} limit - Maximum results
   */
  async searchIssues(filters = {}, limit = 100) {
    const queryParams = new URLSearchParams();
    queryParams.set('limit', limit.toString());
    
    if (filters.query) queryParams.set('query', filters.query);
    if (filters.status) queryParams.set('status', filters.status);
    if (filters.priority) queryParams.set('priority', filters.priority);
    if (filters.assignee) queryParams.set('assignee', filters.assignee);

    const url = `${this.baseUrl}/issues?${queryParams.toString()}`;
    
    try {
      const response = await fetchWithPool(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      return result.issues || [];
    } catch (error) {
      console.error(`[${this.name}] searchIssues failed:`, error.message);
      throw error;
    }
  }

  /**
   * Create a new issue
   * @param {string} projectIdentifier - Project identifier
   * @param {Object} issueData - Issue data
   */
  async createIssue(projectIdentifier, issueData) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues`;
      
      const response = await fetchWithPool(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_identifier: projectIdentifier,
          ...issueData,
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Created issue in ${projectIdentifier} in ${executionTime}ms`);
      
      return result;

    } catch (error) {
      console.error(`[${this.name}] Create issue failed for ${projectIdentifier}:`, error.message);
      throw error;
    }
  }

  /**
   * Update an existing issue
   * @param {string} issueIdentifier - Issue identifier (e.g., "PROJ-123")
   * @param {string} field - Field to update
   * @param {string} value - New value
   */
  async updateIssue(issueIdentifier, field, value) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/${issueIdentifier}`;
      
      const response = await fetchWithPool(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value }),
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();

      // Log execution time for performance monitoring
      if (executionTime > 1000) {
        console.log(`[${this.name}] Updated issue ${issueIdentifier} ${field} in ${executionTime}ms`);
      }

      return result;

    } catch (error) {
      console.error(`[${this.name}] Update issue failed for ${issueIdentifier}:`, error.message);
      throw error;
    }
  }

  /**
   * Get sub-issues of a parent issue
   * @param {string} issueIdentifier - Parent issue identifier (e.g., "PROJ-123")
   * @returns {Promise<Object>} Object with parentIssue, subIssues array, and count
   */
  async getSubIssues(issueIdentifier) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/${issueIdentifier}/subissues`;
      
      const response = await fetchWithPool(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Fetched ${result.count} sub-issues for ${issueIdentifier} in ${executionTime}ms`);
      
      return result;

    } catch (error) {
      console.error(`[${this.name}] Get sub-issues failed for ${issueIdentifier}:`, error.message);
      throw error;
    }
  }

  /**
   * Create a sub-issue under a parent issue
   * @param {string} parentIdentifier - Parent issue identifier (e.g., "PROJ-123")
   * @param {Object} issueData - Sub-issue data (title, description, priority, etc.)
   * @returns {Promise<Object>} Created sub-issue with parentIssue reference
   */
  async createSubIssue(parentIdentifier, issueData) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/${parentIdentifier}/subissues`;
      
      const response = await fetchWithPool(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(issueData),
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Created sub-issue under ${parentIdentifier} in ${executionTime}ms`);
      
      return result;

    } catch (error) {
      console.error(`[${this.name}] Create sub-issue failed for ${parentIdentifier}:`, error.message);
      throw error;
    }
  }

  /**
   * Get full issue hierarchy tree for a project
   * @param {string} projectIdentifier - Project identifier
   * @returns {Promise<Object>} Nested tree structure with parent/children relationships
   */
  async getIssueTree(projectIdentifier) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/projects/${projectIdentifier}/tree`;
      
      const response = await fetchWithPool(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Fetched issue tree for ${projectIdentifier} in ${executionTime}ms`);
      
      return result;

    } catch (error) {
      console.error(`[${this.name}] Get issue tree failed for ${projectIdentifier}:`, error.message);
      throw error;
    }
  }

  /**
   * Get comments for an issue
   * @param {string} issueIdentifier - Issue identifier (e.g., "PROJ-123")
   * @returns {Promise<Array>} Array of comments
   */
  async getComments(issueIdentifier) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/${issueIdentifier}/comments`;
      
      const response = await fetchWithPool(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Fetched comments for ${issueIdentifier} in ${executionTime}ms`);
      
      return result.comments || [];

    } catch (error) {
      console.error(`[${this.name}] Get comments failed for ${issueIdentifier}:`, error.message);
      throw error;
    }
  }

  /**
   * Create a comment on an issue
   * @param {string} issueIdentifier - Issue identifier
   * @param {string} text - Comment text
   * @returns {Promise<Object>} Created comment
   */
  async createComment(issueIdentifier, text) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/${issueIdentifier}/comments`;
      
      const response = await fetchWithPool(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Created comment on ${issueIdentifier} in ${executionTime}ms`);
      
      return result;

    } catch (error) {
      console.error(`[${this.name}] Create comment failed for ${issueIdentifier}:`, error.message);
      throw error;
    }
  }

  /**
   * Delete an issue
   * @param {string} issueIdentifier - Issue identifier
   * @param {Object} options - Delete options
   * @param {boolean} options.cascade - Delete sub-issues too
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteIssue(issueIdentifier, options = {}) {
    const startTime = Date.now();

    try {
      let url = `${this.baseUrl}/issues/${issueIdentifier}`;
      if (options.cascade) {
        url += '?cascade=true';
      }
      
      const response = await fetchWithPool(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      console.log(`[${this.name}] Deleted issue ${issueIdentifier} in ${executionTime}ms`);
      return true;

    } catch (error) {
      console.error(`[${this.name}] Delete issue failed for ${issueIdentifier}:`, error.message);
      throw error;
    }
  }

  /**
   * Update multiple fields on an issue in one request
   * @param {string} issueIdentifier - Issue identifier
   * @param {Object} updates - Fields to update (title, description, status, priority, component, milestone, assignee)
   * @returns {Promise<Object>} Updated issue
   */
  async patchIssue(issueIdentifier, updates) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/${issueIdentifier}`;
      
      const response = await fetchWithPool(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Patched issue ${issueIdentifier} in ${executionTime}ms`);
      
      return result;

    } catch (error) {
      console.error(`[${this.name}] Patch issue failed for ${issueIdentifier}:`, error.message);
      throw error;
    }
  }

  /**
   * Search issues globally across all projects
   * @param {Object} filters - Search filters (query, status, priority, assignee)
   * @returns {Promise<Array>} Matching issues
   */
  async searchIssuesGlobal(filters = {}) {
    const startTime = Date.now();

    try {
      const params = new URLSearchParams();
      if (filters.query) params.append('query', filters.query);
      if (filters.status) params.append('status', filters.status);
      if (filters.priority) params.append('priority', filters.priority);
      if (filters.assignee) params.append('assignee', filters.assignee);

      const queryString = params.toString();
      const url = `${this.baseUrl}/issues${queryString ? '?' + queryString : ''}`;
      
      const response = await fetchWithPool(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Global search returned ${result.count || 0} issues in ${executionTime}ms`);
      
      return result.issues || [];

    } catch (error) {
      console.error(`[${this.name}] Global search failed:`, error.message);
      throw error;
    }
  }

  /**
   * Batch fetch multiple issues by IDs
   * @param {Array<string>} identifiers - Array of issue identifiers
   * @returns {Promise<Array>} Array of issues
   */
  async getIssuesBulk(identifiers) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/bulk?ids=${identifiers.join(',')}`;
      
      const response = await fetchWithPool(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Bulk fetch returned ${result.issues?.length || 0} issues in ${executionTime}ms`);
      
      return result.issues || [];

    } catch (error) {
      console.error(`[${this.name}] Bulk fetch failed:`, error.message);
      throw error;
    }
  }

  /**
   * Move an issue under a new parent (reparenting)
   * @param {string} issueIdentifier - Issue to move
   * @param {string|null} parentIdentifier - New parent identifier, or null to detach to top-level
   * @returns {Promise<Object>} Move result with moved, parentIssue, isTopLevel
   */
  async moveIssue(issueIdentifier, parentIdentifier) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/${issueIdentifier}/parent`;
      
      const response = await fetchWithPool(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentIdentifier }),
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      const action = parentIdentifier ? `under ${parentIdentifier}` : 'to top-level';
      console.log(`[${this.name}] Moved issue ${issueIdentifier} ${action} in ${executionTime}ms`);
      
      return result;

    } catch (error) {
      console.error(`[${this.name}] Move issue failed for ${issueIdentifier}:`, error.message);
      throw error;
    }
  }

  /**
   * Update issue due date
   * @param {string} issueIdentifier - Issue identifier
   * @param {string|Date|null} dueDate - Due date (ISO string, Date object, or null to clear)
   * @returns {Promise<Object>} Updated issue
   */
  async updateIssueDueDate(issueIdentifier, dueDate) {
    // Convert Date to ISO string if needed
    const dueDateValue = dueDate instanceof Date ? dueDate.toISOString() : dueDate;
    
    return this.patchIssue(issueIdentifier, { dueDate: dueDateValue });
  }

  /**
   * Bulk delete multiple issues
   * @param {Array<string>} identifiers - Array of issue identifiers to delete
   * @param {Object} options - Delete options
   * @param {boolean} options.cascade - If true, delete sub-issues; if false (default), move sub-issues to parent level
   * @returns {Promise<Object>} Result with deleted array, succeeded/failed counts, and errors
   */
  async deleteIssuesBulk(identifiers, options = {}) {
    const startTime = Date.now();

    try {
      const url = `${this.baseUrl}/issues/bulk`;
      
      const response = await fetchWithPool(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifiers,
          cascade: options.cascade || false,
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Bulk deleted ${result.succeeded}/${identifiers.length} issues in ${executionTime}ms`);
      
      return result;

    } catch (error) {
      console.error(`[${this.name}] Bulk delete failed:`, error.message);
      throw error;
    }
  }

  /**
   * Get project activity feed
   * @param {string} projectIdentifier - Project identifier
   * @param {Object} options - Query options
   * @param {string} options.since - ISO timestamp (default: 24 hours ago)
   * @param {number} options.limit - Max activities to return (default 100, max 500)
   * @returns {Promise<Object>} Activity feed with activities array, count, summary, and byStatus
   */
  async getProjectActivity(projectIdentifier, options = {}) {
    const startTime = Date.now();

    try {
      const params = new URLSearchParams();
      if (options.since) {
        params.append('since', options.since);
      }
      if (options.limit) {
        params.append('limit', options.limit.toString());
      }

      const queryString = params.toString();
      const url = `${this.baseUrl}/projects/${projectIdentifier}/activity${queryString ? '?' + queryString : ''}`;
      
      const response = await fetchWithPool(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout),
      });

      const executionTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`REST API error (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log(`[${this.name}] Fetched ${result.count} activities for ${projectIdentifier} in ${executionTime}ms`);
      
      return result;

    } catch (error) {
      console.error(`[${this.name}] Get project activity failed for ${projectIdentifier}:`, error.message);
      throw error;
    }
  }

  /**
   * Get client statistics
   */
  getStats() {
    return {
      type: 'rest',
      baseUrl: this.baseUrl,
      timeout: this.timeout,
    };
  }
}

/**
 * Factory function to create Huly REST client
 * @param {string} url - Base URL (can include /mcp suffix, will be converted)
 * @param {Object} options - Client options
 * @returns {HulyRestClient}
 */
export function createHulyRestClient(url, options = {}) {
  return new HulyRestClient(url, options);
}
