import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  normalizeTitleForComparison,
  findHulyIdentifier,
  buildIssueLookups,
  getParentIdFromLookup,
} from '../../lib/BeadsJSONLReader.js';

describe('BeadsJSONLReader', () => {
  describe('normalizeTitleForComparison', () => {
    it('should return empty string for null/undefined', () => {
      expect(normalizeTitleForComparison(null)).toBe('');
      expect(normalizeTitleForComparison(undefined)).toBe('');
      expect(normalizeTitleForComparison('')).toBe('');
    });

    it('should lowercase and trim', () => {
      expect(normalizeTitleForComparison('  Hello World  ')).toBe('hello world');
    });

    it('should strip priority prefixes', () => {
      expect(normalizeTitleForComparison('[P0] Critical Bug')).toBe('critical bug');
      expect(normalizeTitleForComparison('[P1] High Priority')).toBe('high priority');
      expect(normalizeTitleForComparison('[P2] Medium Priority')).toBe('medium priority');
      expect(normalizeTitleForComparison('[P3] Low Priority')).toBe('low priority');
      expect(normalizeTitleForComparison('[P4] No Priority')).toBe('no priority');
    });

    it('should strip perf prefixes', () => {
      expect(normalizeTitleForComparison('[Perf] Slow Query')).toBe('slow query');
      expect(normalizeTitleForComparison('[Perf:Critical] Memory Leak')).toBe('memory leak');
    });

    it('should strip tier prefixes', () => {
      expect(normalizeTitleForComparison('[Tier 1] Feature')).toBe('feature');
      expect(normalizeTitleForComparison('[Tier 2] Feature')).toBe('feature');
    });

    it('should strip action/bug/epic/wip prefixes', () => {
      expect(normalizeTitleForComparison('[Action] Do Something')).toBe('do something');
      expect(normalizeTitleForComparison('[Bug] Fix Something')).toBe('fix something');
      expect(normalizeTitleForComparison('[Fixed] Was Broken')).toBe('was broken');
      expect(normalizeTitleForComparison('[Epic] Big Feature')).toBe('big feature');
      expect(normalizeTitleForComparison('[WIP] In Progress')).toBe('in progress');
    });

    it('should handle multiple prefixes by stripping sequentially', () => {
      expect(normalizeTitleForComparison('[P0] [Bug] Critical Issue')).toBe('critical issue');
      expect(normalizeTitleForComparison('[P1] [Epic] Big Feature')).toBe('big feature');
    });
  });

  describe('findHulyIdentifier', () => {
    it('should return null for issue without Huly ID', () => {
      const issue = {
        id: 'test-123',
        title: 'Test Issue',
        description: 'Just a regular description',
        comments: [],
      };
      expect(findHulyIdentifier(issue)).toBeNull();
    });

    it('should find Huly ID in description', () => {
      const issue = {
        id: 'test-123',
        title: 'Test Issue',
        description: 'Huly Issue: PROJ-42',
        comments: [],
      };
      expect(findHulyIdentifier(issue)).toBe('PROJ-42');
    });

    it('should find "Synced from Huly" format in description', () => {
      const issue = {
        id: 'test-123',
        title: 'Test Issue',
        description: 'Synced from Huly: TEST-99',
        comments: [],
      };
      expect(findHulyIdentifier(issue)).toBe('TEST-99');
    });

    it('should find Huly ID in comments', () => {
      const issue = {
        id: 'test-123',
        title: 'Test Issue',
        description: 'No ID here',
        comments: [{ text: 'First comment' }, { text: 'Huly Issue: HVSYN-123' }],
      };
      expect(findHulyIdentifier(issue)).toBe('HVSYN-123');
    });

    it('should prioritize description over comments', () => {
      const issue = {
        id: 'test-123',
        title: 'Test Issue',
        description: 'Huly Issue: DESC-1',
        comments: [{ text: 'Huly Issue: COMMENT-2' }],
      };
      expect(findHulyIdentifier(issue)).toBe('DESC-1');
    });

    it('should handle missing comments array', () => {
      const issue = {
        id: 'test-123',
        title: 'Test Issue',
        description: '',
      };
      expect(findHulyIdentifier(issue)).toBeNull();
    });

    it('should handle empty comments array', () => {
      const issue = {
        id: 'test-123',
        title: 'Test Issue',
        description: '',
        comments: [],
      };
      expect(findHulyIdentifier(issue)).toBeNull();
    });

    it('should uppercase the identifier', () => {
      const issue = {
        id: 'test-123',
        title: 'Test Issue',
        description: 'Huly Issue: proj-42',
        comments: [],
      };
      expect(findHulyIdentifier(issue)).toBe('PROJ-42');
    });

    it('should handle multiline descriptions', () => {
      const issue = {
        id: 'test-123',
        title: 'Test Issue',
        description: 'Some text\n\nHuly Issue: MULTI-1\n\nMore text',
        comments: [],
      };
      expect(findHulyIdentifier(issue)).toBe('MULTI-1');
    });
  });

  describe('buildIssueLookups', () => {
    const createIssue = (overrides = {}) => ({
      id: 'test-' + Math.random().toString(36).substr(2, 9),
      title: 'Test Issue',
      description: '',
      comments: [],
      created_at: new Date().toISOString(),
      status: 'open',
      ...overrides,
    });

    it('should return empty maps for empty array', () => {
      const { byHulyId, byTitle, byId, parentMap } = buildIssueLookups([]);
      expect(byHulyId.size).toBe(0);
      expect(byTitle.size).toBe(0);
      expect(byId.size).toBe(0);
      expect(parentMap.size).toBe(0);
    });

    it('should build byId map', () => {
      const issues = [createIssue({ id: 'issue-1' }), createIssue({ id: 'issue-2' })];
      const { byId } = buildIssueLookups(issues);

      expect(byId.size).toBe(2);
      expect(byId.get('issue-1')).toBeDefined();
      expect(byId.get('issue-2')).toBeDefined();
    });

    it('should build byHulyId map from descriptions', () => {
      const issues = [
        createIssue({ id: 'beads-1', description: 'Huly Issue: PROJ-1' }),
        createIssue({ id: 'beads-2', description: 'Huly Issue: PROJ-2' }),
      ];
      const { byHulyId } = buildIssueLookups(issues);

      expect(byHulyId.size).toBe(2);
      expect(byHulyId.get('PROJ-1').id).toBe('beads-1');
      expect(byHulyId.get('PROJ-2').id).toBe('beads-2');
    });

    it('should build byHulyId map from comments', () => {
      const issues = [
        createIssue({
          id: 'beads-1',
          comments: [{ text: 'Huly Issue: HVSYN-42' }],
        }),
      ];
      const { byHulyId } = buildIssueLookups(issues);

      expect(byHulyId.size).toBe(1);
      expect(byHulyId.get('HVSYN-42').id).toBe('beads-1');
    });

    it('should build byTitle map with normalized titles', () => {
      const issues = [
        createIssue({ id: 'issue-1', title: '[P0] Critical Bug' }),
        createIssue({ id: 'issue-2', title: 'Feature Request' }),
      ];
      const { byTitle } = buildIssueLookups(issues);

      expect(byTitle.size).toBe(2);
      expect(byTitle.get('critical bug').id).toBe('issue-1');
      expect(byTitle.get('feature request').id).toBe('issue-2');
    });

    it('should keep first issue for duplicate titles (oldest)', () => {
      const issues = [
        createIssue({ id: 'older', title: 'Same Title', created_at: '2024-01-01T00:00:00Z' }),
        createIssue({ id: 'newer', title: 'Same Title', created_at: '2024-01-02T00:00:00Z' }),
      ];
      const { byTitle } = buildIssueLookups(issues);

      expect(byTitle.size).toBe(1);
      expect(byTitle.get('same title').id).toBe('older');
    });

    it('should keep first issue for duplicate Huly IDs', () => {
      const issues = [
        createIssue({
          id: 'first',
          description: 'Huly Issue: DUP-1',
          created_at: '2024-01-01T00:00:00Z',
        }),
        createIssue({
          id: 'second',
          description: 'Huly Issue: DUP-1',
          created_at: '2024-01-02T00:00:00Z',
        }),
      ];
      const { byHulyId } = buildIssueLookups(issues);

      expect(byHulyId.size).toBe(1);
      expect(byHulyId.get('DUP-1').id).toBe('first');
    });

    it('should build parentMap from dependencies', () => {
      const issues = [
        createIssue({
          id: 'child-1',
          dependencies: [{ type: 'parent-child', depends_on_id: 'parent-1' }],
        }),
        createIssue({
          id: 'child-2',
          dependencies: [{ type: 'parent-child', depends_on_id: 'parent-1' }],
        }),
        createIssue({ id: 'parent-1' }),
      ];
      const { parentMap } = buildIssueLookups(issues);

      expect(parentMap.size).toBe(2);
      expect(parentMap.get('child-1')).toBe('parent-1');
      expect(parentMap.get('child-2')).toBe('parent-1');
    });

    it('should ignore non-parent-child dependencies', () => {
      const issues = [
        createIssue({
          id: 'issue-1',
          dependencies: [{ type: 'blocks', depends_on_id: 'issue-2' }],
        }),
      ];
      const { parentMap } = buildIssueLookups(issues);

      expect(parentMap.size).toBe(0);
    });

    it('should handle missing dependencies array', () => {
      const issues = [createIssue({ id: 'issue-1' })];
      const { parentMap } = buildIssueLookups(issues);

      expect(parentMap.size).toBe(0);
    });
  });

  describe('getParentIdFromLookup', () => {
    it('should return parent ID when exists', () => {
      const parentMap = new Map([
        ['child-1', 'parent-1'],
        ['child-2', 'parent-2'],
      ]);

      expect(getParentIdFromLookup(parentMap, 'child-1')).toBe('parent-1');
      expect(getParentIdFromLookup(parentMap, 'child-2')).toBe('parent-2');
    });

    it('should return null when no parent', () => {
      const parentMap = new Map([['child-1', 'parent-1']]);

      expect(getParentIdFromLookup(parentMap, 'orphan')).toBeNull();
    });

    it('should handle empty map', () => {
      const parentMap = new Map();

      expect(getParentIdFromLookup(parentMap, 'any')).toBeNull();
    });
  });
});
