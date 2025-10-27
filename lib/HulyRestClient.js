/**
 * Huly REST API Client
 *
 * Direct REST API client for Huly platform that provides faster
 * access than MCP protocol and better support for incremental sync
 */

import fetch from 'node-fetch';

/**
 * REST API client for Huly platform
 */
export class HulyRestClient {
  constructor(baseUrl, options = {}) {
    // Remove /mcp suffix if present and add /api prefix
    this.baseUrl = baseUrl.replace(/\/mcp$/, '/api');
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
      const response = await this.healthCheck();
      console.log(`[${this.name}] Connected successfully - ${response.data.status}`);
      return true;
    } catch (error) {
      console.error(`[${this.name}] Failed to connect:`, error.message);
      throw error;
    }
  }

  /**
   * Health check endpoint
   */
  async healthCheck() {
    const response = await fetch(`${this.baseUrl}/health`, {
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
      const response = await fetch(url, {
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
    return await this.callTool('huly_query', {
      entity_type: 'project',
      mode: 'list',
    });
  }

  /**
   * List issues for a project with optional incremental sync
   * @param {string} projectIdentifier - Project identifier
   * @param {Object} options - Query options
   * @param {string} options.modifiedAfter - ISO timestamp for incremental sync
   * @param {number} options.limit - Maximum number of issues to return
   * @returns {Promise<Object>} Query result
   */
  async listIssues(projectIdentifier, options = {}) {
    const params = {
      entity_type: 'issue',
      mode: options.modifiedAfter ? 'search' : 'list',
      project_identifier: projectIdentifier,
      options: {
        limit: options.limit || 100,
      },
    };

    // Add incremental sync filter if timestamp provided
    if (options.modifiedAfter) {
      params.filters = {
        modified_after: options.modifiedAfter,
      };
    }

    return await this.callTool('huly_query', params);
  }

  /**
   * Get detailed issue information
   * @param {string} issueIdentifier - Issue identifier (e.g., "PROJECT-123")
   */
  async getIssue(issueIdentifier) {
    return await this.callTool('huly_query', {
      entity_type: 'issue',
      mode: 'get',
      issue_identifier: issueIdentifier,
    });
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
    const params = {
      entity_type: 'issue',
      mode: 'search',
      filters: {},
      options: { limit },
    };

    // Add filters
    if (filters.query) params.filters.query = filters.query;
    if (filters.status) params.filters.status = filters.status;
    if (filters.priority) params.filters.priority = filters.priority;
    if (filters.modifiedAfter) params.filters.modified_after = filters.modifiedAfter;
    if (filters.projectIdentifier) params.project_identifier = filters.projectIdentifier;

    return await this.callTool('huly_query', params);
  }

  /**
   * Create a new issue
   * @param {string} projectIdentifier - Project identifier
   * @param {Object} issueData - Issue data
   */
  async createIssue(projectIdentifier, issueData) {
    return await this.callTool('huly_issue_ops', {
      operation: 'create',
      project_identifier: projectIdentifier,
      data: issueData,
    });
  }

  /**
   * Update an existing issue
   * @param {string} issueIdentifier - Issue identifier
   * @param {string} field - Field to update
   * @param {string} value - New value
   */
  async updateIssue(issueIdentifier, field, value) {
    return await this.callTool('huly_issue_ops', {
      operation: 'update',
      issue_identifier: issueIdentifier,
      update: { field, value },
    });
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
