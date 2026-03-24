/**
 * Unit Tests for ProjectMcpServer
 *
 * Comprehensive test coverage for:
 * - project_query tool (project, issue, comment queries)
 * - project_issue_ops tool (create, update, delete, close, reopen, label, comment)
 * - Error handling and validation
 * - Database integration
 * - Beads CLI integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createProjectMcpServer } from '../../lib/mcp/ProjectMcpServer.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// Mock dependencies
vi.mock('../../lib/beads/BeadsCLI.js', () => ({
  execBeadsCommand: vi.fn(),
}));

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

import { execBeadsCommand } from '../../lib/beads/BeadsCLI.js';

/**
 * Create mock database with all required methods
 */
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
        };
      }
      return null;
    }),
    getProjectFilesystemPath: vi.fn(id => {
      if (id === 'TEST') return '/opt/stacks/test-project';
      if (id === 'DEMO') return '/opt/stacks/demo';
      return null;
    }),
    resolveProjectIdentifier: vi.fn(id => {
      if (id === 'test-project') return 'TEST';
      if (id === 'demo') return 'DEMO';
      return null;
    }),
  };
}

/**
 * Call MCP tool via in-memory transport
 */
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

  // ============================================================
  // project_query Tests
  // ============================================================
  describe('project_query tool', () => {
    describe('project entity', () => {
      it('should list all projects', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_query', {
          entity: 'project',
          mode: 'list',
        });

        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe('text');
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).toHaveLength(2);
        expect(parsed[0].identifier).toBe('TEST');
        expect(parsed[1].identifier).toBe('DEMO');
        expect(mockDb.getAllProjects).toHaveBeenCalled();
      });

      it('should get single project by identifier', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_query', {
          entity: 'project',
          mode: 'get',
          project_identifier: 'TEST',
        });

        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.identifier).toBe('TEST');
        expect(parsed.name).toBe('Test Project');
        expect(mockDb.getProject).toHaveBeenCalledWith('TEST');
      });

      it('should return null for unknown project in get mode', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_query', {
          entity: 'project',
          mode: 'get',
          project_identifier: 'UNKNOWN',
        });

        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).toBeNull();
      });

      it('should return error when project_identifier missing in get mode', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_query', {
          entity: 'project',
          mode: 'get',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('project_identifier is required');
      });
    });

    describe('issue entity', () => {
      it('should list all issues for a project', async () => {
        execBeadsCommand.mockResolvedValue(
          JSON.stringify([
            { id: 'issue-1', title: 'First Issue', status: 'open' },
            { id: 'issue-2', title: 'Second Issue', status: 'closed' },
          ])
        );

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_query', {
          entity: 'issue',
          mode: 'list',
          project_identifier: 'TEST',
        });

        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).toHaveLength(2);
        expect(parsed[0].id).toBe('issue-1');
        expect(execBeadsCommand).toHaveBeenCalledWith('list --json', '/opt/stacks/test-project');
      });

      it('should list issues with status filter open', async () => {
        execBeadsCommand.mockResolvedValue(
          JSON.stringify([{ id: 'issue-1', title: 'Open Issue', status: 'open' }])
        );

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_query', {
          entity: 'issue',
          mode: 'list',
          project_identifier: 'TEST',
          status_filter: 'open',
        });

        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].status).toBe('open');
        expect(execBeadsCommand).toHaveBeenCalledWith(
          'list --json --status=open',
          '/opt/stacks/test-project'
        );
      });

      it('should list issues with status filter closed', async () => {
        execBeadsCommand.mockResolvedValue(
          JSON.stringify([{ id: 'issue-2', title: 'Closed Issue', status: 'closed' }])
        );

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_query', {
          entity: 'issue',
          mode: 'list',
          project_identifier: 'TEST',
          status_filter: 'closed',
        });

        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed[0].status).toBe('closed');
        expect(execBeadsCommand).toHaveBeenCalledWith(
          'list --json --status=closed',
          '/opt/stacks/test-project'
        );
      });

      it('should get single issue by ID', async () => {
        execBeadsCommand.mockResolvedValue(
          JSON.stringify({ id: 'issue-1', title: 'Test Issue', status: 'open' })
        );

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_query', {
          entity: 'issue',
          mode: 'get',
          project_identifier: 'TEST',
          issue_id: 'issue-1',
        });

        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.id).toBe('issue-1');
        expect(parsed.title).toBe('Test Issue');
        expect(execBeadsCommand).toHaveBeenCalledWith(
          'show issue-1 --json',
          '/opt/stacks/test-project'
        );
      });

      it('should search issues by term', async () => {
        execBeadsCommand.mockResolvedValue(
          JSON.stringify([{ id: 'issue-1', title: 'Bug in authentication' }])
        );

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_query', {
          entity: 'issue',
          mode: 'search',
          project_identifier: 'TEST',
          search_term: 'authentication',
        });

        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed[0].title).toContain('authentication');
        expect(execBeadsCommand).toHaveBeenCalledWith(
          "search 'authentication' --json",
          '/opt/stacks/test-project'
        );
      });

      it('should return error when project_identifier missing for issue query', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_query', {
          entity: 'issue',
          mode: 'list',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('project_identifier is required');
      });

      it('should return error when issue_id missing in get mode', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_query', {
          entity: 'issue',
          mode: 'get',
          project_identifier: 'TEST',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('issue_id is required');
      });

      it('should return error when search_term missing in search mode', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_query', {
          entity: 'issue',
          mode: 'search',
          project_identifier: 'TEST',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('search_term is required');
      });

      it('should handle execBeadsCommand failure', async () => {
        execBeadsCommand.mockRejectedValue(new Error('bd command failed'));

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_query', {
          entity: 'issue',
          mode: 'list',
          project_identifier: 'TEST',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('bd command failed');
      });

      it('should resolve folder name to project identifier', async () => {
        execBeadsCommand.mockResolvedValue(JSON.stringify([]));

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        await callTool(server, 'project_query', {
          entity: 'issue',
          mode: 'list',
          project_identifier: 'test-project',
        });

        expect(mockDb.resolveProjectIdentifier).toHaveBeenCalledWith('test-project');
        expect(execBeadsCommand).toHaveBeenCalledWith('list --json', '/opt/stacks/test-project');
      });
    });

    describe('comment entity', () => {
      it('should list comments for an issue', async () => {
        execBeadsCommand.mockResolvedValue(
          JSON.stringify([
            { id: 'comment-1', text: 'First comment', author: 'user1' },
            { id: 'comment-2', text: 'Second comment', author: 'user2' },
          ])
        );

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_query', {
          entity: 'comment',
          mode: 'list',
          project_identifier: 'TEST',
          issue_id: 'issue-1',
        });

        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).toHaveLength(2);
        expect(parsed[0].id).toBe('comment-1');
        expect(execBeadsCommand).toHaveBeenCalledWith(
          'comments list issue-1 --json',
          '/opt/stacks/test-project'
        );
      });

      it('should return error when project_identifier missing for comment query', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_query', {
          entity: 'comment',
          mode: 'list',
          issue_id: 'issue-1',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('project_identifier is required');
      });

      it('should return error when issue_id missing for comment query', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_query', {
          entity: 'comment',
          mode: 'list',
          project_identifier: 'TEST',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('issue_id is required');
      });
    });
  });

  // ============================================================
  // project_issue_ops Tests
  // ============================================================
  describe('project_issue_ops tool', () => {
    describe('create operation', () => {
      it('should create issue with title only', async () => {
        execBeadsCommand.mockResolvedValue(
          JSON.stringify({ id: 'new-issue', title: 'New Issue', status: 'open' })
        );

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'create',
          project_identifier: 'TEST',
          title: 'New Issue',
        });

        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.id).toBe('new-issue');
        expect(parsed.title).toBe('New Issue');
        expect(execBeadsCommand).toHaveBeenCalledWith(
          "create 'New Issue' --json",
          '/opt/stacks/test-project'
        );
      });

      it('should create issue with title and priority', async () => {
        execBeadsCommand.mockResolvedValue(
          JSON.stringify({ id: 'new-issue', title: 'High Priority', priority: 'P1' })
        );

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'create',
          project_identifier: 'TEST',
          title: 'High Priority',
          priority: 'P1',
        });

        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.priority).toBe('P1');
        expect(execBeadsCommand).toHaveBeenCalledWith(
          "create 'High Priority' --json --priority=P1",
          '/opt/stacks/test-project'
        );
      });

      it('should create issue and add description as comment', async () => {
        execBeadsCommand
          .mockResolvedValueOnce(
            JSON.stringify({ id: 'new-issue', title: 'Issue with description' })
          )
          .mockResolvedValueOnce('');

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'create',
          project_identifier: 'TEST',
          title: 'Issue with description',
          description: 'This is a detailed description',
        });

        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.id).toBe('new-issue');
        expect(execBeadsCommand).toHaveBeenCalledTimes(2);
        expect(execBeadsCommand).toHaveBeenNthCalledWith(
          2,
          "comment new-issue 'This is a detailed description'",
          '/opt/stacks/test-project'
        );
      });

      it('should return error when title missing for create', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'create',
          project_identifier: 'TEST',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('title is required');
      });

      it('should handle comment addition failure gracefully', async () => {
        execBeadsCommand
          .mockResolvedValueOnce(JSON.stringify({ id: 'new-issue', title: 'Test' }))
          .mockRejectedValueOnce(new Error('Comment failed'));

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'create',
          project_identifier: 'TEST',
          title: 'Test',
          description: 'Description',
        });

        expect(result.isError).not.toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.id).toBe('new-issue');
      });
    });

    describe('update operation', () => {
      it('should update issue field', async () => {
        execBeadsCommand.mockResolvedValue('');

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'update',
          project_identifier: 'TEST',
          issue_id: 'issue-1',
          field: 'priority',
          value: 'P2',
        });

        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.issue_id).toBe('issue-1');
        expect(parsed.field).toBe('priority');
        expect(parsed.value).toBe('P2');
        expect(execBeadsCommand).toHaveBeenCalledWith(
          "update issue-1 --priority='P2'",
          '/opt/stacks/test-project'
        );
      });

      it('should return error when issue_id missing for update', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'update',
          project_identifier: 'TEST',
          field: 'priority',
          value: 'P1',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('issue_id is required');
      });

      it('should return error when field or value missing for update', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'update',
          project_identifier: 'TEST',
          issue_id: 'issue-1',
          field: 'priority',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('field and value are required');
      });
    });

    describe('delete operation', () => {
      it('should delete issue', async () => {
        execBeadsCommand.mockResolvedValue('');

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'delete',
          project_identifier: 'TEST',
          issue_id: 'issue-1',
        });

        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.issue_id).toBe('issue-1');
        expect(parsed.operation).toBe('deleted');
        expect(execBeadsCommand).toHaveBeenCalledWith('delete issue-1', '/opt/stacks/test-project');
      });

      it('should return error when issue_id missing for delete', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'delete',
          project_identifier: 'TEST',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('issue_id is required');
      });
    });

    describe('close operation', () => {
      it('should close issue', async () => {
        execBeadsCommand.mockResolvedValue('');

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'close',
          project_identifier: 'TEST',
          issue_id: 'issue-1',
        });

        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.issue_id).toBe('issue-1');
        expect(parsed.operation).toBe('closed');
        expect(execBeadsCommand).toHaveBeenCalledWith('close issue-1', '/opt/stacks/test-project');
      });

      it('should return error when issue_id missing for close', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'close',
          project_identifier: 'TEST',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('issue_id is required');
      });
    });

    describe('reopen operation', () => {
      it('should reopen issue', async () => {
        execBeadsCommand.mockResolvedValue('');

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'reopen',
          project_identifier: 'TEST',
          issue_id: 'issue-1',
        });

        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.issue_id).toBe('issue-1');
        expect(parsed.operation).toBe('reopened');
        expect(execBeadsCommand).toHaveBeenCalledWith('reopen issue-1', '/opt/stacks/test-project');
      });

      it('should return error when issue_id missing for reopen', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'reopen',
          project_identifier: 'TEST',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('issue_id is required');
      });
    });

    describe('label operation', () => {
      it('should add label to issue', async () => {
        execBeadsCommand.mockResolvedValue('');

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'label',
          project_identifier: 'TEST',
          issue_id: 'issue-1',
          label_action: 'add',
          label: 'bug',
        });

        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.issue_id).toBe('issue-1');
        expect(parsed.label_action).toBe('add');
        expect(parsed.label).toBe('bug');
        expect(execBeadsCommand).toHaveBeenCalledWith(
          "label add issue-1 'bug'",
          '/opt/stacks/test-project'
        );
      });

      it('should remove label from issue', async () => {
        execBeadsCommand.mockResolvedValue('');

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'label',
          project_identifier: 'TEST',
          issue_id: 'issue-1',
          label_action: 'remove',
          label: 'enhancement',
        });

        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(execBeadsCommand).toHaveBeenCalledWith(
          "label remove issue-1 'enhancement'",
          '/opt/stacks/test-project'
        );
      });

      it('should return error when issue_id missing for label', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'label',
          project_identifier: 'TEST',
          label_action: 'add',
          label: 'bug',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('issue_id is required');
      });

      it('should return error when label_action or label missing', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'label',
          project_identifier: 'TEST',
          issue_id: 'issue-1',
          label_action: 'add',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('label_action and label are required');
      });
    });

    describe('comment operation', () => {
      it('should add comment to issue', async () => {
        execBeadsCommand.mockResolvedValue('');

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'comment',
          project_identifier: 'TEST',
          issue_id: 'issue-1',
          comment_text: 'This is a comment',
        });

        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.issue_id).toBe('issue-1');
        expect(parsed.operation).toBe('comment_added');
        expect(execBeadsCommand).toHaveBeenCalledWith(
          "comment issue-1 'This is a comment'",
          '/opt/stacks/test-project'
        );
      });

      it('should return error when issue_id missing for comment', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'comment',
          project_identifier: 'TEST',
          comment_text: 'Test comment',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('issue_id is required');
      });

      it('should return error when comment_text missing', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'comment',
          project_identifier: 'TEST',
          issue_id: 'issue-1',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('comment_text is required');
      });
    });

    describe('error handling', () => {
      it('should return error for unknown project', async () => {
        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'close',
          project_identifier: 'UNKNOWN',
          issue_id: 'issue-1',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('Project not found');
      });

      it('should handle execBeadsCommand failure in operations', async () => {
        execBeadsCommand.mockRejectedValue(new Error('Command execution failed'));

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        const result = await callTool(server, 'project_issue_ops', {
          operation: 'close',
          project_identifier: 'TEST',
          issue_id: 'issue-1',
        });

        expect(result.isError).toBe(true);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toContain('Command execution failed');
      });

      it('should resolve folder name to project identifier', async () => {
        execBeadsCommand.mockResolvedValue('');

        const server = createProjectMcpServer({ db: mockDb, logger: mockLogger });

        await callTool(server, 'project_issue_ops', {
          operation: 'close',
          project_identifier: 'test-project',
          issue_id: 'issue-1',
        });

        expect(mockDb.resolveProjectIdentifier).toHaveBeenCalledWith('test-project');
        expect(execBeadsCommand).toHaveBeenCalledWith('close issue-1', '/opt/stacks/test-project');
      });
    });
  });
});
