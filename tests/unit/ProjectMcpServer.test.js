import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createProjectMcpServer } from '../../lib/mcp/ProjectMcpServer.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

vi.mock('../../lib/logger.js', () => ({
  logger: {
    child: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    })),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

function createMockDb() {
  return {
    getAllProjects: vi.fn(() => [
      { identifier: 'TEST', name: 'Test Project', filesystem_path: '/opt/stacks/test-project' },
      { identifier: 'DEMO', name: 'Demo Project', filesystem_path: '/opt/stacks/demo' },
    ]),
    getProject: vi.fn(id => {
      if (id === 'TEST') {
        return {
          identifier: 'TEST',
          name: 'Test Project',
          filesystem_path: '/opt/stacks/test-project',
          tech_stack: 'node',
        };
      }

      return null;
    }),
  };
}

async function callTool(server, toolName, args) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const result = await client.callTool({ name: toolName, arguments: args });

  await client.close();
  await server.close();

  return result;
}

describe('ProjectMcpServer', () => {
  let mockDb;
  let mockLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    mockLogger = {
      child: vi.fn(() => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      })),
    };
  });

  describe('project_query tool', () => {
    it('lists all projects from db when registry is unavailable', async () => {
      const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

      const result = await callTool(server, 'project_query', {
        entity: 'project',
        mode: 'list',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(2);
      expect(mockDb.getAllProjects).toHaveBeenCalled();
    });

    it('lists projects from registry with status filter', async () => {
      const registry = {
        getProjects: vi.fn(() => [{ identifier: 'ACTIVE', status: 'active' }]),
      };
      const server = createProjectMcpServer({ db: mockDb, logger: mockLogger, registry });

      const result = await callTool(server, 'project_query', {
        entity: 'project',
        mode: 'list',
        status_filter: 'active',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(1);
      expect(registry.getProjects).toHaveBeenCalledWith({ status: 'active' });
    });

    it('gets a single project by identifier', async () => {
      const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

      const result = await callTool(server, 'project_query', {
        entity: 'project',
        mode: 'get',
        project_identifier: 'TEST',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.identifier).toBe('TEST');
      expect(mockDb.getProject).toHaveBeenCalledWith('TEST');
    });

    it('uses registry for single-project lookup when available', async () => {
      const registry = {
        getProject: vi.fn(() => ({ identifier: 'REG', name: 'Registry Project' })),
      };
      const server = createProjectMcpServer({ db: mockDb, logger: mockLogger, registry });

      const result = await callTool(server, 'project_query', {
        entity: 'project',
        mode: 'get',
        project_identifier: 'REG',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.identifier).toBe('REG');
      expect(registry.getProject).toHaveBeenCalledWith('REG');
    });

    it('searches projects by identifier, name, path, or tech stack', async () => {
      const registry = {
        getProjects: vi.fn(() => [
          {
            identifier: 'TEST',
            name: 'Test Project',
            filesystem_path: '/opt/stacks/test-project',
            tech_stack: 'node',
          },
          {
            identifier: 'RUSTY',
            name: 'Ferric App',
            filesystem_path: '/opt/stacks/rusty',
            tech_stack: 'rust',
          },
        ]),
      };
      const server = createProjectMcpServer({ db: mockDb, logger: mockLogger, registry });

      const result = await callTool(server, 'project_query', {
        entity: 'project',
        mode: 'search',
        search_term: 'rust',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].identifier).toBe('RUSTY');
    });

    it('returns error when project_identifier is missing in get mode', async () => {
      const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

      const result = await callTool(server, 'project_query', {
        entity: 'project',
        mode: 'get',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(result.isError).toBe(true);
      expect(parsed.error).toContain('project_identifier is required');
    });
  });
});
