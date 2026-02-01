export function registerHealthRoutes(app, deps) {
  const {
    healthStats,
    config,
    db,
    sseManager,
    syncHistory,
    getHealthMetrics,
    getMetricsRegistry,
    sendJson,
    logger,
  } = deps;

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/health' && method === 'GET',
    handle: async ({ res }) => {
      const health = getHealthMetrics(healthStats, config);
      sendJson(res, 200, health);
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/metrics' && method === 'GET',
    handle: async ({ res }) => {
      const register = getMetricsRegistry();
      res.writeHead(200, {
        'Content-Type': register.contentType,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(await register.metrics());
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/stats' && method === 'GET',
    handle: async ({ res }) => {
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

      if (db) {
        try {
          stats.database = db.getStats();
        } catch (error) {
          logger.error({ err: error }, 'Failed to get database stats');
          stats.database = { error: 'Failed to fetch database statistics' };
        }
      }

      sendJson(res, 200, stats);
    },
  });
}
