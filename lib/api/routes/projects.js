import path from 'path';

const ALLOWED_PROJECT_STATUSES = new Set(['active', 'archived']);

function isAbsolutePath(value) {
  return typeof value === 'string' && value.trim().length > 0 && path.isAbsolute(value.trim());
}

function serializeProject(project) {
  if (!project) return null;

  return {
    identifier: project.identifier,
    name: project.name,
    tech_stack: project.tech_stack,
    letta_agent_id: project.letta_agent_id,
    status: project.status,
    last_scan_at: project.last_scan_at,
    issue_count: project.issue_count,
    filesystem_path: project.filesystem_path,
    git_url: project.git_url,
    description: project.description,
    last_sync_at: project.last_sync_at,
  };
}

export function registerProjectRoutes(app, deps) {
  const { db, codePerceptionWatcher, parseJsonBody, sendJson, sendError, logger, projectRegistry } =
    deps;

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
    match: ({ pathname, method }) => pathname === '/api/registry/projects' && method === 'POST',
    handle: async ({ req, res }) => {
      if (!projectRegistry) {
        sendError(res, 503, 'ProjectRegistry not available');
        return;
      }

      try {
        const body = await parseJsonBody(req);
        const dirPath = typeof body.filesystem_path === 'string' ? body.filesystem_path.trim() : '';

        if (!dirPath) {
          sendError(res, 400, 'filesystem_path is required', { field: 'filesystem_path' });
          return;
        }

        if (!isAbsolutePath(dirPath)) {
          sendError(res, 400, 'filesystem_path must be an absolute path', {
            field: 'filesystem_path',
          });
          return;
        }

        const project = projectRegistry.registerProject(dirPath);
        const updatedProject = projectRegistry.updateProject(project.identifier, {
          name: typeof body.name === 'string' ? body.name.trim() : undefined,
          git_url: typeof body.git_url === 'string' ? body.git_url.trim() : undefined,
        });

        sendJson(res, 201, {
          message: 'Project registered',
          project: serializeProject(updatedProject || project),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to register project');
        const statusCode = error.message.includes('does not exist') ? 404 : 400;
        sendError(res, statusCode, 'Failed to register project', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      method === 'PATCH' && /^\/api\/registry\/projects\/[^/]+$/.test(pathname),
    handle: async ({ req, res, pathname }) => {
      if (!projectRegistry) {
        sendError(res, 503, 'ProjectRegistry not available');
        return;
      }

      try {
        const identifier = decodeURIComponent(pathname.split('/')[4]);
        const body = await parseJsonBody(req);
        const updates = {};

        if (body.filesystem_path !== undefined) {
          if (!isAbsolutePath(body.filesystem_path)) {
            sendError(res, 400, 'filesystem_path must be an absolute path', {
              field: 'filesystem_path',
            });
            return;
          }
          updates.filesystem_path = body.filesystem_path.trim();
        }

        if (body.git_url !== undefined) {
          updates.git_url = typeof body.git_url === 'string' ? body.git_url.trim() : body.git_url;
        }

        if (body.status !== undefined) {
          if (
            typeof body.status !== 'string' ||
            !ALLOWED_PROJECT_STATUSES.has(body.status.trim())
          ) {
            sendError(res, 400, 'status must be one of: active, archived', { field: 'status' });
            return;
          }

          updates.status = body.status.trim();
        }

        const project = projectRegistry.updateProject(identifier, updates);
        if (!project) {
          sendError(res, 404, 'Project not found', { identifier });
          return;
        }

        sendJson(res, 200, {
          message: 'Project updated',
          project: serializeProject(project),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to update project');
        const statusCode = error.message.includes('does not exist') ? 404 : 400;
        sendError(res, statusCode, 'Failed to update project', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      method === 'DELETE' && /^\/api\/registry\/projects\/[^/]+$/.test(pathname),
    handle: async ({ res, pathname }) => {
      if (!projectRegistry) {
        sendError(res, 503, 'ProjectRegistry not available');
        return;
      }

      try {
        const identifier = decodeURIComponent(pathname.split('/')[4]);
        const deleted = projectRegistry.deleteProject(identifier);

        if (!deleted) {
          sendError(res, 404, 'Project not found', { identifier });
          return;
        }

        sendJson(res, 200, {
          message: 'Project deleted',
          identifier,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to delete project');
        sendError(res, 500, 'Failed to delete project', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/registry/projects' && method === 'GET',
    handle: async ({ res, url }) => {
      if (!projectRegistry) {
        sendError(res, 503, 'ProjectRegistry not available');
        return;
      }

      try {
        const filters = {};
        const status = url.searchParams.get('status');
        const techStack = url.searchParams.get('tech_stack');

        if (status) filters.status = status;
        if (techStack) filters.tech_stack = techStack;

        const projects = projectRegistry.getProjects(filters);
        sendJson(res, 200, {
          total: projects.length,
          projects: projects.map(serializeProject),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get registry projects');
        sendError(res, 500, 'Failed to fetch projects', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      method === 'GET' && /^\/api\/registry\/projects\/[^/]+$/.test(pathname),
    handle: async ({ res, pathname }) => {
      if (!projectRegistry) {
        sendError(res, 503, 'ProjectRegistry not available');
        return;
      }

      try {
        const identifier = decodeURIComponent(pathname.split('/')[4]);
        const project = projectRegistry.getProject(identifier);

        if (!project) {
          sendError(res, 404, 'Project not found', { identifier });
          return;
        }

        sendJson(res, 200, {
          ...serializeProject(project),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get registry project');
        sendError(res, 500, 'Failed to fetch project', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      method === 'POST' && /^\/api\/registry\/projects\/[^/]+\/scan$/.test(pathname),
    handle: async ({ res, pathname }) => {
      if (!projectRegistry) {
        sendError(res, 503, 'ProjectRegistry not available');
        return;
      }

      try {
        const identifier = decodeURIComponent(pathname.split('/')[4]);
        const existing = projectRegistry.getProject(identifier);
        if (!existing) {
          sendError(res, 404, 'Project not found', { identifier });
          return;
        }

        const result = projectRegistry.scanProjects();
        const refreshed = projectRegistry.getProject(identifier);

        sendJson(res, 200, {
          message: 'Scan complete',
          scan: result,
          project: serializeProject(refreshed),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to scan projects');
        sendError(res, 500, 'Failed to scan projects', { error: error.message });
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
