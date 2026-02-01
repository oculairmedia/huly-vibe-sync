/**
 * API Server - Extended REST API for Frontend Integration
 *
 * Provides endpoints for:
 * - Configuration management (GET/PATCH /api/config)
 * - Manual sync control (POST /api/sync/trigger)
 * - Sync history (GET /api/sync/history)
 * - Real-time updates via Server-Sent Events (GET /api/events/stream)
 * - Issue mappings (GET /api/sync/mappings)
 */

import http from 'http';
import { URL } from 'url';
import { logger } from './logger.js';
import { getHealthMetrics, updateSystemMetrics, getMetricsRegistry } from './HealthService.js';
import { registerHealthRoutes } from './api/routes/health.js';
import { registerProjectRoutes } from './api/routes/projects.js';
import { registerConfigRoutes } from './api/routes/config.js';
import { registerSyncRoutes } from './api/routes/sync.js';
import { registerBeadsRoutes } from './api/routes/beads.js';
import { registerEventsRoutes } from './api/routes/events.js';
import { registerFilesRoutes } from './api/routes/files.js';
import { registerLettaCodeRoutes } from './api/routes/lettaCode.js';
import { registerDocsRoutes } from './api/routes/docs.js';
import { registerWebhooksRoutes } from './api/routes/webhooks.js';
import { registerTemporalRoutes } from './api/routes/temporal.js';

/**
 * Parse JSON body from request
 *
 * @param {http.IncomingMessage} req - HTTP request
 * @returns {Promise<Object>} Parsed JSON object
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        resolve(parsed);
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Send JSON response
 *
 * @param {http.ServerResponse} res - HTTP response
 * @param {number} statusCode - HTTP status code
 * @param {Object} data - Data to send as JSON
 */
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*', // CORS - adjust in production
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data, null, 2));
}

/**
 * Send error response
 *
 * @param {http.ServerResponse} res - HTTP response
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {Object} [details] - Additional error details
 */
function sendError(res, statusCode, message, details = null) {
  const error = {
    error: message,
    statusCode,
    timestamp: new Date().toISOString(),
  };

  if (details) {
    error.details = details;
  }

  sendJson(res, statusCode, error);
}

/**
 * SSE Client Manager
 * Manages Server-Sent Events connections for real-time updates
 */
class SSEManager {
  constructor() {
    this.clients = new Set();
  }

  /**
   * Add a new SSE client
   *
   * @param {http.ServerResponse} res - HTTP response for SSE stream
   * @returns {string} Client ID
   */
  addClient(res) {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial connection event
    this.sendEvent(res, 'connected', { clientId, timestamp: new Date().toISOString() });

    // Add client to set
    const client = { id: clientId, res, connectedAt: Date.now() };
    this.clients.add(client);

    // Handle client disconnect
    res.on('close', () => {
      this.clients.delete(client);
      logger.info({ clientId }, 'SSE client disconnected');
    });

    logger.info({ clientId, totalClients: this.clients.size }, 'SSE client connected');

    return clientId;
  }

  /**
   * Send event to a specific client
   *
   * @param {http.ServerResponse} res - Client response stream
   * @param {string} eventType - Event type
   * @param {Object} data - Event data
   */
  sendEvent(res, eventType, data) {
    try {
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      logger.error({ err: error }, 'Failed to send SSE event');
    }
  }

  /**
   * Broadcast event to all connected clients
   *
   * @param {string} eventType - Event type
   * @param {Object} data - Event data
   */
  broadcast(eventType, data) {
    const deadClients = [];

    for (const client of this.clients) {
      try {
        this.sendEvent(client.res, eventType, {
          ...data,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        // Client connection is dead, mark for removal
        deadClients.push(client);
      }
    }

    // Remove dead clients
    for (const client of deadClients) {
      this.clients.delete(client);
    }

    logger.debug(
      {
        eventType,
        clientCount: this.clients.size,
        removedClients: deadClients.length,
      },
      'Broadcast SSE event'
    );
  }

  /**
   * Get number of connected clients
   * @returns {number} Client count
   */
  getClientCount() {
    return this.clients.size;
  }

  /**
   * Close all client connections
   */
  closeAll() {
    for (const client of this.clients) {
      try {
        client.res.end();
      } catch (error) {
        // Ignore errors when closing
      }
    }
    this.clients.clear();
  }
}

// Global SSE manager instance
const sseManager = new SSEManager();

/**
 * Export SSE manager for external use (from sync orchestrator, etc.)
 */
export { sseManager };

/**
 * In-memory sync history storage
 * In production, this should be persisted to database
 */
class SyncHistoryStore {
  constructor(maxEntries = 100) {
    this.history = [];
    this.maxEntries = maxEntries;
    this.mappings = new Map(); // Huly identifier -> Vibe task mapping
  }

  /**
   * Add sync event to history
   *
   * @param {Object} event - Sync event data
   * @returns {string} Event ID
   */
  addEvent(event) {
    const eventId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const entry = {
      id: eventId,
      timestamp: new Date().toISOString(),
      ...event,
    };

    this.history.unshift(entry); // Add to beginning

    // Trim history if exceeds max entries
    if (this.history.length > this.maxEntries) {
      this.history = this.history.slice(0, this.maxEntries);
    }

    return eventId;
  }

  /**
   * Get sync history with pagination
   *
   * @param {number} limit - Number of entries to return
   * @param {number} offset - Offset for pagination
   * @returns {Object} Paginated history
   */
  getHistory(limit = 20, offset = 0) {
    const total = this.history.length;
    const entries = this.history.slice(offset, offset + limit);

    return {
      total,
      limit,
      offset,
      entries,
      hasMore: offset + limit < total,
    };
  }

  /**
   * Get specific sync event by ID
   *
   * @param {string} eventId - Event ID
   * @returns {Object|null} Event data or null if not found
   */
  getEvent(eventId) {
    return this.history.find(e => e.id === eventId) || null;
  }

  /**
   * Add or update issue mapping
   *
   * @param {string} hulyIdentifier - Huly issue identifier (e.g., "PROJ-123")
   * @param {string} vibeTaskId - Vibe Kanban task ID
   * @param {Object} metadata - Additional metadata
   */
  addMapping(hulyIdentifier, vibeTaskId, metadata = {}) {
    this.mappings.set(hulyIdentifier, {
      hulyIdentifier,
      vibeTaskId,
      lastSynced: new Date().toISOString(),
      ...metadata,
    });
  }

  /**
   * Get all issue mappings
   *
   * @returns {Array} Array of mapping objects
   */
  getMappings() {
    return Array.from(this.mappings.values());
  }

  /**
   * Get specific mapping
   *
   * @param {string} hulyIdentifier - Huly issue identifier
   * @returns {Object|null} Mapping or null if not found
   */
  getMapping(hulyIdentifier) {
    return this.mappings.get(hulyIdentifier) || null;
  }

  /**
   * Clear all history and mappings
   */
  clear() {
    this.history = [];
    this.mappings.clear();
  }
}

// Global sync history store
const syncHistory = new SyncHistoryStore();

/**
 * Export sync history for external use
 */
export { syncHistory };

/**
 * Route handler for configuration endpoints
 */
class ConfigurationHandler {
  constructor(config, onConfigUpdate) {
    this.config = config;
    this.onConfigUpdate = onConfigUpdate;
  }

  /**
   * Get current configuration
   */
  getConfig(req, res) {
    sendJson(res, 200, {
      config: this.getSafeConfig(),
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Update configuration (partial update)
   */
  async updateConfig(req, res) {
    try {
      const updates = await parseJsonBody(req);

      // Validate updates
      const validatedUpdates = this.validateConfigUpdates(updates);

      // Apply updates to config object
      this.applyConfigUpdates(validatedUpdates);

      // Notify listeners (e.g., restart sync with new interval)
      if (this.onConfigUpdate) {
        this.onConfigUpdate(validatedUpdates);
      }

      // Broadcast config update event via SSE
      sseManager.broadcast('config:updated', {
        updates: validatedUpdates,
        config: this.getSafeConfig(),
      });

      logger.info({ updates: validatedUpdates }, 'Configuration updated via API');

      sendJson(res, 200, {
        message: 'Configuration updated successfully',
        config: this.getSafeConfig(),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to update configuration');
      sendError(res, 400, 'Failed to update configuration', { error: error.message });
    }
  }

  /**
   * Reset configuration to defaults
   */
  resetConfig(req, res) {
    // Implementation would reload from environment/defaults
    sendJson(res, 200, {
      message: 'Configuration reset to defaults',
      config: this.getSafeConfig(),
    });
  }

  /**
   * Get safe config (without sensitive data like passwords)
   */
  getSafeConfig() {
    return {
      huly: {
        apiUrl: this.config.huly.apiUrl,
        useRestApi: this.config.huly.useRestApi,
      },
      vibeKanban: {
        apiUrl: this.config.vibeKanban.apiUrl,
        useRestApi: this.config.vibeKanban.useRestApi,
      },
      sync: {
        interval: this.config.sync.interval,
        dryRun: this.config.sync.dryRun,
        incremental: this.config.sync.incremental,
        parallel: this.config.sync.parallel,
        maxWorkers: this.config.sync.maxWorkers,
        skipEmpty: this.config.sync.skipEmpty,
        apiDelay: this.config.sync.apiDelay,
      },
      stacks: {
        baseDir: this.config.stacks.baseDir,
      },
      letta: {
        enabled: this.config.letta.enabled,
        baseURL: this.config.letta.baseURL,
        // Do NOT expose password
      },
    };
  }

  /**
   * Validate configuration updates
   *
   * @param {Object} updates - Configuration updates
   * @returns {Object} Validated updates
   * @throws {Error} If validation fails
   */
  validateConfigUpdates(updates) {
    const validated = {};

    // Validate sync interval
    if (updates.syncInterval !== undefined) {
      const interval = parseInt(updates.syncInterval);
      if (isNaN(interval) || interval < 1000) {
        throw new Error('syncInterval must be >= 1000 milliseconds');
      }
      validated.syncInterval = interval;
    }

    // Validate max workers
    if (updates.maxWorkers !== undefined) {
      const workers = parseInt(updates.maxWorkers);
      if (isNaN(workers) || workers < 1 || workers > 20) {
        throw new Error('maxWorkers must be between 1 and 20');
      }
      validated.maxWorkers = workers;
    }

    // Validate API delay
    if (updates.apiDelay !== undefined) {
      const delay = parseInt(updates.apiDelay);
      if (isNaN(delay) || delay < 0 || delay > 10000) {
        throw new Error('apiDelay must be between 0 and 10000 milliseconds');
      }
      validated.apiDelay = delay;
    }

    // Validate boolean flags
    if (updates.dryRun !== undefined) {
      validated.dryRun = Boolean(updates.dryRun);
    }

    if (updates.incremental !== undefined) {
      validated.incremental = Boolean(updates.incremental);
    }

    if (updates.parallel !== undefined) {
      validated.parallel = Boolean(updates.parallel);
    }

    if (updates.skipEmpty !== undefined) {
      validated.skipEmpty = Boolean(updates.skipEmpty);
    }

    return validated;
  }

  /**
   * Apply validated configuration updates
   *
   * @param {Object} updates - Validated configuration updates
   */
  applyConfigUpdates(updates) {
    if (updates.syncInterval !== undefined) {
      this.config.sync.interval = updates.syncInterval;
    }

    if (updates.maxWorkers !== undefined) {
      this.config.sync.maxWorkers = updates.maxWorkers;
    }

    if (updates.apiDelay !== undefined) {
      this.config.sync.apiDelay = updates.apiDelay;
    }

    if (updates.dryRun !== undefined) {
      this.config.sync.dryRun = updates.dryRun;
    }

    if (updates.incremental !== undefined) {
      this.config.sync.incremental = updates.incremental;
    }

    if (updates.parallel !== undefined) {
      this.config.sync.parallel = updates.parallel;
    }

    if (updates.skipEmpty !== undefined) {
      this.config.sync.skipEmpty = updates.skipEmpty;
    }
  }
}

/**
 * Create comprehensive API server with all endpoints
 *
 * @param {Object} params - Server parameters
 * @param {Object} params.config - Application configuration
 * @param {Object} params.healthStats - Health statistics object
 * @param {Object} params.db - Database instance for accessing project/issue data
 * @param {Function} params.onSyncTrigger - Callback to trigger manual sync
 * @param {Function} params.onConfigUpdate - Callback when config is updated
 * @param {Object} [params.lettaCodeService] - Optional LettaCodeService instance for filesystem mode
 * @param {Object} [params.webhookHandler] - Optional HulyWebhookHandler instance for change watcher integration
 * @param {Function} [params.getTemporalClient] - Optional function to get Temporal orchestration client
 * @param {Object} [params.codePerceptionWatcher] - Optional CodePerceptionWatcher instance
 * @returns {http.Server} HTTP server instance
 */
export function createApiServer({
  config,
  healthStats,
  db,
  onSyncTrigger,
  onConfigUpdate,
  lettaCodeService = null,
  webhookHandler = null,
  getTemporalClient = null,
  codePerceptionWatcher = null,
}) {
  const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3099');
  const configHandler = new ConfigurationHandler(config, onConfigUpdate);
  const routes = [];
  const app = {
    registerRoute(route) {
      routes.push(route);
    },
  };
  const deps = {
    config,
    healthStats,
    db,
    onSyncTrigger,
    onConfigUpdate,
    configHandler,
    lettaCodeService,
    webhookHandler,
    getTemporalClient,
    codePerceptionWatcher,
    sseManager,
    syncHistory,
    getHealthMetrics,
    getMetricsRegistry,
    parseJsonBody,
    sendJson,
    sendError,
    logger,
  };

  registerHealthRoutes(app, deps);
  registerProjectRoutes(app, deps);
  registerConfigRoutes(app, deps);
  registerSyncRoutes(app, deps);
  registerBeadsRoutes(app, deps);
  registerEventsRoutes(app, deps);
  registerFilesRoutes(app, deps);
  registerLettaCodeRoutes(app, deps);
  registerDocsRoutes(app);
  registerWebhooksRoutes(app, deps);
  registerTemporalRoutes(app, deps);

  const server = http.createServer(async (req, res) => {
    try {
      // Update system metrics before serving
      updateSystemMetrics();

      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = url.pathname;
      const method = req.method;

      // Handle CORS preflight
      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }

      const context = { req, res, url, pathname, method };

      for (const route of routes) {
        if (route.match(context)) {
          await route.handle(context);
          return;
        }
      }

      // 404 - Route not found
      sendError(res, 404, 'Endpoint not found', {
        path: pathname,
        method,
        availableEndpoints: [
          'GET /health',
          'GET /metrics',
          'GET /api/config',
          'PATCH /api/config',
          'POST /api/sync/trigger',
          'GET /api/sync/history',
          'GET /api/sync/mappings',
          'GET /api/events/stream',
          'POST /webhook',
          'GET /api/webhook/stats',
          'GET /api/temporal/schedule',
          'POST /api/temporal/schedule/start',
          'POST /api/temporal/schedule/stop',
          'PATCH /api/temporal/schedule',
          'POST /api/temporal/reconciliation/run',
          'GET /api/temporal/workflows',
        ],
      });
    } catch (error) {
      logger.error({ err: error }, 'Unhandled error in API server');
      sendError(res, 500, 'Internal server error', { error: error.message });
    }
  });

  server.listen(HEALTH_PORT, () => {
    logger.info({ port: HEALTH_PORT }, 'API server running with extended endpoints');
  });

  // Graceful shutdown
  server.on('close', () => {
    sseManager.closeAll();
    logger.info('API server closed, all SSE connections terminated');
  });

  return server;
}

/**
 * Helper function to broadcast sync events from external code
 * (e.g., from SyncOrchestrator)
 *
 * @param {string} eventType - Event type
 * @param {Object} data - Event data
 */
export function broadcastSyncEvent(eventType, data) {
  sseManager.broadcast(eventType, data);

  // Also add to history if it's a significant event
  if (eventType.startsWith('sync:')) {
    syncHistory.addEvent({
      type: eventType,
      ...data,
    });
  }
}

/**
 * Helper function to record issue mapping
 *
 * @param {string} hulyIdentifier - Huly issue identifier
 * @param {string} vibeTaskId - Vibe task ID
 * @param {Object} metadata - Additional metadata
 */
export function recordIssueMapping(hulyIdentifier, vibeTaskId, metadata = {}) {
  syncHistory.addMapping(hulyIdentifier, vibeTaskId, metadata);
}
