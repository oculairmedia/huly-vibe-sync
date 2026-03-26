/**
 * Unit Tests for DoltQueryService
 *
 * Tests the Dolt SQL query service with mocked mysql2 pool.
 * Verifies correct SQL generation, port auto-discovery, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// ============================================================
// Mock mysql2/promise before importing DoltQueryService
// ============================================================

const mockExecute = vi.fn();
const mockEnd = vi.fn();

const mockPool = {
  execute: mockExecute,
  end: mockEnd,
};

const mockCreatePool = vi.fn(() => mockPool);

vi.mock('mysql2/promise', () => ({
  default: { createPool: mockCreatePool },
  createPool: mockCreatePool,
}));

// Import after mocking
const { DoltQueryService, discoverPort } = await import('../../lib/DoltQueryService.js');

// ============================================================
// Helpers
// ============================================================

const REPO_PATH = '/opt/stacks/huly-vibe-sync';
const PORT_FILE_PATH = path.join(REPO_PATH, '.beads/dolt-server.port');

/**
 * Create a connected DoltQueryService instance for testing.
 * Bypasses port file discovery by passing port directly.
 */
async function createConnectedService() {
  const svc = new DoltQueryService();
  await svc.connect(REPO_PATH, { port: 38131 });
  return svc;
}

// ============================================================
// Tests
// ============================================================

describe('DoltQueryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockReset();
    mockEnd.mockReset();
    mockCreatePool.mockReturnValue(mockPool);
    mockEnd.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ----------------------------------------------------------
  // Port auto-discovery
  // ----------------------------------------------------------
  describe('discoverPort', () => {
    it('should read port from .beads/dolt-server.port', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('38131\n');

      const port = discoverPort('/test/repo');

      expect(fs.existsSync).toHaveBeenCalledWith('/test/repo/.beads/dolt-server.port');
      expect(port).toBe(38131);
    });

    it('should throw if port file does not exist', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      expect(() => discoverPort('/missing/repo')).toThrow('port file not found');
    });

    it('should throw if port file contains invalid data', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('not-a-number\n');

      expect(() => discoverPort('/test/repo')).toThrow('Invalid port');
    });

    it('should throw if port is out of range', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('99999\n');

      expect(() => discoverPort('/test/repo')).toThrow('Invalid port');
    });

    it('should throw if port is zero', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('0\n');

      expect(() => discoverPort('/test/repo')).toThrow('Invalid port');
    });

    it('should trim whitespace from port file', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('  38131  \n');

      const port = discoverPort('/test/repo');
      expect(port).toBe(38131);
    });
  });

  // ----------------------------------------------------------
  // connect()
  // ----------------------------------------------------------
  describe('connect', () => {
    it('should create a connection pool with auto-discovered port', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('38131');

      const svc = new DoltQueryService();
      await svc.connect(REPO_PATH);

      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '127.0.0.1',
          port: 38131,
          database: 'huly_vibe_sync',
          connectionLimit: 5,
          waitForConnections: true,
        })
      );
      expect(svc.pool).toBe(mockPool);
      expect(svc.repoPath).toBe(REPO_PATH);
    });

    it('should accept port override', async () => {
      const svc = new DoltQueryService();
      await svc.connect(REPO_PATH, { port: 12345 });

      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({ port: 12345 })
      );
    });

    it('should accept host override', async () => {
      const svc = new DoltQueryService();
      await svc.connect(REPO_PATH, { port: 38131, host: '192.168.1.1' });

      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({ host: '192.168.1.1' })
      );
    });

    it('should accept database override', async () => {
      const svc = new DoltQueryService();
      await svc.connect(REPO_PATH, { port: 38131, database: 'other_db' });

      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({ database: 'other_db' })
      );
    });

    it('should accept connectionLimit override', async () => {
      const svc = new DoltQueryService();
      await svc.connect(REPO_PATH, { port: 38131, connectionLimit: 10 });

      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({ connectionLimit: 10 })
      );
    });
  });

  // ----------------------------------------------------------
  // _ensureConnected()
  // ----------------------------------------------------------
  describe('_ensureConnected', () => {
    it('should throw if not connected', () => {
      const svc = new DoltQueryService();
      expect(() => svc._ensureConnected()).toThrow('not connected');
    });

    it('should not throw if connected', async () => {
      const svc = await createConnectedService();
      expect(() => svc._ensureConnected()).not.toThrow();
    });
  });

  // ----------------------------------------------------------
  // getStatusCounts()
  // ----------------------------------------------------------
  describe('getStatusCounts', () => {
    it('should execute correct SQL', async () => {
      const svc = await createConnectedService();
      const mockRows = [
        { status: 'open', count: 5 },
        { status: 'closed', count: 3 },
        { status: 'in-progress', count: 2 },
      ];
      mockExecute.mockResolvedValue([mockRows, []]);

      const result = await svc.getStatusCounts();

      expect(mockExecute).toHaveBeenCalledWith(
        'SELECT status, COUNT(*) AS count FROM issues GROUP BY status'
      );
      expect(result).toEqual(mockRows);
    });

    it('should throw if not connected', async () => {
      const svc = new DoltQueryService();
      await expect(svc.getStatusCounts()).rejects.toThrow('not connected');
    });
  });

  // ----------------------------------------------------------
  // getOpenByPriority()
  // ----------------------------------------------------------
  describe('getOpenByPriority', () => {
    it('should execute correct SQL with open status filter', async () => {
      const svc = await createConnectedService();
      const mockRows = [
        { id: 'issue-1', priority: 0, status: 'open' },
        { id: 'issue-2', priority: 1, status: 'open' },
        { id: 'issue-3', priority: 2, status: 'open' },
      ];
      mockExecute.mockResolvedValue([mockRows, []]);

      const result = await svc.getOpenByPriority();

      expect(mockExecute).toHaveBeenCalledWith(
        'SELECT * FROM issues WHERE status = ? ORDER BY priority ASC',
        ['open']
      );
      expect(result).toEqual(mockRows);
      expect(result[0].priority).toBe(0);
    });
  });

  // ----------------------------------------------------------
  // getIssueById()
  // ----------------------------------------------------------
  describe('getIssueById', () => {
    it('should join labels and return issue', async () => {
      const svc = await createConnectedService();
      const mockRows = [
        {
          id: 'huly-vibe-sync-abc',
          title: 'Test Issue',
          status: 'open',
          labels: 'bug,urgent',
        },
      ];
      mockExecute.mockResolvedValue([mockRows, []]);

      const result = await svc.getIssueById('huly-vibe-sync-abc');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('LEFT JOIN labels'),
        ['huly-vibe-sync-abc']
      );
      expect(result.id).toBe('huly-vibe-sync-abc');
      expect(result.labels).toEqual(['bug', 'urgent']);
    });

    it('should return null when issue not found', async () => {
      const svc = await createConnectedService();
      mockExecute.mockResolvedValue([[], []]);

      const result = await svc.getIssueById('nonexistent');

      expect(result).toBeNull();
    });

    it('should return empty labels array when no labels exist', async () => {
      const svc = await createConnectedService();
      const mockRows = [
        {
          id: 'huly-vibe-sync-abc',
          title: 'No Labels',
          labels: null,
        },
      ];
      mockExecute.mockResolvedValue([mockRows, []]);

      const result = await svc.getIssueById('huly-vibe-sync-abc');

      expect(result.labels).toEqual([]);
    });

    it('should pass the id as a parameterized value', async () => {
      const svc = await createConnectedService();
      mockExecute.mockResolvedValue([[], []]);

      await svc.getIssueById('test-id');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.any(String),
        ['test-id']
      );
    });
  });

  // ----------------------------------------------------------
  // getIssuesByStatus()
  // ----------------------------------------------------------
  describe('getIssuesByStatus', () => {
    it('should filter by status and order by updated_at', async () => {
      const svc = await createConnectedService();
      const mockRows = [
        { id: 'issue-1', status: 'in-progress' },
        { id: 'issue-2', status: 'in-progress' },
      ];
      mockExecute.mockResolvedValue([mockRows, []]);

      const result = await svc.getIssuesByStatus('in-progress');

      expect(mockExecute).toHaveBeenCalledWith(
        'SELECT * FROM issues WHERE status = ? ORDER BY updated_at DESC',
        ['in-progress']
      );
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no issues match', async () => {
      const svc = await createConnectedService();
      mockExecute.mockResolvedValue([[], []]);

      const result = await svc.getIssuesByStatus('nonexistent');

      expect(result).toEqual([]);
    });
  });

  // ----------------------------------------------------------
  // getRecentChanges()
  // ----------------------------------------------------------
  describe('getRecentChanges', () => {
    it('should use dolt_diff function with commit hash', async () => {
      const svc = await createConnectedService();
      const mockRows = [
        { diff_type: 'modified', from_id: 'issue-1', to_id: 'issue-1' },
      ];
      mockExecute.mockResolvedValue([mockRows, []]);

      const result = await svc.getRecentChanges('abc123');

      expect(mockExecute).toHaveBeenCalledWith(
        "SELECT * FROM dolt_diff('issues', ?, 'HEAD')",
        ['abc123']
      );
      expect(result).toEqual(mockRows);
    });
  });

  // ----------------------------------------------------------
  // getCurrentCommitHash()
  // ----------------------------------------------------------
  describe('getCurrentCommitHash', () => {
    it('should return the HEAD commit hash', async () => {
      const svc = await createConnectedService();
      mockExecute.mockResolvedValue([[{ hash: 'abc123def456' }], []]);

      const hash = await svc.getCurrentCommitHash();

      expect(mockExecute).toHaveBeenCalledWith(
        "SELECT dolt_hashof('HEAD') AS hash"
      );
      expect(hash).toBe('abc123def456');
    });
  });

  // ----------------------------------------------------------
  // getCommitLog()
  // ----------------------------------------------------------
  describe('getCommitLog', () => {
    it('should return commit log with default limit', async () => {
      const svc = await createConnectedService();
      const mockRows = [
        { commit_hash: 'abc123', committer: 'user', message: 'Update issue' },
      ];
      mockExecute.mockResolvedValue([mockRows, []]);

      const result = await svc.getCommitLog();

      expect(mockExecute).toHaveBeenCalledWith(
        'SELECT * FROM dolt_log LIMIT ?',
        [20]
      );
      expect(result).toEqual(mockRows);
    });

    it('should accept custom limit', async () => {
      const svc = await createConnectedService();
      mockExecute.mockResolvedValue([[], []]);

      await svc.getCommitLog(5);

      expect(mockExecute).toHaveBeenCalledWith(
        'SELECT * FROM dolt_log LIMIT ?',
        [5]
      );
    });
  });

  // ----------------------------------------------------------
  // queryAsOf()
  // ----------------------------------------------------------
  describe('queryAsOf', () => {
    it('should append AS OF clause with commit hash', async () => {
      const svc = await createConnectedService();
      const mockRows = [{ id: 'issue-1', title: 'Old title' }];
      mockExecute.mockResolvedValue([mockRows, []]);

      const result = await svc.queryAsOf('abc123', 'SELECT * FROM issues');

      expect(mockExecute).toHaveBeenCalledWith(
        "SELECT * FROM issues AS OF 'abc123'"
      );
      expect(result).toEqual(mockRows);
    });
  });

  // ----------------------------------------------------------
  // disconnect()
  // ----------------------------------------------------------
  describe('disconnect', () => {
    it('should close the pool and reset state', async () => {
      const svc = await createConnectedService();

      await svc.disconnect();

      expect(mockEnd).toHaveBeenCalled();
      expect(svc.pool).toBeNull();
      expect(svc.repoPath).toBeNull();
    });

    it('should be safe to call when not connected', async () => {
      const svc = new DoltQueryService();

      await expect(svc.disconnect()).resolves.toBeUndefined();
      expect(mockEnd).not.toHaveBeenCalled();
    });

    it('should be safe to call multiple times', async () => {
      const svc = await createConnectedService();

      await svc.disconnect();
      await svc.disconnect();

      expect(mockEnd).toHaveBeenCalledTimes(1);
    });
  });

  // ----------------------------------------------------------
  // getRecentActivityFromDolt()
  // ----------------------------------------------------------
  describe('getRecentActivityFromDolt', () => {
    it('should return empty result when no commits exist', async () => {
      const svc = await createConnectedService();
      // getCommitLog returns empty
      mockExecute.mockResolvedValue([[], []]);

      const result = await svc.getRecentActivityFromDolt(24);

      expect(result.changes).toEqual([]);
      expect(result.summary.total).toBe(0);
      expect(result.since).toBeNull();
    });

    it('should find commit closest to 24h ago and diff from it', async () => {
      const svc = await createConnectedService();
      const now = new Date();
      const thirtyHoursAgo = new Date(now.getTime() - 30 * 60 * 60 * 1000);
      const tenHoursAgo = new Date(now.getTime() - 10 * 60 * 60 * 1000);
      const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000);

      // First call: getCommitLog (via getCommitLog -> pool.execute)
      const commitLogRows = [
        { commit_hash: 'commit_5h', date: fiveHoursAgo, message: 'Recent' },
        { commit_hash: 'commit_10h', date: tenHoursAgo, message: 'Older' },
        { commit_hash: 'commit_30h', date: thirtyHoursAgo, message: 'Old' },
      ];

      // Second call: getRecentChanges (diff from commit_30h)
      const diffRows = [
        { diff_type: 'added', to_id: 'i-1', to_title: 'New Issue', from_id: null, from_title: null, to_status: 'open', from_status: null, to_updated_at: now.toISOString(), from_updated_at: null },
        { diff_type: 'modified', to_id: 'i-2', to_title: 'Updated Issue', from_id: 'i-2', from_title: 'Updated Issue', to_status: 'closed', from_status: 'in-progress', to_updated_at: now.toISOString(), from_updated_at: tenHoursAgo.toISOString() },
        { diff_type: 'modified', to_id: 'i-3', to_title: 'Changed Issue', from_id: 'i-3', from_title: 'Changed Issue', to_status: 'in-progress', from_status: 'open', to_updated_at: now.toISOString(), from_updated_at: tenHoursAgo.toISOString() },
        { diff_type: 'removed', to_id: null, to_title: null, from_id: 'i-4', from_title: 'Deleted Issue', to_status: null, from_status: 'open', to_updated_at: null, from_updated_at: tenHoursAgo.toISOString() },
      ];

      mockExecute
        .mockResolvedValueOnce([commitLogRows, []])  // getCommitLog
        .mockResolvedValueOnce([diffRows, []]);       // getRecentChanges

      const result = await svc.getRecentActivityFromDolt(24);

      // Should have picked commit_30h as the base (first commit older than 24h)
      expect(result.changes).toHaveLength(4);
      expect(result.summary.created).toBe(1);
      expect(result.summary.closed).toBe(1);
      expect(result.summary.updated).toBe(1);
      expect(result.summary.deleted).toBe(1);
      expect(result.summary.total).toBe(4);
      expect(result.since).toBe(thirtyHoursAgo.toISOString());

      // Verify diff was called with the correct base commit
      expect(mockExecute).toHaveBeenCalledWith(
        "SELECT * FROM dolt_diff('issues', ?, 'HEAD')",
        ['commit_30h']
      );
    });

    it('should fallback to oldest commit when no commit is older than cutoff', async () => {
      const svc = await createConnectedService();
      const now = new Date();
      const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const commitLogRows = [
        { commit_hash: 'commit_2h', date: twoHoursAgo, message: 'Recent' },
        { commit_hash: 'commit_5h', date: fiveHoursAgo, message: 'Older' },
      ];

      mockExecute
        .mockResolvedValueOnce([commitLogRows, []])  // getCommitLog
        .mockResolvedValueOnce([[], []]);             // getRecentChanges (empty diff)

      const result = await svc.getRecentActivityFromDolt(24);

      // Should fallback to oldest commit (commit_5h)
      expect(mockExecute).toHaveBeenCalledWith(
        "SELECT * FROM dolt_diff('issues', ?, 'HEAD')",
        ['commit_5h']
      );
      expect(result.changes).toEqual([]);
      expect(result.summary.total).toBe(0);
      expect(result.since).toBe(fiveHoursAgo.toISOString());
    });

    it('should classify diff_type=added as created', async () => {
      const svc = await createConnectedService();
      const now = new Date();
      const thirtyHoursAgo = new Date(now.getTime() - 30 * 60 * 60 * 1000);

      mockExecute
        .mockResolvedValueOnce([[{ commit_hash: 'old', date: thirtyHoursAgo, message: 'old' }], []])
        .mockResolvedValueOnce([[{ diff_type: 'added', to_id: 'i-new', to_title: 'New', to_status: 'open', from_id: null, from_title: null, from_status: null, to_updated_at: now.toISOString(), from_updated_at: null }], []]);

      const result = await svc.getRecentActivityFromDolt(24);

      expect(result.changes[0].action).toBe('created');
      expect(result.changes[0].id).toBe('i-new');
    });

    it('should classify modified + to_status=closed as closed', async () => {
      const svc = await createConnectedService();
      const now = new Date();
      const thirtyHoursAgo = new Date(now.getTime() - 30 * 60 * 60 * 1000);

      mockExecute
        .mockResolvedValueOnce([[{ commit_hash: 'old', date: thirtyHoursAgo, message: 'old' }], []])
        .mockResolvedValueOnce([[{ diff_type: 'modified', to_id: 'i-closed', to_title: 'Closed', to_status: 'closed', from_id: 'i-closed', from_title: 'Closed', from_status: 'in-progress', to_updated_at: now.toISOString(), from_updated_at: null }], []]);

      const result = await svc.getRecentActivityFromDolt(24);

      expect(result.changes[0].action).toBe('closed');
    });

    it('should classify modified with other status as updated', async () => {
      const svc = await createConnectedService();
      const now = new Date();
      const thirtyHoursAgo = new Date(now.getTime() - 30 * 60 * 60 * 1000);

      mockExecute
        .mockResolvedValueOnce([[{ commit_hash: 'old', date: thirtyHoursAgo, message: 'old' }], []])
        .mockResolvedValueOnce([[{ diff_type: 'modified', to_id: 'i-upd', to_title: 'Updated', to_status: 'in-progress', from_id: 'i-upd', from_title: 'Updated', from_status: 'open', to_updated_at: now.toISOString(), from_updated_at: null }], []]);

      const result = await svc.getRecentActivityFromDolt(24);

      expect(result.changes[0].action).toBe('updated');
    });

    it('should populate byStatus counts', async () => {
      const svc = await createConnectedService();
      const now = new Date();
      const thirtyHoursAgo = new Date(now.getTime() - 30 * 60 * 60 * 1000);

      mockExecute
        .mockResolvedValueOnce([[{ commit_hash: 'old', date: thirtyHoursAgo, message: 'old' }], []])
        .mockResolvedValueOnce([[
          { diff_type: 'added', to_id: 'i-1', to_title: 'A', to_status: 'open', from_id: null, from_title: null, from_status: null, to_updated_at: now.toISOString(), from_updated_at: null },
          { diff_type: 'added', to_id: 'i-2', to_title: 'B', to_status: 'open', from_id: null, from_title: null, from_status: null, to_updated_at: now.toISOString(), from_updated_at: null },
          { diff_type: 'modified', to_id: 'i-3', to_title: 'C', to_status: 'closed', from_id: 'i-3', from_title: 'C', from_status: 'open', to_updated_at: now.toISOString(), from_updated_at: null },
        ], []]);

      const result = await svc.getRecentActivityFromDolt(24);

      expect(result.byStatus.open).toBe(2);
      expect(result.byStatus.closed).toBe(1);
    });

    it('should accept custom hoursAgo parameter', async () => {
      const svc = await createConnectedService();
      const now = new Date();
      const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000);
      const tenHoursAgo = new Date(now.getTime() - 10 * 60 * 60 * 1000);

      const commitLogRows = [
        { commit_hash: 'commit_5h', date: fiveHoursAgo, message: 'Recent' },
        { commit_hash: 'commit_10h', date: tenHoursAgo, message: 'Older' },
      ];

      mockExecute
        .mockResolvedValueOnce([commitLogRows, []])
        .mockResolvedValueOnce([[], []]);

      // 8 hours ago — should pick commit_10h (the first commit older than 8h)
      const result = await svc.getRecentActivityFromDolt(8);

      expect(mockExecute).toHaveBeenCalledWith(
        "SELECT * FROM dolt_diff('issues', ?, 'HEAD')",
        ['commit_10h']
      );
    });

    it('should throw if not connected', async () => {
      const svc = new DoltQueryService();
      await expect(svc.getRecentActivityFromDolt()).rejects.toThrow('not connected');
    });
  });

  // ----------------------------------------------------------
  // Error handling
  // ----------------------------------------------------------
  describe('error handling', () => {
    it('should propagate database errors from execute', async () => {
      const svc = await createConnectedService();
      mockExecute.mockRejectedValue(new Error('Connection refused'));

      await expect(svc.getStatusCounts()).rejects.toThrow('Connection refused');
    });

    it('should propagate errors from getIssueById', async () => {
      const svc = await createConnectedService();
      mockExecute.mockRejectedValue(new Error('Table not found'));

      await expect(svc.getIssueById('test')).rejects.toThrow('Table not found');
    });

    it('should propagate errors from disconnect', async () => {
      const svc = await createConnectedService();
      mockEnd.mockRejectedValue(new Error('Pool end failed'));

      await expect(svc.disconnect()).rejects.toThrow('Pool end failed');
    });

    it('should throw when calling methods without connect', async () => {
      const svc = new DoltQueryService();

      await expect(svc.getStatusCounts()).rejects.toThrow('not connected');
      await expect(svc.getOpenByPriority()).rejects.toThrow('not connected');
      await expect(svc.getIssueById('x')).rejects.toThrow('not connected');
      await expect(svc.getIssuesByStatus('open')).rejects.toThrow('not connected');
      await expect(svc.getRecentChanges('abc')).rejects.toThrow('not connected');
      await expect(svc.getCurrentCommitHash()).rejects.toThrow('not connected');
      await expect(svc.getCommitLog()).rejects.toThrow('not connected');
      await expect(svc.queryAsOf('abc', 'SELECT 1')).rejects.toThrow('not connected');
      await expect(svc.getRecentActivityFromDolt()).rejects.toThrow('not connected');
    });
  });
});
