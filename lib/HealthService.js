/**
 * Health Service
 *
 * Provides HTTP health check endpoint, health metrics tracking, and Prometheus metrics
 */

import http from 'http';
import { Registry, Counter, Gauge, Histogram } from 'prom-client';
import { formatDuration } from './utils.js';
import { getPoolStats } from './http.js';
import { logger } from './logger.js';

// Create Prometheus registry
const register = new Registry();

// Prometheus metrics
export const metrics = {
  // Sync run counters
  syncRunsTotal: new Counter({
    name: 'sync_runs_total',
    help: 'Total number of sync runs',
    labelNames: ['status'], // success, error
    registers: [register],
  }),

  // Sync duration histogram
  syncDuration: new Histogram({
    name: 'sync_duration_seconds',
    help: 'Sync run duration in seconds',
    buckets: [1, 5, 10, 30, 60, 120, 300, 600], // 1s to 10min
    registers: [register],
  }),

  // API latency histograms
  hulyApiLatency: new Histogram({
    name: 'huly_api_latency_seconds',
    help: 'Huly API call latency in seconds',
    labelNames: ['operation'], // fetchProjects, fetchIssues, updateIssue, etc.
    buckets: [0.1, 0.5, 1, 2, 5, 10],
    registers: [register],
  }),

  // Current sync state gauges
  projectsProcessed: new Gauge({
    name: 'projects_processed',
    help: 'Number of projects processed in current sync',
    registers: [register],
  }),

  issuesSynced: new Gauge({
    name: 'issues_synced',
    help: 'Number of issues synced in current sync',
    registers: [register],
  }),

  // System metrics
  memoryUsageBytes: new Gauge({
    name: 'memory_usage_bytes',
    help: 'Memory usage in bytes',
    labelNames: ['type'], // rss, heapUsed, heapTotal
    registers: [register],
  }),

  connectionPoolActive: new Gauge({
    name: 'connection_pool_active',
    help: 'Number of active connections in the pool',
    labelNames: ['protocol'], // http, https
    registers: [register],
  }),

  connectionPoolFree: new Gauge({
    name: 'connection_pool_free',
    help: 'Number of free connections in the pool',
    labelNames: ['protocol'], // http, https
    registers: [register],
  }),
};

// Register default metrics (process metrics)
const collectDefaultMetrics = register.registerMetric.bind(register);

/**
 * Update system metrics (memory, connection pool)
 */
export function updateSystemMetrics() {
  const mem = process.memoryUsage();
  metrics.memoryUsageBytes.set({ type: 'rss' }, mem.rss);
  metrics.memoryUsageBytes.set({ type: 'heapUsed' }, mem.heapUsed);
  metrics.memoryUsageBytes.set({ type: 'heapTotal' }, mem.heapTotal);

  const poolStats = getPoolStats();
  metrics.connectionPoolActive.set({ protocol: 'http' }, poolStats.http.sockets);
  metrics.connectionPoolActive.set({ protocol: 'https' }, poolStats.https.sockets);
  metrics.connectionPoolFree.set({ protocol: 'http' }, poolStats.http.freeSockets);
  metrics.connectionPoolFree.set({ protocol: 'https' }, poolStats.https.freeSockets);
}

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
      lastSyncDuration: healthStats.lastSyncDuration ? `${healthStats.lastSyncDuration}ms` : null,
      totalSyncs: healthStats.syncCount,
      errorCount: healthStats.errorCount,
      successRate:
        healthStats.syncCount > 0
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
    bookstack: healthStats.bookstack || { enabled: false },
  };
}

/**
 * Create HTTP health check server with /health and /metrics endpoints
 *
 * @param {Object} healthStats - Health statistics object
 * @param {Object} config - Configuration object
 * @returns {http.Server} HTTP server instance
 */
export function createHealthServer(healthStats, config) {
  const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3099');

  const server = http.createServer(async (req, res) => {
    // Update system metrics before serving
    updateSystemMetrics();

    if (req.url === '/health') {
      const health = getHealthMetrics(healthStats, config);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
    } else if (req.url === '/metrics') {
      // Serve Prometheus metrics
      try {
        res.writeHead(200, { 'Content-Type': register.contentType });
        res.end(await register.metrics());
      } catch (error) {
        logger.error({ err: error }, 'Failed to generate Prometheus metrics');
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    } else if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Huly-Vibe Sync Service\nHealth check: /health\nMetrics: /metrics');
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(HEALTH_PORT, () => {
    logger.info({ port: HEALTH_PORT }, 'Health check and metrics endpoint running');
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

  // Record Prometheus metrics
  metrics.syncRunsTotal.inc({ status: 'success' });
  metrics.syncDuration.observe(duration / 1000); // Convert to seconds
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

  // Record Prometheus metrics
  metrics.syncRunsTotal.inc({ status: 'error' });
}

/**
 * Record sync statistics (projects and issues counts)
 *
 * @param {number} projectsCount - Number of projects processed
 * @param {number} issuesCount - Number of issues synced
 */
export function recordSyncStats(projectsCount, issuesCount) {
  metrics.projectsProcessed.set(projectsCount);
  metrics.issuesSynced.set(issuesCount);
}

/**
 * Record API call latency
 *
 * @param {string} service - 'huly' or 'vibe'
 * @param {string} operation - Operation name (e.g., 'fetchProjects')
 * @param {number} durationMs - Duration in milliseconds
 */
export function recordApiLatency(service, operation, durationMs) {
  const durationSeconds = durationMs / 1000;

  if (service === 'huly') {
    metrics.hulyApiLatency.observe({ operation }, durationSeconds);
  }
}

/**
 * Get Prometheus registry (for testing)
 * @returns {Registry} Prometheus registry
 */
export function getMetricsRegistry() {
  return register;
}
