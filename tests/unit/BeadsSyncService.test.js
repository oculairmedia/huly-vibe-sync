/**
 * Unit Tests for BeadsSyncService
 *
 * Tests the high-level sync orchestration functions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockBeadsIssue, createSyncPair } from '../mocks/beadsMocks.js';

// Mock child_process before importing
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

describe('BeadsSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('module exports', () => {
    it('should export syncHulyIssueToBeads', async () => {
      const { syncHulyIssueToBeads } = await import('../../lib/BeadsSyncService.js');
      expect(syncHulyIssueToBeads).toBeDefined();
      expect(typeof syncHulyIssueToBeads).toBe('function');
    });

    it('should export syncBeadsIssueToHuly', async () => {
      const { syncBeadsIssueToHuly } = await import('../../lib/BeadsSyncService.js');
      expect(syncBeadsIssueToHuly).toBeDefined();
      expect(typeof syncBeadsIssueToHuly).toBe('function');
    });

    it('should export syncBeadsToGit', async () => {
      const { syncBeadsToGit } = await import('../../lib/BeadsSyncService.js');
      expect(syncBeadsToGit).toBeDefined();
      expect(typeof syncBeadsToGit).toBe('function');
    });

    it('should export batchSyncHulyToBeads', async () => {
      const { batchSyncHulyToBeads } = await import('../../lib/BeadsSyncService.js');
      expect(batchSyncHulyToBeads).toBeDefined();
      expect(typeof batchSyncHulyToBeads).toBe('function');
    });

    it('should export batchSyncBeadsToHuly', async () => {
      const { batchSyncBeadsToHuly } = await import('../../lib/BeadsSyncService.js');
      expect(batchSyncBeadsToHuly).toBeDefined();
      expect(typeof batchSyncBeadsToHuly).toBe('function');
    });

    it('should export fullBidirectionalSync', async () => {
      const { fullBidirectionalSync } = await import('../../lib/BeadsSyncService.js');
      expect(fullBidirectionalSync).toBeDefined();
      expect(typeof fullBidirectionalSync).toBe('function');
    });
  });

  describe('batchSyncHulyToBeads', () => {
    const createMockDb = () => ({
      getIssue: vi.fn(() => null),
      getAllIssues: vi.fn(() => []),
      upsertIssue: vi.fn(),
    });

    it('should return result summary for empty input', async () => {
      const { batchSyncHulyToBeads } = await import('../../lib/BeadsSyncService.js');
      const db = createMockDb();

      const result = await batchSyncHulyToBeads('/test/project', [], [], db, {});

      expect(result).toEqual({
        synced: 0,
        skipped: 0,
        errors: 0,
        errorMessages: [],
      });
    });

    it('should count synced issues', async () => {
      const { batchSyncHulyToBeads } = await import('../../lib/BeadsSyncService.js');
      const db = createMockDb();

      // Mock successful create
      const createdIssue = createMockBeadsIssue({ id: 'beads-new' });
      mockExecSync.mockReturnValue(JSON.stringify(createdIssue));

      const hulyIssues = [
        {
          identifier: 'TEST-1',
          title: 'Issue 1',
          status: 'Todo',
          priority: 'Medium',
          project: 'TEST',
        },
      ];

      const result = await batchSyncHulyToBeads('/test/project', hulyIssues, [], db, {});

      expect(result.synced).toBe(1);
      expect(result.errors).toBe(0);
    });

    it('should handle errors gracefully', async () => {
      const { batchSyncHulyToBeads } = await import('../../lib/BeadsSyncService.js');
      const db = createMockDb();

      mockExecSync.mockImplementation(() => {
        throw new Error('CLI error');
      });

      const hulyIssues = [
        {
          identifier: 'TEST-1',
          title: 'Issue 1',
          status: 'Todo',
          priority: 'Medium',
          project: 'TEST',
        },
      ];

      const result = await batchSyncHulyToBeads('/test/project', hulyIssues, [], db, {});

      // Should track errors but not throw
      expect(result.synced).toBe(0);
      expect(result.skipped).toBe(1); // Returns null on error = skipped
    });
  });

  describe('batchSyncBeadsToHuly', () => {
    const createMockDb = () => ({
      getIssue: vi.fn(() => null),
      getAllIssues: vi.fn(() => []),
      upsertIssue: vi.fn(),
      markDeletedFromHuly: vi.fn(),
      isDeletedFromHuly: vi.fn(() => false),
    });

    const createMockHulyClient = () => ({
      createIssue: vi.fn().mockResolvedValue({ identifier: 'TEST-NEW' }),
      patchIssue: vi.fn().mockResolvedValue(true),
      getIssue: vi.fn().mockResolvedValue(null),
    });

    it('should return result summary for empty input', async () => {
      const { batchSyncBeadsToHuly } = await import('../../lib/BeadsSyncService.js');
      const db = createMockDb();
      const hulyClient = createMockHulyClient();

      const result = await batchSyncBeadsToHuly(
        hulyClient,
        '/test/project',
        [],
        [],
        'TEST',
        db,
        {}
      );

      expect(result).toEqual({
        synced: 0,
        skipped: 0,
        errors: 0,
        errorMessages: [],
      });
    });

    it('should process beads issues', async () => {
      const { batchSyncBeadsToHuly } = await import('../../lib/BeadsSyncService.js');
      const db = createMockDb();
      const hulyClient = createMockHulyClient();

      const beadsIssues = [createMockBeadsIssue({ id: 'beads-1', title: 'Beads Issue 1' })];

      const result = await batchSyncBeadsToHuly(
        hulyClient,
        '/test/project',
        beadsIssues,
        [],
        'TEST',
        db,
        {}
      );

      expect(result.synced).toBe(1);
    });
  });

  describe('fullBidirectionalSync', () => {
    const createMockDb = () => ({
      getIssue: vi.fn(() => null),
      getAllIssues: vi.fn(() => []),
      upsertIssue: vi.fn(),
    });

    const createMockHulyClient = () => ({
      createIssue: vi.fn().mockResolvedValue({ identifier: 'TEST-NEW' }),
      patchIssue: vi.fn().mockResolvedValue(true),
    });

    it('should return combined results', async () => {
      const { fullBidirectionalSync } = await import('../../lib/BeadsSyncService.js');
      const db = createMockDb();
      const hulyClient = createMockHulyClient();

      const result = await fullBidirectionalSync(hulyClient, '/test/project', [], [], 'TEST', db, {
        sync: { dryRun: true },
      });

      expect(result).toHaveProperty('hulyToBeads');
      expect(result).toHaveProperty('beadsToHuly');
      expect(result).toHaveProperty('gitSync');
      expect(result).toHaveProperty('timestamp');
    });

    it('should skip git sync in dry run mode', async () => {
      const { fullBidirectionalSync } = await import('../../lib/BeadsSyncService.js');
      const db = createMockDb();
      const hulyClient = createMockHulyClient();

      const result = await fullBidirectionalSync(hulyClient, '/test/project', [], [], 'TEST', db, {
        sync: { dryRun: true },
      });

      expect(result.gitSync).toBe(false);
    });
  });

  describe('deletion protection', () => {
    it('should mark issue as deleted when Huly API returns null', async () => {
      const { syncBeadsIssueToHuly } = await import('../../lib/BeadsSyncService.js');

      const db = {
        getIssue: vi.fn(() => null),
        getAllIssues: vi.fn(() => [
          { identifier: 'TEST-1', beads_issue_id: 'beads-orphan', deleted_from_huly: 0 },
        ]),
        upsertIssue: vi.fn(),
        markDeletedFromHuly: vi.fn(),
      };

      const hulyClient = {
        getIssue: vi.fn().mockResolvedValue(null),
        createIssue: vi.fn(),
        patchIssue: vi.fn(),
      };

      const beadsIssue = createMockBeadsIssue({ id: 'beads-orphan', title: 'Orphaned Issue' });

      await syncBeadsIssueToHuly(
        hulyClient,
        '/test/project',
        beadsIssue,
        [],
        'TEST',
        db,
        {},
        new Set()
      );

      expect(db.markDeletedFromHuly).toHaveBeenCalledWith('TEST-1');
    });
  });
});
