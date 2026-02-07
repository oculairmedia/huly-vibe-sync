/**
 * Unit Tests for HulyService
 *
 * Comprehensive test coverage for:
 * - fetchHulyIssues with incremental sync (cursor-based)
 * - fetchHulyIssuesBulk for bulk fetching behavior
 * - updateHulyIssueStatus for both REST and MCP client paths
 * - All other HulyService functions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchHulyProjects,
  fetchHulyIssues,
  fetchHulyIssuesSimple,
  fetchHulyIssuesBulk,
  updateHulyIssueStatus,
  updateHulyIssueDescription,
  updateHulyIssuePriority,
  updateHulyIssueTitle,
  updateHulyIssueParent,
  createHulyIssue,
  syncVibeTaskToHuly,
  createHulyService,
} from '../../lib/HulyService.js';

vi.mock('../../lib/HealthService.js', () => ({
  recordApiLatency: vi.fn(),
}));

describe('HulyService', () => {
  let mockRestClient;
  let mockMcpClient;
  let mockDb;
  let consoleSpy;

  beforeEach(() => {
    // Create mock REST client
    mockRestClient = {
      listProjects: vi.fn(),
      listIssues: vi.fn(),
      listIssuesBulk: vi.fn(),
      updateIssue: vi.fn(),
      moveIssue: vi.fn(),
      createIssue: vi.fn(),
    };

    // Create mock MCP client
    mockMcpClient = {
      callTool: vi.fn(),
    };

    // Create mock database
    mockDb = {
      getHulySyncCursor: vi.fn(),
      setHulySyncCursor: vi.fn(),
    };

    // Suppress console output during tests
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // fetchHulyIssues Tests - Incremental Sync with Cursor
  // ============================================================
  describe('fetchHulyIssues - Incremental Sync', () => {
    it('should perform full sync when no cursor exists in db', async () => {
      mockDb.getHulySyncCursor.mockReturnValue(null);
      mockRestClient.listIssues.mockResolvedValue({
        issues: [
          { identifier: 'TEST-1', title: 'Issue 1' },
          { identifier: 'TEST-2', title: 'Issue 2' },
        ],
        syncMeta: {
          latestModified: '2025-01-24T10:00:00Z',
          serverTime: '2025-01-24T10:00:00Z',
        },
      });

      const result = await fetchHulyIssues(
        mockRestClient,
        'TEST',
        { sync: { incremental: true } },
        mockDb
      );

      // Should NOT include modifiedSince when no cursor
      expect(mockRestClient.listIssues).toHaveBeenCalledWith('TEST', {
        limit: 1000,
        includeSyncMeta: true,
      });

      expect(result.issues).toHaveLength(2);
      expect(result.syncMeta.latestModified).toBe('2025-01-24T10:00:00Z');

      // Should update cursor after successful fetch
      expect(mockDb.setHulySyncCursor).toHaveBeenCalledWith('TEST', '2025-01-24T10:00:00Z');
    });

    it('should perform incremental sync when cursor exists in db', async () => {
      const cursor = '2025-01-20T00:00:00Z';
      mockDb.getHulySyncCursor.mockReturnValue(cursor);
      mockRestClient.listIssues.mockResolvedValue({
        issues: [{ identifier: 'TEST-3', title: 'New Issue' }],
        syncMeta: {
          latestModified: '2025-01-24T12:00:00Z',
          serverTime: '2025-01-24T12:00:00Z',
        },
      });

      const result = await fetchHulyIssues(
        mockRestClient,
        'TEST',
        { sync: { incremental: true } },
        mockDb
      );

      // Should include modifiedSince with cursor value
      expect(mockRestClient.listIssues).toHaveBeenCalledWith('TEST', {
        limit: 1000,
        includeSyncMeta: true,
        modifiedSince: cursor,
      });

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].identifier).toBe('TEST-3');

      // Should update cursor to new latestModified
      expect(mockDb.setHulySyncCursor).toHaveBeenCalledWith('TEST', '2025-01-24T12:00:00Z');

      // Should log incremental fetch message
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Incremental fetch for TEST')
      );
    });

    it('should perform full sync when incremental is disabled in config', async () => {
      mockDb.getHulySyncCursor.mockReturnValue('2025-01-20T00:00:00Z');
      mockRestClient.listIssues.mockResolvedValue({
        issues: [],
        syncMeta: { latestModified: null, serverTime: '2025-01-24T10:00:00Z' },
      });

      await fetchHulyIssues(mockRestClient, 'TEST', { sync: { incremental: false } }, mockDb);

      // Should NOT include modifiedSince when incremental is disabled
      expect(mockRestClient.listIssues).toHaveBeenCalledWith('TEST', {
        limit: 1000,
        includeSyncMeta: true,
      });

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Full fetch for project TEST')
      );
    });

    it('should perform full sync when db is null', async () => {
      mockRestClient.listIssues.mockResolvedValue({
        issues: [],
        syncMeta: { latestModified: null, serverTime: '2025-01-24T10:00:00Z' },
      });

      await fetchHulyIssues(mockRestClient, 'TEST', { sync: { incremental: true } }, null);

      // Should NOT include modifiedSince when db is null
      expect(mockRestClient.listIssues).toHaveBeenCalledWith('TEST', {
        limit: 1000,
        includeSyncMeta: true,
      });
    });

    it('should not update cursor when syncMeta.latestModified is null', async () => {
      mockDb.getHulySyncCursor.mockReturnValue(null);
      mockRestClient.listIssues.mockResolvedValue({
        issues: [],
        syncMeta: { latestModified: null, serverTime: '2025-01-24T10:00:00Z' },
      });

      await fetchHulyIssues(mockRestClient, 'TEST', {}, mockDb);

      expect(mockDb.setHulySyncCursor).not.toHaveBeenCalled();
    });

    it('should handle API response without syncMeta', async () => {
      mockRestClient.listIssues.mockResolvedValue([{ identifier: 'TEST-1', title: 'Issue 1' }]);

      const result = await fetchHulyIssues(mockRestClient, 'TEST', {}, null);

      expect(result.issues).toHaveLength(1);
      expect(result.syncMeta).toEqual({
        latestModified: null,
        serverTime: expect.any(String),
      });
    });

    it('should return empty issues and syncMeta on error', async () => {
      mockRestClient.listIssues.mockRejectedValue(new Error('Network error'));

      const result = await fetchHulyIssues(mockRestClient, 'TEST', {}, mockDb);

      expect(result.issues).toEqual([]);
      expect(result.syncMeta).toEqual({
        latestModified: null,
        serverTime: expect.any(String),
      });
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  // ============================================================
  // fetchHulyIssuesBulk Tests - Bulk Fetching Behavior
  // ============================================================
  describe('fetchHulyIssuesBulk', () => {
    it('should fetch issues from multiple projects in bulk', async () => {
      const projectIds = ['PROJ1', 'PROJ2', 'PROJ3'];
      mockRestClient.listIssuesBulk.mockResolvedValue({
        projects: {
          PROJ1: {
            issues: [{ identifier: 'PROJ1-1' }, { identifier: 'PROJ1-2' }],
            syncMeta: { latestModified: '2025-01-24T10:00:00Z' },
          },
          PROJ2: {
            issues: [{ identifier: 'PROJ2-1' }],
            syncMeta: { latestModified: '2025-01-24T11:00:00Z' },
          },
          PROJ3: {
            issues: [],
            syncMeta: { latestModified: null },
          },
        },
        totalIssues: 3,
        projectCount: 3,
      });

      const result = await fetchHulyIssuesBulk(mockRestClient, projectIds, {}, null);

      expect(mockRestClient.listIssuesBulk).toHaveBeenCalledWith(projectIds, {
        limit: 1000,
      });

      expect(result.totalIssues).toBe(3);
      expect(result.projectCount).toBe(3);
      expect(result.projects.PROJ1.issues).toHaveLength(2);
      expect(result.projects.PROJ2.issues).toHaveLength(1);
      expect(result.projects.PROJ3.issues).toHaveLength(0);
    });

    it('should split incremental bulk fetches by cursor group', async () => {
      const projectIds = ['PROJ1', 'PROJ2', 'PROJ3'];
      mockDb.getHulySyncCursor
        .mockReturnValueOnce('2025-01-22T00:00:00Z') // PROJ1
        .mockReturnValueOnce('2025-01-20T00:00:00Z') // PROJ2
        .mockReturnValueOnce(null); // PROJ3 (full fetch)

      mockRestClient.listIssuesBulk.mockImplementation(async (ids, options) => ({
        projects: Object.fromEntries(
          ids.map((id, idx) => [
            id,
            { issues: [], syncMeta: { latestModified: `2025-01-24T1${idx}:00:00Z` } },
          ])
        ),
        totalIssues: 0,
        projectCount: ids.length,
        options,
      }));

      await fetchHulyIssuesBulk(
        mockRestClient,
        projectIds,
        { sync: { incremental: true } },
        mockDb
      );

      expect(mockRestClient.listIssuesBulk).toHaveBeenCalledTimes(3);
      expect(mockRestClient.listIssuesBulk).toHaveBeenCalledWith(['PROJ1'], {
        limit: 1000,
        modifiedSince: '2025-01-22T00:00:00Z',
      });
      expect(mockRestClient.listIssuesBulk).toHaveBeenCalledWith(['PROJ2'], {
        limit: 1000,
        modifiedSince: '2025-01-20T00:00:00Z',
      });
      expect(mockRestClient.listIssuesBulk).toHaveBeenCalledWith(['PROJ3'], {
        limit: 1000,
      });

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('split by')
      );
    });

    it('should use a single incremental bulk call when all cursors match', async () => {
      const projectIds = ['PROJ1', 'PROJ2'];
      mockDb.getHulySyncCursor.mockReturnValue('2025-01-20T00:00:00Z');
      mockRestClient.listIssuesBulk.mockResolvedValue({
        projects: {
          PROJ1: { issues: [], syncMeta: { latestModified: '2025-01-24T10:00:00Z' } },
          PROJ2: { issues: [], syncMeta: { latestModified: '2025-01-24T11:00:00Z' } },
        },
        totalIssues: 0,
        projectCount: 2,
      });

      await fetchHulyIssuesBulk(mockRestClient, projectIds, { sync: { incremental: true } }, mockDb);

      expect(mockRestClient.listIssuesBulk).toHaveBeenCalledTimes(1);
      expect(mockRestClient.listIssuesBulk).toHaveBeenCalledWith(projectIds, {
        limit: 1000,
        modifiedSince: '2025-01-20T00:00:00Z',
      });
    });

    it('should update cursors for all projects after bulk fetch', async () => {
      const projectIds = ['PROJ1', 'PROJ2'];
      mockDb.getHulySyncCursor.mockReturnValue(null);
      mockRestClient.listIssuesBulk.mockResolvedValue({
        projects: {
          PROJ1: {
            issues: [],
            syncMeta: { latestModified: '2025-01-24T10:00:00Z' },
          },
          PROJ2: {
            issues: [],
            syncMeta: { latestModified: '2025-01-24T11:00:00Z' },
          },
        },
        totalIssues: 0,
        projectCount: 2,
      });

      await fetchHulyIssuesBulk(mockRestClient, projectIds, {}, mockDb);

      expect(mockDb.setHulySyncCursor).toHaveBeenCalledWith('PROJ1', '2025-01-24T10:00:00Z');
      expect(mockDb.setHulySyncCursor).toHaveBeenCalledWith('PROJ2', '2025-01-24T11:00:00Z');
    });

    it('should fallback to individual fetches when bulk endpoint not available', async () => {
      const projectIds = ['PROJ1', 'PROJ2'];
      const clientWithoutBulk = {
        listIssues: vi.fn().mockResolvedValue({
          issues: [{ identifier: 'TEST-1' }],
          syncMeta: { latestModified: '2025-01-24T10:00:00Z' },
        }),
      };

      const result = await fetchHulyIssuesBulk(clientWithoutBulk, projectIds, {}, null);

      expect(clientWithoutBulk.listIssues).toHaveBeenCalledTimes(2);
      expect(result.projects.PROJ1.issues).toHaveLength(1);
      expect(result.projects.PROJ2.issues).toHaveLength(1);
      expect(result.totalIssues).toBe(2);

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Bulk endpoint not available')
      );
    });

    it('should fallback to individual fetches on bulk API error', async () => {
      const projectIds = ['PROJ1', 'PROJ2'];
      mockRestClient.listIssuesBulk.mockRejectedValue(new Error('Bulk API error'));
      mockRestClient.listIssues.mockResolvedValue({
        issues: [],
        syncMeta: { latestModified: null },
      });

      const result = await fetchHulyIssuesBulk(mockRestClient, projectIds, {}, null);

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('Error in bulk fetch'),
        expect.any(String)
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Falling back to individual fetches')
      );

      expect(mockRestClient.listIssues).toHaveBeenCalledTimes(2);
      expect(result.totalIssues).toBe(0);
    });

    it('should perform full bulk fetch when no cursors exist', async () => {
      const projectIds = ['PROJ1', 'PROJ2'];
      mockDb.getHulySyncCursor.mockReturnValue(null);
      mockRestClient.listIssuesBulk.mockResolvedValue({
        projects: {
          PROJ1: { issues: [], syncMeta: { latestModified: null } },
          PROJ2: { issues: [], syncMeta: { latestModified: null } },
        },
        totalIssues: 0,
        projectCount: 2,
      });

      await fetchHulyIssuesBulk(
        mockRestClient,
        projectIds,
        { sync: { incremental: true } },
        mockDb
      );

      // Should NOT include modifiedSince when no cursors
      expect(mockRestClient.listIssuesBulk).toHaveBeenCalledWith(projectIds, {
        limit: 1000,
      });

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Bulk full fetch'));
    });

    it('should skip cursor update for projects without latestModified', async () => {
      const projectIds = ['PROJ1', 'PROJ2'];
      mockRestClient.listIssuesBulk.mockResolvedValue({
        projects: {
          PROJ1: {
            issues: [],
            syncMeta: { latestModified: '2025-01-24T10:00:00Z' },
          },
          PROJ2: {
            issues: [],
            syncMeta: { latestModified: null },
          },
        },
        totalIssues: 0,
        projectCount: 2,
      });

      await fetchHulyIssuesBulk(mockRestClient, projectIds, {}, mockDb);

      // Only PROJ1 should have cursor updated
      expect(mockDb.setHulySyncCursor).toHaveBeenCalledWith('PROJ1', '2025-01-24T10:00:00Z');
      expect(mockDb.setHulySyncCursor).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // updateHulyIssueStatus Tests - REST and MCP Client Paths
  // ============================================================
  describe('updateHulyIssueStatus - REST and MCP Clients', () => {
    it('should update status using REST client', async () => {
      mockRestClient.updateIssue.mockResolvedValue({ success: true });

      const result = await updateHulyIssueStatus(mockRestClient, 'TEST-1', 'In Progress');

      expect(mockRestClient.updateIssue).toHaveBeenCalledWith('TEST-1', 'status', 'In Progress');
      expect(result).toBe(true);
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('✓ Updated issue TEST-1 status to: In Progress')
      );
    });

    it('should update status using MCP client', async () => {
      mockMcpClient.callTool.mockResolvedValue({ success: true });

      const result = await updateHulyIssueStatus(mockMcpClient, 'TEST-1', 'Done');

      expect(mockMcpClient.callTool).toHaveBeenCalledWith('huly_issue_ops', {
        operation: 'update',
        issue_identifier: 'TEST-1',
        update: {
          field: 'status',
          value: 'Done',
        },
      });
      expect(result).toBe(true);
    });

    it('should skip update in dry run mode with REST client', async () => {
      const result = await updateHulyIssueStatus(mockRestClient, 'TEST-1', 'In Progress', {
        sync: { dryRun: true },
      });

      expect(mockRestClient.updateIssue).not.toHaveBeenCalled();
      expect(result).toBe(true);
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN] Would update issue TEST-1 status to: In Progress')
      );
    });

    it('should skip update in dry run mode with MCP client', async () => {
      const result = await updateHulyIssueStatus(mockMcpClient, 'TEST-1', 'Done', {
        sync: { dryRun: true },
      });

      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false on REST client error', async () => {
      mockRestClient.updateIssue.mockRejectedValue(new Error('Network error'));

      const result = await updateHulyIssueStatus(mockRestClient, 'TEST-1', 'Done');

      expect(result).toBe(false);
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('Error updating issue TEST-1 status'),
        expect.any(String)
      );
    });

    it('should return false on MCP client error', async () => {
      mockMcpClient.callTool.mockRejectedValue(new Error('MCP error'));

      const result = await updateHulyIssueStatus(mockMcpClient, 'TEST-1', 'Done');

      expect(result).toBe(false);
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should return false for unsupported client type', async () => {
      const unsupportedClient = { someMethod: vi.fn() };

      const result = await updateHulyIssueStatus(unsupportedClient, 'TEST-1', 'Done');

      expect(result).toBe(false);
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('Error updating issue TEST-1 status'),
        expect.any(String)
      );
    });
  });

  // ============================================================
  // fetchHulyProjects Tests
  // ============================================================
  describe('fetchHulyProjects', () => {
    it('should fetch projects successfully', async () => {
      const mockProjects = [
        { identifier: 'PROJ1', name: 'Project 1' },
        { identifier: 'PROJ2', name: 'Project 2' },
      ];
      mockRestClient.listProjects.mockResolvedValue(mockProjects);

      const result = await fetchHulyProjects(mockRestClient);

      expect(mockRestClient.listProjects).toHaveBeenCalled();
      expect(result).toEqual(mockProjects);
      expect(result).toHaveLength(2);
    });

    it('should return empty array on error', async () => {
      mockRestClient.listProjects.mockRejectedValue(new Error('API error'));

      const result = await fetchHulyProjects(mockRestClient);

      expect(result).toEqual([]);
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  // ============================================================
  // fetchHulyIssuesSimple Tests
  // ============================================================
  describe('fetchHulyIssuesSimple', () => {
    it('should return just the issues array (backward compatible)', async () => {
      mockRestClient.listIssues.mockResolvedValue({
        issues: [{ identifier: 'TEST-1' }],
        syncMeta: { latestModified: '2025-01-24T10:00:00Z' },
      });

      const result = await fetchHulyIssuesSimple(mockRestClient, 'TEST');

      expect(result).toEqual([{ identifier: 'TEST-1' }]);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ============================================================
  // updateHulyIssueDescription Tests
  // ============================================================
  describe('updateHulyIssueDescription', () => {
    it('should update description using REST client', async () => {
      mockRestClient.updateIssue.mockResolvedValue({ success: true });

      const result = await updateHulyIssueDescription(mockRestClient, 'TEST-1', 'New description');

      expect(mockRestClient.updateIssue).toHaveBeenCalledWith(
        'TEST-1',
        'description',
        'New description'
      );
      expect(result).toBe(true);
    });

    it('should update description using MCP client', async () => {
      mockMcpClient.callTool.mockResolvedValue({ success: true });

      const result = await updateHulyIssueDescription(mockMcpClient, 'TEST-1', 'New description');

      expect(mockMcpClient.callTool).toHaveBeenCalledWith('huly_issue_ops', {
        operation: 'update',
        issue_identifier: 'TEST-1',
        update: {
          field: 'description',
          value: 'New description',
        },
      });
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // updateHulyIssuePriority Tests
  // ============================================================
  describe('updateHulyIssuePriority', () => {
    it('should update priority using REST client', async () => {
      mockRestClient.updateIssue.mockResolvedValue({ success: true });

      const result = await updateHulyIssuePriority(mockRestClient, 'TEST-1', 'High');

      expect(mockRestClient.updateIssue).toHaveBeenCalledWith('TEST-1', 'priority', 'High');
      expect(result).toBe(true);
    });

    it('should update priority using MCP client', async () => {
      mockMcpClient.callTool.mockResolvedValue({ success: true });

      const result = await updateHulyIssuePriority(mockMcpClient, 'TEST-1', 'Urgent');

      expect(mockMcpClient.callTool).toHaveBeenCalledWith('huly_issue_ops', {
        operation: 'update',
        issue_identifier: 'TEST-1',
        update: {
          field: 'priority',
          value: 'Urgent',
        },
      });
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // updateHulyIssueTitle Tests
  // ============================================================
  describe('updateHulyIssueTitle', () => {
    it('should update title using REST client', async () => {
      mockRestClient.updateIssue.mockResolvedValue({ success: true });

      const result = await updateHulyIssueTitle(mockRestClient, 'TEST-1', 'New Title');

      expect(mockRestClient.updateIssue).toHaveBeenCalledWith('TEST-1', 'title', 'New Title');
      expect(result).toBe(true);
    });

    it('should update title using MCP client', async () => {
      mockMcpClient.callTool.mockResolvedValue({ success: true });

      const result = await updateHulyIssueTitle(mockMcpClient, 'TEST-1', 'New Title');

      expect(mockMcpClient.callTool).toHaveBeenCalledWith('huly_issue_ops', {
        operation: 'update',
        issue_identifier: 'TEST-1',
        update: {
          field: 'title',
          value: 'New Title',
        },
      });
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // updateHulyIssueParent Tests
  // ============================================================
  describe('updateHulyIssueParent', () => {
    it('should move issue under parent using REST client', async () => {
      mockRestClient.moveIssue.mockResolvedValue({ moved: 'TEST-2', parentIssue: 'TEST-1' });

      const result = await updateHulyIssueParent(mockRestClient, 'TEST-2', 'TEST-1');

      expect(mockRestClient.moveIssue).toHaveBeenCalledWith('TEST-2', 'TEST-1');
      expect(result).toBe(true);
    });

    it('should move issue to top-level when parent is null', async () => {
      mockRestClient.moveIssue.mockResolvedValue({ moved: 'TEST-2', parentIssue: null });

      const result = await updateHulyIssueParent(mockRestClient, 'TEST-2', null);

      expect(mockRestClient.moveIssue).toHaveBeenCalledWith('TEST-2', null);
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // createHulyIssue Tests
  // ============================================================
  describe('createHulyIssue', () => {
    const issueData = {
      title: 'New Issue',
      description: 'Issue description',
      priority: 'High',
      status: 'Backlog',
    };

    it('should create issue using REST client', async () => {
      const createdIssue = { identifier: 'TEST-42', ...issueData };
      mockRestClient.createIssue.mockResolvedValue(createdIssue);

      const result = await createHulyIssue(mockRestClient, 'TEST', issueData);

      expect(mockRestClient.createIssue).toHaveBeenCalledWith('TEST', issueData);
      expect(result).toEqual(createdIssue);
    });

    it('should create issue using MCP client', async () => {
      const createdIssue = { identifier: 'TEST-42', ...issueData };
      mockMcpClient.callTool.mockResolvedValue(createdIssue);

      const result = await createHulyIssue(mockMcpClient, 'TEST', issueData);

      expect(mockMcpClient.callTool).toHaveBeenCalledWith('huly_issue_ops', {
        operation: 'create',
        project_identifier: 'TEST',
        issue_data: issueData,
      });
      expect(result).toEqual(createdIssue);
    });

    it('should return dry run result in dry run mode', async () => {
      const result = await createHulyIssue(mockRestClient, 'TEST', issueData, {
        sync: { dryRun: true },
      });

      expect(mockRestClient.createIssue).not.toHaveBeenCalled();
      expect(result).toEqual({
        identifier: 'TEST-DRY',
        ...issueData,
      });
    });

    it('should return null on error', async () => {
      mockRestClient.createIssue.mockRejectedValue(new Error('Create failed'));

      const result = await createHulyIssue(mockRestClient, 'TEST', issueData);

      expect(result).toBeNull();
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  // ============================================================
  // syncVibeTaskToHuly Tests
  // ============================================================
  describe('syncVibeTaskToHuly', () => {
    it('should skip task updated in Phase 1', async () => {
      const vibeTask = {
        id: 'task-1',
        title: 'Test Task',
        description: 'Description\n\n---\nSynced from Huly: TEST-1',
        status: 'in_progress',
      };
      const phase1UpdatedTasks = new Set(['task-1']);

      await syncVibeTaskToHuly(mockRestClient, vibeTask, [], 'TEST', {}, phase1UpdatedTasks);

      expect(mockRestClient.updateIssue).not.toHaveBeenCalled();
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('was just updated in Phase 1')
      );
    });

    it('should skip task without Huly identifier', async () => {
      const vibeTask = {
        id: 'task-1',
        title: 'Test Task',
        description: 'No Huly link',
        status: 'todo',
      };

      await syncVibeTaskToHuly(mockRestClient, vibeTask, [], 'TEST', {});

      expect(mockRestClient.updateIssue).not.toHaveBeenCalled();
    });

    it('should update status when Vibe status differs from Huly', async () => {
      const vibeTask = {
        id: 'task-1',
        title: 'Test Task',
        description: 'Description\n\n---\nSynced from Huly: TEST-1',
        status: 'done',
      };
      const hulyIssues = [
        {
          identifier: 'TEST-1',
          status: 'In Progress',
          description: 'Description',
        },
      ];
      mockRestClient.updateIssue.mockResolvedValue({ success: true });

      await syncVibeTaskToHuly(mockRestClient, vibeTask, hulyIssues, 'TEST', {});

      expect(mockRestClient.updateIssue).toHaveBeenCalledWith(
        'TEST-1',
        'status',
        expect.any(String)
      );
    });

    it('should reparent Huly issue when Vibe parent metadata changes', async () => {
      const vibeTask = {
        id: 'task-2',
        title: 'Child Task',
        description: 'Description\n\n---\nHuly Issue: TEST-2\nHuly Parent: TEST-99',
        status: 'todo',
      };
      const hulyIssues = [
        {
          identifier: 'TEST-2',
          status: 'Backlog',
          description: 'Description',
          parentIssue: { identifier: 'TEST-1' },
        },
      ];

      mockRestClient.moveIssue.mockResolvedValue({ moved: 'TEST-2', parentIssue: 'TEST-99' });

      await syncVibeTaskToHuly(mockRestClient, vibeTask, hulyIssues, 'TEST', {});

      expect(mockRestClient.moveIssue).toHaveBeenCalledWith('TEST-2', 'TEST-99');
    });

    it('should move issue to top-level when parent metadata is none', async () => {
      const vibeTask = {
        id: 'task-3',
        title: 'Child Task',
        description: 'Description\n\n---\nHuly Issue: TEST-3\nHuly Parent: none',
        status: 'todo',
      };
      const hulyIssues = [
        {
          identifier: 'TEST-3',
          status: 'Backlog',
          description: 'Description',
          parentIssue: { identifier: 'TEST-1' },
        },
      ];

      mockRestClient.moveIssue.mockResolvedValue({ moved: 'TEST-3', parentIssue: null });

      await syncVibeTaskToHuly(mockRestClient, vibeTask, hulyIssues, 'TEST', {});

      expect(mockRestClient.moveIssue).toHaveBeenCalledWith('TEST-3', null);
    });
  });

  // ============================================================
  // createHulyService Factory Tests
  // ============================================================
  describe('createHulyService', () => {
    it('should create service with bound config', () => {
      const config = { sync: { dryRun: true } };
      const service = createHulyService(config);

      expect(service).toHaveProperty('fetchProjects');
      expect(service).toHaveProperty('fetchIssues');
      expect(service).toHaveProperty('updateIssueStatus');
      expect(service).toHaveProperty('updateIssueDescription');
      expect(service).toHaveProperty('updateIssueParent');
      expect(service).toHaveProperty('syncVibeTaskToHuly');
    });

    it('should pass config to methods', async () => {
      const config = { sync: { dryRun: true } };
      const service = createHulyService(config);

      const result = await service.updateIssueStatus(mockRestClient, 'TEST-1', 'Done');

      expect(mockRestClient.updateIssue).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });
});
