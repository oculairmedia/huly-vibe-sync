export function registerSyncRoutes(app, deps) {
  const { db, onSyncTrigger, syncHistory, sseManager, parseJsonBody, sendJson, sendError, logger } =
    deps;

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/sync/trigger' && method === 'POST',
    handle: async ({ req, res }) => {
      try {
        const body = await parseJsonBody(req);
        let projectId = body.projectId || null;

        if (projectId && db?.resolveProjectIdentifier) {
          const resolvedId = db.resolveProjectIdentifier(projectId);
          if (resolvedId) {
            logger.info(
              { original: projectId, resolved: resolvedId },
              'Resolved folder name to project ID'
            );
            projectId = resolvedId;
          } else {
            logger.warn(
              { projectId },
              'Could not resolve project identifier - may be invalid folder name'
            );
          }
        }

        if (onSyncTrigger) {
          const eventId = syncHistory.addEvent({
            type: 'manual_trigger',
            projectId,
            source: 'api',
          });

          sseManager.broadcast('sync:triggered', {
            eventId,
            projectId,
            triggeredBy: 'api',
          });

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
            message: projectId ? `Sync triggered for project ${projectId}` : 'Full sync triggered',
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
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/sync/history' && method === 'GET',
    handle: async ({ res, url }) => {
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const offset = parseInt(url.searchParams.get('offset') || '0');

      const history = syncHistory.getHistory(limit, offset);
      sendJson(res, 200, history);
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname.startsWith('/api/sync/history/') && method === 'GET',
    handle: async ({ res, pathname }) => {
      const eventId = pathname.split('/').pop();
      const event = syncHistory.getEvent(eventId);

      if (event) {
        sendJson(res, 200, event);
      } else {
        sendError(res, 404, 'Sync event not found');
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/sync/mappings' && method === 'GET',
    handle: async ({ res }) => {
      const mappings = syncHistory.getMappings();
      sendJson(res, 200, {
        total: mappings.length,
        mappings,
      });
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname.startsWith('/api/sync/mappings/') && method === 'GET',
    handle: async ({ res, pathname }) => {
      const identifier = pathname.split('/').pop();
      const mapping = syncHistory.getMapping(identifier);

      if (mapping) {
        sendJson(res, 200, mapping);
      } else {
        sendError(res, 404, 'Mapping not found');
      }
    },
  });
}
