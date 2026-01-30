/**
 * Unit Tests for BeadsDBReader
 *
 * Covers all exported functions:
 * - normalizeTitleForComparison
 * - openBeadsDB
 * - readIssuesFromDB
 * - findHulyIdentifier
 * - buildIssueLookups
 * - getBeadsIssuesWithLookups
 * - getParentIdFromLookup
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock external dependencies ──────────────────────────

const mockStmt = { all: vi.fn(() => []) };
const mockDb = {
  prepare: vi.fn(() => mockStmt),
  close: vi.fn(),
};

vi.mock('better-sqlite3', () => {
  // Must be a real function to support `new Database()`
  const MockDatabase = vi.fn(function () {
    return mockDb;
  });
  return { default: MockDatabase };
});

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
  },
  existsSync: vi.fn(() => false),
}));

// ── Import module under test after mocks ────────────────

const {
  normalizeTitleForComparison,
  openBeadsDB,
  readIssuesFromDB,
  findHulyIdentifier,
  buildIssueLookups,
  getBeadsIssuesWithLookups,
  getParentIdFromLookup,
} = await import('../../lib/BeadsDBReader.js');

const fs = await import('fs');
const Database = (await import('better-sqlite3')).default;

describe('BeadsDBReader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStmt.all.mockReturnValue([]);
  });

  // ── normalizeTitleForComparison ───────────────────────

  describe('normalizeTitleForComparison', () => {
    it('returns empty string for null/undefined', () => {
      expect(normalizeTitleForComparison(null)).toBe('');
      expect(normalizeTitleForComparison(undefined)).toBe('');
      expect(normalizeTitleForComparison('')).toBe('');
    });

    it('trims and lowercases', () => {
      expect(normalizeTitleForComparison('  Hello World  ')).toBe('hello world');
    });

    it('strips [P0] through [P4] tags', () => {
      expect(normalizeTitleForComparison('[P0] Critical bug')).toBe('critical bug');
      expect(normalizeTitleForComparison('[P2] Medium task')).toBe('medium task');
      expect(normalizeTitleForComparison('[P4] Low priority')).toBe('low priority');
    });

    it('strips [Perf...] tags', () => {
      expect(normalizeTitleForComparison('[PerfCritical] Slow query')).toBe('slow query');
      expect(normalizeTitleForComparison('[Perf] Optimization')).toBe('optimization');
    });

    it('strips [Tier N] tags', () => {
      expect(normalizeTitleForComparison('[Tier 1] Important')).toBe('important');
      expect(normalizeTitleForComparison('[Tier 3] Normal')).toBe('normal');
    });

    it('strips [Action] tag', () => {
      expect(normalizeTitleForComparison('[Action] Do something')).toBe('do something');
    });

    it('strips [Bug] tag', () => {
      expect(normalizeTitleForComparison('[Bug] Fix crash')).toBe('fix crash');
    });

    it('strips [Fixed] tag', () => {
      expect(normalizeTitleForComparison('[Fixed] Was broken')).toBe('was broken');
    });

    it('strips [Epic] tag', () => {
      expect(normalizeTitleForComparison('[Epic] Big feature')).toBe('big feature');
    });

    it('strips [WIP] tag', () => {
      expect(normalizeTitleForComparison('[WIP] In progress')).toBe('in progress');
    });

    it('is case-insensitive for tag matching', () => {
      expect(normalizeTitleForComparison('[BUG] Fix it')).toBe('fix it');
      expect(normalizeTitleForComparison('[wip] Working')).toBe('working');
    });
  });

  // ── openBeadsDB ───────────────────────────────────────

  describe('openBeadsDB', () => {
    it('returns null when DB file does not exist', () => {
      fs.default.existsSync.mockReturnValue(false);
      const result = openBeadsDB('/some/project');
      expect(result).toBeNull();
    });

    it('returns a Database instance when DB file exists', () => {
      fs.default.existsSync.mockReturnValue(true);
      const result = openBeadsDB('/some/project');
      expect(result).toBe(mockDb);
      expect(Database).toHaveBeenCalledWith(expect.stringContaining('.beads/beads.db'), {
        readonly: true,
      });
    });
  });

  // ── readIssuesFromDB ─────────────────────────────────

  describe('readIssuesFromDB', () => {
    it('returns empty array when DB not found', () => {
      fs.default.existsSync.mockReturnValue(false);
      const result = readIssuesFromDB('/no/db');
      expect(result).toEqual([]);
    });

    it('reads issues with comments and dependencies', () => {
      fs.default.existsSync.mockReturnValue(true);

      const issues = [
        { id: 'i1', title: 'Issue 1', description: 'Desc 1' },
        { id: 'i2', title: 'Issue 2', description: 'Desc 2' },
      ];
      const comments = [
        { issue_id: 'i1', text: 'Comment 1', created_at: '2025-01-01', author: 'alice' },
        { issue_id: 'i1', text: 'Comment 2', created_at: '2025-01-02', author: 'bob' },
      ];
      const deps = [{ issue_id: 'i2', depends_on_id: 'i1', type: 'parent-child' }];

      // prepare() is called 3 times: issues, comments, deps
      const stmtIssues = { all: vi.fn(() => issues) };
      const stmtComments = { all: vi.fn(() => comments) };
      const stmtDeps = { all: vi.fn(() => deps) };
      mockDb.prepare
        .mockReturnValueOnce(stmtIssues)
        .mockReturnValueOnce(stmtComments)
        .mockReturnValueOnce(stmtDeps);

      const result = readIssuesFromDB('/my/project');

      expect(result).toHaveLength(2);
      // Issue 1 has 2 comments, no deps
      expect(result[0].comments).toHaveLength(2);
      expect(result[0].comments[0]).toEqual({
        text: 'Comment 1',
        created_at: '2025-01-01',
        author: 'alice',
      });
      expect(result[0].dependencies).toEqual([]);
      // Issue 2 has no comments, 1 dep
      expect(result[1].comments).toEqual([]);
      expect(result[1].dependencies).toHaveLength(1);
      expect(result[1].dependencies[0]).toEqual({
        depends_on_id: 'i1',
        type: 'parent-child',
      });
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('returns issues with empty comments and deps when none exist', () => {
      fs.default.existsSync.mockReturnValue(true);

      const issues = [{ id: 'i1', title: 'Solo issue' }];
      const stmtIssues = { all: vi.fn(() => issues) };
      const stmtComments = { all: vi.fn(() => []) };
      const stmtDeps = { all: vi.fn(() => []) };
      mockDb.prepare
        .mockReturnValueOnce(stmtIssues)
        .mockReturnValueOnce(stmtComments)
        .mockReturnValueOnce(stmtDeps);

      const result = readIssuesFromDB('/my/project');
      expect(result).toHaveLength(1);
      expect(result[0].comments).toEqual([]);
      expect(result[0].dependencies).toEqual([]);
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('closes db even if an error occurs', () => {
      fs.default.existsSync.mockReturnValue(true);
      mockDb.prepare.mockImplementationOnce(() => {
        throw new Error('SQL error');
      });

      expect(() => readIssuesFromDB('/my/project')).toThrow('SQL error');
      expect(mockDb.close).toHaveBeenCalled();
    });
  });

  // ── findHulyIdentifier ───────────────────────────────

  describe('findHulyIdentifier', () => {
    it('finds "Huly Issue: PROJ-123" in description', () => {
      const issue = { description: 'Some text\nHuly Issue: PROJ-123\nMore text', comments: [] };
      expect(findHulyIdentifier(issue)).toBe('PROJ-123');
    });

    it('finds "Synced from Huly: PROJ-456" in description', () => {
      const issue = { description: 'Synced from Huly: PROJ-456', comments: [] };
      expect(findHulyIdentifier(issue)).toBe('PROJ-456');
    });

    it('finds identifier in comments when not in description', () => {
      const issue = {
        description: 'No huly ref here',
        comments: [{ text: 'Regular comment' }, { text: 'Huly Issue: ABC-789' }],
      };
      expect(findHulyIdentifier(issue)).toBe('ABC-789');
    });

    it('handles comment with null text', () => {
      const issue = {
        description: 'No ref',
        comments: [{ text: null }, { text: 'Huly Issue: TEST-1' }],
      };
      expect(findHulyIdentifier(issue)).toBe('TEST-1');
    });

    it('returns null when no match found', () => {
      const issue = { description: 'Just a plain description', comments: [] };
      expect(findHulyIdentifier(issue)).toBeNull();
    });

    it('returns null when description is null', () => {
      const issue = { description: null, comments: [] };
      expect(findHulyIdentifier(issue)).toBeNull();
    });

    it('returns null when no description and no comments', () => {
      const issue = { description: null };
      expect(findHulyIdentifier(issue)).toBeNull();
    });

    it('uppercases the identifier', () => {
      const issue = { description: 'Huly Issue: proj-99', comments: [] };
      expect(findHulyIdentifier(issue)).toBe('PROJ-99');
    });
  });

  // ── buildIssueLookups ────────────────────────────────

  describe('buildIssueLookups', () => {
    it('returns empty maps for empty array', () => {
      const result = buildIssueLookups([]);
      expect(result.byHulyId.size).toBe(0);
      expect(result.byTitle.size).toBe(0);
      expect(result.byId.size).toBe(0);
      expect(result.parentMap.size).toBe(0);
    });

    it('builds byId map', () => {
      const issues = [
        {
          id: 'a',
          title: 'First',
          description: null,
          created_at: '2025-01-01',
          comments: [],
          dependencies: [],
        },
      ];
      const { byId } = buildIssueLookups(issues);
      expect(byId.get('a')).toBe(issues[0]);
    });

    it('builds byHulyId map from description', () => {
      const issues = [
        {
          id: 'a',
          title: 'Task',
          description: 'Huly Issue: TST-1',
          created_at: '2025-01-01',
          comments: [],
          dependencies: [],
        },
        {
          id: 'b',
          title: 'Other',
          description: 'Huly Issue: TST-2',
          created_at: '2025-01-02',
          comments: [],
          dependencies: [],
        },
      ];
      const { byHulyId } = buildIssueLookups(issues);
      expect(byHulyId.size).toBe(2);
      expect(byHulyId.get('TST-1').id).toBe('a');
      expect(byHulyId.get('TST-2').id).toBe('b');
    });

    it('first issue wins for duplicate Huly IDs', () => {
      const issues = [
        {
          id: 'a',
          title: 'First',
          description: 'Huly Issue: DUP-1',
          created_at: '2025-01-01',
          comments: [],
          dependencies: [],
        },
        {
          id: 'b',
          title: 'Second',
          description: 'Huly Issue: DUP-1',
          created_at: '2025-01-02',
          comments: [],
          dependencies: [],
        },
      ];
      const { byHulyId } = buildIssueLookups(issues);
      expect(byHulyId.get('DUP-1').id).toBe('a');
    });

    it('builds byTitle map with normalization', () => {
      const issues = [
        {
          id: 'a',
          title: '[P0] Critical Bug',
          description: null,
          created_at: '2025-01-01',
          comments: [],
          dependencies: [],
        },
      ];
      const { byTitle } = buildIssueLookups(issues);
      expect(byTitle.get('critical bug').id).toBe('a');
    });

    it('first issue wins for duplicate normalized titles', () => {
      const issues = [
        {
          id: 'a',
          title: '[P0] Same Title',
          description: null,
          created_at: '2025-01-01',
          comments: [],
          dependencies: [],
        },
        {
          id: 'b',
          title: '[P1] Same Title',
          description: null,
          created_at: '2025-01-02',
          comments: [],
          dependencies: [],
        },
      ];
      const { byTitle } = buildIssueLookups(issues);
      expect(byTitle.get('same title').id).toBe('a');
    });

    it('builds parentMap from parent-child dependencies', () => {
      const issues = [
        {
          id: 'parent',
          title: 'Parent',
          description: null,
          created_at: '2025-01-01',
          comments: [],
          dependencies: [],
        },
        {
          id: 'child',
          title: 'Child',
          description: null,
          created_at: '2025-01-02',
          comments: [],
          dependencies: [{ depends_on_id: 'parent', type: 'parent-child' }],
        },
      ];
      const { parentMap } = buildIssueLookups(issues);
      expect(parentMap.get('child')).toBe('parent');
      expect(parentMap.has('parent')).toBe(false);
    });

    it('ignores non parent-child dependencies', () => {
      const issues = [
        {
          id: 'a',
          title: 'Task',
          description: null,
          created_at: '2025-01-01',
          comments: [],
          dependencies: [{ depends_on_id: 'b', type: 'blocks' }],
        },
      ];
      const { parentMap } = buildIssueLookups(issues);
      expect(parentMap.size).toBe(0);
    });

    it('skips issues with empty title', () => {
      const issues = [
        {
          id: 'a',
          title: '',
          description: null,
          created_at: '2025-01-01',
          comments: [],
          dependencies: [],
        },
      ];
      const { byTitle } = buildIssueLookups(issues);
      expect(byTitle.size).toBe(0);
    });

    it('sorts by created_at before processing', () => {
      const issues = [
        {
          id: 'b',
          title: 'Same Name',
          description: null,
          created_at: '2025-02-01',
          comments: [],
          dependencies: [],
        },
        {
          id: 'a',
          title: 'Same Name',
          description: null,
          created_at: '2025-01-01',
          comments: [],
          dependencies: [],
        },
      ];
      const { byTitle } = buildIssueLookups(issues);
      // 'a' was created first, so it wins
      expect(byTitle.get('same name').id).toBe('a');
    });
  });

  // ── getBeadsIssuesWithLookups ─────────────────────────

  describe('getBeadsIssuesWithLookups', () => {
    it('returns issues and lookups from DB', () => {
      fs.default.existsSync.mockReturnValue(true);

      const issues = [{ id: 'x', title: 'Test', description: 'Huly Issue: HV-1' }];
      const stmtIssues = { all: vi.fn(() => issues) };
      const stmtComments = { all: vi.fn(() => []) };
      const stmtDeps = { all: vi.fn(() => []) };
      mockDb.prepare
        .mockReturnValueOnce(stmtIssues)
        .mockReturnValueOnce(stmtComments)
        .mockReturnValueOnce(stmtDeps);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = getBeadsIssuesWithLookups('/proj');
      consoleSpy.mockRestore();

      expect(result.issues).toHaveLength(1);
      expect(result.lookups.byHulyId.get('HV-1').id).toBe('x');
      expect(result.lookups.byId.get('x').id).toBe('x');
    });

    it('returns empty results when DB not found', () => {
      fs.default.existsSync.mockReturnValue(false);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = getBeadsIssuesWithLookups('/no/db');
      consoleSpy.mockRestore();

      expect(result.issues).toEqual([]);
      expect(result.lookups.byHulyId.size).toBe(0);
    });
  });

  // ── getParentIdFromLookup ────────────────────────────

  describe('getParentIdFromLookup', () => {
    it('returns parent ID when found', () => {
      const parentMap = new Map([['child-1', 'parent-1']]);
      expect(getParentIdFromLookup(parentMap, 'child-1')).toBe('parent-1');
    });

    it('returns null when not found', () => {
      const parentMap = new Map();
      expect(getParentIdFromLookup(parentMap, 'missing')).toBeNull();
    });
  });
});
