/**
 * Unit Tests for BeadsSyncService
 *
 * Comprehensive tests covering:
 * - syncHulyIssueToBeads (create, link, update, conflict resolution, reparenting)
 * - syncBeadsIssueToHuly (skip logic, create, link, update, vibe cascade, reparenting)
 * - syncBeadsToGit (init checks, sync, push, error recovery)
 * - batchSyncHulyToBeads (batch processing, counters)
 * - batchSyncBeadsToHuly (pre-fetch, batch processing)
 * - fullBidirectionalSync (3-phase orchestration)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createMockBeadsIssue,
  createSyncPair,
  createMockBeadsDbRecord,
  MOCK_CONFIG,
} from '../mocks/beadsMocks.js';

// ── Mock all external dependencies ──────────────────────────

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    default: { ...actual, existsSync: vi.fn(() => true) },
    existsSync: vi.fn(() => true),
  };
});

vi.mock('../../lib/statusMapper.js', () => ({
  mapHulyStatusToBeads: vi.fn(status => {
    const map = {
      Backlog: { status: 'open', label: null },
      'In Progress': { status: 'in_progress', label: null },
      Done: { status: 'closed', label: null },
      'In Review': { status: 'open', label: 'review' },
      Testing: { status: 'open', label: 'testing' },
      Blocked: { status: 'blocked', label: 'blocked' },
    };
    return map[status] || { status: 'open', label: null };
  }),
  mapHulyPriorityToBeads: vi.fn(priority => {
    const map = { Urgent: 0, High: 1, Medium: 2, Low: 3, None: 4 };
    return map[priority] ?? 2;
  }),
  mapHulyTypeToBeads: vi.fn(() => 'task'),
  getHulyStatusLabels: vi.fn(() => ['review', 'testing', 'blocked', 'deferred']),
  mapBeadsStatusToHuly: vi.fn(status => {
    const map = { open: 'Backlog', in_progress: 'In Progress', closed: 'Done', blocked: 'Blocked' };
    return map[status] || 'Backlog';
  }),
  mapBeadsPriorityToHuly: vi.fn(priority => {
    const map = { 0: 'Urgent', 1: 'High', 2: 'Medium', 3: 'Low', 4: 'None' };
    return map[priority] || 'Medium';
  }),
  mapBeadsTypeToHuly: vi.fn(() => 'Task'),
  mapBeadsStatusToVibe: vi.fn(() => 'todo'),
}));

vi.mock('../../lib/HulyService.js', () => ({
  updateHulyIssueStatus: vi.fn(async () => true),
  updateHulyIssueTitle: vi.fn(async () => true),
  updateHulyIssuePriority: vi.fn(async () => true),
  createHulyIssue: vi.fn(async () => ({ identifier: 'NEW-1', id: 'new-huly-id' })),
}));

vi.mock('../../lib/VibeService.js', () => ({
  updateVibeTaskStatus: vi.fn(async () => true),
}));

vi.mock('../../lib/textParsers.js', () => ({
  extractHulyIdentifier: vi.fn(() => null),
}));

vi.mock('../../lib/BeadsService.js', () => ({
  createBeadsIssue: vi.fn(async () => ({
    id: 'new-beads-id',
    updated_at: new Date().toISOString(),
  })),
  updateBeadsIssue: vi.fn(async () => true),
  updateBeadsIssueStatusWithLabel: vi.fn(async () => true),
  isBeadsInitialized: vi.fn(() => true),
  isGitRepository: vi.fn(() => true),
  execBeadsCommand: vi.fn(() => ''),
  execGitCommand: vi.fn(() => ''),
  beadsWorkingTreeDirty: vi.fn(() => false),
  commitBeadsSyncFiles: vi.fn(() => true),
  syncParentChildToBeads: vi.fn(async () => {}),
  addParentChildDependency: vi.fn(async () => {}),
  removeParentChildDependency: vi.fn(async () => {}),
  getBeadsParentId: vi.fn(async () => null),
}));

vi.mock('../../lib/BeadsDBReader.js', () => ({
  findHulyIdentifier: vi.fn(() => null),
  buildIssueLookups: vi.fn(() => ({
    byHulyId: new Map(),
    byTitle: new Map(),
    byBeadsId: new Map(),
    parentMap: new Map(),
  })),
  getParentIdFromLookup: vi.fn(() => null),
}));

// ── Import module under test and mocked deps ────────────────

const {
  syncHulyIssueToBeads,
  syncBeadsIssueToHuly,
  syncBeadsToGit,
  batchSyncHulyToBeads,
  batchSyncBeadsToHuly,
  fullBidirectionalSync,
} = await import('../../lib/BeadsSyncService.js');

import {
  createBeadsIssue,
  updateBeadsIssue,
  updateBeadsIssueStatusWithLabel,
  isBeadsInitialized,
  isGitRepository,
  execBeadsCommand,
  execGitCommand,
  beadsWorkingTreeDirty,
  commitBeadsSyncFiles,
  syncParentChildToBeads,
  addParentChildDependency,
  removeParentChildDependency,
} from '../../lib/BeadsService.js';

import {
  updateHulyIssueStatus,
  updateHulyIssueTitle,
  updateHulyIssuePriority,
  createHulyIssue,
} from '../../lib/HulyService.js';

import { updateVibeTaskStatus } from '../../lib/VibeService.js';
import { extractHulyIdentifier } from '../../lib/textParsers.js';
import { mapBeadsStatusToVibe } from '../../lib/statusMapper.js';
import {
  findHulyIdentifier,
  buildIssueLookups,
  getParentIdFromLookup,
} from '../../lib/BeadsDBReader.js';

// ── Helpers ─────────────────────────────────────────────────

function createMockDb(issues = []) {
  const issueMap = new Map(issues.map(i => [i.identifier, i]));
  return {
    getIssue: vi.fn(id => issueMap.get(id) || null),
    getAllIssues: vi.fn(() => issues),
    upsertIssue: vi.fn(),
    markDeletedFromHuly: vi.fn(),
    updateParentChild: vi.fn(),
  };
}

function createHulyIssue_(overrides = {}) {
  return {
    identifier: 'TEST-1',
    id: 'huly-id-1',
    title: 'Test Issue',
    status: 'Backlog',
    priority: 'Medium',
    type: 'Task',
    description: 'A test issue',
    modifiedOn: Date.now(),
    project: 'TEST',
    ...overrides,
  };
}

function makeHulyClient(overrides = {}) {
  return {
    getIssue: vi.fn(async () => null),
    getIssuesBulk: vi.fn(async () => []),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('BeadsSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================
  // syncHulyIssueToBeads
  // ========================================================
  describe('syncHulyIssueToBeads', () => {
    it('creates new beads issue when no existing match', async () => {
      const hulyIssue = createHulyIssue_();
      const db = createMockDb();

      const result = await syncHulyIssueToBeads('/proj', hulyIssue, [], db, {});

      expect(createBeadsIssue).toHaveBeenCalledWith(
        '/proj',
        expect.objectContaining({ title: 'Test Issue' }),
        {}
      );
      expect(result).toEqual(expect.objectContaining({ id: 'new-beads-id' }));
      expect(db.upsertIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'TEST-1',
          beads_issue_id: 'new-beads-id',
        })
      );
    });

    it('links existing beads issue found by title match (no lookups)', async () => {
      const hulyIssue = createHulyIssue_({ title: 'My Task' });
      const beadsIssue = createMockBeadsIssue({ id: 'beads-existing', title: 'My Task' });
      const db = createMockDb();

      const result = await syncHulyIssueToBeads('/proj', hulyIssue, [beadsIssue], db, {});

      expect(createBeadsIssue).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: 'beads-existing' }));
      expect(db.upsertIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'TEST-1',
          beads_issue_id: 'beads-existing',
        })
      );
    });

    it('links existing beads issue found by huly identifier (no lookups)', async () => {
      const hulyIssue = createHulyIssue_({ title: 'Unique Title ABC' });
      const beadsIssue = createMockBeadsIssue({ id: 'beads-linked', title: 'Different Title' });
      const db = createMockDb();
      findHulyIdentifier.mockReturnValueOnce('TEST-1');

      const result = await syncHulyIssueToBeads('/proj', hulyIssue, [beadsIssue], db, {});

      expect(createBeadsIssue).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: 'beads-linked' }));
    });

    it('links via lookup maps (config.lookups byHulyId)', async () => {
      const hulyIssue = createHulyIssue_();
      const beadsIssue = createMockBeadsIssue({ id: 'beads-lookup' });
      const db = createMockDb();
      const lookups = {
        byHulyId: new Map([['TEST-1', beadsIssue]]),
        byTitle: new Map(),
      };

      const result = await syncHulyIssueToBeads('/proj', hulyIssue, [], db, { lookups });

      expect(createBeadsIssue).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: 'beads-lookup' }));
    });

    it('links via lookup title map when hulyId not found', async () => {
      const hulyIssue = createHulyIssue_({ title: 'Lookup Title' });
      const beadsIssue = createMockBeadsIssue({ id: 'beads-title-lookup' });
      const db = createMockDb();
      const lookups = {
        byHulyId: new Map(),
        byTitle: new Map([['lookup title', beadsIssue]]),
      };

      const result = await syncHulyIssueToBeads('/proj', hulyIssue, [], db, { lookups });

      expect(createBeadsIssue).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: 'beads-title-lookup' }));
    });

    it('updates status when Huly changed since last seen', async () => {
      const now = Date.now();
      const hulyIssue = createHulyIssue_({ status: 'In Progress', modifiedOn: now });
      const beadsIssue = createMockBeadsIssue({
        id: 'beads-1',
        title: 'Test Issue',
        status: 'open',
        priority: 2,
        updated_at: new Date(now - 10000).toISOString(),
      });
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-1',
        beads_issue_id: 'beads-1',
        huly_modified_at: now - 5000,
        beads_modified_at: now - 10000,
      });
      const db = createMockDb([dbRecord]);

      const result = await syncHulyIssueToBeads('/proj', hulyIssue, [beadsIssue], db, {});

      expect(updateBeadsIssueStatusWithLabel).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: 'beads-1' }));
    });

    it('updates priority when mismatched', async () => {
      const now = Date.now();
      const hulyIssue = createHulyIssue_({ priority: 'High', modifiedOn: now });
      const beadsIssue = createMockBeadsIssue({
        id: 'beads-1',
        title: 'Test Issue',
        status: 'open',
        priority: 3,
        updated_at: new Date(now - 10000).toISOString(),
      });
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-1',
        beads_issue_id: 'beads-1',
        huly_modified_at: now - 5000,
        beads_modified_at: now - 10000,
      });
      const db = createMockDb([dbRecord]);

      await syncHulyIssueToBeads('/proj', hulyIssue, [beadsIssue], db, {});

      expect(updateBeadsIssue).toHaveBeenCalledWith('/proj', 'beads-1', 'priority', 1, {});
    });

    it('updates title when mismatched', async () => {
      const now = Date.now();
      const hulyIssue = createHulyIssue_({ title: 'New Title', modifiedOn: now });
      const beadsIssue = createMockBeadsIssue({
        id: 'beads-1',
        title: 'Old Title',
        status: 'open',
        priority: 2,
        updated_at: new Date(now - 10000).toISOString(),
      });
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-1',
        beads_issue_id: 'beads-1',
        huly_modified_at: now - 5000,
        beads_modified_at: now - 10000,
      });
      const db = createMockDb([dbRecord]);

      await syncHulyIssueToBeads('/proj', hulyIssue, [beadsIssue], db, {});

      expect(updateBeadsIssue).toHaveBeenCalledWith('/proj', 'beads-1', 'title', 'New Title', {});
    });

    it('returns null when nothing changed', async () => {
      const now = Date.now();
      const hulyIssue = createHulyIssue_({
        title: 'Same',
        status: 'Backlog',
        priority: 'Medium',
        modifiedOn: now,
      });
      const beadsIssue = createMockBeadsIssue({
        id: 'beads-1',
        title: 'Same',
        status: 'open',
        priority: 2,
        labels: [],
        updated_at: new Date(now - 10000).toISOString(),
      });
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-1',
        beads_issue_id: 'beads-1',
        huly_modified_at: now - 5000,
        beads_modified_at: now - 10000,
      });
      const db = createMockDb([dbRecord]);

      const result = await syncHulyIssueToBeads('/proj', hulyIssue, [beadsIssue], db, {});

      expect(result).toBeNull();
      expect(updateBeadsIssue).not.toHaveBeenCalled();
      expect(updateBeadsIssueStatusWithLabel).not.toHaveBeenCalled();
    });

    it('defers to Beads when Beads changed more recently (conflict resolution)', async () => {
      const now = Date.now();
      const hulyIssue = createHulyIssue_({
        title: 'Changed',
        status: 'In Progress',
        modifiedOn: now - 10000,
      });
      const beadsIssue = createMockBeadsIssue({
        id: 'beads-1',
        title: 'Changed',
        status: 'open',
        priority: 2,
        updated_at: new Date(now).toISOString(),
      });
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-1',
        beads_issue_id: 'beads-1',
        huly_modified_at: now - 10000, // Huly NOT changed since last seen
        beads_modified_at: now - 20000, // Beads HAS changed since last seen
      });
      const db = createMockDb([dbRecord]);

      const result = await syncHulyIssueToBeads('/proj', hulyIssue, [beadsIssue], db, {});

      expect(result).toBeNull();
      expect(updateBeadsIssueStatusWithLabel).not.toHaveBeenCalled();
    });

    it('Huly wins conflict when Huly is newer', async () => {
      const now = Date.now();
      const hulyIssue = createHulyIssue_({
        title: 'HulyChanged',
        status: 'Done',
        modifiedOn: now,
      });
      const beadsIssue = createMockBeadsIssue({
        id: 'beads-1',
        title: 'HulyChanged',
        status: 'open',
        priority: 2,
        updated_at: new Date(now - 1000).toISOString(),
      });
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-1',
        beads_issue_id: 'beads-1',
        huly_modified_at: now - 5000,
        beads_modified_at: now - 5000,
      });
      const db = createMockDb([dbRecord]);

      const result = await syncHulyIssueToBeads('/proj', hulyIssue, [beadsIssue], db, {});

      expect(result).toEqual(expect.objectContaining({ id: 'beads-1' }));
      expect(updateBeadsIssueStatusWithLabel).toHaveBeenCalled();
    });

    it('handles reparenting (parent changed)', async () => {
      const now = Date.now();
      const hulyIssue = createHulyIssue_({
        title: 'Child Changed',
        modifiedOn: now,
        parentIssue: { identifier: 'TEST-PARENT' },
      });
      const beadsIssue = createMockBeadsIssue({
        id: 'beads-child',
        title: 'Child',
        status: 'open',
        priority: 2,
        updated_at: new Date(now - 10000).toISOString(),
      });
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-1',
        beads_issue_id: 'beads-child',
        parent_huly_id: 'TEST-OLD-PARENT',
        huly_modified_at: now - 5000,
        beads_modified_at: now - 10000,
      });
      const oldParentDb = createMockBeadsDbRecord({
        identifier: 'TEST-OLD-PARENT',
        beads_issue_id: 'beads-old-parent',
      });
      const newParentDb = createMockBeadsDbRecord({
        identifier: 'TEST-PARENT',
        beads_issue_id: 'beads-new-parent',
      });
      const db = createMockDb([dbRecord, oldParentDb, newParentDb]);

      await syncHulyIssueToBeads('/proj', hulyIssue, [beadsIssue], db, {});

      expect(removeParentChildDependency).toHaveBeenCalledWith(
        '/proj',
        'beads-child',
        'beads-old-parent',
        {}
      );
      expect(addParentChildDependency).toHaveBeenCalledWith(
        '/proj',
        'beads-child',
        'beads-new-parent',
        {}
      );
      expect(db.updateParentChild).toHaveBeenCalledWith(
        'TEST-1',
        'TEST-PARENT',
        'beads-new-parent'
      );
    });

    it('handles reparenting to top-level (remove parent)', async () => {
      const now = Date.now();
      const hulyIssue = createHulyIssue_({
        title: 'Child Renamed',
        modifiedOn: now,
      });
      const beadsIssue = createMockBeadsIssue({
        id: 'beads-child',
        title: 'Child',
        status: 'open',
        priority: 2,
        updated_at: new Date(now - 10000).toISOString(),
      });
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-1',
        beads_issue_id: 'beads-child',
        parent_huly_id: 'TEST-OLD-PARENT',
        huly_modified_at: now - 5000,
        beads_modified_at: now - 10000,
      });
      const oldParentDb = createMockBeadsDbRecord({
        identifier: 'TEST-OLD-PARENT',
        beads_issue_id: 'beads-old-parent',
      });
      const db = createMockDb([dbRecord, oldParentDb]);

      await syncHulyIssueToBeads('/proj', hulyIssue, [beadsIssue], db, {});

      expect(removeParentChildDependency).toHaveBeenCalled();
      expect(db.updateParentChild).toHaveBeenCalledWith('TEST-1', null, null);
    });

    it('sets correct beads status on create (non-open statuses)', async () => {
      const hulyIssue = createHulyIssue_({ status: 'In Progress' });
      const db = createMockDb();

      await syncHulyIssueToBeads('/proj', hulyIssue, [], db, {});

      expect(createBeadsIssue).toHaveBeenCalled();
      expect(updateBeadsIssue).toHaveBeenCalledWith(
        '/proj',
        'new-beads-id',
        'status',
        'in_progress',
        {}
      );
    });

    it('does NOT update status when creating with open status', async () => {
      const hulyIssue = createHulyIssue_({ status: 'Backlog' });
      const db = createMockDb();

      await syncHulyIssueToBeads('/proj', hulyIssue, [], db, {});

      expect(createBeadsIssue).toHaveBeenCalled();
      expect(updateBeadsIssue).not.toHaveBeenCalled();
    });

    it('stores parent info in DB on create', async () => {
      const hulyIssue = createHulyIssue_({
        parentIssue: { identifier: 'TEST-PARENT' },
        subIssueCount: 3,
      });
      const db = createMockDb();

      await syncHulyIssueToBeads('/proj', hulyIssue, [], db, {});

      expect(db.upsertIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          parent_huly_id: 'TEST-PARENT',
          sub_issue_count: 3,
        })
      );
    });

    it('syncs parent-child to beads when parent already synced', async () => {
      const parentDbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-PARENT',
        beads_issue_id: 'beads-parent',
      });
      const hulyIssue = createHulyIssue_({
        parentIssue: { identifier: 'TEST-PARENT' },
      });
      const db = createMockDb([parentDbRecord]);

      await syncHulyIssueToBeads('/proj', hulyIssue, [], db, {});

      expect(syncParentChildToBeads).toHaveBeenCalledWith(
        '/proj',
        'new-beads-id',
        'beads-parent',
        db,
        {}
      );
    });

    it('returns null when createBeadsIssue returns null', async () => {
      createBeadsIssue.mockResolvedValueOnce(null);
      const hulyIssue = createHulyIssue_();
      const db = createMockDb();

      const result = await syncHulyIssueToBeads('/proj', hulyIssue, [], db, {});

      expect(result).toBeNull();
    });

    it('adds description with huly identifier on create', async () => {
      const hulyIssue = createHulyIssue_({ description: 'My description' });
      const db = createMockDb();

      await syncHulyIssueToBeads('/proj', hulyIssue, [], db, {});

      expect(createBeadsIssue).toHaveBeenCalledWith(
        '/proj',
        expect.objectContaining({
          description: 'My description\n\n---\nHuly Issue: TEST-1',
        }),
        {}
      );
    });

    it('creates description from identifier when no description', async () => {
      const hulyIssue = createHulyIssue_({ description: null });
      const db = createMockDb();

      await syncHulyIssueToBeads('/proj', hulyIssue, [], db, {});

      expect(createBeadsIssue).toHaveBeenCalledWith(
        '/proj',
        expect.objectContaining({
          description: 'Synced from Huly: TEST-1',
        }),
        {}
      );
    });

    it('adds label on create when status maps to label', async () => {
      const hulyIssue = createHulyIssue_({ status: 'In Review' });
      const db = createMockDb();

      await syncHulyIssueToBeads('/proj', hulyIssue, [], db, {});

      expect(createBeadsIssue).toHaveBeenCalledWith(
        '/proj',
        expect.objectContaining({
          labels: ['review'],
        }),
        {}
      );
    });

    it('handles new reparent where new parent not yet synced', async () => {
      const now = Date.now();
      const hulyIssue = createHulyIssue_({
        title: 'Child Moved',
        modifiedOn: now,
        parentIssue: { identifier: 'TEST-UNSYNC-PARENT' },
      });
      const beadsIssue = createMockBeadsIssue({
        id: 'beads-child',
        title: 'Child',
        status: 'open',
        priority: 2,
        updated_at: new Date(now - 10000).toISOString(),
      });
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-1',
        beads_issue_id: 'beads-child',
        parent_huly_id: null, // was top-level
        huly_modified_at: now - 5000,
        beads_modified_at: now - 10000,
      });
      const db = createMockDb([dbRecord]);

      await syncHulyIssueToBeads('/proj', hulyIssue, [beadsIssue], db, {});

      // New parent not in DB so beads_issue_id is null
      expect(db.updateParentChild).toHaveBeenCalledWith('TEST-1', 'TEST-UNSYNC-PARENT', null);
    });
  });

  // ========================================================
  // syncBeadsIssueToHuly
  // ========================================================
  describe('syncBeadsIssueToHuly', () => {
    it('skips issues in phase3UpdatedIssues set', async () => {
      const beadsIssue = createMockBeadsIssue({ id: 'beads-1' });
      const db = createMockDb([]);
      const phase3 = new Set(['beads-1']);

      await syncBeadsIssueToHuly(makeHulyClient(), '/proj', beadsIssue, [], 'TEST', db, {}, phase3);

      expect(db.upsertIssue).not.toHaveBeenCalled();
    });

    it('skips issues marked deleted_from_huly', async () => {
      const beadsIssue = createMockBeadsIssue({ id: 'beads-1' });
      const dbRecord = createMockBeadsDbRecord({
        beads_issue_id: 'beads-1',
        deleted_from_huly: true,
      });
      const db = createMockDb([dbRecord]);

      await syncBeadsIssueToHuly(makeHulyClient(), '/proj', beadsIssue, [], 'TEST', db, {});

      expect(createHulyIssue).not.toHaveBeenCalled();
    });

    it('creates Huly issue for new beads-only issue', async () => {
      const beadsIssue = createMockBeadsIssue({ id: 'beads-new', title: 'Brand New' });
      const db = createMockDb([]);

      await syncBeadsIssueToHuly(makeHulyClient(), '/proj', beadsIssue, [], 'TEST', db, {});

      expect(createHulyIssue).toHaveBeenCalledWith(
        expect.anything(),
        'TEST',
        expect.objectContaining({ title: 'Brand New' }),
        {}
      );
      expect(db.upsertIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'NEW-1',
          beads_issue_id: 'beads-new',
        })
      );
    });

    it('links existing Huly issue by title match', async () => {
      const beadsIssue = createMockBeadsIssue({ id: 'beads-match', title: 'Matching Title' });
      const hulyIssues = [
        {
          identifier: 'TEST-5',
          id: 'huly-5',
          title: 'Matching Title',
          status: 'Backlog',
          priority: 'Medium',
          modifiedOn: Date.now(),
        },
      ];
      const db = createMockDb([]);

      await syncBeadsIssueToHuly(makeHulyClient(), '/proj', beadsIssue, hulyIssues, 'TEST', db, {});

      expect(createHulyIssue).not.toHaveBeenCalled();
      expect(db.upsertIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'TEST-5',
          beads_issue_id: 'beads-match',
        })
      );
    });

    it('links by description containing beads ID', async () => {
      const beadsIssue = createMockBeadsIssue({ id: 'beads-desc', title: 'Unique Title XYZ' });
      const hulyIssues = [
        {
          identifier: 'TEST-6',
          id: 'huly-6',
          title: 'Different Title',
          status: 'Backlog',
          priority: 'Medium',
          description: 'Synced from Beads: beads-desc',
          modifiedOn: Date.now(),
        },
      ];
      const db = createMockDb([]);

      await syncBeadsIssueToHuly(makeHulyClient(), '/proj', beadsIssue, hulyIssues, 'TEST', db, {});

      expect(createHulyIssue).not.toHaveBeenCalled();
      expect(db.upsertIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'TEST-6',
          beads_issue_id: 'beads-desc',
        })
      );
    });

    it('updates Huly status when beads status differs', async () => {
      const beadsIssue = createMockBeadsIssue({
        id: 'beads-1',
        title: 'Same Title',
        status: 'in_progress',
        priority: 2,
      });
      const hulyIssue = {
        identifier: 'TEST-1',
        title: 'Same Title',
        status: 'Backlog',
        priority: 'Medium',
        modifiedOn: Date.now(),
      };
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-1',
        beads_issue_id: 'beads-1',
      });
      const db = createMockDb([dbRecord]);

      await syncBeadsIssueToHuly(
        makeHulyClient(),
        '/proj',
        beadsIssue,
        [hulyIssue],
        'TEST',
        db,
        {}
      );

      expect(updateHulyIssueStatus).toHaveBeenCalledWith(
        expect.anything(),
        'TEST-1',
        'In Progress',
        {}
      );
    });

    it('updates Huly title when beads title differs', async () => {
      const beadsIssue = createMockBeadsIssue({
        id: 'beads-1',
        title: 'Updated Title',
        status: 'open',
        priority: 2,
      });
      const hulyIssue = {
        identifier: 'TEST-1',
        title: 'Old Title',
        status: 'Backlog',
        priority: 'Medium',
        modifiedOn: Date.now(),
      };
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-1',
        beads_issue_id: 'beads-1',
      });
      const db = createMockDb([dbRecord]);

      await syncBeadsIssueToHuly(
        makeHulyClient(),
        '/proj',
        beadsIssue,
        [hulyIssue],
        'TEST',
        db,
        {}
      );

      expect(updateHulyIssueTitle).toHaveBeenCalledWith(
        expect.anything(),
        'TEST-1',
        'Updated Title',
        {}
      );
    });

    it('updates Huly priority when beads priority differs', async () => {
      const beadsIssue = createMockBeadsIssue({
        id: 'beads-1',
        title: 'Same',
        status: 'open',
        priority: 0,
      });
      const hulyIssue = {
        identifier: 'TEST-1',
        title: 'Same',
        status: 'Backlog',
        priority: 'Medium',
        modifiedOn: Date.now(),
      };
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-1',
        beads_issue_id: 'beads-1',
      });
      const db = createMockDb([dbRecord]);

      await syncBeadsIssueToHuly(
        makeHulyClient(),
        '/proj',
        beadsIssue,
        [hulyIssue],
        'TEST',
        db,
        {}
      );

      expect(updateHulyIssuePriority).toHaveBeenCalledWith(
        expect.anything(),
        'TEST-1',
        'Urgent',
        {}
      );
    });

    it('fetches issue from API when not in cached array', async () => {
      const beadsIssue = createMockBeadsIssue({
        id: 'beads-1',
        title: 'T',
        status: 'open',
        priority: 2,
      });
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-99',
        beads_issue_id: 'beads-1',
      });
      const db = createMockDb([dbRecord]);
      const fetchedIssue = {
        identifier: 'TEST-99',
        title: 'T',
        status: 'Backlog',
        priority: 'Medium',
        modifiedOn: Date.now(),
      };
      const client = makeHulyClient({ getIssue: vi.fn(async () => fetchedIssue) });

      await syncBeadsIssueToHuly(client, '/proj', beadsIssue, [], 'TEST', db, {});

      expect(client.getIssue).toHaveBeenCalledWith('TEST-99');
    });

    it('marks deleted when API fetch returns null', async () => {
      const beadsIssue = createMockBeadsIssue({ id: 'beads-1' });
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-GONE',
        beads_issue_id: 'beads-1',
      });
      const db = createMockDb([dbRecord]);
      const client = makeHulyClient({ getIssue: vi.fn(async () => null) });

      await syncBeadsIssueToHuly(client, '/proj', beadsIssue, [], 'TEST', db, {});

      expect(db.markDeletedFromHuly).toHaveBeenCalledWith('TEST-GONE');
    });

    it('marks deleted when API fetch throws', async () => {
      const beadsIssue = createMockBeadsIssue({ id: 'beads-1' });
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-ERR',
        beads_issue_id: 'beads-1',
      });
      const db = createMockDb([dbRecord]);
      const client = makeHulyClient({
        getIssue: vi.fn(async () => {
          throw new Error('Not found');
        }),
      });

      await syncBeadsIssueToHuly(client, '/proj', beadsIssue, [], 'TEST', db, {});

      expect(db.markDeletedFromHuly).toHaveBeenCalledWith('TEST-ERR');
    });

    it('cascades to Vibe when vibeContext provided', async () => {
      const beadsIssue = createMockBeadsIssue({
        id: 'beads-1',
        title: 'Same Title',
        status: 'in_progress',
        priority: 2,
      });
      const hulyIssue = {
        identifier: 'TEST-1',
        title: 'Same Title',
        status: 'Backlog',
        priority: 'Medium',
        modifiedOn: Date.now(),
      };
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-1',
        beads_issue_id: 'beads-1',
      });
      const db = createMockDb([dbRecord]);

      extractHulyIdentifier.mockReturnValueOnce('TEST-1');
      mapBeadsStatusToVibe.mockReturnValueOnce('inprogress');
      const vibeContext = {
        vibeClient: {},
        vibeTasks: [{ id: 'vibe-1', description: 'Huly Issue: TEST-1', status: 'todo' }],
      };

      await syncBeadsIssueToHuly(
        makeHulyClient(),
        '/proj',
        beadsIssue,
        [hulyIssue],
        'TEST',
        db,
        {},
        new Set(),
        vibeContext
      );

      expect(updateVibeTaskStatus).toHaveBeenCalled();
    });

    it('handles reparenting detection', async () => {
      const beadsIssue = createMockBeadsIssue({
        id: 'beads-child',
        title: 'Same',
        status: 'open',
        priority: 2,
      });
      const hulyIssue = {
        identifier: 'TEST-CHILD',
        title: 'Same',
        status: 'Backlog',
        priority: 'Medium',
        modifiedOn: Date.now(),
      };
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-CHILD',
        beads_issue_id: 'beads-child',
        parent_beads_id: 'old-parent-beads',
        parent_huly_id: 'TEST-OLD-PARENT',
      });
      const parentRecord = createMockBeadsDbRecord({
        identifier: 'TEST-NEW-PARENT',
        beads_issue_id: 'new-parent-beads',
      });
      const db = createMockDb([dbRecord, parentRecord]);
      getParentIdFromLookup.mockReturnValueOnce('new-parent-beads');

      await syncBeadsIssueToHuly(makeHulyClient(), '/proj', beadsIssue, [hulyIssue], 'TEST', db, {
        parentMap: new Map(),
      });

      expect(db.updateParentChild).toHaveBeenCalledWith(
        'TEST-CHILD',
        'TEST-NEW-PARENT',
        'new-parent-beads'
      );
    });

    it('updates db after successful updates', async () => {
      const beadsIssue = createMockBeadsIssue({
        id: 'beads-1',
        title: 'New Title',
        status: 'in_progress',
        priority: 0,
      });
      const hulyIssue = {
        identifier: 'TEST-1',
        title: 'Old Title',
        status: 'Backlog',
        priority: 'Medium',
        modifiedOn: Date.now(),
      };
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-1',
        beads_issue_id: 'beads-1',
      });
      const db = createMockDb([dbRecord]);

      await syncBeadsIssueToHuly(
        makeHulyClient(),
        '/proj',
        beadsIssue,
        [hulyIssue],
        'TEST',
        db,
        {}
      );

      expect(db.upsertIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'TEST-1',
          beads_issue_id: 'beads-1',
        })
      );
    });

    it('does not create Huly issue when createHulyIssue returns null', async () => {
      createHulyIssue.mockResolvedValueOnce(null);
      const beadsIssue = createMockBeadsIssue({ id: 'beads-new', title: 'Brand New' });
      const db = createMockDb([]);

      await syncBeadsIssueToHuly(makeHulyClient(), '/proj', beadsIssue, [], 'TEST', db, {});

      // createHulyIssue was called but returned null, so no db upsert
      expect(createHulyIssue).toHaveBeenCalled();
      expect(db.upsertIssue).not.toHaveBeenCalled();
    });
  });

  // ========================================================
  // syncBeadsToGit
  // ========================================================
  describe('syncBeadsToGit', () => {
    it('returns false if beads not initialized', async () => {
      isBeadsInitialized.mockReturnValueOnce(false);
      const result = await syncBeadsToGit('/proj', { projectIdentifier: 'TEST' });
      expect(result).toBe(false);
      expect(execBeadsCommand).not.toHaveBeenCalled();
    });

    it('returns false if not a git repo', async () => {
      isGitRepository.mockReturnValueOnce(false);
      const result = await syncBeadsToGit('/proj', { projectIdentifier: 'TEST' });
      expect(result).toBe(false);
    });

    it('runs bd sync and git push successfully', async () => {
      const result = await syncBeadsToGit('/proj', { projectIdentifier: 'TEST' });
      expect(execBeadsCommand).toHaveBeenCalledWith(expect.stringContaining('sync -m'), '/proj');
      expect(execGitCommand).toHaveBeenCalledWith('push', '/proj');
      expect(result).toBe(true);
    });

    it('handles "no changes" gracefully', async () => {
      execBeadsCommand.mockImplementationOnce(() => {
        throw new Error('nothing to commit');
      });
      const result = await syncBeadsToGit('/proj', { projectIdentifier: 'TEST' });
      expect(result).toBe(true);
    });

    it('handles push "up-to-date" gracefully', async () => {
      execGitCommand.mockImplementationOnce(() => {
        throw new Error('Everything up-to-date');
      });
      const result = await syncBeadsToGit('/proj', { projectIdentifier: 'TEST' });
      expect(result).toBe(true);
    });

    it('handles push=false option', async () => {
      const result = await syncBeadsToGit('/proj', { projectIdentifier: 'TEST', push: false });
      expect(result).toBe(true);
      expect(execGitCommand).not.toHaveBeenCalled();
    });

    it('recovery: commits beads files when bd sync fails with "nothing added"', async () => {
      execBeadsCommand.mockImplementationOnce(() => {
        throw new Error('nothing added to commit');
      });
      beadsWorkingTreeDirty.mockReturnValueOnce(true);
      const result = await syncBeadsToGit('/proj', { projectIdentifier: 'TEST' });
      expect(commitBeadsSyncFiles).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('returns false on sync error (non-recoverable)', async () => {
      execBeadsCommand.mockImplementationOnce(() => {
        throw new Error('fatal git error');
      });
      const result = await syncBeadsToGit('/proj', { projectIdentifier: 'TEST' });
      expect(result).toBe(false);
    });

    it('returns false when not in a git repository (sync error)', async () => {
      execBeadsCommand.mockImplementationOnce(() => {
        throw new Error('not in a git repository');
      });
      const result = await syncBeadsToGit('/proj', { projectIdentifier: 'TEST' });
      expect(result).toBe(false);
    });

    it('returns false on push failure (non-up-to-date)', async () => {
      execGitCommand.mockImplementationOnce(() => {
        throw new Error('rejected: non-fast-forward');
      });
      const result = await syncBeadsToGit('/proj', { projectIdentifier: 'TEST' });
      expect(result).toBe(false);
    });

    it('handles post-sync dirty tree commit', async () => {
      beadsWorkingTreeDirty.mockReturnValueOnce(true);
      const result = await syncBeadsToGit('/proj', { projectIdentifier: 'TEST' });
      expect(commitBeadsSyncFiles).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('handles post-sync commit failure gracefully', async () => {
      beadsWorkingTreeDirty.mockReturnValueOnce(true);
      commitBeadsSyncFiles.mockImplementationOnce(() => {
        throw new Error('commit failed');
      });
      const result = await syncBeadsToGit('/proj', { projectIdentifier: 'TEST' });
      expect(result).toBe(true);
    });

    it('returns false on outer catch (unexpected error)', async () => {
      isBeadsInitialized.mockImplementationOnce(() => {
        throw new Error('unexpected');
      });
      const result = await syncBeadsToGit('/proj', { projectIdentifier: 'TEST' });
      expect(result).toBe(false);
    });

    it('recovery commit failure is handled gracefully', async () => {
      execBeadsCommand.mockImplementationOnce(() => {
        throw new Error('no changes added to commit');
      });
      beadsWorkingTreeDirty.mockReturnValueOnce(true);
      commitBeadsSyncFiles.mockImplementationOnce(() => {
        throw new Error('recovery failed');
      });
      const result = await syncBeadsToGit('/proj', { projectIdentifier: 'TEST' });
      // After recovery failure, 'no changes' is still an acceptable condition
      expect(result).toBe(true);
    });
  });

  // ========================================================
  // batchSyncHulyToBeads
  // ========================================================
  describe('batchSyncHulyToBeads', () => {
    it('processes all issues and returns counts', async () => {
      const issues = [
        createHulyIssue_({ identifier: 'T-1' }),
        createHulyIssue_({ identifier: 'T-2' }),
      ];
      const db = createMockDb();
      createBeadsIssue.mockResolvedValue({ id: 'b-1', updated_at: new Date().toISOString() });

      const result = await batchSyncHulyToBeads('/proj', issues, [], db, {
        beads: { operationDelay: 0 },
      });

      expect(result.synced).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('increments skipped counter on null return', async () => {
      const now = Date.now();
      const hulyIssue = createHulyIssue_({
        title: 'Same',
        status: 'Backlog',
        priority: 'Medium',
        modifiedOn: now,
      });
      const beadsIssue = createMockBeadsIssue({
        id: 'b-1',
        title: 'Same',
        status: 'open',
        priority: 2,
        labels: [],
        updated_at: new Date(now - 10000).toISOString(),
      });
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-1',
        beads_issue_id: 'b-1',
        huly_modified_at: now - 5000,
        beads_modified_at: now - 10000,
      });
      const db = createMockDb([dbRecord]);

      buildIssueLookups.mockReturnValueOnce({
        byHulyId: new Map(),
        byTitle: new Map(),
        byBeadsId: new Map([['b-1', beadsIssue]]),
        parentMap: new Map(),
      });

      const result = await batchSyncHulyToBeads('/proj', [hulyIssue], [beadsIssue], db, {
        beads: { operationDelay: 0 },
      });

      expect(result.skipped).toBe(1);
    });

    it('increments error counter and records message on throw', async () => {
      createBeadsIssue.mockRejectedValueOnce(new Error('Create failed'));
      const db = createMockDb();

      const result = await batchSyncHulyToBeads('/proj', [createHulyIssue_()], [], db, {
        beads: { operationDelay: 0 },
      });

      expect(result.errors).toBe(1);
      expect(result.errorMessages).toHaveLength(1);
      expect(result.errorMessages[0]).toContain('Create failed');
    });

    it('builds lookups and passes to individual calls', async () => {
      const db = createMockDb();
      const beadsIssues = [createMockBeadsIssue()];

      await batchSyncHulyToBeads('/proj', [], beadsIssues, db, {});

      expect(buildIssueLookups).toHaveBeenCalledWith(beadsIssues);
    });

    it('returns result summary for empty input', async () => {
      const db = createMockDb();
      const result = await batchSyncHulyToBeads('/proj', [], [], db, {});

      expect(result).toEqual({
        synced: 0,
        skipped: 0,
        errors: 0,
        errorMessages: [],
      });
    });
  });

  // ========================================================
  // batchSyncBeadsToHuly
  // ========================================================
  describe('batchSyncBeadsToHuly', () => {
    it('processes all issues and returns counts', async () => {
      const beadsIssues = [
        createMockBeadsIssue({ id: 'b-1', title: 'Issue 1' }),
        createMockBeadsIssue({ id: 'b-2', title: 'Issue 2' }),
      ];
      const db = createMockDb([]);

      const result = await batchSyncBeadsToHuly(
        makeHulyClient(),
        '/proj',
        beadsIssues,
        [],
        'TEST',
        db,
        { beads: { operationDelay: 0 } }
      );

      expect(result.synced).toBe(2);
      expect(result.errors).toBe(0);
    });

    it('pre-fetches missing issues in bulk', async () => {
      const beadsIssue = createMockBeadsIssue({ id: 'b-1' });
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-MISSING',
        beads_issue_id: 'b-1',
      });
      const db = createMockDb([dbRecord]);
      const fetchedIssue = {
        identifier: 'TEST-MISSING',
        title: 'Fetched',
        status: 'Backlog',
        priority: 'Medium',
        modifiedOn: Date.now(),
      };
      const client = makeHulyClient({
        getIssuesBulk: vi.fn(async () => [fetchedIssue]),
      });

      await batchSyncBeadsToHuly(client, '/proj', [beadsIssue], [], 'TEST', db, {
        beads: { operationDelay: 0 },
      });

      expect(client.getIssuesBulk).toHaveBeenCalledWith(['TEST-MISSING']);
    });

    it('handles bulk fetch failure gracefully', async () => {
      const beadsIssue = createMockBeadsIssue({ id: 'b-1' });
      const dbRecord = createMockBeadsDbRecord({
        identifier: 'TEST-MISSING',
        beads_issue_id: 'b-1',
      });
      const db = createMockDb([dbRecord]);
      const client = makeHulyClient({
        getIssuesBulk: vi.fn(async () => {
          throw new Error('Bulk failed');
        }),
      });

      const result = await batchSyncBeadsToHuly(client, '/proj', [beadsIssue], [], 'TEST', db, {
        beads: { operationDelay: 0 },
      });

      expect(result).toBeDefined();
    });

    it('passes phase3UpdatedIssues through', async () => {
      const beadsIssue = createMockBeadsIssue({ id: 'b-skip' });
      const db = createMockDb([]);
      const phase3 = new Set(['b-skip']);

      const result = await batchSyncBeadsToHuly(
        makeHulyClient(),
        '/proj',
        [beadsIssue],
        [],
        'TEST',
        db,
        { beads: { operationDelay: 0 } },
        phase3
      );

      // syncBeadsIssueToHuly returns early for phase3 issues but doesn't throw
      expect(result.synced).toBe(1);
    });

    it('returns result summary for empty input', async () => {
      const db = createMockDb([]);
      const result = await batchSyncBeadsToHuly(makeHulyClient(), '/proj', [], [], 'TEST', db, {});

      expect(result).toEqual({
        synced: 0,
        skipped: 0,
        errors: 0,
        errorMessages: [],
      });
    });
  });

  // ========================================================
  // fullBidirectionalSync
  // ========================================================
  describe('fullBidirectionalSync', () => {
    it('runs all 3 phases in order', async () => {
      const db = createMockDb();
      const result = await fullBidirectionalSync(makeHulyClient(), '/proj', [], [], 'TEST', db, {});

      expect(result.hulyToBeads).toBeDefined();
      expect(result.beadsToHuly).toBeDefined();
      expect(result.gitSync).toBeDefined();
      expect(result.timestamp).toBeDefined();
    });

    it('skips git sync in dry run mode', async () => {
      const db = createMockDb();
      const result = await fullBidirectionalSync(makeHulyClient(), '/proj', [], [], 'TEST', db, {
        sync: { dryRun: true },
      });

      expect(result.gitSync).toBe(false);
      // execBeadsCommand may be called by batchSync but NOT by syncBeadsToGit
    });

    it('returns combined results object', async () => {
      const db = createMockDb();
      const result = await fullBidirectionalSync(makeHulyClient(), '/proj', [], [], 'TEST', db, {});

      expect(result).toEqual(
        expect.objectContaining({
          hulyToBeads: expect.objectContaining({
            synced: expect.any(Number),
            skipped: expect.any(Number),
            errors: expect.any(Number),
          }),
          beadsToHuly: expect.objectContaining({
            synced: expect.any(Number),
            errors: expect.any(Number),
          }),
          gitSync: expect.any(Boolean),
          timestamp: expect.any(String),
        })
      );
    });

    it('performs git sync when not dry run', async () => {
      const db = createMockDb();
      const result = await fullBidirectionalSync(makeHulyClient(), '/proj', [], [], 'TEST', db, {});

      // syncBeadsToGit is called (isBeadsInitialized and isGitRepository return true by default)
      expect(result.gitSync).toBe(true);
    });
  });
});
