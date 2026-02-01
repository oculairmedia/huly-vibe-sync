export function registerLettaCodeRoutes(app, deps) {
  const { lettaCodeService, parseJsonBody, sendJson, sendError, sseManager, logger } = deps;

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/letta-code/sessions' && method === 'GET',
    handle: async ({ res }) => {
      if (!lettaCodeService) {
        sendError(res, 503, 'Letta Code service not available');
        return;
      }

      const sessions = lettaCodeService.listSessions();
      sendJson(res, 200, {
        total: sessions.length,
        sessions,
        timestamp: new Date().toISOString(),
      });
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      pathname.startsWith('/api/letta-code/sessions/') && method === 'GET',
    handle: async ({ res, pathname }) => {
      if (!lettaCodeService) {
        sendError(res, 503, 'Letta Code service not available');
        return;
      }

      const agentId = pathname.split('/').pop();
      const session = lettaCodeService.getSession(agentId);

      if (session) {
        sendJson(res, 200, session);
      } else {
        sendError(res, 404, 'Session not found', { agentId });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/letta-code/link' && method === 'POST',
    handle: async ({ req, res }) => {
      if (!lettaCodeService) {
        sendError(res, 503, 'Letta Code service not available');
        return;
      }

      try {
        const body = await parseJsonBody(req);
        const { agentId, projectDir, agentName } = body;

        if (!agentId) {
          sendError(res, 400, 'agentId is required');
          return;
        }
        if (!projectDir) {
          sendError(res, 400, 'projectDir is required');
          return;
        }

        const result = await lettaCodeService.linkTools(agentId, projectDir, agentName);

        if (result.success) {
          sseManager.broadcast('letta-code:linked', {
            agentId,
            projectDir,
            agentName,
          });
          sendJson(res, 200, result);
        } else {
          sendError(res, 400, result.message);
        }
      } catch (error) {
        logger.error({ err: error }, 'Failed to link Letta Code tools');
        sendError(res, 500, 'Failed to link tools', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/letta-code/task' && method === 'POST',
    handle: async ({ req, res }) => {
      if (!lettaCodeService) {
        sendError(res, 503, 'Letta Code service not available');
        return;
      }

      try {
        const body = await parseJsonBody(req);
        const { agentId, prompt, projectDir, timeout } = body;

        if (!agentId) {
          sendError(res, 400, 'agentId is required');
          return;
        }
        if (!prompt) {
          sendError(res, 400, 'prompt is required');
          return;
        }

        sseManager.broadcast('letta-code:task-started', {
          agentId,
          promptPreview: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
        });

        const result = await lettaCodeService.runTask(agentId, prompt, {
          projectDir,
          timeout,
        });

        sseManager.broadcast(
          result.success ? 'letta-code:task-completed' : 'letta-code:task-failed',
          {
            agentId,
            success: result.success,
            resultLength: result.result?.length || 0,
          }
        );

        sendJson(res, result.success ? 200 : 500, result);
      } catch (error) {
        logger.error({ err: error }, 'Failed to run Letta Code task');
        sendError(res, 500, 'Failed to run task', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      pathname === '/api/letta-code/configure-project' && method === 'POST',
    handle: async ({ req, res }) => {
      if (!lettaCodeService) {
        sendError(res, 503, 'Letta Code service not available');
        return;
      }

      try {
        const body = await parseJsonBody(req);
        const { agentId, hulyProject, agentName } = body;

        if (!agentId) {
          sendError(res, 400, 'agentId is required');
          return;
        }
        if (!hulyProject || !hulyProject.identifier) {
          sendError(res, 400, 'hulyProject with identifier is required');
          return;
        }

        const result = await lettaCodeService.configureForProject(agentId, hulyProject, agentName);

        if (result.success) {
          sseManager.broadcast('letta-code:project-configured', {
            agentId,
            projectIdentifier: hulyProject.identifier,
            projectDir: result.session?.projectDir,
          });
          sendJson(res, 200, result);
        } else {
          sendError(res, 400, result.message);
        }
      } catch (error) {
        logger.error({ err: error }, 'Failed to configure project');
        sendError(res, 500, 'Failed to configure project', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      pathname.startsWith('/api/letta-code/sessions/') && method === 'DELETE',
    handle: async ({ res, pathname }) => {
      if (!lettaCodeService) {
        sendError(res, 503, 'Letta Code service not available');
        return;
      }

      const agentId = pathname.split('/').pop();
      const removed = lettaCodeService.removeSession(agentId);

      if (removed) {
        sseManager.broadcast('letta-code:session-removed', { agentId });
        sendJson(res, 200, { success: true, message: `Session removed for agent ${agentId}` });
      } else {
        sendError(res, 404, 'Session not found', { agentId });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/letta-code/status' && method === 'GET',
    handle: async ({ res }) => {
      if (!lettaCodeService) {
        sendJson(res, 200, {
          available: false,
          reason: 'Letta Code service not initialized',
        });
        return;
      }

      const available = await lettaCodeService.checkLettaCodeAvailable();
      sendJson(res, 200, {
        available,
        sessions: lettaCodeService.listSessions().length,
        projectRoot: lettaCodeService.projectRoot,
      });
    },
  });
}
