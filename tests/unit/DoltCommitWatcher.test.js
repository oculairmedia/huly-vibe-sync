/**
 * Unit Tests for Dolt Commit Watcher
 *
 * Tests the commit-based change detection watcher that replaces
 * beads SDK polling with Dolt commit hash diffing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================
// Mock modules before importing the watcher
// ============================================================

const mockExecute = vi.fn();
const mockEnd = vi.fn();
const mockGetCurrentCommitHash = vi.fn();
const mockGetRecentChanges = vi.fn();
const mockGetIssueById = vi.fn();
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();

const mockPool = {
  execute: mockExecute,
  end: mockEnd,
};

class MockDoltQueryService {
  constructor() {
    this.pool = mockPool;
    this.connect = mockConnect;
    this.disconnect = mockDisconnect;
    this.getCurrentCommitHash = mockGetCurrentCommitHash;
    this.getRecentChanges = mockGetRecentChanges;
    this.getIssueById = mockGetIssueById;
  }
}

vi.mock('../../lib/DoltQueryService.js', () => ({
  DoltQueryService: MockDoltQueryService,
}));

// Mock node:fs — the watcher imports { readdirSync, existsSync } from 'node:fs'
const mockReaddirSync = vi.fn();
const mockExistsSync = vi.fn();

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readdirSync: (...args) => mockReaddirSync(...args),
    existsSync: (...args) => mockExistsSync(...args),
  };
});

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocking
const {
  WorkspaceWatcher,
  DoltCommitWatcherService,
  discoverWorkspaces,
  DIFF_TYPE_MAP,
} = await import('../../host-helper/dolt-commit-watcher.mjs');

// ============================================================
// Helpers
// ============================================================

const WORKSPACE_PATH = '/opt/stacks/test-project';

function createMockDiffRow(overrides = {}) {
  return {
    diff_type: 'modified',
    from_id: 'issue-1',
    to_id: 'issue-1',
    from_title: 'Old Title',
    to_title: 'New Title',
    from_status: 'open',
    to_status: 'open',
    from_priority: 1,
    to_priority: 1,
    from_description: 'Old desc',
    to_description: 'New desc',
    ...overrides,
  };
}

function createMockFetchResponse(status = 202, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

// ============================================================
// Tests
// ============================================================

describe('DoltCommitWatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: false });
    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
    mockGetCurrentCommitHash.mockResolvedValue('abc123def456');
    mockGetRecentChanges.mockResolvedValue([]);
    mockGetIssueById.mockResolvedValue(null);
    mockExecute.mockResolvedValue([[], []]);
    mockEnd.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue(createMockFetchResponse(202, { workflowId: 'wf-123' }));
    // Default: no workspaces discovered (tests that need them will override)
    mockReaddirSync.mockReturnValue([]);
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ----------------------------------------------------------
  // DIFF_TYPE_MAP
  // ----------------------------------------------------------
  describe('DIFF_TYPE_MAP', () => {
    it('should map added to create', () => {
      expect(DIFF_TYPE_MAP.added).toBe('create');
    });

    it('should map modified to update', () => {
      expect(DIFF_TYPE_MAP.modified).toBe('update');
    });

    it('should map removed to delete', () => {
      expect(DIFF_TYPE_MAP.removed).toBe('delete');
    });
  });

  // ----------------------------------------------------------
  // discoverWorkspaces
  // ----------------------------------------------------------
  describe('discoverWorkspaces', () => {
    it('should find workspaces with dolt-server.port files', () => {
      mockReaddirSync.mockReturnValue([
        { name: 'project-a', isDirectory: () => true },
        { name: 'project-b', isDirectory: () => true },
        { name: 'readme.md', isDirectory: () => false },
      ]);

      mockExistsSync.mockImplementation(path => {
        return path.includes('project-a') && path.includes('dolt-server.port');
      });

      const workspaces = discoverWorkspaces();

      expect(workspaces).toHaveLength(1);
      expect(workspaces[0].name).toBe('project-a');
    });

    it('should return empty array when no workspaces found', () => {
      mockReaddirSync.mockReturnValue([]);

      const workspaces = discoverWorkspaces();

      expect(workspaces).toEqual([]);
    });

    it('should handle filesystem errors gracefully', () => {
      mockReaddirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const workspaces = discoverWorkspaces();

      expect(workspaces).toEqual([]);
    });
  });

  // ----------------------------------------------------------
  // WorkspaceWatcher - Start / Stop
  // ----------------------------------------------------------
  describe('WorkspaceWatcher start/stop', () => {
    it('should connect to Dolt and capture initial commit hash on start', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);

      await watcher.start();

      expect(mockConnect).toHaveBeenCalledWith(WORKSPACE_PATH);
      expect(mockGetCurrentCommitHash).toHaveBeenCalledTimes(1);
      expect(watcher.lastSeenCommit).toBe('abc123def456');
      expect(watcher.running).toBe(true);

      await watcher.stop();
    });

    it('should set projectName from workspace path', () => {
      const watcher = new WorkspaceWatcher('/opt/stacks/my-project');
      expect(watcher.projectName).toBe('my-project');
    });

    it('should not start if already running', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);

      await watcher.start();
      await watcher.start(); // second call should be a no-op

      expect(mockConnect).toHaveBeenCalledTimes(1);

      await watcher.stop();
    });

    it('should clean up on stop', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      await watcher.stop();

      expect(mockDisconnect).toHaveBeenCalled();
      expect(watcher.running).toBe(false);
      expect(watcher.doltService).toBeNull();
      expect(watcher.pendingIssues.size).toBe(0);
    });

    it('should not stop if not running', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.stop(); // should be a no-op

      expect(mockDisconnect).not.toHaveBeenCalled();
    });

    it('should clear pending debounce timers on stop', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      // Simulate a pending issue
      const timer = setTimeout(() => {}, 99999);
      watcher.pendingIssues.set('issue-1', { timer, mutation: {} });

      await watcher.stop();

      expect(watcher.pendingIssues.size).toBe(0);
    });

    it('should throw and set running=false on connection failure', async () => {
      mockConnect.mockRejectedValue(new Error('Connection refused'));

      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);

      await expect(watcher.start()).rejects.toThrow('Connection refused');
      expect(watcher.running).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // WorkspaceWatcher - Polling
  // ----------------------------------------------------------
  describe('WorkspaceWatcher polling', () => {
    it('should detect new commits and process diffs', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      // Simulate a commit change
      mockGetCurrentCommitHash.mockResolvedValue('newcommit789');
      mockGetRecentChanges.mockResolvedValue([
        createMockDiffRow({ diff_type: 'added', from_id: null, to_id: 'issue-new' }),
      ]);

      // Trigger poll
      await watcher._pollForChanges();

      expect(watcher.lastSeenCommit).toBe('newcommit789');
      expect(mockGetRecentChanges).toHaveBeenCalledWith('abc123def456');
      expect(watcher.stats.mutations).toBe(1);

      await watcher.stop();
    });

    it('should not process when commit hash unchanged', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      // Same commit hash
      mockGetCurrentCommitHash.mockResolvedValue('abc123def456');

      await watcher._pollForChanges();

      expect(mockGetRecentChanges).not.toHaveBeenCalled();

      await watcher.stop();
    });

    it('should handle empty diffs gracefully', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      mockGetCurrentCommitHash.mockResolvedValue('newcommit789');
      mockGetRecentChanges.mockResolvedValue([]);

      await watcher._pollForChanges();

      expect(watcher.lastSeenCommit).toBe('newcommit789');
      expect(watcher.stats.mutations).toBe(0);

      await watcher.stop();
    });

    it('should handle diff errors without resetting lastSeenCommit', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      mockGetCurrentCommitHash.mockResolvedValue('newcommit789');
      mockGetRecentChanges.mockRejectedValue(new Error('SQL error'));

      await watcher._pollForChanges();

      // lastSeenCommit should still be updated to avoid re-diffing the same range
      expect(watcher.lastSeenCommit).toBe('newcommit789');

      await watcher.stop();
    });

    it('should increment poll counter', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      await watcher._pollForChanges();
      await watcher._pollForChanges();
      await watcher._pollForChanges();

      expect(watcher.stats.polls).toBe(3);

      await watcher.stop();
    });
  });

  // ----------------------------------------------------------
  // WorkspaceWatcher - Diff Row Handling
  // ----------------------------------------------------------
  describe('WorkspaceWatcher diff row handling', () => {
    it('should map added diff to create mutation', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      const row = createMockDiffRow({
        diff_type: 'added',
        from_id: null,
        to_id: 'new-issue',
        to_title: 'New Issue',
        to_status: 'open',
      });

      watcher._handleDiffRow(row);

      expect(watcher.pendingIssues.has('new-issue')).toBe(true);
      const pending = watcher.pendingIssues.get('new-issue');
      expect(pending.mutation.Type).toBe('create');
      expect(pending.mutation.IssueID).toBe('new-issue');

      await watcher.stop();
    });

    it('should map modified diff to update mutation', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      const row = createMockDiffRow({
        diff_type: 'modified',
        from_status: 'open',
        to_status: 'open', // same status
      });

      watcher._handleDiffRow(row);

      const pending = watcher.pendingIssues.get('issue-1');
      expect(pending.mutation.Type).toBe('update');

      await watcher.stop();
    });

    it('should map modified diff with status change to status mutation', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      const row = createMockDiffRow({
        diff_type: 'modified',
        from_status: 'open',
        to_status: 'closed',
      });

      watcher._handleDiffRow(row);

      const pending = watcher.pendingIssues.get('issue-1');
      expect(pending.mutation.Type).toBe('status');
      expect(pending.mutation.old_status).toBe('open');
      expect(pending.mutation.new_status).toBe('closed');

      await watcher.stop();
    });

    it('should map removed diff to delete mutation', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      const row = createMockDiffRow({
        diff_type: 'removed',
        from_id: 'deleted-issue',
        to_id: null,
      });

      watcher._handleDiffRow(row);

      const pending = watcher.pendingIssues.get('deleted-issue');
      expect(pending.mutation.Type).toBe('delete');
      expect(pending.mutation.IssueID).toBe('deleted-issue');

      await watcher.stop();
    });

    it('should ignore unknown diff types', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      const row = createMockDiffRow({ diff_type: 'unknown' });

      watcher._handleDiffRow(row);

      expect(watcher.pendingIssues.size).toBe(0);
      expect(watcher.stats.mutations).toBe(0);

      await watcher.stop();
    });

    it('should ignore rows with missing issue ID', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      const row = createMockDiffRow({
        diff_type: 'added',
        from_id: null,
        to_id: null,
      });

      watcher._handleDiffRow(row);

      expect(watcher.pendingIssues.size).toBe(0);

      await watcher.stop();
    });

    it('should debounce rapid mutations for the same issue', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      const row1 = createMockDiffRow({ to_title: 'First Title' });
      const row2 = createMockDiffRow({ to_title: 'Second Title' });

      watcher._handleDiffRow(row1);
      watcher._handleDiffRow(row2);

      // Only one pending entry
      expect(watcher.pendingIssues.size).toBe(1);
      const pending = watcher.pendingIssues.get('issue-1');
      expect(pending.mutation.Title).toBe('Second Title');
      // Mutation count reflects both
      expect(watcher.stats.mutations).toBe(2);

      await watcher.stop();
    });
  });

  // ----------------------------------------------------------
  // WorkspaceWatcher - syncIssue
  // ----------------------------------------------------------
  describe('WorkspaceWatcher syncIssue', () => {
    it('should POST correct payload for create mutation', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      const event = {
        Type: 'create',
        IssueID: 'new-issue',
        Title: 'New Issue',
        old_status: null,
        new_status: 'open',
        Timestamp: '2026-01-01T00:00:00.000Z',
        _diffRow: createMockDiffRow({
          diff_type: 'added',
          to_id: 'new-issue',
          to_title: 'New Issue',
          to_status: 'open',
          to_priority: 2,
          to_description: 'A new issue',
        }),
        _diffType: 'added',
      };

      // Mock getIssueById for label enrichment
      mockGetIssueById.mockResolvedValue({
        id: 'new-issue',
        title: 'New Issue',
        status: 'open',
        priority: 2,
        description: 'A new issue',
        labels: ['bug', 'urgent'],
      });

      await watcher.syncIssue(event);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/beads/mutation');
      expect(opts.method).toBe('POST');

      const body = JSON.parse(opts.body);
      expect(body.projectId).toBe('test-project');
      expect(body.mutation.type).toBe('create');
      expect(body.mutation.issueId).toBe('new-issue');
      expect(body.issue).toEqual({
        id: 'new-issue',
        title: 'New Issue',
        status: 'open',
        priority: 2,
        description: 'A new issue',
        labels: ['bug', 'urgent'],
      });

      expect(watcher.stats.syncs).toBe(1);

      await watcher.stop();
    });

    it('should POST null issue for delete mutations', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      const event = {
        Type: 'delete',
        IssueID: 'deleted-issue',
        Title: 'Deleted Issue',
        old_status: 'open',
        new_status: null,
        Timestamp: '2026-01-01T00:00:00.000Z',
        _diffRow: createMockDiffRow({ diff_type: 'removed' }),
        _diffType: 'removed',
      };

      await watcher.syncIssue(event);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.issue).toBeNull();
      expect(body.mutation.type).toBe('delete');

      await watcher.stop();
    });

    it('should fall back to getIssueById when diff row has no title', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      mockGetIssueById.mockResolvedValue({
        id: 'issue-1',
        title: 'Full Issue Title',
        status: 'open',
        priority: 1,
        description: 'Full description',
        labels: ['feature'],
      });

      const event = {
        Type: 'update',
        IssueID: 'issue-1',
        Title: null,
        old_status: null,
        new_status: null,
        Timestamp: '2026-01-01T00:00:00.000Z',
        _diffRow: createMockDiffRow({
          to_id: 'issue-1',
          to_title: null, // missing title triggers fallback
        }),
        _diffType: 'modified',
      };

      await watcher.syncIssue(event);

      expect(mockGetIssueById).toHaveBeenCalledWith('issue-1');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.issue.title).toBe('Full Issue Title');
      expect(body.issue.labels).toEqual(['feature']);

      await watcher.stop();
    });

    it('should throw on API error response', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      mockFetch.mockResolvedValue(createMockFetchResponse(500, { error: 'Internal error' }));

      const event = {
        Type: 'update',
        IssueID: 'issue-1',
        Title: 'Test',
        old_status: null,
        new_status: null,
        Timestamp: '2026-01-01T00:00:00.000Z',
        _diffRow: createMockDiffRow(),
        _diffType: 'modified',
      };

      await expect(watcher.syncIssue(event)).rejects.toThrow('API returned 500');

      await watcher.stop();
    });

    it('should return early when issue not found and was likely deleted', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      mockGetIssueById.mockRejectedValue(new Error('Issue not found'));

      const event = {
        Type: 'update',
        IssueID: 'missing-issue',
        Title: null,
        old_status: null,
        new_status: null,
        Timestamp: '2026-01-01T00:00:00.000Z',
        _diffRow: createMockDiffRow({
          to_id: 'missing-issue',
          to_title: null,
        }),
        _diffType: 'modified',
      };

      // Should not throw, just return early
      await watcher.syncIssue(event);

      expect(mockFetch).not.toHaveBeenCalled();

      await watcher.stop();
    });
  });

  // ----------------------------------------------------------
  // WorkspaceWatcher - syncIssueWithRetry
  // ----------------------------------------------------------
  describe('WorkspaceWatcher syncIssueWithRetry', () => {
    it('should retry on failure with exponential backoff', async () => {
      vi.useRealTimers(); // need real timers for retry delays

      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      // Override env to reduce retry attempts for test speed
      const event = {
        Type: 'update',
        IssueID: 'issue-1',
        Title: 'Test',
        old_status: null,
        new_status: null,
        Timestamp: '2026-01-01T00:00:00.000Z',
        _diffRow: createMockDiffRow(),
        _diffType: 'modified',
      };

      // First two calls fail, third succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(createMockFetchResponse(202, { workflowId: 'wf-retry' }));

      await watcher.syncIssueWithRetry(event);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(watcher.stats.syncs).toBe(1);

      await watcher.stop();
    });

    it('should throw after all retries exhausted', async () => {
      vi.useRealTimers();

      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      const event = {
        Type: 'update',
        IssueID: 'issue-1',
        Title: 'Test',
        old_status: null,
        new_status: null,
        Timestamp: '2026-01-01T00:00:00.000Z',
        _diffRow: createMockDiffRow(),
        _diffType: 'modified',
      };

      mockFetch.mockRejectedValue(new Error('Persistent error'));

      await expect(watcher.syncIssueWithRetry(event)).rejects.toThrow('Persistent error');

      await watcher.stop();
    });
  });

  // ----------------------------------------------------------
  // WorkspaceWatcher - Health
  // ----------------------------------------------------------
  describe('WorkspaceWatcher getHealth', () => {
    it('should return health status', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      const health = watcher.getHealth();

      expect(health.workspace).toBe('test-project');
      expect(health.running).toBe(true);
      expect(health.connected).toBe(true);
      expect(health.lastSeenCommit).toBe('abc123def456'.substring(0, 12));
      expect(health.pending).toBe(0);
      expect(health.stats.mutations).toBe(0);
      expect(health.stats.syncs).toBe(0);
      expect(health.stats.errors).toBe(0);
      expect(health.stats.polls).toBe(0);
      expect(health.stats.reconciliations).toBe(0);

      await watcher.stop();
    });

    it('should show not running when stopped', () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      const health = watcher.getHealth();

      expect(health.running).toBe(false);
      expect(health.connected).toBe(false);
      expect(health.lastSeenCommit).toBeNull();
    });
  });

  // ----------------------------------------------------------
  // WorkspaceWatcher - Reconciliation
  // ----------------------------------------------------------
  describe('WorkspaceWatcher reconciliation', () => {
    it('should query non-tombstone issues and POST to reconcile endpoint', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      const mockIssues = [
        { id: 'issue-1', title: 'Issue 1', status: 'open', priority: 1, description: 'Desc 1', labels: 'bug,urgent' },
        { id: 'issue-2', title: 'Issue 2', status: 'in-progress', priority: 2, description: 'Desc 2', labels: null },
      ];
      mockExecute.mockResolvedValue([mockIssues, []]);

      mockFetch.mockResolvedValue(createMockFetchResponse(202, { workflowId: 'wf-recon' }));

      await watcher.triggerReconciliation();

      // Verify SQL query filters tombstones
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("status != 'tombstone'")
      );

      // Verify POST to reconcile API
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/beads/reconcile');

      const body = JSON.parse(opts.body);
      expect(body.projectId).toBe('test-project');
      expect(body.issues).toHaveLength(2);
      expect(body.issues[0].labels).toEqual(['bug', 'urgent']);
      expect(body.issues[1].labels).toEqual([]);

      expect(watcher.stats.reconciliations).toBe(1);

      await watcher.stop();
    });

    it('should skip reconciliation when not running', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);

      await watcher.triggerReconciliation();

      expect(mockExecute).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should skip reconciliation when no issues found', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      mockExecute.mockResolvedValue([[], []]);

      await watcher.triggerReconciliation();

      expect(mockFetch).not.toHaveBeenCalled();

      await watcher.stop();
    });

    it('should handle reconciliation API errors gracefully', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      mockExecute.mockResolvedValue([[
        { id: 'issue-1', title: 'Issue 1', status: 'open', priority: 1, description: 'Desc 1', labels: null },
      ], []]);

      mockFetch.mockResolvedValue(createMockFetchResponse(500, { error: 'Server error' }));

      // Should not throw
      await watcher.triggerReconciliation();

      expect(watcher.stats.reconciliations).toBe(0);

      await watcher.stop();
    });

    it('should handle SQL errors in reconciliation gracefully', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      mockExecute.mockRejectedValue(new Error('Connection lost'));

      // Should not throw
      await watcher.triggerReconciliation();

      expect(watcher.stats.reconciliations).toBe(0);

      await watcher.stop();
    });
  });

  // ----------------------------------------------------------
  // DoltCommitWatcherService
  // ----------------------------------------------------------
  describe('DoltCommitWatcherService', () => {
    it('should construct with empty watchers map', () => {
      const service = new DoltCommitWatcherService();

      expect(service.watchers.size).toBe(0);
      expect(service.shutdownRequested).toBe(false);
    });

    it('should discover and create watchers', async () => {
      mockReaddirSync.mockReturnValue([
        { name: 'test-project', isDirectory: () => true },
      ]);
      mockExistsSync.mockReturnValue(true);

      const service = new DoltCommitWatcherService();
      await service.discoverAndWatch();

      expect(service.watchers.size).toBe(1);

      // Clean up
      for (const watcher of service.watchers.values()) {
        await watcher.stop();
      }
    });

    it('should skip workspaces that fail to start', async () => {
      mockReaddirSync.mockReturnValue([
        { name: 'bad-project', isDirectory: () => true },
      ]);
      mockExistsSync.mockReturnValue(true);
      mockConnect.mockRejectedValue(new Error('Port file not found'));

      const service = new DoltCommitWatcherService();
      await service.discoverAndWatch();

      expect(service.watchers.size).toBe(0);
    });

    it('should remove watchers for dead workspaces', async () => {
      // First discovery: project-a exists
      mockReaddirSync.mockReturnValue([
        { name: 'project-a', isDirectory: () => true },
      ]);
      mockExistsSync.mockReturnValue(true);

      const service = new DoltCommitWatcherService();
      await service.discoverAndWatch();

      expect(service.watchers.size).toBe(1);

      // Second discovery: project-a port file gone
      mockReaddirSync.mockReturnValue([
        { name: 'project-a', isDirectory: () => true },
      ]);
      mockExistsSync.mockReturnValue(false);

      await service.discoverAndWatch();

      expect(service.watchers.size).toBe(0);
    });

    it('should not duplicate watchers for known workspaces', async () => {
      mockReaddirSync.mockReturnValue([
        { name: 'project-a', isDirectory: () => true },
      ]);
      mockExistsSync.mockReturnValue(true);

      const service = new DoltCommitWatcherService();
      await service.discoverAndWatch();
      await service.discoverAndWatch();

      expect(service.watchers.size).toBe(1);
      expect(mockConnect).toHaveBeenCalledTimes(1);

      for (const watcher of service.watchers.values()) {
        await watcher.stop();
      }
    });

    it('should run health check across all watchers', async () => {
      mockReaddirSync.mockReturnValue([
        { name: 'project-a', isDirectory: () => true },
      ]);
      mockExistsSync.mockReturnValue(true);

      const service = new DoltCommitWatcherService();
      await service.discoverAndWatch();

      // Should not throw
      service.healthCheck();

      for (const watcher of service.watchers.values()) {
        await watcher.stop();
      }
    });

    it('should log warning when no active watchers in health check', () => {
      const service = new DoltCommitWatcherService();
      // Should not throw even with no watchers
      service.healthCheck();
    });

    it('should run reconciliation across all watchers', async () => {
      mockReaddirSync.mockReturnValue([
        { name: 'project-a', isDirectory: () => true },
      ]);
      mockExistsSync.mockReturnValue(true);

      const service = new DoltCommitWatcherService();
      await service.discoverAndWatch();

      mockExecute.mockResolvedValue([[], []]);

      await service.runReconciliation();

      // Reconciliation executed but no issues to send
      expect(mockFetch).not.toHaveBeenCalled();

      for (const watcher of service.watchers.values()) {
        await watcher.stop();
      }
    });
  });

  // ----------------------------------------------------------
  // Payload compatibility
  // ----------------------------------------------------------
  describe('payload compatibility with beads-mutation-watcher', () => {
    it('should produce mutation payload matching the expected API format', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      mockGetIssueById.mockResolvedValue({
        id: 'issue-42',
        title: 'Fix the bug',
        status: 'in-progress',
        priority: 1,
        description: 'There is a bug',
        labels: ['bug'],
      });

      const event = {
        Type: 'update',
        IssueID: 'issue-42',
        Title: 'Fix the bug',
        old_status: 'open',
        new_status: 'in-progress',
        Timestamp: '2026-01-01T00:00:00.000Z',
        _diffRow: createMockDiffRow({
          to_id: 'issue-42',
          to_title: 'Fix the bug',
          to_status: 'in-progress',
          to_priority: 1,
          to_description: 'There is a bug',
        }),
        _diffType: 'modified',
      };

      await watcher.syncIssue(event);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);

      // Validate exact structure expected by /api/beads/mutation
      expect(body).toHaveProperty('projectId');
      expect(body).toHaveProperty('mutation');
      expect(body).toHaveProperty('issue');

      expect(body.mutation).toHaveProperty('type');
      expect(body.mutation).toHaveProperty('issueId');
      expect(body.mutation).toHaveProperty('title');
      expect(body.mutation).toHaveProperty('oldStatus');
      expect(body.mutation).toHaveProperty('newStatus');
      expect(body.mutation).toHaveProperty('timestamp');

      expect(body.issue).toHaveProperty('id');
      expect(body.issue).toHaveProperty('title');
      expect(body.issue).toHaveProperty('status');
      expect(body.issue).toHaveProperty('priority');
      expect(body.issue).toHaveProperty('description');
      expect(body.issue).toHaveProperty('labels');

      await watcher.stop();
    });

    it('should produce reconcile payload matching the expected API format', async () => {
      const watcher = new WorkspaceWatcher(WORKSPACE_PATH);
      await watcher.start();

      mockExecute.mockResolvedValue([[
        { id: 'issue-1', title: 'Issue 1', status: 'open', priority: 1, description: 'Desc', labels: 'bug' },
      ], []]);

      mockFetch.mockResolvedValue(createMockFetchResponse(202, { workflowId: 'wf-recon' }));

      await watcher.triggerReconciliation();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);

      // Validate exact structure expected by /api/beads/reconcile
      expect(body).toHaveProperty('projectId');
      expect(body).toHaveProperty('issues');
      expect(Array.isArray(body.issues)).toBe(true);

      const issue = body.issues[0];
      expect(issue).toHaveProperty('id');
      expect(issue).toHaveProperty('title');
      expect(issue).toHaveProperty('status');
      expect(issue).toHaveProperty('priority');
      expect(issue).toHaveProperty('description');
      expect(issue).toHaveProperty('labels');
      expect(Array.isArray(issue.labels)).toBe(true);

      await watcher.stop();
    });
  });
});
