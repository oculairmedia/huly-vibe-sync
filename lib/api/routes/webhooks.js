export function registerWebhooksRoutes(app, deps) {
  const { webhookHandler, parseJsonBody, sendJson, sendError, sseManager, logger } = deps;

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/webhook' && method === 'POST',
    handle: async ({ req, res }) => {
      try {
        const payload = await parseJsonBody(req);

        logger.debug(
          {
            type: payload.type,
            changeCount: payload.changes?.length,
          },
          'Received webhook'
        );

        if (webhookHandler) {
          const result = await webhookHandler.handleWebhook(payload);

          sseManager.broadcast('webhook:received', {
            type: payload.type,
            processed: result.processed,
            skipped: result.skipped,
            timestamp: new Date().toISOString(),
          });

          sendJson(res, 200, {
            success: result.success,
            processed: result.processed,
            skipped: result.skipped,
            errors: result.errors.length > 0 ? result.errors : undefined,
          });
        } else {
          logger.warn('Webhook received but no handler configured');
          sendJson(res, 200, {
            success: true,
            message: 'Webhook acknowledged (no handler configured)',
          });
        }
      } catch (error) {
        logger.error({ err: error }, 'Error processing webhook');
        sendError(res, 500, 'Failed to process webhook', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/webhook/stats' && method === 'GET',
    handle: async ({ res }) => {
      if (webhookHandler) {
        const stats = webhookHandler.getStats();
        const watcherStats = await webhookHandler.getWatcherStats();
        sendJson(res, 200, {
          handler: stats,
          watcher: watcherStats,
          timestamp: new Date().toISOString(),
        });
      } else {
        sendJson(res, 200, {
          handler: null,
          message: 'Webhook handler not configured',
          timestamp: new Date().toISOString(),
        });
      }
    },
  });
}
