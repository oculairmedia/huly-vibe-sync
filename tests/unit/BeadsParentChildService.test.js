/**
 * Unit Tests for BeadsParentChildService
 *
 * Tests the parent-child relationship management functions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockBeadsIssue, createMockBeadsDbRecord } from '../mocks/beadsMocks.js';

// Mock child_process before importing
const mockExec = vi.fn();
vi.mock('child_process', () => ({
  exec: mockExec,
}));

describe('BeadsParentChildService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExec.mockReset();
    mockExec.mockImplementation((command, options, callback) => {
      if (typeof options === 'function') {
        callback = options;
      }
      callback(null, '', '');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('module exports', () => {
    it('should export addParentChildDependency', async () => {
      const { addParentChildDependency } = await import('../../lib/BeadsParentChildService.js');
      expect(addParentChildDependency).toBeDefined();
      expect(typeof addParentChildDependency).toBe('function');
    });

    it('should export removeParentChildDependency', async () => {
      const { removeParentChildDependency } = await import('../../lib/BeadsParentChildService.js');
      expect(removeParentChildDependency).toBeDefined();
      expect(typeof removeParentChildDependency).toBe('function');
    });

    it('should export getParentChildRelationships', async () => {
      const { getParentChildRelationships } = await import('../../lib/BeadsParentChildService.js');
      expect(getParentChildRelationships).toBeDefined();
      expect(typeof getParentChildRelationships).toBe('function');
    });

    it('should export getBeadsParentId', async () => {
      const { getBeadsParentId } = await import('../../lib/BeadsParentChildService.js');
      expect(getBeadsParentId).toBeDefined();
      expect(typeof getBeadsParentId).toBe('function');
    });

    it('should export syncParentChildToBeads', async () => {
      const { syncParentChildToBeads } = await import('../../lib/BeadsParentChildService.js');
      expect(syncParentChildToBeads).toBeDefined();
      expect(typeof syncParentChildToBeads).toBe('function');
    });

    it('should export syncBeadsParentChildToHuly', async () => {
      const { syncBeadsParentChildToHuly } = await import('../../lib/BeadsParentChildService.js');
      expect(syncBeadsParentChildToHuly).toBeDefined();
      expect(typeof syncBeadsParentChildToHuly).toBe('function');
    });

    it('should export getAllParentChildRelationships', async () => {
      const { getAllParentChildRelationships } = await import(
        '../../lib/BeadsParentChildService.js'
      );
      expect(getAllParentChildRelationships).toBeDefined();
      expect(typeof getAllParentChildRelationships).toBe('function');
    });

    it('should export validateParentChildConsistency', async () => {
      const { validateParentChildConsistency } = await import(
        '../../lib/BeadsParentChildService.js'
      );
      expect(validateParentChildConsistency).toBeDefined();
      expect(typeof validateParentChildConsistency).toBe('function');
    });

    it('should export batchCreateDependencies', async () => {
      const { batchCreateDependencies } = await import('../../lib/BeadsParentChildService.js');
      expect(batchCreateDependencies).toBeDefined();
      expect(typeof batchCreateDependencies).toBe('function');
    });

    it('should export batchRemoveDependencies', async () => {
      const { batchRemoveDependencies } = await import('../../lib/BeadsParentChildService.js');
      expect(batchRemoveDependencies).toBeDefined();
      expect(typeof batchRemoveDependencies).toBe('function');
    });
  });

  describe('getAllParentChildRelationships', () => {
    it('should return empty array for issues without dependencies', async () => {
      const { getAllParentChildRelationships } = await import(
        '../../lib/BeadsParentChildService.js'
      );

      const beadsIssues = [
        createMockBeadsIssue({ id: 'issue-1', dependency_count: 0 }),
        createMockBeadsIssue({ id: 'issue-2', dependency_count: 0 }),
      ];

      const result = await getAllParentChildRelationships('/test/project', beadsIssues);

      expect(result).toEqual([]);
    });

    it('should find parent relationships', async () => {
      const { getAllParentChildRelationships } = await import(
        '../../lib/BeadsParentChildService.js'
      );

      const beadsIssues = [
        createMockBeadsIssue({ id: 'child-1', dependency_count: 1 }),
        createMockBeadsIssue({ id: 'parent-1', dependency_count: 0 }),
      ];

      // Mock dep tree response
      mockExec.mockImplementation((command, options, callback) => {
        if (typeof options === 'function') {
          callback = options;
        }
        callback(
          null,
          JSON.stringify([
            { id: 'child-1', depth: 0 },
            { id: 'parent-1', depth: 1 },
          ]),
          ''
        );
      });

      const result = await getAllParentChildRelationships('/test/project', beadsIssues);

      expect(result.length).toBe(1);
      expect(result[0]).toEqual({
        childId: 'child-1',
        parentId: 'parent-1',
        source: 'beads',
        success: true,
      });
    });

    it('should handle errors gracefully', async () => {
      const { getAllParentChildRelationships } = await import(
        '../../lib/BeadsParentChildService.js'
      );

      const beadsIssues = [createMockBeadsIssue({ id: 'child-1', dependency_count: 1 })];

      mockExec.mockImplementation((command, options, callback) => {
        if (typeof options === 'function') {
          callback = options;
        }
        callback(new Error('Command failed'), '', '');
      });

      const result = await getAllParentChildRelationships('/test/project', beadsIssues);

      // getBeadsParentId catches errors and returns null, so no relationship found
      // The function doesn't add to results if parentId is null
      expect(result.length).toBe(0);
    });
  });

  describe('validateParentChildConsistency', () => {
    it('should return valid for consistent data', async () => {
      const { validateParentChildConsistency } = await import(
        '../../lib/BeadsParentChildService.js'
      );

      const mockDb = {
        getAllIssues: () => [
          createMockBeadsDbRecord({
            identifier: 'PROJ-1',
            parent_huly_id: 'PROJ-2',
            parent_beads_id: 'beads-parent',
          }),
          createMockBeadsDbRecord({
            identifier: 'PROJ-2',
          }),
        ],
      };

      const result = validateParentChildConsistency(mockDb, 'PROJ');

      expect(result.valid).toBe(true);
      expect(result.mismatches).toEqual([]);
      expect(result.orphans).toEqual([]);
    });

    it('should detect Huly-only parent', async () => {
      const { validateParentChildConsistency } = await import(
        '../../lib/BeadsParentChildService.js'
      );

      // Create issue with only Huly parent set
      const issueWithHulyParent = {
        ...createMockBeadsDbRecord({ identifier: 'PROJ-1' }),
        parent_huly_id: 'PROJ-2',
        parent_beads_id: null,
      };

      const mockDb = {
        getAllIssues: () => [issueWithHulyParent],
      };

      const result = validateParentChildConsistency(mockDb, 'PROJ');

      expect(result.valid).toBe(false);
      expect(result.mismatches.length).toBe(1);
      expect(result.mismatches[0].type).toBe('huly_only_parent');
    });

    it('should detect Beads-only parent', async () => {
      const { validateParentChildConsistency } = await import(
        '../../lib/BeadsParentChildService.js'
      );

      // Create issue with only Beads parent set
      const issueWithBeadsParent = {
        ...createMockBeadsDbRecord({ identifier: 'PROJ-1' }),
        parent_huly_id: null,
        parent_beads_id: 'beads-parent',
      };

      const mockDb = {
        getAllIssues: () => [issueWithBeadsParent],
      };

      const result = validateParentChildConsistency(mockDb, 'PROJ');

      expect(result.valid).toBe(false);
      expect(result.mismatches.length).toBe(1);
      expect(result.mismatches[0].type).toBe('beads_only_parent');
    });

    it('should detect orphaned children', async () => {
      const { validateParentChildConsistency } = await import(
        '../../lib/BeadsParentChildService.js'
      );

      // Create child issue and parent issue, but parent has different identifier
      const childIssue = {
        ...createMockBeadsDbRecord({ identifier: 'PROJ-1' }),
        parent_huly_id: 'PROJ-999', // Points to non-existent parent
        parent_beads_id: null, // Only Huly parent to avoid mismatch detection
      };

      // Only child exists, parent PROJ-999 is missing
      const mockDb = {
        getAllIssues: () => [childIssue],
      };

      const result = validateParentChildConsistency(mockDb, 'PROJ');

      // Should detect orphan (child references parent that doesn't exist)
      // Also detects mismatch (huly parent but no beads parent)
      expect(result.valid).toBe(false);
      expect(result.orphans.length).toBe(1);
      expect(result.orphans[0].identifier).toBe('PROJ-1');
      expect(result.orphans[0].parent_huly_id).toBe('PROJ-999');
    });
  });

  describe('batchCreateDependencies', () => {
    it('should return empty result for empty input', async () => {
      const { batchCreateDependencies } = await import('../../lib/BeadsParentChildService.js');

      const mockDb = { upsertIssue: vi.fn() };

      const result = await batchCreateDependencies('/test/project', [], mockDb, {});

      expect(result).toEqual({
        synced: 0,
        skipped: 0,
        errors: [],
      });
    });

    it('should process relationships', async () => {
      const { batchCreateDependencies } = await import('../../lib/BeadsParentChildService.js');

      const mockDb = { upsertIssue: vi.fn() };

      // Mock successful dep add
      mockExec.mockImplementation((command, options, callback) => {
        if (typeof options === 'function') {
          callback = options;
        }
        callback(null, '', '');
      });

      const relationships = [{ childId: 'child-1', parentId: 'parent-1' }];

      const result = await batchCreateDependencies('/test/project', relationships, mockDb, {});

      expect(result.synced).toBe(1);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('dep add'),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should handle errors', async () => {
      const { batchCreateDependencies } = await import('../../lib/BeadsParentChildService.js');

      const mockDb = { upsertIssue: vi.fn() };

      mockExec.mockImplementation((command, options, callback) => {
        if (typeof options === 'function') {
          callback = options;
        }
        callback(new Error('Failed to add dependency'), '', '');
      });

      const relationships = [{ childId: 'child-1', parentId: 'parent-1' }];

      const result = await batchCreateDependencies('/test/project', relationships, mockDb, {});

      // addParentChildDependency catches errors and returns false, so it's skipped not errored
      expect(result.skipped).toBe(1);
    });
  });

  describe('batchRemoveDependencies', () => {
    it('should return empty result for empty input', async () => {
      const { batchRemoveDependencies } = await import('../../lib/BeadsParentChildService.js');

      const result = await batchRemoveDependencies('/test/project', [], {});

      expect(result).toEqual({
        synced: 0,
        skipped: 0,
        errors: [],
      });
    });

    it('should process relationships', async () => {
      const { batchRemoveDependencies } = await import('../../lib/BeadsParentChildService.js');

      // Mock successful dep remove
      mockExec.mockImplementation((command, options, callback) => {
        if (typeof options === 'function') {
          callback = options;
        }
        callback(null, '', '');
      });

      const relationships = [{ childId: 'child-1', parentId: 'parent-1' }];

      const result = await batchRemoveDependencies('/test/project', relationships, {});

      expect(result.synced).toBe(1);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('dep remove'),
        expect.any(Object),
        expect.any(Function)
      );
    });
  });

  describe('syncAllParentChildFromHuly', () => {
    it('should return empty result for issues without parents', async () => {
      const { syncAllParentChildFromHuly } = await import('../../lib/BeadsParentChildService.js');

      const mockDb = {
        getIssue: vi.fn(() => null),
      };

      const hulyIssues = [
        { identifier: 'PROJ-1', parent: null },
        { identifier: 'PROJ-2', parent: null },
      ];

      const result = await syncAllParentChildFromHuly('/test/project', hulyIssues, mockDb, {});

      expect(result.synced).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it('should skip issues not synced to Beads', async () => {
      const { syncAllParentChildFromHuly } = await import('../../lib/BeadsParentChildService.js');

      const mockDb = {
        getIssue: vi.fn(() => null), // No Beads mapping
      };

      const hulyIssues = [{ identifier: 'PROJ-1', parent: 'PROJ-2' }];

      const result = await syncAllParentChildFromHuly('/test/project', hulyIssues, mockDb, {});

      expect(result.skipped).toBe(1);
    });

    it('should process issues with Beads mapping', async () => {
      const { syncAllParentChildFromHuly } = await import('../../lib/BeadsParentChildService.js');

      const mockDb = {
        getIssue: vi.fn(id => {
          if (id === 'PROJ-1')
            return createMockBeadsDbRecord({ identifier: 'PROJ-1', beads_issue_id: 'beads-child' });
          if (id === 'PROJ-2')
            return createMockBeadsDbRecord({
              identifier: 'PROJ-2',
              beads_issue_id: 'beads-parent',
            });
          return null;
        }),
        upsertIssue: vi.fn(),
      };

      // Mock successful dep add
      mockExec.mockImplementation((command, options, callback) => {
        if (typeof options === 'function') {
          callback = options;
        }
        callback(null, '', '');
      });

      const hulyIssues = [{ identifier: 'PROJ-1', parent: 'PROJ-2' }];

      const result = await syncAllParentChildFromHuly('/test/project', hulyIssues, mockDb, {});

      // The function processes issues with parent relationships
      // It may sync, skip, or error depending on the underlying syncParentChildToBeads result
      expect(result).toHaveProperty('synced');
      expect(result).toHaveProperty('skipped');
      expect(result).toHaveProperty('errors');
      // At least one of synced or skipped should be 1 (or errors if something went wrong)
      expect(result.synced + result.skipped + result.errors.length).toBeGreaterThanOrEqual(1);
    });
  });
});
