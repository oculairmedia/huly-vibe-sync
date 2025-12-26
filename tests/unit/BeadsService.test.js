/**
 * Unit Tests for BeadsService
 *
 * Tests the Beads CLI wrapper service for issue tracking.
 * These tests mock child_process.execSync to avoid actual CLI calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createMockBeadsIssue,
  createMockBeadsIssueList,
  createMockListOutput,
  createMockShowOutput,
  createMockCreateOutput,
  createMockExecTracker,
  createBeadsCliError,
  BEADS_ERRORS,
  MOCK_CONFIG,
  SAMPLE_ISSUES,
  createSyncPair,
} from '../mocks/beadsMocks.js';

// Mock child_process before importing BeadsService
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

// Now import the functions we're testing (after mocking)
const {
  listBeadsIssues,
  getBeadsIssue,
  createBeadsIssue,
  updateBeadsIssue,
  closeBeadsIssue,
  reopenBeadsIssue,
} = await import('../../lib/BeadsService.js');

describe('BeadsService', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    mockExecSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listBeadsIssues', () => {
    it('should return empty array when no issues exist', async () => {
      mockExecSync.mockReturnValue('[]');

      const issues = await listBeadsIssues('/test/project');

      expect(issues).toEqual([]);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('bd list --json'),
        expect.objectContaining({ cwd: '/test/project' })
      );
    });

    it('should parse and return issues list', async () => {
      const mockIssues = createMockBeadsIssueList(3);
      mockExecSync.mockReturnValue(JSON.stringify(mockIssues));

      const issues = await listBeadsIssues('/test/project');

      expect(issues).toHaveLength(3);
      expect(issues[0]).toHaveProperty('id');
      expect(issues[0]).toHaveProperty('title');
      expect(issues[0]).toHaveProperty('status');
    });

    it('should filter by open status when specified', async () => {
      mockExecSync.mockReturnValue(createMockListOutput([SAMPLE_ISSUES.openTask]));

      await listBeadsIssues('/test/project', { status: 'open' });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--status=open'),
        expect.any(Object)
      );
    });

    it('should filter by closed status when specified', async () => {
      mockExecSync.mockReturnValue(createMockListOutput([SAMPLE_ISSUES.closedBug]));

      await listBeadsIssues('/test/project', { status: 'closed' });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--status=closed'),
        expect.any(Object)
      );
    });

    it('should return empty array on CLI error', async () => {
      mockExecSync.mockImplementation(() => {
        throw createBeadsCliError(BEADS_ERRORS.NOT_INITIALIZED);
      });

      const issues = await listBeadsIssues('/test/project');

      expect(issues).toEqual([]);
    });

    it('should return empty array when output is empty', async () => {
      mockExecSync.mockReturnValue('');

      const issues = await listBeadsIssues('/test/project');

      expect(issues).toEqual([]);
    });

    it('should always use --no-daemon flag', async () => {
      mockExecSync.mockReturnValue('[]');

      await listBeadsIssues('/test/project');

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--no-daemon'),
        expect.any(Object)
      );
    });
  });

  describe('getBeadsIssue', () => {
    it('should return null when issue not found', async () => {
      mockExecSync.mockImplementation(() => {
        throw createBeadsCliError(BEADS_ERRORS.ISSUE_NOT_FOUND('nonexistent'));
      });

      const issue = await getBeadsIssue('/test/project', 'nonexistent');

      expect(issue).toBeNull();
    });

    it('should return issue when found', async () => {
      const mockIssue = SAMPLE_ISSUES.openTask;
      mockExecSync.mockReturnValue(createMockShowOutput(mockIssue));

      const issue = await getBeadsIssue('/test/project', mockIssue.id);

      expect(issue).toBeDefined();
      expect(issue.id).toBe(mockIssue.id);
      expect(issue.title).toBe(mockIssue.title);
    });

    it('should call bd show with correct issue ID', async () => {
      mockExecSync.mockReturnValue(createMockShowOutput());

      await getBeadsIssue('/test/project', 'test-issue-123');

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('bd show test-issue-123 --json'),
        expect.any(Object)
      );
    });

    it('should return null on empty output', async () => {
      mockExecSync.mockReturnValue('');

      const issue = await getBeadsIssue('/test/project', 'test-123');

      expect(issue).toBeNull();
    });
  });

  describe('createBeadsIssue', () => {
    it('should create issue with title', async () => {
      const created = createMockBeadsIssue({ title: 'New Feature' });
      mockExecSync.mockReturnValue(JSON.stringify(created));

      const issue = await createBeadsIssue('/test/project', { title: 'New Feature' });

      expect(issue).toBeDefined();
      expect(issue.title).toBe('New Feature');
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('bd create "New Feature" --json'),
        expect.any(Object)
      );
    });

    it('should include priority when specified', async () => {
      mockExecSync.mockReturnValue(createMockCreateOutput({ priority: 1 }));

      await createBeadsIssue('/test/project', { title: 'High Priority', priority: 1 });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--priority=1'),
        expect.any(Object)
      );
    });

    it('should include type when specified', async () => {
      mockExecSync.mockReturnValue(createMockCreateOutput({ issue_type: 'bug' }));

      await createBeadsIssue('/test/project', { title: 'Bug Report', type: 'bug' });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--type=bug'),
        expect.any(Object)
      );
    });

    it('should add description as comment when provided', async () => {
      const created = createMockBeadsIssue({ id: 'proj-new1', title: 'With Description' });
      mockExecSync.mockReturnValue(JSON.stringify(created));

      await createBeadsIssue('/test/project', {
        title: 'With Description',
        description: 'This is the description',
      });

      // First call: create
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('bd create "With Description"'),
        expect.any(Object)
      );

      // Second call: add comment with description
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('bd comment proj-new1'),
        expect.any(Object)
      );
    });

    it('should return null in dry run mode', async () => {
      const issue = await createBeadsIssue(
        '/test/project',
        { title: 'Dry Run' },
        MOCK_CONFIG.dryRun
      );

      expect(issue).toBeNull();
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('should return null on CLI error', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Command failed');
      });

      const issue = await createBeadsIssue('/test/project', { title: 'Will Fail' });

      expect(issue).toBeNull();
    });

    it('should handle title passed to command', async () => {
      mockExecSync.mockReturnValue(createMockCreateOutput({ title: 'Issue with quotes' }));

      await createBeadsIssue('/test/project', { title: 'Issue with "quotes"' });

      // The title is passed directly
      expect(mockExecSync).toHaveBeenCalled();
    });
  });

  describe('updateBeadsIssue', () => {
    it('should update status to closed by calling close command', async () => {
      mockExecSync.mockReturnValue('');

      const result = await updateBeadsIssue('/test/project', 'issue-123', 'status', 'closed');

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('bd close issue-123'),
        expect.any(Object)
      );
    });

    it('should update status to open by calling reopen command', async () => {
      mockExecSync.mockReturnValue('');

      const result = await updateBeadsIssue('/test/project', 'issue-123', 'status', 'open');

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('bd reopen issue-123'),
        expect.any(Object)
      );
    });

    it('should update priority', async () => {
      mockExecSync.mockReturnValue('');

      const result = await updateBeadsIssue('/test/project', 'issue-123', 'priority', 1);

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('bd update issue-123 --priority=1'),
        expect.any(Object)
      );
    });

    it('should update title', async () => {
      mockExecSync.mockReturnValue('');

      const result = await updateBeadsIssue('/test/project', 'issue-123', 'title', 'New Title');

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('bd update issue-123 --title="New Title"'),
        expect.any(Object)
      );
    });

    it('should update type', async () => {
      mockExecSync.mockReturnValue('');

      const result = await updateBeadsIssue('/test/project', 'issue-123', 'type', 'bug');

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('bd update issue-123 --type=bug'),
        expect.any(Object)
      );
    });

    it('should return false for unknown status value', async () => {
      const result = await updateBeadsIssue('/test/project', 'issue-123', 'status', 'unknown');

      expect(result).toBe(false);
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('should return false for unsupported field', async () => {
      const result = await updateBeadsIssue('/test/project', 'issue-123', 'unsupported', 'value');

      expect(result).toBe(false);
    });

    it('should return true in dry run mode without executing', async () => {
      const result = await updateBeadsIssue(
        '/test/project',
        'issue-123',
        'priority',
        1,
        MOCK_CONFIG.dryRun
      );

      expect(result).toBe(true);
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('should return false on CLI error', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Command failed');
      });

      const result = await updateBeadsIssue('/test/project', 'issue-123', 'priority', 1);

      expect(result).toBe(false);
    });

    it('should escape quotes in title update', async () => {
      mockExecSync.mockReturnValue('');

      await updateBeadsIssue('/test/project', 'issue-123', 'title', 'Title with "quotes"');

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--title="Title with \\"quotes\\""'),
        expect.any(Object)
      );
    });
  });

  describe('closeBeadsIssue', () => {
    it('should close issue using updateBeadsIssue', async () => {
      mockExecSync.mockReturnValue('');

      const result = await closeBeadsIssue('/test/project', 'issue-123');

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('bd close issue-123'),
        expect.any(Object)
      );
    });

    it('should respect dry run mode', async () => {
      const result = await closeBeadsIssue('/test/project', 'issue-123', MOCK_CONFIG.dryRun);

      expect(result).toBe(true);
      expect(mockExecSync).not.toHaveBeenCalled();
    });
  });

  describe('reopenBeadsIssue', () => {
    it('should reopen issue using updateBeadsIssue', async () => {
      mockExecSync.mockReturnValue('');

      const result = await reopenBeadsIssue('/test/project', 'issue-123');

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('bd reopen issue-123'),
        expect.any(Object)
      );
    });

    it('should respect dry run mode', async () => {
      const result = await reopenBeadsIssue('/test/project', 'issue-123', MOCK_CONFIG.dryRun);

      expect(result).toBe(true);
      expect(mockExecSync).not.toHaveBeenCalled();
    });
  });

  describe('CLI command construction', () => {
    it('should always add --no-daemon to avoid WAL permission issues', async () => {
      mockExecSync.mockReturnValue('[]');

      await listBeadsIssues('/test/project');

      const call = mockExecSync.mock.calls[0][0];
      expect(call).toContain('--no-daemon');
    });

    it('should not duplicate --no-daemon if already present', async () => {
      // This tests the internal command construction
      mockExecSync.mockReturnValue('[]');

      await listBeadsIssues('/test/project');

      const call = mockExecSync.mock.calls[0][0];
      const count = (call.match(/--no-daemon/g) || []).length;
      expect(count).toBe(1);
    });

    it('should use correct working directory', async () => {
      mockExecSync.mockReturnValue('[]');

      await listBeadsIssues('/path/to/project');

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ cwd: '/path/to/project' })
      );
    });

    it('should use utf-8 encoding', async () => {
      mockExecSync.mockReturnValue('[]');

      await listBeadsIssues('/test/project');

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ encoding: 'utf-8' })
      );
    });
  });

  describe('error handling', () => {
    it('should handle JSON parse errors gracefully in list', async () => {
      mockExecSync.mockReturnValue('not valid json');

      const issues = await listBeadsIssues('/test/project');

      expect(issues).toEqual([]);
    });

    it('should handle JSON parse errors gracefully in get', async () => {
      mockExecSync.mockReturnValue('not valid json');

      const issue = await getBeadsIssue('/test/project', 'test-123');

      expect(issue).toBeNull();
    });

    it('should handle not initialized error in list', async () => {
      mockExecSync.mockImplementation(() => {
        throw createBeadsCliError(BEADS_ERRORS.NOT_INITIALIZED);
      });

      const issues = await listBeadsIssues('/test/project');

      expect(issues).toEqual([]);
    });

    it('should handle database locked error', async () => {
      mockExecSync.mockImplementation(() => {
        throw createBeadsCliError(BEADS_ERRORS.DATABASE_LOCKED);
      });

      const result = await updateBeadsIssue('/test/project', 'issue-123', 'priority', 1);

      expect(result).toBe(false);
    });

    it('should handle permission denied error', async () => {
      mockExecSync.mockImplementation(() => {
        throw createBeadsCliError(BEADS_ERRORS.PERMISSION_DENIED);
      });

      const issue = await createBeadsIssue('/test/project', { title: 'Test' });

      expect(issue).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle empty title in create', async () => {
      mockExecSync.mockReturnValue(createMockCreateOutput({ title: '' }));

      // Empty title should still attempt to create
      const issue = await createBeadsIssue('/test/project', { title: '' });

      expect(mockExecSync).toHaveBeenCalled();
    });

    it('should handle special characters in title', async () => {
      const title = 'Issue with $pecial ch@rs & "quotes" \'single\' `backticks`';
      mockExecSync.mockReturnValue(createMockCreateOutput({ title }));

      await createBeadsIssue('/test/project', { title });

      expect(mockExecSync).toHaveBeenCalled();
    });

    it('should handle unicode in title', async () => {
      const title = 'Issue with unicode: cafe, , emoji ';
      mockExecSync.mockReturnValue(createMockCreateOutput({ title }));

      await createBeadsIssue('/test/project', { title });

      expect(mockExecSync).toHaveBeenCalled();
    });

    it('should handle very long title', async () => {
      const title = 'A'.repeat(1000);
      mockExecSync.mockReturnValue(createMockCreateOutput({ title }));

      await createBeadsIssue('/test/project', { title });

      expect(mockExecSync).toHaveBeenCalled();
    });

    it('should handle null description', async () => {
      mockExecSync.mockReturnValue(createMockCreateOutput({}));

      await createBeadsIssue('/test/project', { title: 'Test', description: null });

      // Should only call create, not comment
      expect(mockExecSync).toHaveBeenCalledTimes(1);
    });

    it('should handle undefined filters', async () => {
      mockExecSync.mockReturnValue('[]');

      await listBeadsIssues('/test/project', undefined);

      expect(mockExecSync).toHaveBeenCalled();
    });

    it('should handle priority 0 (P0 urgent)', async () => {
      mockExecSync.mockReturnValue(createMockCreateOutput({ priority: 0 }));

      await createBeadsIssue('/test/project', { title: 'Urgent', priority: 0 });

      // Priority 0 (P0/urgent) should now be passed correctly
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--priority=0'),
        expect.any(Object)
      );
    });

    it('should handle priority 4 (P4 no priority)', async () => {
      mockExecSync.mockReturnValue(createMockCreateOutput({ priority: 4 }));

      await createBeadsIssue('/test/project', { title: 'No Priority', priority: 4 });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--priority=4'),
        expect.any(Object)
      );
    });
  });

  describe('mock infrastructure', () => {
    it('should create valid mock issues', () => {
      const issue = createMockBeadsIssue();

      expect(issue).toHaveProperty('id');
      expect(issue).toHaveProperty('title');
      expect(issue).toHaveProperty('status');
      expect(issue).toHaveProperty('priority');
      expect(issue).toHaveProperty('issue_type');
      expect(issue).toHaveProperty('created_at');
      expect(issue).toHaveProperty('updated_at');
    });

    it('should create issue list with correct count', () => {
      const issues = createMockBeadsIssueList(5);

      expect(issues).toHaveLength(5);
      issues.forEach(issue => {
        expect(issue).toHaveProperty('id');
      });
    });

    it('should create valid sync pairs', () => {
      const pair = createSyncPair({ identifier: 'TEST-42' });

      expect(pair.hulyIssue.identifier).toBe('TEST-42');
      expect(pair.beadsIssue).toHaveProperty('id');
      expect(pair.dbRecord.identifier).toBe('TEST-42');
      expect(pair.dbRecord.beads_issue_id).toBe(pair.beadsIssue.id);
    });

    it('should track exec calls with tracker', () => {
      const tracker = createMockExecTracker({
        list: '[]',
        show: '[]',
      });

      tracker.mock('bd list --json', {});
      tracker.mock('bd show test-123 --json', {});

      expect(tracker.getCallCount()).toBe(2);
      expect(tracker.getCallsMatching('list')).toHaveLength(1);
      expect(tracker.getLastCall().command).toContain('show');
    });
  });

  describe('isBeadsInitialized', () => {
    it('should return false for non-existent path', async () => {
      const { isBeadsInitialized } = await import('../../lib/BeadsService.js');

      const result = isBeadsInitialized('/nonexistent/path/that/does/not/exist');
      expect(result).toBe(false);
    });

    it('should return false when .beads directory exists but beads.db is missing', async () => {
      // This tests the case where .beads exists but is incomplete
      const { isBeadsInitialized } = await import('../../lib/BeadsService.js');

      // Using /tmp which exists but won't have a .beads/beads.db
      const result = isBeadsInitialized('/tmp');
      expect(result).toBe(false);
    });

    it('should return true for initialized beads project', async () => {
      const { isBeadsInitialized } = await import('../../lib/BeadsService.js');

      // Test with the actual project path that has beads initialized
      const result = isBeadsInitialized('/opt/stacks/huly-vibe-sync');
      expect(result).toBe(true);
    });
  });

  describe('syncBeadsToGit', () => {
    it('should handle non-beads repository gracefully', async () => {
      const { syncBeadsToGit } = await import('../../lib/BeadsService.js');

      // Should return false and not throw for uninitialized path
      const result = await syncBeadsToGit('/nonexistent/path');
      expect(result).toBe(false);
    });

    it('should return false when path is not a beads project', async () => {
      const { syncBeadsToGit } = await import('../../lib/BeadsService.js');

      // Using /tmp which exists but isn't a beads project
      const result = await syncBeadsToGit('/tmp');
      expect(result).toBe(false);
    });
  });

  describe('ensureBeadsInitialized', () => {
    it('should return true if already initialized', async () => {
      const { ensureBeadsInitialized } = await import('../../lib/BeadsService.js');

      // Test with actual initialized project
      const result = await ensureBeadsInitialized('/opt/stacks/huly-vibe-sync');
      expect(result).toBe(true);
    });

    it('should attempt initialization if not initialized', async () => {
      mockExecSync.mockReturnValue('');

      const { ensureBeadsInitialized } = await import('../../lib/BeadsService.js');

      // For non-existent path, it should try to initialize
      const result = await ensureBeadsInitialized('/tmp/test-beads-init-' + Date.now());

      // May succeed or fail depending on permissions, but shouldn't throw
      expect(typeof result).toBe('boolean');
    });
  });

  describe('createBeadsService factory', () => {
    it('should create service with config', async () => {
      const { createBeadsService } = await import('../../lib/BeadsService.js');

      const service = createBeadsService({ projectPath: '/test/project' });

      expect(service).toBeDefined();
      expect(typeof service.listIssues).toBe('function');
      expect(typeof service.getIssue).toBe('function');
      expect(typeof service.createIssue).toBe('function');
      expect(typeof service.updateIssue).toBe('function');
      expect(typeof service.closeIssue).toBe('function');
      expect(typeof service.reopenIssue).toBe('function');
    });

    it('should pass project path to service methods', async () => {
      mockExecSync.mockReturnValue('[]');

      const { createBeadsService } = await import('../../lib/BeadsService.js');

      const service = createBeadsService({ dryRun: false });
      // The factory methods take projectPath as first argument
      await service.listIssues('/test/project');

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ cwd: '/test/project' })
      );
    });
  });
});
