export function registerProjectRoutes(app, deps) {
  const { db, codePerceptionWatcher, parseJsonBody, sendJson, sendError, logger } = deps;

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/projects' && method === 'GET',
    handle: async ({ res }) => {
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
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      pathname.startsWith('/api/projects/') && pathname.includes('/issues') && method === 'GET',
    handle: async ({ res, pathname }) => {
      if (!db) {
        sendError(res, 503, 'Database not available');
        return;
      }

      try {
        const parts = pathname.split('/');
        const projectIdentifier = parts[3];
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
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      pathname.startsWith('/api/projects/') && pathname.endsWith('/ast-sync') && method === 'POST',
    handle: async ({ req, res, pathname }) => {
      if (!codePerceptionWatcher) {
        sendError(res, 503, 'Code perception watcher not available');
        return;
      }

      try {
        const parts = pathname.split('/');
        const projectIdentifier = parts[3];

        const projectPath = db?.getProjectFilesystemPath?.(projectIdentifier);
        if (!projectPath) {
          sendError(res, 404, 'Project not found or has no filesystem path', {
            projectIdentifier,
          });
          return;
        }

        const body = await parseJsonBody(req);
        const options = {
          concurrency: body.concurrency || 10,
          rateLimit: body.rateLimit || 100,
        };

        logger.info(
          { projectIdentifier, projectPath, options },
          'Starting AST initial sync via API'
        );

        const result = await codePerceptionWatcher.astInitialSync(
          projectIdentifier,
          projectPath,
          options
        );

        sendJson(res, 200, {
          status: 'complete',
          projectIdentifier,
          ...result,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'AST initial sync failed');
        sendError(res, 500, 'AST initial sync failed', { error: error.message });
      }
    },
  });
}
