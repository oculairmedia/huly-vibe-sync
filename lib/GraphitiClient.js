/**
 * GraphitiClient — Facade
 *
 * Delegates to domain-specific operation modules while preserving the original API surface.
 */

import { GraphitiHttpClient, RateLimiter } from './graphiti/GraphitiHttpClient.js';
import { GraphitiEntityOps } from './graphiti/GraphitiEntityOps.js';
import { GraphitiEdgeOps } from './graphiti/GraphitiEdgeOps.js';
import { GraphitiFunctionOps } from './graphiti/GraphitiFunctionOps.js';

export { RateLimiter } from './graphiti/GraphitiHttpClient.js';

export class GraphitiClient {
  constructor(options) {
    this._http = new GraphitiHttpClient(options);
    this._entities = new GraphitiEntityOps(this._http);
    this._edges = new GraphitiEdgeOps(this._http);
    this._functions = new GraphitiFunctionOps(this._http, this._entities, this._edges);
  }

  // Expose http client properties for backward compat
  get baseUrl() { return this._http.baseUrl; }
  get groupId() { return this._http.groupId; }
  get timeout() { return this._http.timeout; }
  get retries() { return this._http.retries; }
  get retryDelayMs() { return this._http.retryDelayMs; }
  get log() { return this._http.log; }
  get stats() { return this._http.stats; }
  set stats(v) { this._http.stats = v; }
  get uuidCache() { return this._http.uuidCache; }
  set uuidCache(v) { this._http.uuidCache = v; }

  // UUID operations
  getEntityUuid(...args) { return this._http.getEntityUuid(...args); }
  getEdgeUuid(...args) { return this._http.getEdgeUuid(...args); }

  // Entity operations
  upsertEntity(...args) { return this._entities.upsertEntity(...args); }
  upsertEntitiesBatch(...args) { return this._entities.upsertEntitiesBatch(...args); }
  updateNodeSummary(...args) { return this._entities.updateNodeSummary(...args); }
  pruneDeletedFiles(...args) { return this._entities.pruneDeletedFiles(...args); }

  // Edge operations
  createContainmentEdge(...args) { return this._edges.createContainmentEdge(...args); }
  _createEdgeViaMessageQueue(...args) { return this._edges._createEdgeViaMessageQueue(...args); }
  createContainmentEdgesBatch(...args) { return this._edges.createContainmentEdgesBatch(...args); }
  createFileFunctionEdge(...args) { return this._edges.createFileFunctionEdge(...args); }

  // Function operations
  upsertFunction(...args) { return this._functions.upsertFunction(...args); }
  _buildFunctionSummary(...args) { return this._functions._buildFunctionSummary(...args); }
  upsertFunctionsWithEdges(...args) { return this._functions.upsertFunctionsWithEdges(...args); }
  deleteFunctions(...args) { return this._functions.deleteFunctions(...args); }
  syncFilesWithFunctions(...args) { return this._functions.syncFilesWithFunctions(...args); }

  // Context operations
  async addMessage(options) {
    const message = {
      content: options.content,
      name: options.name || 'code_update',
      role: options.role || 'code_analyzer',
      role_type: 'user',
      timestamp: (options.timestamp || new Date()).toISOString(),
    };

    this._http.log.debug({ name: message.name }, 'Adding message');

    return this._http._fetch(`${this._http.baseUrl}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id: this._http.groupId,
        messages: [message],
      }),
    });
  }

  // Utility operations
  getStats() { return this._http.getStats(); }
  resetStats() { return this._http.resetStats(); }
  healthCheck() { return this._http.healthCheck(); }

  // Internal methods exposed for testing
  _fetch(...args) { return this._http._fetch(...args); }
  _isRetryableError(...args) { return this._http._isRetryableError(...args); }
  _delay(...args) { return this._http._delay(...args); }
  _parallelLimit(...args) { return this._http._parallelLimit(...args); }
}

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
