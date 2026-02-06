/**
 * API Server - Extended REST API for Frontend Integration
 *
 * Delegates to extracted modules:
 * - SSEManager (lib/api/SSEManager.js)
 * - SyncHistoryStore (lib/api/SyncHistoryStore.js)
 * - ConfigurationHandler (lib/api/ConfigurationHandler.js)
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
import { registerAgentRoutes } from './api/routes/agents.js';
import { SSEManager, sseManager } from './api/SSEManager.js';
import { SyncHistoryStore, syncHistory } from './api/SyncHistoryStore.js';
import { ConfigurationHandler } from './api/ConfigurationHandler.js';

// Re-export for backward compatibility
export { sseManager, syncHistory };

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

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data, null, 2));
}

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
  const configHandler = new ConfigurationHandler(config, onConfigUpdate, {
    sseManager,
    parseJsonBody,
    sendJson,
    sendError,
  });
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
  registerAgentRoutes(app, deps);

  const server = http.createServer(async (req, res) => {
    try {
      updateSystemMetrics();

      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = url.pathname;
      const method = req.method;

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
          'GET /api/agents',
          'GET /api/agents/lookup?repo=<name>',
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

  server.on('close', () => {
    sseManager.closeAll();
    logger.info('API server closed, all SSE connections terminated');
  });

  return server;
}

export function broadcastSyncEvent(eventType, data) {
  sseManager.broadcast(eventType, data);

  if (eventType.startsWith('sync:')) {
    syncHistory.addEvent({
      type: eventType,
      ...data,
    });
  }
}

export function recordIssueMapping(hulyIdentifier, vibeTaskId, metadata = {}) {
  syncHistory.addMapping(hulyIdentifier, vibeTaskId, metadata);
}
