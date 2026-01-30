/**
 * Unit Tests for HulyRestClient
 *
 * Tests REST API client for Huly platform
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HulyRestClient } from '../../lib/HulyRestClient.js';
import {
  createMockHealthResponse,
  createMockHulyProject,
  createMockHulyIssue,
  createMockListProjectsResponse,
  createMockListIssuesResponse,
  createMockToolResponse,
  createMockCreateIssueResponse,
  createMockUpdateIssueResponse,
} from '../mocks/hulyMocks.js';

describe('HulyRestClient', () => {
  let client;
  let mockFetch;
  const baseUrl = 'http://localhost:3458';

  beforeEach(() => {
    client = new HulyRestClient(baseUrl);

    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create client with correct base URL', () => {
      const client = new HulyRestClient('http://localhost:3457/mcp');
      expect(client.baseUrl).toBe('http://localhost:3458/api');
    });

    it('should normalize URL by removing /mcp suffix', () => {
      const client = new HulyRestClient('http://localhost:3457/mcp');
      expect(client.baseUrl).not.toContain('/mcp');
      expect(client.baseUrl).toContain('/api');
    });

    it('should normalize URL by removing /api suffix and re-adding', () => {
      const client = new HulyRestClient('http://localhost:3457/api');
      expect(client.baseUrl).toBe('http://localhost:3458/api');
    });

    it('should set port to 3458', () => {
      const client = new HulyRestClient('http://localhost:8080');
      expect(client.baseUrl).toContain(':3458');
    });

    it('should use custom name if provided', () => {
      const client = new HulyRestClient(baseUrl, { name: 'Custom' });
      expect(client.name).toBe('Custom');
    });

    it('should use default name if not provided', () => {
      const client = new HulyRestClient(baseUrl);
      expect(client.name).toBe('Huly REST');
    });

    it('should use custom timeout if provided', () => {
      const client = new HulyRestClient(baseUrl, { timeout: 30000 });
      expect(client.timeout).toBe(30000);
    });

    it('should use default timeout if not provided', () => {
      const client = new HulyRestClient(baseUrl);
      expect(client.timeout).toBe(60000);
    });
  });

  describe('initialize', () => {
    it('should test health endpoint on initialize', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => createMockHealthResponse(),
      });

      await client.initialize();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/health',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should return true on successful health check', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => createMockHealthResponse({ status: 'ok', connected: true }),
      });

      const result = await client.initialize();
      expect(result).toBe(true);
    });

    it('should throw error on failed health check', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Server Error',
      });

      await expect(client.initialize()).rejects.toThrow('Health check failed');
    });

    it('should throw error on invalid response format', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}), // Missing status field
      });

      await expect(client.initialize()).rejects.toThrow('Invalid health check response format');
    });

    it('should throw error on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(client.initialize()).rejects.toThrow('Network error');
    });
  });

  describe('healthCheck', () => {
    it('should call health endpoint', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockHealthResponse(),
      });

      await client.healthCheck();

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3458/health', expect.any(Object));
    });

    it('should return health status', async () => {
      const mockHealth = createMockHealthResponse({ status: 'ok' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockHealth,
      });

      const result = await client.healthCheck();
      expect(result).toEqual(mockHealth);
    });

    it('should throw on failed health check', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      await expect(client.healthCheck()).rejects.toThrow('Health check failed');
    });
  });

  describe('callTool', () => {
    it('should call tool endpoint with correct URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockToolResponse('test_tool', 'result'),
      });

      await client.callTool('test_tool', { arg: 'value' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/tools/test_tool',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should send arguments in request body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockToolResponse('test_tool', 'result'),
      });

      const args = { key: 'value', number: 42 };
      await client.callTool('test_tool', args);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.arguments).toEqual(args);
    });

    it('should return tool result', async () => {
      const mockResponse = createMockToolResponse('test_tool', 'test result');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.callTool('test_tool');
      // callTool returns just the result content, not the full response
      expect(result).toBe('test result');
    });

    it('should throw on failed tool call', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid arguments',
      });

      await expect(client.callTool('test_tool')).rejects.toThrow('REST API error (400)');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      await expect(client.callTool('test_tool')).rejects.toThrow('Connection refused');
    });
  });

  describe('listProjects', () => {
    it('should call projects endpoint', async () => {
      const projects = [createMockHulyProject(), createMockHulyProject({ identifier: 'TEST2' })];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ projects }),
      });

      await client.listProjects();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/projects',
        expect.any(Object)
      );
    });

    it('should return list of projects', async () => {
      const projects = [
        createMockHulyProject({ identifier: 'TEST1', name: 'Project 1' }),
        createMockHulyProject({ identifier: 'TEST2', name: 'Project 2' }),
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ projects }),
      });

      const result = await client.listProjects();
      expect(result).toHaveLength(2);
      expect(result[0].identifier).toBe('TEST1');
      expect(result[1].identifier).toBe('TEST2');
    });

    it('should return empty array if no projects', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ projects: [] }),
      });

      const result = await client.listProjects();
      expect(result).toEqual([]);
    });
  });

  describe('listIssues', () => {
    it('should call issues endpoint with project identifier', async () => {
      const issues = [createMockHulyIssue()];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ issues, count: issues.length }),
      });

      await client.listIssues('TEST');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/projects/TEST/issues',
        expect.any(Object)
      );
    });

    it('should return list of issues', async () => {
      const issues = [
        createMockHulyIssue({ identifier: 'TEST-1' }),
        createMockHulyIssue({ identifier: 'TEST-2' }),
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ issues, count: issues.length }),
      });

      const result = await client.listIssues('TEST');
      expect(result).toHaveLength(2);
      expect(result[0].identifier).toBe('TEST-1');
      expect(result[1].identifier).toBe('TEST-2');
    });

    it('should support limit option', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [], count: 0 }),
      });

      await client.listIssues('TEST', { limit: 50 });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain('limit=50');
    });

    it('should support modifiedSince option for incremental sync', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [], count: 0 }),
      });

      const timestamp = new Date().toISOString();
      await client.listIssues('TEST', { modifiedSince: timestamp });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain('modifiedSince=');
    });

    it('should support legacy modifiedAfter as alias for modifiedSince', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [], count: 0 }),
      });

      const timestamp = new Date().toISOString();
      await client.listIssues('TEST', { modifiedAfter: timestamp });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain('modifiedSince='); // modifiedAfter maps to modifiedSince
    });

    it('should return issues array by default (backward compatible)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [], count: 0 }),
      });

      const result = await client.listIssues('TEST');
      expect(result).toEqual([]);
    });

    it('should return { issues, syncMeta } when includeSyncMeta is true', async () => {
      const syncMeta = {
        latestModified: '2025-01-01T00:00:00Z',
        serverTime: '2025-01-01T00:00:00Z',
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [{ identifier: 'TEST-1' }], count: 1, syncMeta }),
      });

      const result = await client.listIssues('TEST', { includeSyncMeta: true });
      expect(result.issues).toEqual([{ identifier: 'TEST-1' }]);
      expect(result.syncMeta).toEqual(syncMeta);
      expect(result.count).toBe(1);
    });
  });

  describe('getIssue', () => {
    it('should call REST API issues endpoint', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ identifier: 'TEST-1', title: 'Test Issue' }),
      });

      await client.getIssue('TEST-1');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/issues/TEST-1',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });
  });

  describe('createIssue', () => {
    it('should call REST API issues endpoint', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockCreateIssueResponse(),
      });

      await client.createIssue('TEST', {
        title: 'New Issue',
        description: 'Description',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/issues',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should send issue data in request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockCreateIssueResponse(),
      });

      const issueData = {
        title: 'New Issue',
        description: 'Test description',
        priority: 'High',
      };

      await client.createIssue('TEST', issueData);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.project_identifier).toBe('TEST');
      expect(body.title).toBe('New Issue');
      expect(body.description).toBe('Test description');
      expect(body.priority).toBe('High');
    });

    it('should return created issue', async () => {
      const createdIssue = createMockCreateIssueResponse({
        identifier: 'TEST-42',
        title: 'New Issue',
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createdIssue,
      });

      const result = await client.createIssue('TEST', { title: 'New Issue' });
      expect(result.identifier).toBe('TEST-42');
    });
  });

  describe('updateIssue', () => {
    it('should call REST API PUT endpoint', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockUpdateIssueResponse('TEST-1', 'status', 'Done'),
      });

      await client.updateIssue('TEST-1', 'status', 'Done');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/issues/TEST-1',
        expect.objectContaining({
          method: 'PUT',
        })
      );
    });

    it('should send update parameters in body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockUpdateIssueResponse('TEST-1', 'status', 'Done'),
      });

      await client.updateIssue('TEST-1', 'status', 'Done');

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.field).toBe('status');
      expect(body.value).toBe('Done');
    });

    it('should return update result', async () => {
      const updateResponse = createMockUpdateIssueResponse('TEST-1', 'priority', 'High');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => updateResponse,
      });

      const result = await client.updateIssue('TEST-1', 'priority', 'High');
      expect(result.issueId).toBe('TEST-1');
      expect(result.field).toBe('priority');
      expect(result.value).toBe('High');
    });
  });

  describe('error handling', () => {
    it('should handle 404 errors gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Resource not found',
      });

      await expect(client.listProjects()).rejects.toThrow('REST API error (404)');
    });

    it('should handle 500 errors gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server error',
      });

      await expect(client.listIssues('TEST')).rejects.toThrow('REST API error (500)');
    });

    it('should handle timeout errors', async () => {
      mockFetch.mockRejectedValue(new Error('Timeout'));

      await expect(client.healthCheck()).rejects.toThrow('Timeout');
    });
  });

  describe('edge cases', () => {
    it('should handle empty project identifier', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [], count: 0 }),
      });

      await client.listIssues('');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/projects//issues',
        expect.any(Object)
      );
    });

    it('should handle very long issue titles', async () => {
      const longTitle = 'A'.repeat(1000);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockCreateIssueResponse(),
      });

      await client.createIssue('TEST', { title: longTitle });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.title).toBe(longTitle);
    });

    it('should handle special characters in identifiers', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ identifier: 'TEST-123_ABC', title: 'Test Issue' }),
      });

      await client.getIssue('TEST-123_ABC');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/issues/TEST-123_ABC',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });
  });

  // ============================================================
  // Bulk Delete Tests
  // ============================================================
  describe('deleteIssuesBulk', () => {
    it('should delete multiple issues', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          deleted: [
            { identifier: 'TEST-1', subIssuesHandled: 0, cascaded: false },
            { identifier: 'TEST-2', subIssuesHandled: 2, cascaded: false },
          ],
          succeeded: 2,
          failed: 0,
          errors: [],
        }),
      });

      const result = await client.deleteIssuesBulk(['TEST-1', 'TEST-2']);

      expect(result.succeeded).toBe(2);
      expect(result.deleted).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/issues/bulk',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({
            identifiers: ['TEST-1', 'TEST-2'],
            cascade: false,
            fast: false,
            concurrency: 10,
          }),
        })
      );
    });

    it('should support cascade option', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          deleted: [{ identifier: 'TEST-1', subIssuesHandled: 3, cascaded: true }],
          succeeded: 1,
          failed: 0,
          errors: [],
        }),
      });

      await client.deleteIssuesBulk(['TEST-1'], { cascade: true });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.cascade).toBe(true);
    });

    it('should handle partial failures', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          deleted: [{ identifier: 'TEST-1', subIssuesHandled: 0, cascaded: false }],
          succeeded: 1,
          failed: 1,
          errors: [{ identifier: 'INVALID-1', error: 'Issue not found' }],
        }),
      });

      const result = await client.deleteIssuesBulk(['TEST-1', 'INVALID-1']);

      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toBe('Issue not found');
    });
  });

  // ============================================================
  // Project Activity Tests
  // ============================================================
  describe('getProjectActivity', () => {
    it('should fetch project activity', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          project: 'TEST',
          since: '2025-01-15T00:00:00.000Z',
          activities: [
            {
              type: 'issue.created',
              issue: 'TEST-1',
              title: 'New issue',
              status: 'Backlog',
              timestamp: '2025-01-15T10:00:00Z',
            },
            {
              type: 'issue.updated',
              issue: 'TEST-2',
              title: 'Updated issue',
              status: 'Done',
              timestamp: '2025-01-15T11:00:00Z',
            },
          ],
          count: 2,
          summary: { created: 1, updated: 1, total: 2 },
          byStatus: { Backlog: 1, Done: 1 },
        }),
      });

      const result = await client.getProjectActivity('TEST');

      expect(result.count).toBe(2);
      expect(result.activities).toHaveLength(2);
      expect(result.summary.total).toBe(2);
      expect(result.byStatus.Done).toBe(1);
    });

    it('should pass since parameter', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          project: 'TEST',
          activities: [],
          count: 0,
          summary: { created: 0, updated: 0, total: 0 },
          byStatus: {},
        }),
      });

      const since = '2025-01-15T00:00:00Z';
      await client.getProjectActivity('TEST', { since });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain('since=2025-01-15T00%3A00%3A00Z');
    });

    it('should pass limit parameter', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          project: 'TEST',
          activities: [],
          count: 0,
          summary: { created: 0, updated: 0, total: 0 },
          byStatus: {},
        }),
      });

      await client.getProjectActivity('TEST', { limit: 50 });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain('limit=50');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Project not found',
      });

      await expect(client.getProjectActivity('INVALID')).rejects.toThrow('REST API error (404)');
    });
  });

  // ============================================================
  // List Components Tests
  // ============================================================
  describe('listComponents', () => {
    it('should fetch components for a project', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          components: [
            { label: 'Core', description: 'Core functionality' },
            { label: 'API', description: 'REST API endpoints' },
          ],
          count: 2,
        }),
      });

      const result = await client.listComponents('TEST');

      expect(result).toHaveLength(2);
      expect(result[0].label).toBe('Core');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/projects/TEST/components',
        expect.any(Object)
      );
    });

    it('should return empty array when no components', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          components: [],
          count: 0,
        }),
      });

      const result = await client.listComponents('TEST');

      expect(result).toHaveLength(0);
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Project not found',
      });

      await expect(client.listComponents('INVALID')).rejects.toThrow('REST API error (404)');
    });
  });

  // ============================================================
  // callTool - additional branch coverage
  // ============================================================
  describe('callTool - additional branches', () => {
    it('should throw when result.success is false', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, error: 'tool failed' }),
      });

      await expect(client.callTool('bad_tool')).rejects.toThrow('Tool execution failed');
    });

    it('should return toolResult directly when not in content array format', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { result: { raw: 'data', count: 5 } },
        }),
      });

      const result = await client.callTool('raw_tool');
      expect(result).toEqual({ raw: 'data', count: 5 });
    });

    it('should return toolResult when content is not an array', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { result: { content: 'not-an-array' } },
        }),
      });

      const result = await client.callTool('string_content_tool');
      expect(result).toEqual({ content: 'not-an-array' });
    });
  });

  // ============================================================
  // getIssue - additional branch coverage
  // ============================================================
  describe('getIssue - additional branches', () => {
    it('should return null on 404', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      });

      const result = await client.getIssue('NONEXIST-999');
      expect(result).toBeNull();
    });

    it('should throw on non-404 errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Server error',
      });

      await expect(client.getIssue('TEST-1')).rejects.toThrow('REST API error (500)');
    });

    it('should return issue data on success', async () => {
      const issue = { identifier: 'TEST-1', title: 'Test' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => issue,
      });

      const result = await client.getIssue('TEST-1');
      expect(result).toEqual(issue);
    });
  });

  // ============================================================
  // listIssuesBulk
  // ============================================================
  describe('listIssuesBulk', () => {
    it('should POST to bulk-by-projects endpoint', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ totalIssues: 5, projectCount: 2, projects: {} }),
      });

      await client.listIssuesBulk(['PROJ1', 'PROJ2']);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/issues/bulk-by-projects',
        expect.objectContaining({ method: 'POST' })
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.projects).toEqual(['PROJ1', 'PROJ2']);
    });

    it('should include modifiedSince and limit options', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ totalIssues: 0, projectCount: 1, projects: {} }),
      });

      await client.listIssuesBulk(['PROJ1'], { modifiedSince: '2025-01-01T00:00:00Z', limit: 50 });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.modifiedSince).toBe('2025-01-01T00:00:00Z');
      expect(body.limit).toBe(50);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal error',
      });

      await expect(client.listIssuesBulk(['PROJ1'])).rejects.toThrow('REST API error (500)');
    });
  });

  // ============================================================
  // searchIssues
  // ============================================================
  describe('searchIssues', () => {
    it('should call issues endpoint with query params', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [{ identifier: 'TEST-1' }] }),
      });

      const result = await client.searchIssues(
        { query: 'bug', status: 'Open', priority: 'High', assignee: 'user1' },
        50
      );

      expect(result).toHaveLength(1);
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('query=bug');
      expect(url).toContain('status=Open');
      expect(url).toContain('priority=High');
      expect(url).toContain('assignee=user1');
      expect(url).toContain('limit=50');
    });

    it('should return empty array when no issues field', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const result = await client.searchIssues();
      expect(result).toEqual([]);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad request',
      });

      await expect(client.searchIssues({ query: 'x' })).rejects.toThrow('REST API error (400)');
    });
  });

  // ============================================================
  // getSubIssues
  // ============================================================
  describe('getSubIssues', () => {
    it('should fetch sub-issues for a parent', async () => {
      const mockResult = {
        parentIssue: 'TEST-1',
        subIssues: [{ identifier: 'TEST-2' }, { identifier: 'TEST-3' }],
        count: 2,
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResult,
      });

      const result = await client.getSubIssues('TEST-1');

      expect(result.count).toBe(2);
      expect(result.subIssues).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/issues/TEST-1/subissues',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      });

      await expect(client.getSubIssues('BAD-1')).rejects.toThrow('REST API error (404)');
    });
  });

  // ============================================================
  // createSubIssue
  // ============================================================
  describe('createSubIssue', () => {
    it('should POST sub-issue data', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ identifier: 'TEST-5', parentIssue: 'TEST-1' }),
      });

      const result = await client.createSubIssue('TEST-1', { title: 'Sub task', priority: 'Low' });

      expect(result.identifier).toBe('TEST-5');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/issues/TEST-1/subissues',
        expect.objectContaining({ method: 'POST' })
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.title).toBe('Sub task');
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Server error',
      });

      await expect(client.createSubIssue('TEST-1', { title: 'x' })).rejects.toThrow(
        'REST API error (500)'
      );
    });
  });

  // ============================================================
  // getIssueTree
  // ============================================================
  describe('getIssueTree', () => {
    it('should fetch issue tree for a project', async () => {
      const mockTree = { project: 'TEST', tree: [{ identifier: 'TEST-1', children: [] }] };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockTree,
      });

      const result = await client.getIssueTree('TEST');

      expect(result.tree).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/projects/TEST/tree',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Project not found',
      });

      await expect(client.getIssueTree('BAD')).rejects.toThrow('REST API error (404)');
    });
  });

  // ============================================================
  // getComments
  // ============================================================
  describe('getComments', () => {
    it('should fetch comments for an issue', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ comments: [{ id: 'c1', text: 'Hello' }] }),
      });

      const result = await client.getComments('TEST-1');

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Hello');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/issues/TEST-1/comments',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should return empty array when no comments', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const result = await client.getComments('TEST-1');
      expect(result).toEqual([]);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Error',
      });

      await expect(client.getComments('TEST-1')).rejects.toThrow('REST API error (500)');
    });
  });

  // ============================================================
  // createComment
  // ============================================================
  describe('createComment', () => {
    it('should POST comment text', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'c1', text: 'My comment', issueIdentifier: 'TEST-1' }),
      });

      const result = await client.createComment('TEST-1', 'My comment');

      expect(result.text).toBe('My comment');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/issues/TEST-1/comments',
        expect.objectContaining({ method: 'POST' })
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toBe('My comment');
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad request',
      });

      await expect(client.createComment('TEST-1', '')).rejects.toThrow('REST API error (400)');
    });
  });

  // ============================================================
  // deleteIssue
  // ============================================================
  describe('deleteIssue', () => {
    it('should DELETE an issue and return true', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const result = await client.deleteIssue('TEST-1');

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/issues/TEST-1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should append cascade=true query param', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      await client.deleteIssue('TEST-1', { cascade: true });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/issues/TEST-1?cascade=true',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      });

      await expect(client.deleteIssue('BAD-1')).rejects.toThrow('REST API error (404)');
    });
  });

  // ============================================================
  // patchIssue
  // ============================================================
  describe('patchIssue', () => {
    it('should PATCH issue with updates', async () => {
      const updated = { identifier: 'TEST-1', title: 'New Title', status: 'Done' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => updated,
      });

      const result = await client.patchIssue('TEST-1', { title: 'New Title', status: 'Done' });

      expect(result.title).toBe('New Title');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/issues/TEST-1',
        expect.objectContaining({ method: 'PATCH' })
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.title).toBe('New Title');
      expect(body.status).toBe('Done');
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => 'Validation error',
      });

      await expect(client.patchIssue('TEST-1', { status: 'Invalid' })).rejects.toThrow(
        'REST API error (422)'
      );
    });
  });

  // ============================================================
  // searchIssuesGlobal
  // ============================================================
  describe('searchIssuesGlobal', () => {
    it('should search globally with filters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [{ identifier: 'A-1' }], count: 1 }),
      });

      const result = await client.searchIssuesGlobal({
        query: 'urgent',
        status: 'Open',
        priority: 'High',
        assignee: 'user1',
      });

      expect(result).toHaveLength(1);
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('query=urgent');
      expect(url).toContain('status=Open');
      expect(url).toContain('priority=High');
      expect(url).toContain('assignee=user1');
    });

    it('should return empty array when no issues', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ count: 0 }),
      });

      const result = await client.searchIssuesGlobal({});
      expect(result).toEqual([]);
    });

    it('should call without query params when no filters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [], count: 0 }),
      });

      await client.searchIssuesGlobal();

      const url = mockFetch.mock.calls[0][0];
      expect(url).toBe('http://localhost:3458/api/issues');
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Error',
      });

      await expect(client.searchIssuesGlobal({ query: 'x' })).rejects.toThrow(
        'REST API error (500)'
      );
    });
  });

  // ============================================================
  // getIssuesBulk
  // ============================================================
  describe('getIssuesBulk', () => {
    it('should GET bulk issues by IDs', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [{ identifier: 'T-1' }, { identifier: 'T-2' }] }),
      });

      const result = await client.getIssuesBulk(['T-1', 'T-2']);

      expect(result).toHaveLength(2);
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('ids=T-1,T-2');
    });

    it('should return empty array when no issues returned', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const result = await client.getIssuesBulk(['NONE-1']);
      expect(result).toEqual([]);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad request',
      });

      await expect(client.getIssuesBulk(['T-1'])).rejects.toThrow('REST API error (400)');
    });
  });

  // ============================================================
  // moveIssue
  // ============================================================
  describe('moveIssue', () => {
    it('should PATCH issue parent', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ moved: 'TEST-2', parentIssue: 'TEST-1', isTopLevel: false }),
      });

      const result = await client.moveIssue('TEST-2', 'TEST-1');

      expect(result.parentIssue).toBe('TEST-1');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/api/issues/TEST-2/parent',
        expect.objectContaining({ method: 'PATCH' })
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.parentIdentifier).toBe('TEST-1');
    });

    it('should support null parent (move to top-level)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ moved: 'TEST-2', parentIssue: null, isTopLevel: true }),
      });

      const result = await client.moveIssue('TEST-2', null);

      expect(result.isTopLevel).toBe(true);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.parentIdentifier).toBeNull();
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Circular reference',
      });

      await expect(client.moveIssue('TEST-1', 'TEST-1')).rejects.toThrow('REST API error (400)');
    });
  });

  // ============================================================
  // updateIssueDueDate
  // ============================================================
  describe('updateIssueDueDate', () => {
    it('should delegate to patchIssue with ISO string', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ identifier: 'TEST-1', dueDate: '2025-06-01T00:00:00.000Z' }),
      });

      await client.updateIssueDueDate('TEST-1', '2025-06-01T00:00:00.000Z');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.dueDate).toBe('2025-06-01T00:00:00.000Z');
    });

    it('should convert Date object to ISO string', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ identifier: 'TEST-1', dueDate: '2025-06-01T00:00:00.000Z' }),
      });

      const date = new Date('2025-06-01T00:00:00.000Z');
      await client.updateIssueDueDate('TEST-1', date);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.dueDate).toBe('2025-06-01T00:00:00.000Z');
    });

    it('should handle null to clear due date', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ identifier: 'TEST-1', dueDate: null }),
      });

      await client.updateIssueDueDate('TEST-1', null);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.dueDate).toBeNull();
    });
  });

  // ============================================================
  // getStats
  // ============================================================
  describe('getStats', () => {
    it('should return client statistics', () => {
      const stats = client.getStats();

      expect(stats.type).toBe('rest');
      expect(stats.baseUrl).toBe('http://localhost:3458/api');
      expect(stats.timeout).toBe(60000);
    });
  });

  // ============================================================
  // createHulyRestClient factory
  // ============================================================
  describe('createHulyRestClient', () => {
    it('should create a HulyRestClient instance', async () => {
      const { createHulyRestClient } = await import('../../lib/HulyRestClient.js');
      const c = createHulyRestClient('http://localhost:3457/mcp', { name: 'Factory Test' });

      expect(c).toBeInstanceOf(HulyRestClient);
      expect(c.name).toBe('Factory Test');
      expect(c.baseUrl).toBe('http://localhost:3458/api');
    });
  });
});
