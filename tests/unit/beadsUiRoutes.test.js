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

vi.mock('../../lib/BeadsDBReader.js', () => ({
  readIssuesFromDB: vi.fn(projectPath => {
    if (projectPath === '/opt/stacks/my-project') {
      return [
        { id: 'iss-1', title: 'Fix login', status: 'open', priority: 'high' },
        { id: 'iss-2', title: 'Add tests', status: 'closed', priority: 'medium' },
        { id: 'iss-3', title: 'Refactor DB', status: 'open', priority: 'low' },
      ];
    }
    return [];
  }),
  normalizeTitleForComparison: vi.fn(t => t),
  openBeadsDB: vi.fn(),
  buildIssueLookups: vi.fn(),
  getBeadsIssuesWithLookups: vi.fn(),
  getParentIdFromLookup: vi.fn(),
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

describe('beads-ui API routes', () => {
  let server;
  let port;
  let mockProjectRegistry;

  beforeAll(async () => {
    port = getRandomPort();
    process.env.HEALTH_PORT = String(port);

    mockProjectRegistry = {
      getProjects: vi.fn(() => [
        {
          identifier: 'PROJ-A',
          name: 'Project A',
          status: 'active',
          tech_stack: 'node',
          beads_prefix: 'PA',
          beads_issue_count: 5,
          filesystem_path: '/opt/stacks/my-project',
        },
        {
          identifier: 'PROJ-B',
          name: 'Project B',
          status: 'active',
          tech_stack: 'python',
          beads_prefix: null,
          beads_issue_count: 0,
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
            beads_prefix: 'PA',
            beads_issue_count: 5,
            filesystem_path: '/opt/stacks/my-project',
          };
        }
        if (id === 'NO-FS') {
          return {
            identifier: 'NO-FS',
            name: 'No FS',
            status: 'active',
            filesystem_path: null,
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

    it('should pass has_beads filter as boolean', async () => {
      mockProjectRegistry.getProjects.mockClear();
      await makeRequest(port, 'GET', '/api/registry/projects?has_beads=true');
      expect(mockProjectRegistry.getProjects).toHaveBeenCalledWith(
        expect.objectContaining({ has_beads: true })
      );
    });

    it('should handle registry errors', async () => {
      mockProjectRegistry.getProjects.mockImplementationOnce(() => {
        throw new Error('scan failed');
      });
      const res = await makeRequest(port, 'GET', '/api/registry/projects');
      expect(res.statusCode).toBe(500);
      expect(res.body.error).toBe('Failed to fetch projects');
    });
  });

  describe('GET /api/registry/projects/:id', () => {
    it('should return a single project with live issue count', async () => {
      const res = await makeRequest(port, 'GET', '/api/registry/projects/PROJ-A');
      expect(res.statusCode).toBe(200);
      expect(res.body.identifier).toBe('PROJ-A');
      expect(res.body.beads_issue_count_live).toBe(3);
      expect(res.body.timestamp).toBeDefined();
    });

    it('should return 404 for unknown project', async () => {
      const res = await makeRequest(port, 'GET', '/api/registry/projects/NONEXISTENT');
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });

    it('should handle registry errors', async () => {
      mockProjectRegistry.getProject.mockImplementationOnce(() => {
        throw new Error('db error');
      });
      const res = await makeRequest(port, 'GET', '/api/registry/projects/PROJ-A');
      expect(res.statusCode).toBe(500);
    });
  });

  describe('GET /api/registry/projects/:id/issues', () => {
    it('should return beads issues for a project', async () => {
      const res = await makeRequest(port, 'GET', '/api/registry/projects/PROJ-A/issues');
      expect(res.statusCode).toBe(200);
      expect(res.body.projectIdentifier).toBe('PROJ-A');
      expect(res.body.total).toBe(3);
      expect(res.body.issues).toHaveLength(3);
      expect(res.body.issues[0].id).toBe('iss-1');
    });

    it('should filter by status query param', async () => {
      const res = await makeRequest(
        port,
        'GET',
        '/api/registry/projects/PROJ-A/issues?status=open'
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.issues.every(i => i.status === 'open')).toBe(true);
    });

    it('should return 404 for unknown project', async () => {
      const res = await makeRequest(port, 'GET', '/api/registry/projects/NONEXISTENT/issues');
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });

    it('should return 404 if project has no filesystem_path', async () => {
      const res = await makeRequest(port, 'GET', '/api/registry/projects/NO-FS/issues');
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toBe('Project has no filesystem path');
    });
  });

  describe('POST /api/registry/projects/:id/scan', () => {
    it('should trigger scan and return refreshed project', async () => {
      const res = await makeRequest(port, 'POST', '/api/registry/projects/PROJ-A/scan');
      expect(res.statusCode).toBe(200);
      expect(res.body.message).toBe('Scan complete');
      expect(res.body.scan.discovered).toBe(10);
      expect(res.body.scan.updated).toBe(8);
      expect(res.body.project.identifier).toBe('PROJ-A');
      expect(mockProjectRegistry.scanProjects).toHaveBeenCalled();
    });

    it('should return 404 for unknown project', async () => {
      const res = await makeRequest(port, 'POST', '/api/registry/projects/NONEXISTENT/scan');
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });

    it('should handle scan errors', async () => {
      mockProjectRegistry.scanProjects.mockImplementationOnce(() => {
        throw new Error('fs error');
      });
      const res = await makeRequest(port, 'POST', '/api/registry/projects/PROJ-A/scan');
      expect(res.statusCode).toBe(500);
      expect(res.body.error).toBe('Failed to scan projects');
    });
  });
});
