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

        const { DoltQueryService } = await import('../../DoltQueryService.js');

        const results = [];
        for (const project of matched) {
          try {
            const dolt = new DoltQueryService();
            await dolt.connect(project.filesystem_path);
            let beadsIssues;
            try {
              const [rows] = await dolt.pool.execute(
                `SELECT i.*, GROUP_CONCAT(l.label) AS labels
                 FROM issues i
                 LEFT JOIN labels l ON i.id = l.issue_id
                 WHERE i.status != 'tombstone'
                 GROUP BY i.id
                 ORDER BY i.updated_at DESC`
              );
              beadsIssues = rows.map(row => ({
                id: row.id,
                title: row.title,
                status: row.status,
                priority: row.priority,
                description: row.description,
                labels: row.labels ? row.labels.split(',') : [],
              }));
            } finally {
              await dolt.disconnect();
            }
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

  // ── Delete Endpoint (Temporal compensation) ────────────────────
  // Used by compensateBeadsCreate activity to roll back a failed issue creation.
  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/beads/delete' && method === 'POST',
    handle: async ({ req, res }) => {
      try {
        const { beadsId, projectPath } = await parseJsonBody(req);

        if (!beadsId) {
          sendError(res, 400, 'Missing required field: beadsId');
          return;
        }

        // Resolve project path — try provided path, then scan DB for first match
        let resolvedPath = projectPath;
        if (!resolvedPath && db?.getProjectsWithFilesystemPath) {
          const projects = db.getProjectsWithFilesystemPath();
          for (const project of projects) {
            if (project.filesystem_path) {
              resolvedPath = project.filesystem_path;
              break;
            }
          }
        }

        if (!resolvedPath) {
          sendError(res, 400, 'Could not resolve project path for deletion');
          return;
        }

        const { deleteBeadsIssue } = await import('../../BeadsService.js');
        const success = await deleteBeadsIssue(resolvedPath, beadsId);

        if (success) {
          sendJson(res, 200, { success: true, deleted: beadsId });
        } else {
          sendError(res, 500, 'Failed to delete beads issue', { beadsId });
        }
      } catch (error) {
        logger.error({ err: error }, 'Failed to handle beads delete');
        sendError(res, 500, 'Failed to handle beads delete', {
          error: error.message,
        });
      }
    },
  });

  // ── Reconciliation Endpoint ────────────────────────────────────
  // Called periodically by beads-mutation-watcher.mjs.
  // Reads ALL active issues from the Dolt SQL database and triggers a
  // full BeadsFileChangeWorkflow which diffs against sync DB state and
  // re-syncs any discrepancies.
  // This provides eventual consistency — any mutation that was missed
  // by the real-time path gets caught on the next reconciliation cycle.
  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/beads/reconcile' && method === 'POST',
    handle: async ({ req, res }) => {
      try {
        const body = await parseJsonBody(req);
        const { projectId } = body;

        if (!projectId) {
          sendError(res, 400, 'Missing required field: projectId');
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

        // Read issues from Dolt SQL instead of POST body / JSONL
        const { DoltQueryService } = await import('../../DoltQueryService.js');
        const dolt = new DoltQueryService();
        await dolt.connect(matched.filesystem_path);
        let beadsIssues;
        try {
          const [rows] = await dolt.pool.execute(
            `SELECT i.*, GROUP_CONCAT(l.label) AS labels
             FROM issues i
             LEFT JOIN labels l ON i.id = l.issue_id
             WHERE i.status != 'tombstone'
             GROUP BY i.id
             ORDER BY i.updated_at DESC`
          );
          beadsIssues = rows.map(row => ({
            id: row.id,
            title: row.title,
            status: row.status,
            priority: row.priority,
            description: row.description,
            labels: row.labels ? row.labels.split(',') : [],
          }));
        } finally {
          await dolt.disconnect();
        }

        if (beadsIssues.length === 0) {
          sendJson(res, 200, { message: 'No issues to reconcile', skipped: true });
          return;
        }

        const { workflowId } = await scheduleBeadsFileChange({
          projectIdentifier: matched.identifier,
          gitRepoPath: matched.filesystem_path,
          beadsIssues,
          changedFiles: [`reconciliation:${beadsIssues.length}-issues`],
          timestamp: new Date().toISOString(),
        });

        logger.info(
          {
            project: matched.identifier,
            workflowId,
            issueCount: beadsIssues.length,
          },
          'Scheduled BeadsFileChangeWorkflow from reconciliation'
        );

        sendJson(res, 202, {
          message: 'Reconciliation sync triggered',
          workflowId,
          project: matched.identifier,
          issueCount: beadsIssues.length,
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to handle beads reconciliation');
        sendError(res, 500, 'Failed to handle beads reconciliation', {
          error: error.message,
        });
      }
    },
  });
}
