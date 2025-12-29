/**
 * Unit Tests for HulyService
 * 
 * Tests Huly-specific operations including:
 * - Fetching projects and issues
 * - Updating issue status, description, priority, title
 * - Creating issues
 * - Syncing Vibe tasks back to Huly
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchHulyProjects,
  fetchHulyIssues,
  updateHulyIssueStatus,
  updateHulyIssueDescription,
  createHulyIssue,
  updateHulyIssuePriority,
  updateHulyIssueTitle,
  syncVibeTaskToHuly,
  createHulyService,
} from '../../lib/HulyService.js';
import {
  createMockHulyProject,
  createMockHulyIssue,
} from '../mocks/hulyMocks.js';

// Mock the HealthService to avoid side effects
vi.mock('../../lib/HealthService.js', () => ({
  recordApiLatency: vi.fn(),
}));

describe('HulyService', () => {
  let mockRestClient;
  let mockMcpClient;
  let consoleSpy;

  beforeEach(() => {
    // Create mock REST client
    mockRestClient = {
      listProjects: vi.fn(),
      listIssues: vi.fn(),
      updateIssue: vi.fn(),
      createIssue: vi.fn(),
    };

    // Create mock MCP client
    mockMcpClient = {
      callTool: vi.fn(),
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
  // fetchHulyProjects Tests
  // ============================================================
  describe('fetchHulyProjects', () => {
    it('should fetch projects successfully', async () => {
      const mockProjects = [
        createMockHulyProject({ identifier: 'PROJ1' }),
        createMockHulyProject({ identifier: 'PROJ2' }),
      ];
      mockRestClient.listProjects.mockResolvedValue(mockProjects);

      const result = await fetchHulyProjects(mockRestClient);

      expect(mockRestClient.listProjects).toHaveBeenCalled();
      expect(result).toEqual(mockProjects);
      expect(result).toHaveLength(2);
    });

    it('should return empty array on error', async () => {
      mockRestClient.listProjects.mockRejectedValue(new Error('Network error'));

      const result = await fetchHulyProjects(mockRestClient);

      expect(result).toEqual([]);
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should log sample project in dry run mode', async () => {
      const mockProjects = [createMockHulyProject({ identifier: 'TEST' })];
      mockRestClient.listProjects.mockResolvedValue(mockProjects);

      await fetchHulyProjects(mockRestClient, { sync: { dryRun: true } });

      // console.log is called with two args: '[Huly] Sample project:' and the JSON string
      const sampleProjectLogs = consoleSpy.log.mock.calls.filter(
        call => call[0] === '[Huly] Sample project:'
      );
      expect(sampleProjectLogs).toHaveLength(1);
    });

    it('should not log sample project when not in dry run mode', async () => {
      // Clear previous calls from other tests
      consoleSpy.log.mockClear();
      
      const mockProjects = [createMockHulyProject({ identifier: 'TEST' })];
      mockRestClient.listProjects.mockResolvedValue(mockProjects);

      await fetchHulyProjects(mockRestClient, { sync: { dryRun: false } });

      const sampleProjectLogs = consoleSpy.log.mock.calls.filter(
        call => call[0] === '[Huly] Sample project:'
      );
      expect(sampleProjectLogs).toHaveLength(0);
    });

    it('should handle empty projects list', async () => {
      mockRestClient.listProjects.mockResolvedValue([]);

      const result = await fetchHulyProjects(mockRestClient);

      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // fetchHulyIssues Tests
  // ============================================================
  describe('fetchHulyIssues', () => {
    it('should fetch issues for a project and return { issues, syncMeta }', async () => {
      const mockIssues = [
        createMockHulyIssue({ identifier: 'TEST-1' }),
        createMockHulyIssue({ identifier: 'TEST-2' }),
      ];
      const mockSyncMeta = { latestModified: '2025-01-01T00:00:00Z', serverTime: '2025-01-01T00:00:00Z' };
      mockRestClient.listIssues.mockResolvedValue({ issues: mockIssues, syncMeta: mockSyncMeta, count: 2 });

      const result = await fetchHulyIssues(mockRestClient, 'TEST');

      expect(mockRestClient.listIssues).toHaveBeenCalledWith('TEST', { limit: 1000, includeSyncMeta: true });
      expect(result.issues).toEqual(mockIssues);
      expect(result.syncMeta).toEqual(mockSyncMeta);
    });

    it('should support incremental sync with modifiedSince from db cursor', async () => {
      const mockDb = {
        getHulySyncCursor: vi.fn().mockReturnValue('2025-01-01T00:00:00Z'),
        setHulySyncCursor: vi.fn(),
      };
      mockRestClient.listIssues.mockResolvedValue({ issues: [], syncMeta: { latestModified: '2025-01-02T00:00:00Z' }, count: 0 });

      await fetchHulyIssues(
        mockRestClient,
        'TEST',
        { sync: { incremental: true } },
        mockDb
      );

      expect(mockRestClient.listIssues).toHaveBeenCalledWith('TEST', {
        limit: 1000,
        includeSyncMeta: true,
        modifiedSince: '2025-01-01T00:00:00Z',
      });
    });

    it('should do full sync when no cursor in db', async () => {
      const mockDb = {
        getHulySyncCursor: vi.fn().mockReturnValue(null),
        setHulySyncCursor: vi.fn(),
      };
      mockRestClient.listIssues.mockResolvedValue({ issues: [], syncMeta: { latestModified: null }, count: 0 });

      await fetchHulyIssues(
        mockRestClient,
        'TEST',
        { sync: { incremental: true } },
        mockDb
      );

      expect(mockRestClient.listIssues).toHaveBeenCalledWith('TEST', {
        limit: 1000,
        includeSyncMeta: true,
      });
    });

    it('should update sync cursor after successful fetch', async () => {
      const mockDb = {
        getHulySyncCursor: vi.fn().mockReturnValue(null),
        setHulySyncCursor: vi.fn(),
      };
      mockRestClient.listIssues.mockResolvedValue({ 
        issues: [], 
        syncMeta: { latestModified: '2025-01-02T00:00:00Z', serverTime: '2025-01-02T00:00:00Z' }, 
        count: 0 
      });

      await fetchHulyIssues(mockRestClient, 'TEST', {}, mockDb);

      expect(mockDb.setHulySyncCursor).toHaveBeenCalledWith('TEST', '2025-01-02T00:00:00Z');
    });

    it('should return empty issues on error', async () => {
      mockRestClient.listIssues.mockRejectedValue(new Error('API error'));

      const result = await fetchHulyIssues(mockRestClient, 'TEST');

      expect(result.issues).toEqual([]);
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should log incremental fetch message when cursor exists', async () => {
      const mockDb = {
        getHulySyncCursor: vi.fn().mockReturnValue('2025-01-01T00:00:00Z'),
        setHulySyncCursor: vi.fn(),
      };
      mockRestClient.listIssues.mockResolvedValue({ issues: [], syncMeta: { latestModified: null }, count: 0 });

      await fetchHulyIssues(
        mockRestClient,
        'PROJ',
        { sync: { incremental: true } },
        mockDb
      );

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[Huly] Incremental fetch for PROJ')
      );
    });
  });

  // ============================================================
  // updateHulyIssueStatus Tests
  // ============================================================
  describe('updateHulyIssueStatus', () => {
    it('should update status using REST client', async () => {
      mockRestClient.updateIssue.mockResolvedValue({ success: true });

      const result = await updateHulyIssueStatus(mockRestClient, 'TEST-1', 'In Progress');

      expect(mockRestClient.updateIssue).toHaveBeenCalledWith('TEST-1', 'status', 'In Progress');
      expect(result).toBe(true);
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

    it('should skip update in dry run mode', async () => {
      const result = await updateHulyIssueStatus(
        mockRestClient,
        'TEST-1',
        'In Progress',
        { sync: { dryRun: true } }
      );

      expect(mockRestClient.updateIssue).not.toHaveBeenCalled();
      expect(result).toBe(true);
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN]')
      );
    });

    it('should return false on error', async () => {
      mockRestClient.updateIssue.mockRejectedValue(new Error('Update failed'));

      const result = await updateHulyIssueStatus(mockRestClient, 'TEST-1', 'In Progress');

      expect(result).toBe(false);
      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should throw error for unsupported client type', async () => {
      const unsupportedClient = {};

      const result = await updateHulyIssueStatus(unsupportedClient, 'TEST-1', 'Done');

      expect(result).toBe(false);
      // Error is logged with two arguments: message and error
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  // ============================================================
  // updateHulyIssueDescription Tests
  // ============================================================
  describe('updateHulyIssueDescription', () => {
    it('should update description using REST client', async () => {
      mockRestClient.updateIssue.mockResolvedValue({ success: true });

      const result = await updateHulyIssueDescription(
        mockRestClient,
        'TEST-1',
        'New description'
      );

      expect(mockRestClient.updateIssue).toHaveBeenCalledWith(
        'TEST-1',
        'description',
        'New description'
      );
      expect(result).toBe(true);
    });

    it('should update description using MCP client', async () => {
      mockMcpClient.callTool.mockResolvedValue({ success: true });

      const result = await updateHulyIssueDescription(
        mockMcpClient,
        'TEST-1',
        'New description'
      );

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

    it('should skip update in dry run mode', async () => {
      const result = await updateHulyIssueDescription(
        mockRestClient,
        'TEST-1',
        'New description',
        { sync: { dryRun: true } }
      );

      expect(mockRestClient.updateIssue).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false on error', async () => {
      mockRestClient.updateIssue.mockRejectedValue(new Error('Update failed'));

      const result = await updateHulyIssueDescription(
        mockRestClient,
        'TEST-1',
        'New description'
      );

      expect(result).toBe(false);
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
      const createdIssue = createMockHulyIssue({
        identifier: 'TEST-42',
        ...issueData,
      });
      mockRestClient.createIssue.mockResolvedValue(createdIssue);

      const result = await createHulyIssue(mockRestClient, 'TEST', issueData);

      expect(mockRestClient.createIssue).toHaveBeenCalledWith('TEST', issueData);
      expect(result).toEqual(createdIssue);
    });

    it('should create issue using MCP client', async () => {
      const createdIssue = createMockHulyIssue({
        identifier: 'TEST-42',
        ...issueData,
      });
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
      const result = await createHulyIssue(
        mockRestClient,
        'TEST',
        issueData,
        { sync: { dryRun: true } }
      );

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

    it('should throw error for unsupported client type', async () => {
      const unsupportedClient = {};

      const result = await createHulyIssue(unsupportedClient, 'TEST', issueData);

      expect(result).toBeNull();
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

    it('should skip update in dry run mode', async () => {
      const result = await updateHulyIssuePriority(
        mockRestClient,
        'TEST-1',
        'High',
        { sync: { dryRun: true } }
      );

      expect(mockRestClient.updateIssue).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false on error', async () => {
      mockRestClient.updateIssue.mockRejectedValue(new Error('Update failed'));

      const result = await updateHulyIssuePriority(mockRestClient, 'TEST-1', 'High');

      expect(result).toBe(false);
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

      const result = await updateHulyIssueTitle(mockMcpClient, 'TEST-1', 'Updated Title');

      expect(mockMcpClient.callTool).toHaveBeenCalledWith('huly_issue_ops', {
        operation: 'update',
        issue_identifier: 'TEST-1',
        update: {
          field: 'title',
          value: 'Updated Title',
        },
      });
      expect(result).toBe(true);
    });

    it('should skip update in dry run mode', async () => {
      const result = await updateHulyIssueTitle(
        mockRestClient,
        'TEST-1',
        'New Title',
        { sync: { dryRun: true } }
      );

      expect(mockRestClient.updateIssue).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false on error', async () => {
      mockRestClient.updateIssue.mockRejectedValue(new Error('Update failed'));

      const result = await updateHulyIssueTitle(mockRestClient, 'TEST-1', 'New Title');

      expect(result).toBe(false);
    });
  });

  // ============================================================
  // syncVibeTaskToHuly Tests
  // ============================================================
  describe('syncVibeTaskToHuly', () => {
    const createVibeTask = (overrides = {}) => ({
      id: 'task-1',
      title: 'Test Task',
      description: 'Task description\n\n---\nSynced from Huly: TEST-1',
      status: 'in_progress',
      ...overrides,
    });

    const hulyIssues = [
      createMockHulyIssue({
        identifier: 'TEST-1',
        status: 'Backlog',
        description: 'Task description',
      }),
    ];

    it('should skip task updated in Phase 1', async () => {
      const vibeTask = createVibeTask();
      const phase1UpdatedTasks = new Set(['task-1']);

      await syncVibeTaskToHuly(
        mockRestClient,
        vibeTask,
        hulyIssues,
        'TEST',
        {},
        phase1UpdatedTasks
      );

      expect(mockRestClient.updateIssue).not.toHaveBeenCalled();
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('was just updated in Phase 1')
      );
    });

    it('should skip task without Huly identifier', async () => {
      const vibeTask = createVibeTask({
        description: 'No Huly link here',
      });

      await syncVibeTaskToHuly(
        mockRestClient,
        vibeTask,
        hulyIssues,
        'TEST',
        {}
      );

      expect(mockRestClient.updateIssue).not.toHaveBeenCalled();
    });

    it('should warn when Huly issue not found', async () => {
      const vibeTask = createVibeTask({
        description: 'Task\n\n---\nSynced from Huly: TEST-999',
      });

      await syncVibeTaskToHuly(
        mockRestClient,
        vibeTask,
        hulyIssues,
        'TEST',
        {}
      );

      expect(consoleSpy.warn).toHaveBeenCalledWith(
        expect.stringContaining('Huly issue TEST-999 not found')
      );
    });

    it('should update status when Vibe status differs', async () => {
      const vibeTask = createVibeTask({
        status: 'done', // Different from Huly's 'Backlog'
      });
      mockRestClient.updateIssue.mockResolvedValue({ success: true });

      await syncVibeTaskToHuly(
        mockRestClient,
        vibeTask,
        hulyIssues,
        'TEST',
        {}
      );

      expect(mockRestClient.updateIssue).toHaveBeenCalledWith(
        'TEST-1',
        'status',
        expect.any(String)
      );
    });

    it('should update status due to case mismatch in current implementation', async () => {
      // NOTE: Current implementation has a potential bug:
      // mapVibeStatusToHuly('todo') returns 'Backlog' (capitalized)
      // normalizeStatus('Backlog') returns 'backlog' (lowercase)
      // So 'Backlog' !== 'backlog' is always true, triggering an update
      // This test documents the current behavior
      const vibeTask = createVibeTask({
        status: 'todo', // mapVibeStatusToHuly('todo') = 'Backlog'
        description: 'Task description\n\n---\nSynced from Huly: TEST-1',
      });

      const matchingIssues = [
        createMockHulyIssue({
          identifier: 'TEST-1',
          status: 'Backlog', // normalizeStatus('Backlog') = 'backlog'
          description: 'Task description',
        }),
      ];
      mockRestClient.updateIssue.mockResolvedValue({ success: true });

      await syncVibeTaskToHuly(
        mockRestClient,
        vibeTask,
        matchingIssues,
        'TEST',
        {}
      );

      // Due to case mismatch, status is always updated
      // This documents current behavior - 'Backlog' !== 'backlog'
      const statusUpdateCalls = mockRestClient.updateIssue.mock.calls.filter(
        call => call[1] === 'status'
      );
      expect(statusUpdateCalls).toHaveLength(1);
      expect(statusUpdateCalls[0]).toEqual(['TEST-1', 'status', 'Backlog']);
    });

    it('should update description when Vibe description differs', async () => {
      const vibeTask = createVibeTask({
        description: 'Updated description\n\n---\nSynced from Huly: TEST-1',
        status: 'backlog', // Match status to avoid status update
      });
      
      // Issue with different description
      const issuesWithDiffDesc = [
        createMockHulyIssue({
          identifier: 'TEST-1',
          status: 'Backlog',
          description: 'Original description',
        }),
      ];
      mockRestClient.updateIssue.mockResolvedValue({ success: true });

      await syncVibeTaskToHuly(
        mockRestClient,
        vibeTask,
        issuesWithDiffDesc,
        'TEST',
        {}
      );

      expect(mockRestClient.updateIssue).toHaveBeenCalledWith(
        'TEST-1',
        'description',
        'Updated description'
      );
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
      expect(service).toHaveProperty('syncVibeTaskToHuly');
    });

    it('should pass config to fetchProjects', async () => {
      const config = { sync: { dryRun: true } };
      const service = createHulyService(config);
      
      const mockProjects = [createMockHulyProject()];
      mockRestClient.listProjects.mockResolvedValue(mockProjects);

      await service.fetchProjects(mockRestClient);

      // Verify it was called (config is passed internally)
      expect(mockRestClient.listProjects).toHaveBeenCalled();
    });

    it('should pass config to fetchIssues', async () => {
      const config = { sync: { incremental: true } };
      const service = createHulyService(config);
      
      mockRestClient.listIssues.mockResolvedValue({ issues: [], syncMeta: { latestModified: null }, count: 0 });

      // Pass null for db - no cursor-based sync
      await service.fetchIssues(mockRestClient, 'TEST', null);

      expect(mockRestClient.listIssues).toHaveBeenCalledWith('TEST', {
        limit: 1000,
        includeSyncMeta: true,
      });
    });

    it('should pass config to updateIssueStatus (dry run)', async () => {
      const config = { sync: { dryRun: true } };
      const service = createHulyService(config);

      const result = await service.updateIssueStatus(mockRestClient, 'TEST-1', 'Done');

      expect(mockRestClient.updateIssue).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should pass config to updateIssueDescription (dry run)', async () => {
      const config = { sync: { dryRun: true } };
      const service = createHulyService(config);

      const result = await service.updateIssueDescription(
        mockRestClient,
        'TEST-1',
        'New description'
      );

      expect(mockRestClient.updateIssue).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should pass config and phase1UpdatedTasks to syncVibeTaskToHuly', async () => {
      const config = { sync: { dryRun: false } };
      const service = createHulyService(config);
      
      const vibeTask = {
        id: 'task-1',
        title: 'Test',
        description: 'Test\n\n---\nSynced from Huly: TEST-1',
        status: 'done',
      };
      const hulyIssues = [createMockHulyIssue({ identifier: 'TEST-1', status: 'Backlog' })];
      const phase1UpdatedTasks = new Set(['task-1']);

      await service.syncVibeTaskToHuly(
        mockRestClient,
        vibeTask,
        hulyIssues,
        'TEST',
        phase1UpdatedTasks
      );

      // Should skip because task was in phase1UpdatedTasks
      expect(mockRestClient.updateIssue).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Edge Cases and Error Handling
  // ============================================================
  describe('Edge Cases', () => {
    it('should handle null description in Huly issue', async () => {
      const vibeTask = {
        id: 'task-1',
        title: 'Test',
        description: 'Description\n\n---\nSynced from Huly: TEST-1',
        status: 'backlog',
      };
      const hulyIssues = [
        createMockHulyIssue({
          identifier: 'TEST-1',
          status: 'Backlog',
          description: null,
        }),
      ];
      mockRestClient.updateIssue.mockResolvedValue({ success: true });

      await syncVibeTaskToHuly(
        mockRestClient,
        vibeTask,
        hulyIssues,
        'TEST',
        {}
      );

      // Should try to update description since null !== 'Description'
      expect(mockRestClient.updateIssue).toHaveBeenCalledWith(
        'TEST-1',
        'description',
        'Description'
      );
    });

    it('should handle empty hulyIssues array', async () => {
      const vibeTask = {
        id: 'task-1',
        title: 'Test',
        description: 'Test\n\n---\nSynced from Huly: TEST-1',
        status: 'done',
      };

      await syncVibeTaskToHuly(
        mockRestClient,
        vibeTask,
        [],
        'TEST',
        {}
      );

      expect(consoleSpy.warn).toHaveBeenCalledWith(
        expect.stringContaining('Huly issue TEST-1 not found')
      );
    });

    it('should handle undefined config gracefully', async () => {
      mockRestClient.listProjects.mockResolvedValue([]);

      const result = await fetchHulyProjects(mockRestClient);

      expect(result).toEqual([]);
    });

    it('should handle description with multiple separators', async () => {
      const vibeTask = {
        id: 'task-1',
        title: 'Test',
        description: 'Part 1\n\n---\n\nPart 2\n\n---\nSynced from Huly: TEST-1',
        status: 'backlog',
      };
      const hulyIssues = [
        createMockHulyIssue({
          identifier: 'TEST-1',
          status: 'Backlog',
          description: 'Part 1',
        }),
      ];

      await syncVibeTaskToHuly(
        mockRestClient,
        vibeTask,
        hulyIssues,
        'TEST',
        {}
      );

      // First part before first separator should match
      const descUpdateCalls = mockRestClient.updateIssue.mock.calls.filter(
        call => call[1] === 'description'
      );
      expect(descUpdateCalls).toHaveLength(0);
    });
  });
});
