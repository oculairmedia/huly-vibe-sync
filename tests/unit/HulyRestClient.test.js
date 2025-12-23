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

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3458/health',
        expect.any(Object)
      );
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

    it('should support modifiedAfter option for incremental sync', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [], count: 0 }),
      });

      const timestamp = new Date().toISOString();
      await client.listIssues('TEST', { modifiedAfter: timestamp });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain('modifiedAfter=');
    });

    it('should return empty array if no issues', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [], count: 0 }),
      });

      const result = await client.listIssues('TEST');
      expect(result).toEqual([]);
    });
  });

  describe('getIssue', () => {
    it('should call get issue tool', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockToolResponse('huly_query', { identifier: 'TEST-1' }),
      });

      await client.getIssue('TEST-1');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('huly_query'),
        expect.any(Object)
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
        json: async () => createMockToolResponse('huly_query', { issue: createMockHulyIssue() }),
      });

      await client.getIssue('TEST-123_ABC');

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.arguments.issue_identifier).toBe('TEST-123_ABC');
    });
  });
});
