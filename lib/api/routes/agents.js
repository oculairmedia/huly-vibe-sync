export function registerAgentRoutes(app, deps) {
  const { db, sendJson, sendError, logger } = deps;

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/agents/lookup' && method === 'GET',
    handle: async ({ res, url }) => {
      if (!db) {
        sendError(res, 503, 'Database not available');
        return;
      }

      const repo = url.searchParams.get('repo');
      if (!repo) {
        sendError(res, 400, 'Missing required query parameter: repo');
        return;
      }

      try {
        const result = db.lookupProjectByRepo(repo);
        if (!result) {
          sendError(res, 404, 'No agent found for repository', { repo });
          return;
        }

        sendJson(res, 200, result);
      } catch (error) {
        logger.error({ err: error, repo }, 'Agent lookup failed');
        sendError(res, 500, 'Agent lookup failed', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/agents' && method === 'GET',
    handle: async ({ res }) => {
      if (!db) {
        sendError(res, 503, 'Database not available');
        return;
      }

      try {
        const agents = db.getAllProjectsWithAgents();
        sendJson(res, 200, {
          total: agents.length,
          agents,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to list agents');
        sendError(res, 500, 'Failed to list agents', { error: error.message });
      }
    },
  });
}
