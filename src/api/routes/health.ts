import type { ServerResponse } from 'http';
import type { SSEManager } from '../SSEManager.js';
import type { SyncHistoryStore } from '../SyncHistoryStore.js';
import type { HealthStats } from '../../HealthService.js';
import type { App, Logger, SendJson } from '../../types/api.js';

export interface HealthMetricsSnapshot {
  status: string;
  uptime: Record<string, unknown>;
  sync: Record<string, unknown>;
  memory: Record<string, unknown>;
  connectionPool: Record<string, unknown>;
  [key: string]: unknown;
}

export interface StatsDb {
  getStats: () => Record<string, unknown>;
}

interface HealthDeps {
  healthStats: HealthStats;
  config: Record<string, unknown>;
  db: StatsDb | null;
  sseManager: SSEManager;
  syncHistory: SyncHistoryStore;
  getHealthMetrics: (stats: HealthStats, cfg: Record<string, unknown>) => HealthMetricsSnapshot;
  getMetricsRegistry: () => { contentType: string; metrics: () => Promise<string> };
  sendJson: SendJson;
  logger: Logger;
}

export function registerHealthRoutes(app: App, deps: HealthDeps): void {
  const { healthStats, config, db, sseManager, syncHistory, getHealthMetrics, getMetricsRegistry, sendJson, logger } = deps;

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/health' && method === 'GET',
    handle: async ({ res }) => { sendJson(res, 200, getHealthMetrics(healthStats, config)); },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/metrics' && method === 'GET',
    handle: async ({ res }) => {
      const register = getMetricsRegistry();
      const response = res as ServerResponse;
      response.writeHead(200, {
        'Content-Type': register.contentType,
        'Access-Control-Allow-Origin': '*',
      });
      response.end(await register.metrics());
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/stats' && method === 'GET',
    handle: async ({ res }) => {
      const health = getHealthMetrics(healthStats, config);
      const stats: Record<string, unknown> = {
        uptime: health.uptime, sync: health.sync, memory: health.memory, connectionPool: health.connectionPool,
        sseClients: sseManager.getClientCount(),
        syncHistory: { total: syncHistory.history.length, mappings: syncHistory.mappings.size },
      };
      if (db) {
        try { stats.database = db.getStats(); } catch (error) {
          logger.error({ err: error }, 'Failed to get database stats');
          stats.database = { error: 'Failed to fetch database statistics' };
        }
      }
      sendJson(res, 200, stats);
    },
  });
}
