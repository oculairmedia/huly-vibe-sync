export function registerTemporalRoutes(app, deps) {
  const { getTemporalClient, config, parseJsonBody, sendJson, sendError, sseManager, logger } =
    deps;

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/temporal/schedule' && method === 'GET',
    handle: async ({ res }) => {
      if (!getTemporalClient) {
        sendJson(res, 200, {
          available: false,
          message: 'Temporal orchestration not configured',
        });
        return;
      }

      try {
        const temporal = await getTemporalClient();
        if (!temporal) {
          sendJson(res, 200, {
            available: false,
            message: 'Temporal not available',
          });
          return;
        }

        const activeSchedule = await temporal.getActiveScheduledSync();
        sendJson(res, 200, {
          available: true,
          active: !!activeSchedule,
          schedule: activeSchedule,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get Temporal schedule status');
        sendError(res, 500, 'Failed to get schedule status', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      pathname === '/api/temporal/schedule/start' && method === 'POST',
    handle: async ({ req, res }) => {
      if (!getTemporalClient) {
        sendError(res, 503, 'Temporal orchestration not configured');
        return;
      }

      try {
        const temporal = await getTemporalClient();
        if (!temporal) {
          sendError(res, 503, 'Temporal not available');
          return;
        }

        const existing = await temporal.getActiveScheduledSync();
        if (existing) {
          sendJson(res, 200, {
            success: false,
            message: 'Scheduled sync already active',
            schedule: existing,
          });
          return;
        }

        const body = await parseJsonBody(req);
        const intervalMinutes =
          body.intervalMinutes || Math.max(1, Math.round(config.sync.interval / 60000));
        const dryRun = body.dryRun ?? config.sync.dryRun;

        const schedule = await temporal.startScheduledSync({
          intervalMinutes,
          syncOptions: { dryRun },
        });

        sseManager.broadcast('temporal:schedule-started', {
          workflowId: schedule.workflowId,
          intervalMinutes,
        });

        sendJson(res, 200, {
          success: true,
          message: 'Scheduled sync started',
          workflowId: schedule.workflowId,
          intervalMinutes,
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to start Temporal schedule');
        sendError(res, 500, 'Failed to start schedule', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      pathname === '/api/temporal/schedule/stop' && method === 'POST',
    handle: async ({ res }) => {
      if (!getTemporalClient) {
        sendError(res, 503, 'Temporal orchestration not configured');
        return;
      }

      try {
        const temporal = await getTemporalClient();
        if (!temporal) {
          sendError(res, 503, 'Temporal not available');
          return;
        }

        const stopped = await temporal.stopScheduledSync();

        if (stopped) {
          sseManager.broadcast('temporal:schedule-stopped', {});
          sendJson(res, 200, {
            success: true,
            message: 'Scheduled sync stopped',
          });
        } else {
          sendJson(res, 200, {
            success: false,
            message: 'No active scheduled sync to stop',
          });
        }
      } catch (error) {
        logger.error({ err: error }, 'Failed to stop Temporal schedule');
        sendError(res, 500, 'Failed to stop schedule', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/temporal/schedule' && method === 'PATCH',
    handle: async ({ req, res }) => {
      if (!getTemporalClient) {
        sendError(res, 503, 'Temporal orchestration not configured');
        return;
      }

      try {
        const temporal = await getTemporalClient();
        if (!temporal) {
          sendError(res, 503, 'Temporal not available');
          return;
        }

        const body = await parseJsonBody(req);
        if (!body.intervalMinutes || body.intervalMinutes < 1) {
          sendError(res, 400, 'intervalMinutes must be at least 1');
          return;
        }

        const schedule = await temporal.restartScheduledSync({
          intervalMinutes: body.intervalMinutes,
          syncOptions: { dryRun: body.dryRun ?? config.sync.dryRun },
        });

        if (schedule) {
          sseManager.broadcast('temporal:schedule-updated', {
            workflowId: schedule.workflowId,
            intervalMinutes: body.intervalMinutes,
          });

          sendJson(res, 200, {
            success: true,
            message: 'Schedule updated',
            workflowId: schedule.workflowId,
            intervalMinutes: body.intervalMinutes,
          });
        } else {
          sendError(res, 500, 'Failed to restart schedule');
        }
      } catch (error) {
        logger.error({ err: error }, 'Failed to update Temporal schedule');
        sendError(res, 500, 'Failed to update schedule', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      pathname === '/api/temporal/reconciliation/run' && method === 'POST',
    handle: async ({ req, res }) => {
      if (!getTemporalClient) {
        sendError(res, 503, 'Temporal orchestration not configured');
        return;
      }

      try {
        const temporal = await getTemporalClient();
        if (!temporal?.executeDataReconciliation) {
          sendError(res, 503, 'Temporal not available');
          return;
        }

        const body = await parseJsonBody(req);
        const input = {
          projectIdentifier: body.projectIdentifier,
          action: body.action,
          dryRun: body.dryRun,
        };

        const result = await temporal.executeDataReconciliation(input);

        sendJson(res, 200, {
          success: result.success,
          result,
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to run data reconciliation');
        sendError(res, 500, 'Failed to run data reconciliation', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/temporal/workflows' && method === 'GET',
    handle: async ({ res, url }) => {
      if (!getTemporalClient) {
        sendJson(res, 200, {
          available: false,
          message: 'Temporal orchestration not configured',
          workflows: [],
        });
        return;
      }

      try {
        const temporal = await getTemporalClient();
        if (!temporal) {
          sendJson(res, 200, {
            available: false,
            message: 'Temporal not available',
            workflows: [],
          });
          return;
        }

        const clientModuleUrl = new URL('../../../temporal/dist/client.js', import.meta.url);
        const { listSyncWorkflows } = await import(clientModuleUrl.href);
        const limit = parseInt(url.searchParams.get('limit') || '20');
        const workflows = await listSyncWorkflows(limit);

        sendJson(res, 200, {
          available: true,
          total: workflows.length,
          workflows,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to list Temporal workflows');
        sendError(res, 500, 'Failed to list workflows', { error: error.message });
      }
    },
  });
}
