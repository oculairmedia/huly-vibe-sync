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
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { getHealthMetrics, updateSystemMetrics, getMetricsRegistry } from './HealthService.js';

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
      'Connection': 'keep-alive',
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

    logger.debug({
      eventType,
      clientCount: this.clients.size,
      removedClients: deadClients.length,
    }, 'Broadcast SSE event');
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
 * @returns {http.Server} HTTP server instance
 */
export function createApiServer({ config, healthStats, db, onSyncTrigger, onConfigUpdate, lettaCodeService = null, webhookHandler = null }) {
  const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3099');
  const configHandler = new ConfigurationHandler(config, onConfigUpdate);

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

      // Route: GET /health - Health check (existing)
      if (pathname === '/health' && method === 'GET') {
        const health = getHealthMetrics(healthStats, config);
        sendJson(res, 200, health);
        return;
      }

      // Route: GET /metrics - Prometheus metrics (existing)
      if (pathname === '/metrics' && method === 'GET') {
        const register = getMetricsRegistry();
        res.writeHead(200, {
          'Content-Type': register.contentType,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(await register.metrics());
        return;
      }

      // Route: GET /api/stats - Human-readable stats (includes database stats)
      if (pathname === '/api/stats' && method === 'GET') {
        const health = getHealthMetrics(healthStats, config);
        const stats = {
          uptime: health.uptime,
          sync: health.sync,
          memory: health.memory,
          connectionPool: health.connectionPool,
          sseClients: sseManager.getClientCount(),
          syncHistory: {
            total: syncHistory.history.length,
            mappings: syncHistory.mappings.size,
          },
        };

        // Add database stats if database is available
        if (db) {
          try {
            stats.database = db.getStats();
          } catch (error) {
            logger.error({ err: error }, 'Failed to get database stats');
            stats.database = { error: 'Failed to fetch database statistics' };
          }
        }

        sendJson(res, 200, stats);
        return;
      }

      // Route: GET /api/projects - Get all projects with issue counts
      if (pathname === '/api/projects' && method === 'GET') {
        if (!db) {
          sendError(res, 503, 'Database not available');
          return;
        }

        try {
          const projects = db.getProjectSummary();
          sendJson(res, 200, {
            total: projects.length,
            projects,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          logger.error({ err: error }, 'Failed to get projects');
          sendError(res, 500, 'Failed to fetch projects', { error: error.message });
        }
        return;
      }

      // Route: GET /api/projects/:identifier/issues - Get issues for a specific project
      if (pathname.startsWith('/api/projects/') && pathname.includes('/issues') && method === 'GET') {
        if (!db) {
          sendError(res, 503, 'Database not available');
          return;
        }

        try {
          const parts = pathname.split('/');
          const projectIdentifier = parts[3]; // /api/projects/[identifier]/issues
          const issues = db.getProjectIssues(projectIdentifier);

          sendJson(res, 200, {
            projectIdentifier,
            total: issues.length,
            issues,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          logger.error({ err: error }, 'Failed to get project issues');
          sendError(res, 500, 'Failed to fetch project issues', { error: error.message });
        }
        return;
      }

      // Route: GET /api/config - Get configuration
      if (pathname === '/api/config' && method === 'GET') {
        configHandler.getConfig(req, res);
        return;
      }

      // Route: PATCH /api/config - Update configuration
      if (pathname === '/api/config' && method === 'PATCH') {
        await configHandler.updateConfig(req, res);
        return;
      }

      // Route: POST /api/config/reset - Reset configuration
      if (pathname === '/api/config/reset' && method === 'POST') {
        configHandler.resetConfig(req, res);
        return;
      }

      // Route: POST /api/sync/trigger - Trigger manual sync
      if (pathname === '/api/sync/trigger' && method === 'POST') {
        try {
          const body = await parseJsonBody(req);
          const projectId = body.projectId || null;

          // Trigger sync (callback to main orchestrator)
          if (onSyncTrigger) {
            const eventId = syncHistory.addEvent({
              type: 'manual_trigger',
              projectId,
              source: 'api',
            });

            // Broadcast sync started event
            sseManager.broadcast('sync:triggered', {
              eventId,
              projectId,
              triggeredBy: 'api',
            });

            // Execute sync
            onSyncTrigger(projectId)
              .then(() => {
                sseManager.broadcast('sync:completed', {
                  eventId,
                  projectId,
                  status: 'success',
                });
              })
              .catch(error => {
                sseManager.broadcast('sync:error', {
                  eventId,
                  projectId,
                  error: error.message,
                });
              });

            sendJson(res, 202, {
              message: projectId
                ? `Sync triggered for project ${projectId}`
                : 'Full sync triggered',
              eventId,
              status: 'accepted',
            });
          } else {
            sendError(res, 503, 'Sync trigger not available');
          }
        } catch (error) {
          logger.error({ err: error }, 'Failed to trigger sync');
          sendError(res, 500, 'Failed to trigger sync', { error: error.message });
        }
        return;
      }

      // Route: GET /api/sync/history - Get sync history
      if (pathname === '/api/sync/history' && method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '20');
        const offset = parseInt(url.searchParams.get('offset') || '0');

        const history = syncHistory.getHistory(limit, offset);
        sendJson(res, 200, history);
        return;
      }

      // Route: GET /api/sync/history/:id - Get specific sync event
      if (pathname.startsWith('/api/sync/history/') && method === 'GET') {
        const eventId = pathname.split('/').pop();
        const event = syncHistory.getEvent(eventId);

        if (event) {
          sendJson(res, 200, event);
        } else {
          sendError(res, 404, 'Sync event not found');
        }
        return;
      }

      // Route: GET /api/sync/mappings - Get all issue mappings
      if (pathname === '/api/sync/mappings' && method === 'GET') {
        const mappings = syncHistory.getMappings();
        sendJson(res, 200, {
          total: mappings.length,
          mappings,
        });
        return;
      }

      // Route: GET /api/sync/mappings/:identifier - Get specific mapping
      if (pathname.startsWith('/api/sync/mappings/') && method === 'GET') {
        const identifier = pathname.split('/').pop();
        const mapping = syncHistory.getMapping(identifier);

        if (mapping) {
          sendJson(res, 200, mapping);
        } else {
          sendError(res, 404, 'Mapping not found');
        }
        return;
      }

      // Route: GET /api/events/stream - Server-Sent Events stream
      if (pathname === '/api/events/stream' && method === 'GET') {
        sseManager.addClient(res);
        // Connection is kept alive, will be closed by client
        return;
      }

      // ============================================
      // FILE OPERATIONS (for remote agent file mounting)
      // ============================================

      // Route: POST /api/files/read - Read file content (for remote agents)
      if (pathname === '/api/files/read' && method === 'POST') {
        try {
          const body = await parseJsonBody(req);
          const { agent_id, file_path, start_line = 1, max_lines = 200 } = body;

          if (!file_path) {
            sendError(res, 400, 'file_path is required');
            return;
          }

          // Determine project root from agent session or config
          let projectRoot = config.stacks?.baseDir || '/opt/stacks';

          // If lettaCodeService is available and agent has a session, use that project dir
          if (lettaCodeService && agent_id) {
            const session = lettaCodeService.getSession(agent_id);
            if (session?.projectDir) {
              projectRoot = session.projectDir;
            }
          }

          // Normalize file path
          let normalizedPath = file_path;
          if (normalizedPath.startsWith('/')) {
            normalizedPath = normalizedPath.slice(1);
          }

          const fullPath = path.join(projectRoot, normalizedPath);

          // Check if file exists
          if (!fs.existsSync(fullPath)) {
            sendError(res, 404, 'File not found', { file_path, fullPath });
            return;
          }

          // Read file
          const content = fs.readFileSync(fullPath, 'utf-8');
          const allLines = content.split('\n');
          const totalLines = allLines.length;

          // Extract requested lines
          const startIdx = Math.max(0, start_line - 1);
          const endIdx = Math.min(allLines.length, startIdx + max_lines);
          const selectedContent = allLines.slice(startIdx, endIdx).join('\n');

          sendJson(res, 200, {
            file_path: normalizedPath,
            content: selectedContent,
            start_line: startIdx + 1,
            end_line: endIdx,
            total_lines: totalLines,
            full_path: fullPath,
          });
        } catch (error) {
          logger.error({ err: error }, 'Failed to read file');
          sendError(res, 500, 'Failed to read file', { error: error.message });
        }
        return;
      }

      // Route: POST /api/files/edit - Edit file content (for remote agents)
      if (pathname === '/api/files/edit' && method === 'POST') {
        try {
          const body = await parseJsonBody(req);
          const { agent_id, file_path, start_line, end_line, new_content } = body;

          if (!file_path) {
            sendError(res, 400, 'file_path is required');
            return;
          }
          if (start_line === undefined || end_line === undefined) {
            sendError(res, 400, 'start_line and end_line are required');
            return;
          }
          if (new_content === undefined) {
            sendError(res, 400, 'new_content is required');
            return;
          }

          // Determine project root from agent session or config
          let projectRoot = config.stacks?.baseDir || '/opt/stacks';

          if (lettaCodeService && agent_id) {
            const session = lettaCodeService.getSession(agent_id);
            if (session?.projectDir) {
              projectRoot = session.projectDir;
            }
          }

          // Normalize file path
          let normalizedPath = file_path;
          if (normalizedPath.startsWith('/')) {
            normalizedPath = normalizedPath.slice(1);
          }

          const fullPath = path.join(projectRoot, normalizedPath);

          // Check if file exists
          if (!fs.existsSync(fullPath)) {
            sendError(res, 404, 'File not found', { file_path, fullPath });
            return;
          }

          // Read current file content
          const content = fs.readFileSync(fullPath, 'utf-8');
          const allLines = content.split('\n');

          // Ensure new_content ends with newline if needed
          let newContentNormalized = new_content;
          if (newContentNormalized && !newContentNormalized.endsWith('\n')) {
            newContentNormalized += '\n';
          }

          // Replace the lines
          const newLines = newContentNormalized.split('\n');
          // Remove trailing empty line from split if content ended with \n
          if (newLines[newLines.length - 1] === '') {
            newLines.pop();
          }

          const startIdx = Math.max(0, start_line - 1);
          const endIdx = Math.min(allLines.length, end_line);

          allLines.splice(startIdx, endIdx - startIdx, ...newLines);

          // Write back
          fs.writeFileSync(fullPath, allLines.join('\n'), 'utf-8');

          logger.info({ file_path: normalizedPath, start_line, end_line, lines_added: newLines.length }, 'File edited via API');

          sendJson(res, 200, {
            success: true,
            file_path: normalizedPath,
            lines_removed: endIdx - startIdx,
            lines_added: newLines.length,
            new_total_lines: allLines.length,
            message: `Replaced lines ${start_line}-${end_line} with ${newLines.length} new line(s).`,
          });
        } catch (error) {
          logger.error({ err: error }, 'Failed to edit file');
          sendError(res, 500, 'Failed to edit file', { error: error.message });
        }
        return;
      }

      // Route: GET /api/files/info - Get file metadata
      if (pathname === '/api/files/info' && method === 'POST') {
        try {
          const body = await parseJsonBody(req);
          const { agent_id, file_path } = body;

          if (!file_path) {
            sendError(res, 400, 'file_path is required');
            return;
          }

          // Determine project root
          let projectRoot = config.stacks?.baseDir || '/opt/stacks';

          if (lettaCodeService && agent_id) {
            const session = lettaCodeService.getSession(agent_id);
            if (session?.projectDir) {
              projectRoot = session.projectDir;
            }
          }

          // Normalize file path
          let normalizedPath = file_path;
          if (normalizedPath.startsWith('/')) {
            normalizedPath = normalizedPath.slice(1);
          }

          const fullPath = path.join(projectRoot, normalizedPath);

          if (!fs.existsSync(fullPath)) {
            sendJson(res, 200, {
              file_path: normalizedPath,
              exists: false,
            });
            return;
          }

          const stats = fs.statSync(fullPath);
          const content = fs.readFileSync(fullPath, 'utf-8');
          const totalLines = content.split('\n').length;

          sendJson(res, 200, {
            file_path: normalizedPath,
            exists: true,
            size_bytes: stats.size,
            modified: stats.mtime.toISOString(),
            created: stats.ctime.toISOString(),
            total_lines: totalLines,
            extension: path.extname(normalizedPath).toLowerCase(),
          });
        } catch (error) {
          logger.error({ err: error }, 'Failed to get file info');
          sendError(res, 500, 'Failed to get file info', { error: error.message });
        }
        return;
      }

      // ============================================
      // LETTA CODE ROUTES
      // ============================================

      // Route: GET /api/letta-code/sessions - List all Letta Code sessions
      if (pathname === '/api/letta-code/sessions' && method === 'GET') {
        if (!lettaCodeService) {
          sendError(res, 503, 'Letta Code service not available');
          return;
        }

        const sessions = lettaCodeService.listSessions();
        sendJson(res, 200, {
          total: sessions.length,
          sessions,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Route: GET /api/letta-code/sessions/:agentId - Get session for specific agent
      if (pathname.startsWith('/api/letta-code/sessions/') && method === 'GET') {
        if (!lettaCodeService) {
          sendError(res, 503, 'Letta Code service not available');
          return;
        }

        const agentId = pathname.split('/').pop();
        const session = lettaCodeService.getSession(agentId);

        if (session) {
          sendJson(res, 200, session);
        } else {
          sendError(res, 404, 'Session not found', { agentId });
        }
        return;
      }

      // Route: POST /api/letta-code/link - Link an agent to a project directory
      if (pathname === '/api/letta-code/link' && method === 'POST') {
        if (!lettaCodeService) {
          sendError(res, 503, 'Letta Code service not available');
          return;
        }

        try {
          const body = await parseJsonBody(req);
          const { agentId, projectDir, agentName } = body;

          if (!agentId) {
            sendError(res, 400, 'agentId is required');
            return;
          }
          if (!projectDir) {
            sendError(res, 400, 'projectDir is required');
            return;
          }

          const result = await lettaCodeService.linkTools(agentId, projectDir, agentName);

          if (result.success) {
            sseManager.broadcast('letta-code:linked', {
              agentId,
              projectDir,
              agentName,
            });
            sendJson(res, 200, result);
          } else {
            sendError(res, 400, result.message);
          }
        } catch (error) {
          logger.error({ err: error }, 'Failed to link Letta Code tools');
          sendError(res, 500, 'Failed to link tools', { error: error.message });
        }
        return;
      }

      // Route: POST /api/letta-code/task - Run a headless task
      if (pathname === '/api/letta-code/task' && method === 'POST') {
        if (!lettaCodeService) {
          sendError(res, 503, 'Letta Code service not available');
          return;
        }

        try {
          const body = await parseJsonBody(req);
          const { agentId, prompt, projectDir, timeout } = body;

          if (!agentId) {
            sendError(res, 400, 'agentId is required');
            return;
          }
          if (!prompt) {
            sendError(res, 400, 'prompt is required');
            return;
          }

          // Broadcast task started
          sseManager.broadcast('letta-code:task-started', {
            agentId,
            promptPreview: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
          });

          const result = await lettaCodeService.runTask(agentId, prompt, {
            projectDir,
            timeout,
          });

          // Broadcast task completed/failed
          sseManager.broadcast(result.success ? 'letta-code:task-completed' : 'letta-code:task-failed', {
            agentId,
            success: result.success,
            resultLength: result.result?.length || 0,
          });

          sendJson(res, result.success ? 200 : 500, result);
        } catch (error) {
          logger.error({ err: error }, 'Failed to run Letta Code task');
          sendError(res, 500, 'Failed to run task', { error: error.message });
        }
        return;
      }

      // Route: POST /api/letta-code/configure-project - Configure agent for a Huly project
      if (pathname === '/api/letta-code/configure-project' && method === 'POST') {
        if (!lettaCodeService) {
          sendError(res, 503, 'Letta Code service not available');
          return;
        }

        try {
          const body = await parseJsonBody(req);
          const { agentId, hulyProject, agentName } = body;

          if (!agentId) {
            sendError(res, 400, 'agentId is required');
            return;
          }
          if (!hulyProject || !hulyProject.identifier) {
            sendError(res, 400, 'hulyProject with identifier is required');
            return;
          }

          const result = await lettaCodeService.configureForProject(agentId, hulyProject, agentName);

          if (result.success) {
            sseManager.broadcast('letta-code:project-configured', {
              agentId,
              projectIdentifier: hulyProject.identifier,
              projectDir: result.session?.projectDir,
            });
            sendJson(res, 200, result);
          } else {
            sendError(res, 400, result.message);
          }
        } catch (error) {
          logger.error({ err: error }, 'Failed to configure project');
          sendError(res, 500, 'Failed to configure project', { error: error.message });
        }
        return;
      }

      // Route: DELETE /api/letta-code/sessions/:agentId - Remove a session
      if (pathname.startsWith('/api/letta-code/sessions/') && method === 'DELETE') {
        if (!lettaCodeService) {
          sendError(res, 503, 'Letta Code service not available');
          return;
        }

        const agentId = pathname.split('/').pop();
        const removed = lettaCodeService.removeSession(agentId);

        if (removed) {
          sseManager.broadcast('letta-code:session-removed', { agentId });
          sendJson(res, 200, { success: true, message: `Session removed for agent ${agentId}` });
        } else {
          sendError(res, 404, 'Session not found', { agentId });
        }
        return;
      }

      // Route: GET /api/letta-code/status - Check Letta Code CLI availability
      if (pathname === '/api/letta-code/status' && method === 'GET') {
        if (!lettaCodeService) {
          sendJson(res, 200, {
            available: false,
            reason: 'Letta Code service not initialized',
          });
          return;
        }

        const available = await lettaCodeService.checkLettaCodeAvailable();
        sendJson(res, 200, {
          available,
          sessions: lettaCodeService.listSessions().length,
          projectRoot: lettaCodeService.projectRoot,
        });
        return;
      }

      // Route: GET / - API documentation
      if (pathname === '/' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`Huly-Vibe Sync Service API

Available Endpoints:

Health & Metrics:
  GET  /health                       - Service health check
  GET  /metrics                      - Prometheus metrics
  GET  /api/stats                    - Human-readable statistics (includes database stats)

Projects & Issues:
  GET  /api/projects                 - Get all projects with issue counts
  GET  /api/projects/:id/issues      - Get issues for a specific project

Configuration:
  GET  /api/config                   - Get current configuration
  PATCH /api/config                  - Update configuration
  POST /api/config/reset             - Reset to defaults

Sync Control:
  POST /api/sync/trigger             - Trigger manual sync
  POST /api/sync/trigger (projectId) - Trigger sync for specific project

Sync History:
  GET  /api/sync/history             - Get sync history (paginated)
  GET  /api/sync/history/:id         - Get specific sync event

Issue Mappings:
  GET  /api/sync/mappings            - Get all Huly ↔ Vibe mappings
  GET  /api/sync/mappings/:id        - Get specific mapping

Real-time Events:
  GET  /api/events/stream            - Server-Sent Events stream

File Operations (Remote Agent File Mounting):
  POST /api/files/read               - Read file content (for remote agents)
  POST /api/files/edit               - Edit file content (for remote agents)
  POST /api/files/info               - Get file metadata

Letta Code (Filesystem Agent Mode):
  GET  /api/letta-code/status        - Check Letta Code CLI availability
  GET  /api/letta-code/sessions      - List all active Letta Code sessions
  GET  /api/letta-code/sessions/:id  - Get session for specific agent
  POST /api/letta-code/link          - Link agent to project directory
  POST /api/letta-code/task          - Run headless task for agent
  POST /api/letta-code/configure-project - Configure agent for Huly project
  DELETE /api/letta-code/sessions/:id - Remove agent session

Event Types (SSE):
  - connected                  - Client connected
  - sync:triggered             - Sync manually triggered
  - sync:started               - Sync cycle started
  - sync:completed             - Sync cycle completed
  - sync:error                 - Error during sync
  - config:updated             - Configuration changed
  - health:updated             - Health metrics updated
  - letta-code:linked          - Agent linked to project
  - letta-code:task-started    - Task execution started
  - letta-code:task-completed  - Task execution completed
  - letta-code:task-failed     - Task execution failed
  - letta-code:session-removed - Session removed
`);
        return;
      }

      // Route: POST /webhook - Receive webhooks from huly-change-watcher
      if (pathname === '/webhook' && method === 'POST') {
        try {
          const payload = await parseJsonBody(req);
          
          logger.debug({ 
            type: payload.type, 
            changeCount: payload.changes?.length 
          }, 'Received webhook');

          if (webhookHandler) {
            const result = await webhookHandler.handleWebhook(payload);
            
            // Broadcast webhook event to SSE clients
            sseManager.broadcast('webhook:received', {
              type: payload.type,
              processed: result.processed,
              skipped: result.skipped,
              timestamp: new Date().toISOString(),
            });

            sendJson(res, 200, {
              success: result.success,
              processed: result.processed,
              skipped: result.skipped,
              errors: result.errors.length > 0 ? result.errors : undefined,
            });
          } else {
            // No webhook handler configured, acknowledge but don't process
            logger.warn('Webhook received but no handler configured');
            sendJson(res, 200, { 
              success: true, 
              message: 'Webhook acknowledged (no handler configured)' 
            });
          }
        } catch (error) {
          logger.error({ err: error }, 'Error processing webhook');
          sendError(res, 500, 'Failed to process webhook', { error: error.message });
        }
        return;
      }

      // Route: GET /api/webhook/stats - Get webhook handler statistics
      if (pathname === '/api/webhook/stats' && method === 'GET') {
        if (webhookHandler) {
          const stats = webhookHandler.getStats();
          const watcherStats = await webhookHandler.getWatcherStats();
          sendJson(res, 200, {
            handler: stats,
            watcher: watcherStats,
            timestamp: new Date().toISOString(),
          });
        } else {
          sendJson(res, 200, {
            handler: null,
            message: 'Webhook handler not configured',
            timestamp: new Date().toISOString(),
          });
        }
        return;
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
