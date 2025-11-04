/**
 * Health Service
 * 
 * Provides HTTP health check endpoint and health metrics tracking
 */

import http from 'http';
import { formatDuration } from './utils.js';
import { getPoolStats } from './http.js';

/**
 * Create and format health metrics response
 * 
 * @param {Object} healthStats - Health statistics object
 * @param {Object} config - Configuration object
 * @returns {Object} Health metrics object
 */
export function getHealthMetrics(healthStats, config) {
  const uptime = Date.now() - healthStats.startTime;
  
  return {
    status: 'healthy',
    service: 'huly-vibe-sync',
    version: '1.0.0',
    uptime: {
      milliseconds: uptime,
      seconds: Math.floor(uptime / 1000),
      human: formatDuration(uptime),
    },
    sync: {
      lastSyncTime: healthStats.lastSyncTime 
        ? new Date(healthStats.lastSyncTime).toISOString() 
        : null,
      lastSyncDuration: healthStats.lastSyncDuration 
        ? `${healthStats.lastSyncDuration}ms` 
        : null,
      totalSyncs: healthStats.syncCount,
      errorCount: healthStats.errorCount,
      successRate: healthStats.syncCount > 0 
        ? `${(((healthStats.syncCount - healthStats.errorCount) / healthStats.syncCount) * 100).toFixed(2)}%`
        : 'N/A',
    },
    lastError: healthStats.lastError 
      ? {
          message: healthStats.lastError.message,
          timestamp: new Date(healthStats.lastError.timestamp).toISOString(),
          age: formatDuration(Date.now() - healthStats.lastError.timestamp),
        }
      : null,
    config: {
      syncInterval: `${config.sync.interval / 1000}s`,
      apiDelay: `${config.sync.apiDelay}ms`,
      parallelSync: config.sync.parallel,
      maxWorkers: config.sync.maxWorkers,
      dryRun: config.sync.dryRun,
      lettaEnabled: !!config.letta.enabled,
    },
    memory: {
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
    },
    connectionPool: getPoolStats(),
  };
}

/**
 * Create HTTP health check server
 * 
 * @param {Object} healthStats - Health statistics object
 * @param {Object} config - Configuration object
 * @returns {http.Server} HTTP server instance
 */
export function createHealthServer(healthStats, config) {
  const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3099');
  
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      const health = getHealthMetrics(healthStats, config);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
    } else if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Huly-Vibe Sync Service\nHealth check: /health');
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });
  
  server.listen(HEALTH_PORT, () => {
    console.log(`[Health] Health check endpoint running at http://localhost:${HEALTH_PORT}/health`);
  });
  
  return server;
}

/**
 * Initialize health stats object
 * 
 * @returns {Object} Health statistics object
 */
export function initializeHealthStats() {
  return {
    startTime: Date.now(),
    lastSyncTime: null,
    lastSyncDuration: null,
    syncCount: 0,
    errorCount: 0,
    lastError: null,
  };
}

/**
 * Update health stats after successful sync
 * 
 * @param {Object} healthStats - Health statistics object
 * @param {number} duration - Sync duration in milliseconds
 */
export function recordSuccessfulSync(healthStats, duration) {
  healthStats.lastSyncTime = Date.now();
  healthStats.lastSyncDuration = duration;
  healthStats.syncCount++;
}

/**
 * Update health stats after failed sync
 * 
 * @param {Object} healthStats - Health statistics object
 * @param {Error} error - Error object
 */
export function recordFailedSync(healthStats, error) {
  healthStats.errorCount++;
  healthStats.lastError = {
    message: error.message,
    timestamp: Date.now(),
  };
}
