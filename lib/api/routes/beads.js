export function registerBeadsRoutes(app, deps) {
  const { db, parseJsonBody, sendJson, sendError, logger } = deps;

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
        // --no-auto-flush: prevent direct JSONL writes; let the daemon handle exports
        // This avoids daemon freshness check failures when CLI falls back to direct mode
        const command = `bd label ${subcommand} ${issueId} "${label}" --no-auto-flush`;

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

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/beads/sync' && method === 'POST',
    handle: async ({ req, res }) => {
      try {
        const body = await parseJsonBody(req);
        let projectId = body.projectId || null;

        if (!projectId) {
          sendError(res, 400, 'Missing required field: projectId');
          return;
        }

        if (db?.resolveProjectIdentifier) {
          const resolved = db.resolveProjectIdentifier(projectId);
          if (resolved?.identifier) {
            projectId = resolved.identifier;
          }
        }

        const projects = db?.getProjectsWithFilesystemPath?.() || [];

        const matched = projects.filter(
          p =>
            p.identifier === projectId ||
            p.filesystem_path?.endsWith('/' + projectId) ||
            p.filesystem_path === projectId
        );

        if (matched.length === 0) {
          sendError(res, 404, 'No projects with filesystem paths found');
          return;
        }

        const { scheduleBeadsFileChange, isTemporalAvailable } = await import(
          '../../../temporal/dist/client.js'
        );

        if (!(await isTemporalAvailable())) {
          sendError(res, 503, 'Temporal not available');
          return;
        }

        const results = [];
        for (const project of matched) {
          try {
            const vibeProjectId = project.vibe_id?.toString() || '';
            const { workflowId } = await scheduleBeadsFileChange({
              projectIdentifier: project.identifier,
              gitRepoPath: project.filesystem_path,
              vibeProjectId,
              changedFiles: ['issues.jsonl'],
              timestamp: new Date().toISOString(),
            });
            results.push({ project: project.identifier, workflowId });
            logger.info(
              { project: project.identifier, workflowId },
              'Scheduled BeadsFileChangeWorkflow'
            );
          } catch (err) {
            logger.warn(
              { project: project.identifier, err },
              'Failed to schedule BeadsFileChangeWorkflow'
            );
            results.push({ project: project.identifier, error: err.message });
          }
        }

        sendJson(res, 202, {
          message: `Beads sync triggered for ${results.length} project(s)`,
          results,
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to trigger beads sync');
        sendError(res, 500, 'Failed to trigger beads sync', { error: error.message });
      }
    },
  });
}
