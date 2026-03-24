/**
 * API Server - Extended REST API for Frontend Integration
 *
 * Delegates to extracted modules:
 * - SSEManager (lib/api/SSEManager.js)
 * - SyncHistoryStore (lib/api/SyncHistoryStore.js)
 * - ConfigurationHandler (lib/api/ConfigurationHandler.js)
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
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
import { registerDocsRoutes } from './api/routes/docs.js';
import { registerTemporalRoutes } from './api/routes/temporal.js';
import { registerAgentRoutes } from './api/routes/agents.js';
import { registerBeadsUiRoutes } from './api/routes/beadsUi.js';
import { SSEManager, sseManager } from './api/SSEManager.js';
import { SyncHistoryStore, syncHistory } from './api/SyncHistoryStore.js';
import { ConfigurationHandler } from './api/ConfigurationHandler.js';
import { createProjectMcpServer } from './mcp/ProjectMcpServer.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

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
  webhookHandler = null,
  getTemporalClient = null,
  codePerceptionWatcher = null,
  projectRegistry = null,
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
    projectRegistry,
  };

  registerHealthRoutes(app, deps);
  registerProjectRoutes(app, deps);
  registerConfigRoutes(app, deps);
  registerSyncRoutes(app, deps);
  registerBeadsRoutes(app, deps);
  registerEventsRoutes(app, deps);
  registerFilesRoutes(app, deps);
  registerDocsRoutes(app);
  registerTemporalRoutes(app, deps);
  registerAgentRoutes(app, deps);
  registerBeadsUiRoutes(app, deps);

  const mcpPath = config.projectMcp?.path || '/mcp';
  const mcpEnabled = config.projectMcp?.enabled !== false;

  const BEADS_UI_DIST = process.env.BEADS_UI_DIST || '/opt/stacks/beads-ui/dist';
  const beadsUiAvailable = fs.existsSync(BEADS_UI_DIST);
  if (beadsUiAvailable) {
    logger.info({ path: BEADS_UI_DIST }, 'beads-ui static files available at /ui');
  }

  const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };

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
          'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id',
        });
        res.end();
        return;
      }

      // MCP endpoint — handled before general routes (needs raw body parsing)
      if (mcpEnabled && pathname === mcpPath) {
        if (method === 'POST') {
          try {
            let body = '';
            for await (const chunk of req) body += chunk.toString();
            const parsed = body ? JSON.parse(body) : {};

            const mcpServer = createProjectMcpServer({ db, logger, registry: projectRegistry });
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: undefined,
            });
            await mcpServer.connect(transport);
            await transport.handleRequest(req, res, parsed);
            res.on('close', () => {
              transport.close();
              mcpServer.close();
            });
          } catch (mcpError) {
            logger.error({ err: mcpError }, 'MCP request failed');
            if (!res.headersSent) {
              sendJson(res, 500, {
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal server error' },
                id: null,
              });
            }
          }
          return;
        } else if (method === 'GET' || method === 'DELETE') {
          // Stateless mode — no SSE streams or session deletion
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Method not allowed.' },
              id: null,
            })
          );
          return;
        }
      }

      if (beadsUiAvailable && pathname.startsWith('/ui')) {
        const stripped = pathname.replace(/^\/ui/, '') || '/index.html';
        const filePath = path.join(BEADS_UI_DIST, stripped);
        const normalised = path.resolve(filePath);

        if (!normalised.startsWith(BEADS_UI_DIST)) {
          sendError(res, 403, 'Forbidden');
          return;
        }

        if (fs.existsSync(normalised) && fs.statSync(normalised).isFile()) {
          const ext = path.extname(normalised);
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': contentType });
          fs.createReadStream(normalised).pipe(res);
          return;
        }

        const indexPath = path.join(BEADS_UI_DIST, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          fs.createReadStream(indexPath).pipe(res);
          return;
        }
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
          'GET /api/registry/projects',
          'GET /api/registry/projects/:id',
          'GET /api/registry/projects/:id/issues',
          'POST /api/registry/projects/:id/scan',
          `POST ${mcpPath}`,
        ],
      });
    } catch (error) {
      logger.error({ err: error }, 'Unhandled error in API server');
      sendError(res, 500, 'Internal server error', { error: error.message });
    }
  });

  server.listen(HEALTH_PORT, () => {
    logger.info({ port: HEALTH_PORT, mcpEnabled, mcpPath }, 'API server running');
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
