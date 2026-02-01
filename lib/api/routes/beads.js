export function registerBeadsRoutes(app, deps) {
  const { parseJsonBody, sendJson, sendError, logger } = deps;

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/beads/label' && method === 'POST',
    handle: async ({ req, res }) => {
      try {
        const { repoPath, issueId, label, action = 'add' } = await parseJsonBody(req);

        if (!repoPath || !issueId || !label) {
          sendError(res, 400, 'Missing required fields: repoPath, issueId, label');
          return;
        }

        const { execSync } = await import('child_process');
        const subcommand = action === 'remove' ? 'remove' : 'add';
        const command = `bd label ${subcommand} ${issueId} "${label}"`;

        logger.info({ repoPath, issueId, label, action }, 'Executing beads label command');

        execSync(command, {
          cwd: repoPath,
          encoding: 'utf-8',
          timeout: 30000,
        });

        sendJson(res, 200, { success: true, issueId, label, action });
      } catch (error) {
        logger.error({ err: error }, 'Failed to update beads label');
        sendError(res, 500, 'Failed to update beads label', { error: error.message });
      }
    },
  });
}
