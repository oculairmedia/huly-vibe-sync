import type { SSEManager } from '../SSEManager.js';
import type { SyncHistoryStore } from '../SyncHistoryStore.js';

interface HealthDeps {
  healthStats: Record<string, unknown>;
  config: Record<string, unknown>;
  db: { getStats: () => Record<string, unknown> } | null;
  sseManager: SSEManager;
  syncHistory: SyncHistoryStore;
  getHealthMetrics: (stats: Record<string, unknown>, cfg: Record<string, unknown>) => Record<string, unknown>;
  getMetricsRegistry: () => { contentType: string; metrics: () => Promise<string> };
  sendJson: (res: unknown, code: number, data: unknown) => void;
  logger: { error: (obj: Record<string, unknown>, msg: string) => void };
}
interface App { registerRoute(opts: { match: (ctx: { pathname: string; method: string }) => boolean; handle: (ctx: { res: unknown }) => Promise<void> }): void }

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
      (res as { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void }).writeHead(200, {
        'Content-Type': register.contentType, 'Access-Control-Allow-Origin': '*',
      });
      (res as { end: (body: string) => void }).end(await register.metrics());
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
