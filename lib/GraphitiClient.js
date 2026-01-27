/**
 * GraphitiClient - Adapter for Graphiti Knowledge Graph API
 *
 * Provides methods for syncing code structure to the Graphiti Knowledge Graph.
 * Used by CodePerceptionWatcher for real-time code indexing.
 *
 * API Endpoints:
 * - POST /entity-node - Create/upsert entity nodes (files, symbols)
 * - PATCH /nodes/{uuid}/summary - Update node summary
 * - POST /api/tools/prune-missing - Invalidate deleted files
 * - GET /api/utils/uuid - Deterministic UUID generation
 * - GET /api/utils/edge-uuid - Edge UUID generation
 * - POST /messages - Add narrative context (commit messages)
 */

import { fetchWithPool } from './http.js';
import { logger } from './logger.js';

/**
 * Simple token bucket rate limiter
 */
class RateLimiter {
  constructor(tokensPerSecond) {
    this.tokensPerSecond = tokensPerSecond;
    this.tokens = tokensPerSecond;
    this.lastRefill = Date.now();
  }

  async acquire() {
    this._refill();
    if (this.tokens >= 1) {
      this.tokens--;
      return;
    }
    const waitMs = Math.ceil((1 - this.tokens) * (1000 / this.tokensPerSecond));
    await new Promise(resolve => setTimeout(resolve, waitMs));
    this._refill();
    this.tokens--;
  }

  _refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = (elapsed / 1000) * this.tokensPerSecond;
    this.tokens = Math.min(this.tokensPerSecond, this.tokens + newTokens);
    this.lastRefill = now;
  }
}

export class GraphitiClient {
  /**
   * Create a new GraphitiClient instance
   *
   * @param {Object} options - Configuration options
   * @param {string} options.baseUrl - Graphiti API base URL (e.g., 'http://localhost:8003')
   * @param {string} options.groupId - Group ID for namespace isolation (e.g., 'vibesync_huly-vibe-sync')
   * @param {number} [options.timeout=30000] - Request timeout in ms
   * @param {number} [options.retries=3] - Number of retry attempts for transient failures
   * @param {number} [options.retryDelayMs=1000] - Delay between retries
   */
  constructor(options) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, ''); // Remove trailing slash
    this.groupId = options.groupId;
    this.timeout = options.timeout || 30000;
    this.retries = options.retries ?? 3;
    this.retryDelayMs = options.retryDelayMs || 1000;

    this.log = logger.child({ service: 'GraphitiClient', groupId: this.groupId });

    // Stats for monitoring
    this.stats = {
      entitiesCreated: 0,
      entitiesUpdated: 0,
      pruneOperations: 0,
      errors: 0,
      retries: 0,
    };
  }

  // ============================================================================
  // UUID Generation
  // ============================================================================

  /**
   * Get UUID from Graphiti server (authoritative source).
   * Uses server-side normalization for consistency.
   */
  async getEntityUuid(name, groupId = this.groupId) {
    const cacheKey = `${groupId}:${name}`;
    if (this.uuidCache?.has(cacheKey)) {
      return this.uuidCache.get(cacheKey);
    }

    const url = new URL(`${this.baseUrl}/api/utils/uuid`);
    url.searchParams.set('name', name);
    url.searchParams.set('group_id', groupId);

    const response = await this._fetch(url.toString(), { method: 'GET' });
    const uuid = response.uuid;

    if (!this.uuidCache) this.uuidCache = new Map();
    this.uuidCache.set(cacheKey, uuid);

    return uuid;
  }

  async getEdgeUuid(sourceUuid, targetUuid, name, groupId = this.groupId) {
    const url = new URL(`${this.baseUrl}/api/utils/edge-uuid`);
    url.searchParams.set('source_uuid', sourceUuid);
    url.searchParams.set('target_uuid', targetUuid);
    url.searchParams.set('name', name);
    url.searchParams.set('group_id', groupId);

    const response = await this._fetch(url.toString(), { method: 'GET' });
    return response.uuid;
  }

  // ============================================================================
  // Entity Operations
  // ============================================================================

  /**
   * Create or update an entity node
   *
   * @param {Object} entity - Entity data
   * @param {string} entity.name - Entity name (e.g., 'File:src/main.py')
   * @param {string} [entity.summary] - Entity summary/description
   * @param {string} [entity.uuid] - Pre-calculated UUID (optional, will generate if not provided)
   * @returns {Promise<Object>} Created/updated entity node
   */
  async upsertEntity(entity) {
    const uuid = entity.uuid || (await this.getEntityUuid(entity.name));

    const requestBody = {
      uuid,
      name: entity.name,
      group_id: this.groupId,
      summary: entity.summary || '',
    };

    this.log.debug({ name: entity.name, uuid }, 'Upserting entity');

    const result = await this._fetch(`${this.baseUrl}/entity-node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    this.stats.entitiesCreated++;
    return result;
  }

  /**
   * Upsert multiple entities in batch
   *
   * @param {Array<Object>} entities - Array of entity objects
   * @param {number} [batchSize=50] - Number of entities per batch
   * @returns {Promise<Object>} Summary of results
   */
  async upsertEntitiesBatch(entities, batchSize = 50) {
    const results = {
      success: 0,
      failed: 0,
      errors: [],
      successfulEntities: [],
    };

    // Process in batches to avoid overwhelming the API
    for (let i = 0; i < entities.length; i += batchSize) {
      const batch = entities.slice(i, i + batchSize);

      // Process batch in parallel
      const batchPromises = batch.map(async entity => {
        try {
          await this.upsertEntity(entity);
          results.success++;
          results.successfulEntities.push(entity.name);
        } catch (error) {
          results.failed++;
          results.errors.push({ entity: entity.name, error: error.message });
        }
      });

      await Promise.all(batchPromises);

      // Small delay between batches
      if (i + batchSize < entities.length) {
        await this._delay(100);
      }
    }

    this.log.info(
      {
        total: entities.length,
        success: results.success,
        failed: results.failed,
      },
      'Batch upsert completed'
    );

    return results;
  }

  /**
   * Update only the summary of an existing node
   * Lighter weight than full entity upsert
   *
   * @param {string} uuid - Entity UUID
   * @param {string} summary - New summary text
   * @returns {Promise<Object>} Updated node
   */
  async updateNodeSummary(uuid, summary) {
    this.log.debug({ uuid }, 'Updating node summary');

    const result = await this._fetch(`${this.baseUrl}/nodes/${uuid}/summary`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary }),
    });

    this.stats.entitiesUpdated++;
    return result;
  }

  // ============================================================================
  // Edge Operations
  // ============================================================================

  /**
   * Create a containment edge between project and file
   * Uses POST /entity-edge endpoint (no LLM overhead)
   *
   * @param {string} projectId - Project identifier (e.g., 'GRAPH')
   * @param {string} fileRelativePath - Relative path of file (e.g., 'src/main.py')
   * @returns {Promise<Object>} Created edge
   */
  async createContainmentEdge(projectId, fileRelativePath) {
    const sourceName = `Project:${projectId}`;
    const targetName = `File:${fileRelativePath}`;

    const [sourceUuid, targetUuid] = await Promise.all([
      this.getEntityUuid(sourceName),
      this.getEntityUuid(targetName),
    ]);

    const edgeUuid = await this.getEdgeUuid(sourceUuid, targetUuid, 'CONTAINS');

    const requestBody = {
      uuid: edgeUuid,
      source_node_uuid: sourceUuid,
      target_node_uuid: targetUuid,
      name: 'CONTAINS',
      group_id: this.groupId,
      fact: `Project ${projectId} contains file ${fileRelativePath}`,
    };

    this.log.debug({ projectId, file: fileRelativePath, edgeUuid }, 'Creating containment edge');

    try {
      const result = await this._fetch(`${this.baseUrl}/entity-edge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      this.stats.edgesCreated = (this.stats.edgesCreated || 0) + 1;
      return result;
    } catch (error) {
      if (error.message?.includes('HTTP 500')) {
        this.log.warn(
          { projectId, file: fileRelativePath, error: error.message },
          'Direct edge creation failed, using message queue fallback'
        );
        return this._createEdgeViaMessageQueue(projectId, fileRelativePath);
      }
      throw error;
    }
  }

  async _createEdgeViaMessageQueue(projectId, fileRelativePath) {
    const message = {
      content: `CODE_INDEX_EVENT: Project "${projectId}" contains file "${fileRelativePath}". This file is part of the ${projectId} project structure.`,
      role_type: 'system',
      role: 'code_indexer',
      name: 'file_containment',
      timestamp: new Date().toISOString(),
      source_description: 'huly-vibe-sync CodePerception',
    };

    const result = await this._fetch(`${this.baseUrl}/api/queue/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id: this.groupId,
        messages: [message],
      }),
    });

    this.stats.edgesFallback = (this.stats.edgesFallback || 0) + 1;
    return result;
  }

  /**
   * Create containment edges for multiple files in batch
   *
   * @param {string} projectId - Project identifier
   * @param {string[]} fileRelativePaths - Array of relative file paths
   * @param {number} [batchSize=50] - Number of edges per batch
   * @returns {Promise<Object>} Summary of results
   */
  async createContainmentEdgesBatch(projectId, fileRelativePaths, batchSize = 50) {
    const results = {
      success: 0,
      failed: 0,
      errors: [],
    };

    for (let i = 0; i < fileRelativePaths.length; i += batchSize) {
      const batch = fileRelativePaths.slice(i, i + batchSize);

      const batchPromises = batch.map(async filePath => {
        try {
          await this.createContainmentEdge(projectId, filePath);
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push({ file: filePath, error: error.message });
        }
      });

      await Promise.all(batchPromises);

      if (i + batchSize < fileRelativePaths.length) {
        await this._delay(100);
      }
    }

    this.log.info(
      {
        projectId,
        total: fileRelativePaths.length,
        success: results.success,
        failed: results.failed,
      },
      'Batch edge creation completed'
    );

    return results;
  }

  // ============================================================================
  // Function Entity Operations
  // ============================================================================

  /**
   * Create or update a Function entity
   *
   * @param {Object} options - Function options
   * @param {string} options.projectId - Project identifier
   * @param {string} options.filePath - Relative file path
   * @param {string} options.name - Function name
   * @param {string} options.signature - Function signature
   * @param {string} [options.docstring] - Function docstring
   * @param {number} options.startLine - Starting line number
   * @param {number} options.endLine - Ending line number
   * @returns {Promise<Object>} Created/updated entity
   */
  async upsertFunction(options) {
    const { projectId, filePath, name, signature, docstring, startLine, endLine } = options;

    const entityName = `function:${projectId}:${filePath}:${name}`;
    const summary = this._buildFunctionSummary({ signature, docstring, startLine, endLine });

    return this.upsertEntity({ name: entityName, summary });
  }

  /**
   * Build summary text for a function entity
   * @private
   */
  _buildFunctionSummary({ signature, docstring, startLine, endLine }) {
    const parts = [signature];
    if (docstring) {
      parts.push('');
      parts.push(docstring);
    }
    parts.push('');
    parts.push(`Lines: ${startLine}-${endLine}`);
    return parts.join('\n');
  }

  /**
   * Create a containment edge between file and function
   *
   * @param {string} projectId - Project identifier
   * @param {string} filePath - Relative file path
   * @param {string} functionName - Function name
   * @returns {Promise<Object>} Created edge
   */
  async createFileFunctionEdge(projectId, filePath, functionName) {
    const sourceName = `File:${filePath}`;
    const targetName = `function:${projectId}:${filePath}:${functionName}`;

    const [sourceUuid, targetUuid] = await Promise.all([
      this.getEntityUuid(sourceName),
      this.getEntityUuid(targetName),
    ]);

    const edgeUuid = await this.getEdgeUuid(sourceUuid, targetUuid, 'CONTAINS');

    const requestBody = {
      uuid: edgeUuid,
      source_node_uuid: sourceUuid,
      target_node_uuid: targetUuid,
      name: 'CONTAINS',
      group_id: this.groupId,
      fact: `File ${filePath} contains function ${functionName}`,
    };

    this.log.debug({ filePath, functionName, edgeUuid }, 'Creating file-function edge');

    const result = await this._fetch(`${this.baseUrl}/entity-edge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    this.stats.edgesCreated = (this.stats.edgesCreated || 0) + 1;
    return result;
  }

  /**
   * Upsert multiple functions and create their edges in parallel with rate limiting
   *
   * @param {Object} options - Batch options
   * @param {string} options.projectId - Project identifier
   * @param {string} options.filePath - Relative file path
   * @param {Array<Object>} options.functions - Array of function info objects
   * @param {number} [options.concurrency=10] - Max concurrent operations
   * @param {number} [options.rateLimit=100] - Max operations per second
   * @returns {Promise<Object>} Summary of results
   */
  async upsertFunctionsWithEdges(options) {
    const { projectId, filePath, functions, concurrency = 10, rateLimit = 100 } = options;

    if (functions.length === 0) {
      return { entities: { success: 0, failed: 0 }, edges: { success: 0, failed: 0 } };
    }

    const results = {
      entities: { success: 0, failed: 0, errors: [] },
      edges: { success: 0, failed: 0, errors: [] },
    };

    const rateLimiter = new RateLimiter(rateLimit);

    const processFunction = async func => {
      await rateLimiter.acquire();

      try {
        await this.upsertFunction({
          projectId,
          filePath,
          name: func.name,
          signature: func.signature,
          docstring: func.docstring,
          startLine: func.start_line,
          endLine: func.end_line,
        });
        results.entities.success++;
      } catch (error) {
        results.entities.failed++;
        results.entities.errors.push({ function: func.name, error: error.message });
        return;
      }

      await rateLimiter.acquire();

      try {
        await this.createFileFunctionEdge(projectId, filePath, func.name);
        results.edges.success++;
      } catch (error) {
        results.edges.failed++;
        results.edges.errors.push({ function: func.name, error: error.message });
      }
    };

    await this._parallelLimit(functions, processFunction, concurrency);

    this.log.info(
      {
        filePath,
        functions: functions.length,
        entitiesSuccess: results.entities.success,
        edgesSuccess: results.edges.success,
      },
      'Functions batch upsert completed'
    );

    return results;
  }

  /**
   * Delete function entities for a file (cascade delete)
   *
   * @param {string} projectId - Project identifier
   * @param {string} filePath - Relative file path
   * @param {string[]} functionNames - Array of function names to delete
   * @returns {Promise<Object>} Summary of results
   */
  async deleteFunctions(projectId, filePath, functionNames) {
    const results = { deleted: 0, failed: 0, errors: [] };

    for (const name of functionNames) {
      const entityName = `function:${projectId}:${filePath}:${name}`;
      try {
        const uuid = await this.getEntityUuid(entityName);
        await this._fetch(`${this.baseUrl}/nodes/${uuid}`, {
          method: 'DELETE',
        });
        results.deleted++;
      } catch (error) {
        if (!error.message?.includes('HTTP 404')) {
          results.failed++;
          results.errors.push({ function: name, error: error.message });
        }
      }
    }

    this.log.info({ filePath, deleted: results.deleted }, 'Functions deleted');
    return results;
  }

  // ============================================================================
  // Parallel Bulk Sync Operations
  // ============================================================================

  /**
   * Sync multiple files with their functions in parallel
   *
   * @param {Object} options - Sync options
   * @param {string} options.projectId - Project identifier
   * @param {Array<Object>} options.files - Array of { filePath, functions } objects
   * @param {number} [options.concurrency=10] - Max concurrent file operations
   * @param {number} [options.rateLimit=100] - Max API calls per second
   * @returns {Promise<Object>} Summary of results
   */
  async syncFilesWithFunctions(options) {
    const { projectId, files, concurrency = 10, rateLimit = 100 } = options;

    if (files.length === 0) {
      return { files: 0, entities: 0, edges: 0, errors: [] };
    }

    const results = {
      files: 0,
      entities: 0,
      edges: 0,
      errors: [],
    };

    const rateLimiter = new RateLimiter(rateLimit);
    const startTime = Date.now();

    const processFile = async fileData => {
      const { filePath, functions } = fileData;

      try {
        const fileResults = await this.upsertFunctionsWithEdges({
          projectId,
          filePath,
          functions,
          concurrency: Math.min(concurrency, 5),
          rateLimit,
        });

        results.files++;
        results.entities += fileResults.entities.success;
        results.edges += fileResults.edges.success;

        if (fileResults.entities.errors.length > 0) {
          results.errors.push(...fileResults.entities.errors.map(e => ({ file: filePath, ...e })));
        }
        if (fileResults.edges.errors.length > 0) {
          results.errors.push(...fileResults.edges.errors.map(e => ({ file: filePath, ...e })));
        }
      } catch (error) {
        results.errors.push({ file: filePath, error: error.message });
      }
    };

    await this._parallelLimit(files, processFile, concurrency);

    const elapsed = Date.now() - startTime;
    this.log.info(
      {
        projectId,
        files: results.files,
        entities: results.entities,
        edges: results.edges,
        elapsed,
        filesPerSecond: Math.round((results.files / elapsed) * 1000),
      },
      'Bulk file sync completed'
    );

    return results;
  }

  /**
   * Execute async operations with concurrency limit
   * @private
   */
  async _parallelLimit(items, operation, limit) {
    const executing = new Set();

    for (const item of items) {
      const promise = operation(item).finally(() => executing.delete(promise));
      executing.add(promise);

      if (executing.size >= limit) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
  }

  // ============================================================================
  // Maintenance Operations
  // ============================================================================

  /**
   * Mark deleted files as invalid
   * Finds all file-like EntityNodes in the group NOT in activeFiles list
   * and sets invalid_at timestamp (soft delete)
   *
   * @param {string[]} activeFiles - Array of file paths that currently exist
   * @returns {Promise<Object>} Prune result with invalidated count
   */
  async pruneDeletedFiles(activeFiles) {
    this.log.info({ activeFileCount: activeFiles.length }, 'Pruning deleted files');

    const result = await this._fetch(`${this.baseUrl}/api/tools/prune-missing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id: this.groupId,
        active_files: activeFiles,
      }),
    });

    this.stats.pruneOperations++;

    if (result.invalidated_count > 0) {
      this.log.info(
        {
          invalidatedCount: result.invalidated_count,
          invalidatedFiles: result.invalidated_files,
        },
        'Files marked as invalid'
      );
    }

    return result;
  }

  // ============================================================================
  // Context Operations
  // ============================================================================

  /**
   * Add a commit message as narrative context
   * The LLM will extract entities and relationships
   *
   * @param {Object} options - Message options
   * @param {string} options.content - Message content (commit message, description)
   * @param {string} [options.name] - Message name/title
   * @param {string} [options.role='code_analyzer'] - Role type
   * @param {Date} [options.timestamp] - Timestamp (defaults to now)
   * @returns {Promise<Object>} Result
   */
  async addMessage(options) {
    const message = {
      content: options.content,
      name: options.name || 'code_update',
      role: options.role || 'code_analyzer',
      role_type: 'user',
      timestamp: (options.timestamp || new Date()).toISOString(),
    };

    this.log.debug({ name: message.name }, 'Adding message');

    return this._fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id: this.groupId,
        messages: [message],
      }),
    });
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get current statistics
   *
   * @returns {Object} Stats object
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      entitiesCreated: 0,
      entitiesUpdated: 0,
      pruneOperations: 0,
      errors: 0,
      retries: 0,
    };
  }

  /**
   * Check if Graphiti API is reachable
   *
   * @returns {Promise<boolean>} True if healthy
   */
  async healthCheck() {
    try {
      const response = await fetchWithPool(`${this.baseUrl}/healthcheck`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch (error) {
      this.log.warn({ error: error.message }, 'Health check failed');
      return false;
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Make HTTP request with retry logic
   *
   * @private
   */
  async _fetch(url, options, attempt = 1) {
    try {
      const response = await fetchWithPool(url, {
        ...options,
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorBody}`);
      }

      return response.json();
    } catch (error) {
      // Check if retryable
      const isRetryable = this._isRetryableError(error);

      if (isRetryable && attempt < this.retries) {
        this.stats.retries++;
        const delay = this.retryDelayMs * attempt; // Exponential backoff
        this.log.warn({ attempt, delay, error: error.message }, 'Retrying request');
        await this._delay(delay);
        return this._fetch(url, options, attempt + 1);
      }

      this.stats.errors++;
      this.log.error({ url, error: error.message }, 'Request failed');
      throw error;
    }
  }

  /**
   * Check if error is retryable
   *
   * @private
   */
  _isRetryableError(error) {
    // Network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
      return true;
    }
    // Timeout
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return true;
    }
    // 5xx server errors
    if (error.message?.includes('HTTP 5')) {
      return true;
    }
    // Rate limiting
    if (error.message?.includes('HTTP 429')) {
      return true;
    }
    return false;
  }

  /**
   * Delay helper
   *
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a GraphitiClient instance from config
 *
 * @param {Object} config - Application config
 * @param {string} projectIdentifier - Project identifier for group ID
 * @returns {GraphitiClient|null} Client instance or null if disabled
 */
export function createGraphitiClient(config, projectIdentifier) {
  if (!config.graphiti?.enabled) {
    return null;
  }

  const groupId = `${config.graphiti.groupIdPrefix || 'vibesync_'}${projectIdentifier}`;

  return new GraphitiClient({
    baseUrl: config.graphiti.apiUrl,
    groupId,
    timeout: config.graphiti.timeout || 30000,
    retries: config.graphiti.retries || 3,
  });
}
