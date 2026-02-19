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

        const { readIssuesFromJSONL } = await import('../../BeadsJSONLReader.js');

        const results = [];
        for (const project of matched) {
          try {
            const issues = readIssuesFromJSONL(project.filesystem_path);
            const beadsIssues = issues
              .filter(i => i.status !== 'tombstone')
              .map(i => ({
                id: i.id,
                title: i.title,
                status: i.status,
                priority: i.priority,
                description: i.description,
                labels: i.labels || [],
              }));
            const { workflowId } = await scheduleBeadsFileChange({
              projectIdentifier: project.identifier,
              gitRepoPath: project.filesystem_path,
              beadsIssues,
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

  // ── Targeted Mutation Endpoint ─────────────────────────────────
  // Called by beads-mutation-watcher.mjs with a single changed issue.
  // Bypasses JSONL entirely — issue data comes from the daemon via SDK.
  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/beads/mutation' && method === 'POST',
    handle: async ({ req, res }) => {
      try {
        const body = await parseJsonBody(req);
        const { projectId, mutation, issue } = body;

        if (!projectId || !mutation?.issueId) {
          sendError(res, 400, 'Missing required fields: projectId, mutation.issueId');
          return;
        }

        // Ignore delete mutations — no Huly counterpart
        if (mutation.type === 'delete') {
          logger.info({ issueId: mutation.issueId }, 'Ignoring delete mutation');
          sendJson(res, 200, { message: 'Delete mutations are not synced', skipped: true });
          return;
        }

        if (!issue) {
          sendError(res, 400, 'Missing issue data (required for non-delete mutations)');
          return;
        }

        // Resolve project
        let resolvedProjectId = projectId;
        if (db?.resolveProjectIdentifier) {
          const resolved = db.resolveProjectIdentifier(projectId);
          if (resolved?.identifier) {
            resolvedProjectId = resolved.identifier;
          }
        }

        const projects = db?.getProjectsWithFilesystemPath?.() || [];
        const matched = projects.find(
          p =>
            p.identifier === resolvedProjectId ||
            p.filesystem_path?.endsWith('/' + projectId) ||
            p.filesystem_path === projectId
        );

        if (!matched) {
          sendError(res, 404, `Project not found: ${projectId}`);
          return;
        }

        const { scheduleBeadsFileChange, isTemporalAvailable } = await import(
          '../../../temporal/dist/client.js'
        );

        if (!(await isTemporalAvailable())) {
          sendError(res, 503, 'Temporal not available');
          return;
        }

        const { workflowId } = await scheduleBeadsFileChange({
          projectIdentifier: matched.identifier,
          gitRepoPath: matched.filesystem_path,
          beadsIssues: [
            {
              id: issue.id,
              title: issue.title,
              status: issue.status,
              priority: issue.priority,
              description: issue.description,
              labels: issue.labels || [],
            },
          ],
          changedFiles: [`mutation:${mutation.type}:${mutation.issueId}`],
          timestamp: mutation.timestamp || new Date().toISOString(),
        });

        logger.info(
          {
            project: matched.identifier,
            workflowId,
            mutationType: mutation.type,
            issueId: mutation.issueId,
            issueStatus: issue.status,
          },
          'Scheduled targeted BeadsFileChangeWorkflow from mutation'
        );

        sendJson(res, 202, {
          message: 'Mutation sync triggered',
          workflowId,
          project: matched.identifier,
          mutation: { type: mutation.type, issueId: mutation.issueId },
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to handle beads mutation');
        sendError(res, 500, 'Failed to handle beads mutation', { error: error.message });
      }
    },
  });
}
