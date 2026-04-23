import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';

vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../lib/HealthService.js', () => ({
  getHealthMetrics: vi.fn(() => ({ status: 'healthy' })),
  updateSystemMetrics: vi.fn(),
  getMetricsRegistry: vi.fn(() => ({
    contentType: 'text/plain',
    metrics: vi.fn().mockResolvedValue('metrics'),
  })),
}));

import { createApiServer } from '../../lib/ApiServer.js';

function getRandomPort() {
  return 10000 + Math.floor(Math.random() * 50000);
}

function makeRequest(port, method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('project registry API routes', () => {
  let server;
  let port;
  let mockProjectRegistry;

  beforeAll(async () => {
    port = getRandomPort();
    process.env.HEALTH_PORT = String(port);

    mockProjectRegistry = {
      registerProject: vi.fn(path => ({
        identifier: 'NEWPROJ',
        name: 'New Project',
        filesystem_path: path,
        tech_stack: 'node',
      })),
      updateProject: vi.fn((identifier, updates) => {
        if (identifier === 'PROJ-A') {
          return {
            identifier: 'PROJ-A',
            name: 'Project A',
            status: updates.status || 'active',
            tech_stack: 'node',
            issue_count: 5,
            filesystem_path: updates.filesystem_path || '/opt/stacks/my-project',
            git_url: updates.git_url || 'https://github.com/oculairmedia/project-a.git',
          };
        }
        if (identifier === 'NEWPROJ') {
          return {
            identifier: 'NEWPROJ',
            name: updates.name || 'New Project',
            status: 'active',
            tech_stack: 'node',
            issue_count: 0,
            filesystem_path: '/opt/stacks/new-project',
            git_url: updates.git_url || 'https://github.com/oculairmedia/new-project.git',
          };
        }
        return null;
      }),
      deleteProject: vi.fn(identifier => identifier === 'PROJ-A'),
      getProjects: vi.fn(() => [
        {
          identifier: 'PROJ-A',
          name: 'Project A',
          status: 'active',
          tech_stack: 'node',
          issue_count: 5,
          filesystem_path: '/opt/stacks/my-project',
        },
        {
          identifier: 'PROJ-B',
          name: 'Project B',
          status: 'active',
          tech_stack: 'python',
          issue_count: 0,
          filesystem_path: '/opt/stacks/other-project',
        },
      ]),
      getProject: vi.fn(id => {
        if (id === 'PROJ-A') {
          return {
            identifier: 'PROJ-A',
            name: 'Project A',
            status: 'active',
            tech_stack: 'node',
            issue_count: 5,
            filesystem_path: '/opt/stacks/my-project',
          };
        }
        return null;
      }),
      scanProjects: vi.fn(() => ({ discovered: 10, updated: 8, errors: [] })),
    };

    server = createApiServer({
      config: {
        huly: { apiUrl: 'http://localhost:3457/api' },
        vibeKanban: { apiUrl: 'http://localhost:9717' },
        sync: { interval: 10000 },
        stacks: { baseDir: '/opt/stacks' },
        letta: { enabled: false },
      },
      healthStats: {},
      db: {
        getStats: vi.fn(() => ({ tables: 0, total_rows: 0 })),
        getProjectSummary: vi.fn(() => []),
        getProjectIssues: vi.fn(() => []),
        getProjectFilesystemPath: vi.fn(() => null),
        resolveProjectIdentifier: vi.fn(() => null),
        getProjectFiles: vi.fn(() => []),
        getOrphanedFiles: vi.fn(() => []),
      },
      onSyncTrigger: vi.fn().mockResolvedValue(undefined),
      onConfigUpdate: vi.fn(),
      projectRegistry: mockProjectRegistry,
    });

    await new Promise(resolve => {
      if (server.listening) resolve();
      else server.on('listening', resolve);
    });
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  describe('GET /api/registry/projects', () => {
    it('should return all projects from registry', async () => {
      const res = await makeRequest(port, 'GET', '/api/registry/projects');
      expect(res.statusCode).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.projects).toHaveLength(2);
      expect(res.body.projects[0].identifier).toBe('PROJ-A');
      expect(res.body.timestamp).toBeDefined();
    });

    it('should pass query filters to getProjects', async () => {
      mockProjectRegistry.getProjects.mockClear();
      await makeRequest(port, 'GET', '/api/registry/projects?status=active&tech_stack=node');
      expect(mockProjectRegistry.getProjects).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active', tech_stack: 'node' })
      );
    });
  });

  describe('POST /api/registry/projects', () => {
    it('should register a project from filesystem path', async () => {
      const res = await makeRequest(port, 'POST', '/api/registry/projects', {
        filesystem_path: '/opt/stacks/new-project',
        git_url: 'https://github.com/oculairmedia/new-project.git',
      });

      expect(res.statusCode).toBe(201);
      expect(res.body.project.identifier).toBe('NEWPROJ');
      expect(mockProjectRegistry.registerProject).toHaveBeenCalledWith('/opt/stacks/new-project');
      expect(mockProjectRegistry.updateProject).toHaveBeenCalledWith(
        'NEWPROJ',
        expect.objectContaining({ git_url: 'https://github.com/oculairmedia/new-project.git' })
      );
    });

    it('should validate missing project path', async () => {
      const res = await makeRequest(port, 'POST', '/api/registry/projects', {});
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('filesystem_path is required');
    });

    it('should reject non-absolute project path', async () => {
      const res = await makeRequest(port, 'POST', '/api/registry/projects', {
        filesystem_path: 'relative/path',
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('filesystem_path must be an absolute path');
    });
  });

  describe('PATCH /api/registry/projects/:id', () => {
    it('should update filesystem_path and git_url', async () => {
      const res = await makeRequest(port, 'PATCH', '/api/registry/projects/PROJ-A', {
        filesystem_path: '/opt/stacks/project-a-renamed',
        git_url: 'https://github.com/oculairmedia/project-a-renamed.git',
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.project.identifier).toBe('PROJ-A');
      expect(res.body.project.filesystem_path).toBe('/opt/stacks/project-a-renamed');
    });

    it('should return 404 for nonexistent project', async () => {
      const res = await makeRequest(port, 'PATCH', '/api/registry/projects/NONEXISTENT', {
        git_url: 'https://github.com/oculairmedia/none.git',
      });

      expect(res.statusCode).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });

    it('should archive a project via status update', async () => {
      const res = await makeRequest(port, 'PATCH', '/api/registry/projects/PROJ-A', {
        status: 'archived',
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.project.status).toBe('archived');
      expect(mockProjectRegistry.updateProject).toHaveBeenCalledWith(
        'PROJ-A',
        expect.objectContaining({ status: 'archived' })
      );
    });

    it('should reject invalid status values', async () => {
      const res = await makeRequest(port, 'PATCH', '/api/registry/projects/PROJ-A', {
        status: 'deleted',
      });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('status must be one of: active, archived');
    });
  });

  describe('DELETE /api/registry/projects/:id', () => {
    it('should delete an existing project', async () => {
      const res = await makeRequest(port, 'DELETE', '/api/registry/projects/PROJ-A');

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toBe('Project deleted');
      expect(res.body.identifier).toBe('PROJ-A');
      expect(mockProjectRegistry.deleteProject).toHaveBeenCalledWith('PROJ-A');
    });

    it('should return 404 for a missing project delete', async () => {
      const res = await makeRequest(port, 'DELETE', '/api/registry/projects/NONEXISTENT');

      expect(res.statusCode).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });
  });

  describe('GET /api/registry/projects/:id', () => {
    it('should return a single project', async () => {
      const res = await makeRequest(port, 'GET', '/api/registry/projects/PROJ-A');
      expect(res.statusCode).toBe(200);
      expect(res.body.identifier).toBe('PROJ-A');
      expect(res.body.issue_count).toBe(5);
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe('POST /api/registry/projects/:id/scan', () => {
    it('should trigger scan and return refreshed project', async () => {
      const res = await makeRequest(port, 'POST', '/api/registry/projects/PROJ-A/scan');
      expect(res.statusCode).toBe(200);
      expect(res.body.message).toBe('Scan complete');
      expect(res.body.scan.discovered).toBe(10);
      expect(res.body.project.identifier).toBe('PROJ-A');
    });
  });
});
