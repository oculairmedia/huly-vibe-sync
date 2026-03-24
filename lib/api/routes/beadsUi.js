import { readIssuesFromDB } from '../../BeadsDBReader.js';

/**
 * GET  /api/registry/projects            — list all registered projects
 * GET  /api/registry/projects/:id         — single project with issue counts
 * GET  /api/registry/projects/:id/issues  — beads issues for a project
 * POST /api/registry/projects/:id/scan    — trigger a project rescan
 */
export function registerBeadsUiRoutes(app, deps) {
  const { projectRegistry, sendJson, sendError, logger } = deps;

  // ── GET /api/registry/projects ──────────────────────────────────
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
        const hasBeads = url.searchParams.get('has_beads');

        if (status) filters.status = status;
        if (techStack) filters.tech_stack = techStack;
        if (hasBeads !== null && hasBeads !== undefined) {
          filters.has_beads = hasBeads === 'true';
        }

        const projects = projectRegistry.getProjects(filters);
        sendJson(res, 200, {
          total: projects.length,
          projects,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get registry projects');
        sendError(res, 500, 'Failed to fetch projects', { error: error.message });
      }
    },
  });

  // ── GET /api/registry/projects/:id ──────────────────────────────
  app.registerRoute({
    match: ({ pathname, method }) =>
      method === 'GET' &&
      /^\/api\/registry\/projects\/[^/]+$/.test(pathname) &&
      !pathname.endsWith('/issues'),
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

        let beadsIssueCount = project.beads_issue_count || 0;
        if (project.filesystem_path) {
          try {
            const issues = readIssuesFromDB(project.filesystem_path);
            beadsIssueCount = issues.length;
          } catch {
            // cached count from DB used as fallback
          }
        }

        sendJson(res, 200, {
          ...project,
          beads_issue_count_live: beadsIssueCount,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get registry project');
        sendError(res, 500, 'Failed to fetch project', { error: error.message });
      }
    },
  });

  // ── GET /api/registry/projects/:id/issues ───────────────────────
  app.registerRoute({
    match: ({ pathname, method }) =>
      method === 'GET' && /^\/api\/registry\/projects\/[^/]+\/issues$/.test(pathname),
    handle: async ({ res, pathname, url }) => {
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

        if (!project.filesystem_path) {
          sendError(res, 404, 'Project has no filesystem path', { identifier });
          return;
        }

        const issues = readIssuesFromDB(project.filesystem_path);

        const statusFilter = url.searchParams.get('status');
        const filtered = statusFilter ? issues.filter(i => i.status === statusFilter) : issues;

        sendJson(res, 200, {
          projectIdentifier: identifier,
          total: filtered.length,
          issues: filtered,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get beads issues');
        sendError(res, 500, 'Failed to fetch beads issues', { error: error.message });
      }
    },
  });

  // ── POST /api/registry/projects/:id/scan ────────────────────────
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
          project: refreshed,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to scan projects');
        sendError(res, 500, 'Failed to scan projects', { error: error.message });
      }
    },
  });
}
