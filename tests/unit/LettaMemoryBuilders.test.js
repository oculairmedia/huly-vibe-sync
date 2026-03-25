/**
 * Unit Tests for Letta Memory Block Builder Functions
 */

import { describe, it, expect } from 'vitest';
import {
  buildProjectMeta,
  buildBoardConfig,
  buildBoardMetrics,
  buildHotspots,
  buildBacklogSummary,
  buildRecentActivity,
  buildComponentsSummary,
  buildChangeLog,
  buildScratchpad,
  buildExpression,
} from '../../lib/LettaMemoryBuilders.js';

// Helper to create beads-format test issues
function createBeadsIssue(overrides = {}) {
  const defaults = {
    id: 'test-' + Math.random().toString(36).substring(7),
    identifier: 'TEST-1',
    title: 'Test Issue',
    description: '',
    status: 'Todo', // Normalized status
    priority: 'medium', // Normalized priority
    createdOn: Date.now(),
    modifiedOn: Date.now(),
    component: null,
    assignee: null,
    _beads: {
      raw_status: 'open',
      raw_priority: 2,
      closed_at: null,
      close_reason: null,
    },
  };
  return { ...defaults, ...overrides };
}

describe('Letta Memory Block Builders', () => {
  // ============================================================
  // buildProjectMeta Tests
  // ============================================================
  describe('buildProjectMeta', () => {
    it('should build project metadata', () => {
      const project = {
        identifier: 'TEST',
        name: 'Test Project',
        description: 'A test project',
        status: 'active',
      };

      const result = buildProjectMeta(project, '/path/to/repo', 'https://github.com/test/repo');

      expect(result.name).toBe('Test Project');
      expect(result.identifier).toBe('TEST');
      expect(result.description).toBe('A test project');
      expect(result.status).toBe('active');
      expect(result.repository.filesystem_path).toBe('/path/to/repo');
      expect(result.repository.git_url).toBe('https://github.com/test/repo');
    });

    it('should handle missing optional fields', () => {
      const project = { name: 'Minimal Project' };

      const result = buildProjectMeta(project, null, null);

      expect(result.name).toBe('Minimal Project');
      expect(result.identifier).toBe('Minimal Project'); // Falls back to name
      expect(result.description).toBe('');
      expect(result.repository.filesystem_path).toBeNull();
    });
  });

  // ============================================================
  // buildBoardConfig Tests
  // ============================================================
  describe('buildBoardConfig', () => {
    it('should return beads workflow configuration', () => {
      const result = buildBoardConfig();

      expect(result.statuses.open).toBeDefined();
      expect(result.statuses['in-progress']).toBeDefined();
      expect(result.statuses.closed).toBeDefined();
      expect(result.priorities.P0).toContain('Urgent');
      expect(result.priorities.P4).toContain('Backlog');
      expect(result.workflow.description).toContain('Beads');
      expect(result.workflow.status_flow).toBe('open → in-progress → closed');
    });
  });

  // ============================================================
  // buildBoardMetrics Tests
  // ============================================================
  describe('buildBoardMetrics', () => {
    it('should calculate metrics from beads issues', () => {
      const issues = [
        createBeadsIssue({ _beads: { raw_status: 'open', raw_priority: 2 } }),
        createBeadsIssue({ _beads: { raw_status: 'open', raw_priority: 2 } }),
        createBeadsIssue({ _beads: { raw_status: 'in-progress', raw_priority: 1 } }),
        createBeadsIssue({ _beads: { raw_status: 'closed', raw_priority: 2 } }),
        createBeadsIssue({ _beads: { raw_status: 'closed', raw_priority: 2 } }),
      ];

      const result = buildBoardMetrics(issues);

      expect(result.total_tasks).toBe(5);
      expect(result.by_status.open).toBe(2);
      expect(result.by_status['in-progress']).toBe(1);
      expect(result.by_status.closed).toBe(2);
      expect(result.wip_count).toBe(1); // in-progress only
      expect(result.completion_rate).toBe('40.0%');
      expect(result.active_tasks).toBe(3); // open + in-progress
    });

    it('should handle empty task list', () => {
      const result = buildBoardMetrics([]);

      expect(result.total_tasks).toBe(0);
      expect(result.completion_rate).toBe('0%');
    });
  });

  // ============================================================
  // buildHotspots Tests
  // ============================================================
  describe('buildHotspots', () => {
    it('should identify blocked items by keywords', () => {
      const issues = [
        createBeadsIssue({
          identifier: 'TEST-1',
          title: 'Normal task',
          _beads: { raw_status: 'open' },
        }),
        createBeadsIssue({
          identifier: 'TEST-2',
          title: 'Blocked by API',
          _beads: { raw_status: 'in-progress' },
        }),
        createBeadsIssue({
          identifier: 'TEST-3',
          title: 'Waiting on review',
          description: '',
          _beads: { raw_status: 'in-progress' },
        }),
      ];

      const result = buildHotspots(issues);

      expect(result.blocked_items).toHaveLength(2);
      expect(result.blocked_items[0].title).toBe('Blocked by API');
      expect(result.summary.blocked_count).toBe(2);
    });

    it('should identify ageing WIP items', () => {
      const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
      const issues = [
        createBeadsIssue({
          identifier: 'TEST-1',
          title: 'Old task',
          _beads: { raw_status: 'in-progress' },
          modifiedOn: tenDaysAgo,
        }),
      ];

      const result = buildHotspots(issues);

      expect(result.ageing_wip).toHaveLength(1);
      expect(result.ageing_wip[0].age_days).toBeGreaterThanOrEqual(10);
    });

    it('should identify high priority open items', () => {
      const issues = [
        createBeadsIssue({
          identifier: 'TEST-1',
          title: 'Urgent fix',
          _beads: { raw_status: 'open' },
          priority: 'urgent',
        }),
        createBeadsIssue({
          identifier: 'TEST-2',
          title: 'Normal task',
          _beads: { raw_status: 'open' },
          priority: 'medium',
        }),
      ];

      const result = buildHotspots(issues);

      expect(result.high_priority_open).toHaveLength(1);
      expect(result.high_priority_open[0].priority).toBe('urgent');
    });
  });

  // ============================================================
  // buildBacklogSummary Tests
  // ============================================================
  describe('buildBacklogSummary', () => {
    it('should summarize backlog by priority', () => {
      const issues = [
        createBeadsIssue({
          identifier: 'TEST-1',
          title: 'Urgent',
          _beads: { raw_status: 'open' },
          priority: 'urgent',
        }),
        createBeadsIssue({
          identifier: 'TEST-2',
          title: 'High',
          _beads: { raw_status: 'open' },
          priority: 'high',
        }),
        createBeadsIssue({
          identifier: 'TEST-3',
          title: 'Medium',
          _beads: { raw_status: 'open' },
          priority: 'medium',
        }),
        createBeadsIssue({
          identifier: 'TEST-4',
          title: 'Done',
          _beads: { raw_status: 'closed' },
          priority: 'high',
        }),
      ];

      const result = buildBacklogSummary(issues);

      expect(result.total_backlog).toBe(3); // Only open items
      expect(result.priority_breakdown.urgent).toBe(1);
      expect(result.priority_breakdown.high).toBe(1);
      expect(result.priority_breakdown.medium).toBe(1);
      expect(result.top_items).toHaveLength(3);
      expect(result.top_items[0].priority).toBe('urgent'); // Sorted by priority
    });

    it('should limit to top 15 items', () => {
      const issues = Array.from({ length: 20 }, (_, i) =>
        createBeadsIssue({
          identifier: `TEST-${i}`,
          title: `Task ${i}`,
          _beads: { raw_status: 'open' },
        })
      );

      const result = buildBacklogSummary(issues);

      expect(result.top_items).toHaveLength(15);
      expect(result.total_backlog).toBe(20);
    });
  });

  // ============================================================
  // buildRecentActivity Tests
  // ============================================================
  describe('buildRecentActivity', () => {
    it('should build activity summary from API response', () => {
      const activityData = {
        since: '2025-01-15T00:00:00Z',
        activities: [
          {
            type: 'issue.created',
            issue: 'TEST-1',
            title: 'New issue',
            status: 'Backlog',
            timestamp: '2025-01-15T10:00:00Z',
          },
          {
            type: 'issue.updated',
            issue: 'TEST-2',
            title: 'Updated',
            status: 'Done',
            timestamp: '2025-01-15T11:00:00Z',
          },
        ],
        summary: { created: 1, updated: 1, total: 2 },
        byStatus: { Backlog: 1, Done: 1 },
      };

      const result = buildRecentActivity(activityData);

      expect(result.since).toBe('2025-01-15T00:00:00Z');
      expect(result.summary.total).toBe(2);
      expect(result.by_status.Done).toBe(1);
      expect(result.recent_items).toHaveLength(2);
      expect(result.recent_items[0].issue).toBe('TEST-1');
    });

    it('should handle null/empty activity data', () => {
      const result = buildRecentActivity(null);

      expect(result.since).toBeNull();
      expect(result.summary.total).toBe(0);
      expect(result.recent_items).toHaveLength(0);
      expect(result.patterns).toHaveLength(0);
    });

    it('should detect high WIP pattern', () => {
      const activityData = {
        since: '2025-01-15T00:00:00Z',
        activities: [],
        summary: { created: 0, updated: 10, total: 10 },
        byStatus: { 'In Progress': 10 },
      };

      const result = buildRecentActivity(activityData);

      expect(result.patterns).toContainEqual(
        expect.objectContaining({ type: 'high_wip', severity: 'info' })
      );
    });

    it('should detect high activity pattern', () => {
      const activityData = {
        since: '2025-01-15T00:00:00Z',
        activities: [],
        summary: { created: 15, updated: 10, total: 25 },
        byStatus: {},
      };

      const result = buildRecentActivity(activityData);

      expect(result.patterns).toContainEqual(
        expect.objectContaining({ type: 'high_activity', severity: 'info' })
      );
    });

    it('should detect completion streak pattern', () => {
      const activityData = {
        since: '2025-01-15T00:00:00Z',
        activities: [],
        summary: { created: 0, updated: 8, total: 8 },
        byStatus: { Done: 8 },
      };

      const result = buildRecentActivity(activityData);

      expect(result.patterns).toContainEqual(
        expect.objectContaining({ type: 'completion_streak', severity: 'positive' })
      );
    });

    it('should detect no activity pattern', () => {
      const activityData = {
        since: '2025-01-15T00:00:00Z',
        activities: [],
        summary: { created: 0, updated: 0, total: 0 },
        byStatus: {},
      };

      const result = buildRecentActivity(activityData);

      expect(result.patterns).toContainEqual(
        expect.objectContaining({ type: 'no_activity', severity: 'info' })
      );
    });

    it('should limit recent items to 10', () => {
      const activities = Array.from({ length: 15 }, (_, i) => ({
        type: 'issue.updated',
        issue: `TEST-${i}`,
        title: `Issue ${i}`,
        status: 'Done',
        timestamp: new Date().toISOString(),
      }));

      const activityData = {
        since: '2025-01-15T00:00:00Z',
        activities,
        summary: { created: 0, updated: 15, total: 15 },
        byStatus: { Done: 15 },
      };

      const result = buildRecentActivity(activityData);

      expect(result.recent_items).toHaveLength(10);
    });
  });

  // ============================================================
  // buildComponentsSummary Tests (now type-based)
  // ============================================================
  describe('buildComponentsSummary', () => {
    it('should build issue type summary with counts', () => {
      const issues = [
        createBeadsIssue({
          identifier: 'TEST-1',
          component: 'task',
          _beads: { raw_status: 'closed' },
        }),
        createBeadsIssue({
          identifier: 'TEST-2',
          component: 'task',
          _beads: { raw_status: 'open' },
        }),
        createBeadsIssue({
          identifier: 'TEST-3',
          component: 'bug',
          _beads: { raw_status: 'in-progress' },
        }),
        createBeadsIssue({ identifier: 'TEST-4', component: null, _beads: { raw_status: 'open' } }), // Untyped
      ];

      const result = buildComponentsSummary(issues);

      expect(result.total_types).toBe(2); // task and bug
      expect(result.untyped_count).toBe(1);

      // Types should be sorted by issue count
      expect(result.types[0].type).toBe('task');
      expect(result.types[0].issue_count).toBe(2);
      expect(result.types[0].status_breakdown.closed).toBe(1);
      expect(result.types[0].status_breakdown.open).toBe(1);
    });

    it('should handle empty issue list', () => {
      const result = buildComponentsSummary([]);

      expect(result.total_types).toBe(0);
      expect(result.types).toHaveLength(0);
      expect(result.untyped_count).toBe(0);
      expect(result.summary).toContain('No issues found');
    });

    it('should handle null/undefined inputs', () => {
      const result = buildComponentsSummary(null);

      expect(result.total_types).toBe(0);
      expect(result.untyped_count).toBe(0);
    });

    it('should calculate status breakdown per type', () => {
      const issues = [
        createBeadsIssue({ identifier: 'TEST-1', component: 'feature', _beads: { raw_status: 'open' } }),
        createBeadsIssue({ identifier: 'TEST-2', component: 'feature', _beads: { raw_status: 'open' } }),
        createBeadsIssue({ identifier: 'TEST-3', component: 'feature', _beads: { raw_status: 'closed' } }),
        createBeadsIssue({
          identifier: 'TEST-4',
          component: 'feature',
          _beads: { raw_status: 'in-progress' },
        }),
      ];

      const result = buildComponentsSummary(issues);

      expect(result.types[0].status_breakdown).toEqual({
        open: 2,
        closed: 1,
        'in-progress': 1,
      });
    });
  });

  // ============================================================
  // buildChangeLog Tests
  // ============================================================
  describe('buildChangeLog', () => {
    it('should mark all issues as new on first sync', () => {
      const currentIssues = [
        createBeadsIssue({ identifier: 'TEST-1', title: 'Issue 1', _beads: { raw_status: 'open' } }),
        createBeadsIssue({ identifier: 'TEST-2', title: 'Issue 2', _beads: { raw_status: 'closed' } }),
      ];
      const mockDb = { getProjectIssues: () => [] };

      const result = buildChangeLog(currentIssues, null, mockDb, 'TEST');

      expect(result.summary.first_sync).toBe(true);
      expect(result.summary.new_count).toBe(2);
      expect(result.new_issues).toHaveLength(2);
    });

    it('should detect new issues', () => {
      const currentIssues = [
        createBeadsIssue({ identifier: 'TEST-1', title: 'Existing', _beads: { raw_status: 'open' } }),
        createBeadsIssue({ identifier: 'TEST-2', title: 'New Issue', _beads: { raw_status: 'open' } }),
      ];
      const mockDb = {
        getProjectIssues: () => [
          createBeadsIssue({ identifier: 'TEST-1', title: 'Existing', _beads: { raw_status: 'open' } }),
        ],
      };

      const result = buildChangeLog(currentIssues, Date.now() - 1000, mockDb, 'TEST');

      expect(result.summary.first_sync).toBe(false);
      expect(result.new_issues).toHaveLength(1);
      expect(result.new_issues[0].identifier).toBe('TEST-2');
    });

    it('should detect status transitions', () => {
      const currentIssues = [
        createBeadsIssue({ identifier: 'TEST-1', title: 'Issue 1', _beads: { raw_status: 'closed' } }),
      ];
      const mockDb = {
        getProjectIssues: () => [
          createBeadsIssue({
            identifier: 'TEST-1',
            title: 'Issue 1',
            _beads: { raw_status: 'in-progress' },
          }),
        ],
      };

      const result = buildChangeLog(currentIssues, Date.now() - 1000, mockDb, 'TEST');

      expect(result.status_transitions).toHaveLength(1);
      expect(result.status_transitions[0].from).toBe('in-progress');
      expect(result.status_transitions[0].to).toBe('closed');
    });

    it('should detect closed/removed issues', () => {
      const currentIssues = [];
      const mockDb = {
        getProjectIssues: () => [
          createBeadsIssue({ identifier: 'TEST-1', title: 'Removed Issue', _beads: { raw_status: 'open' } }),
        ],
      };

      const result = buildChangeLog(currentIssues, Date.now() - 1000, mockDb, 'TEST');

      expect(result.closed_issues).toHaveLength(1);
      expect(result.closed_issues[0].identifier).toBe('TEST-1');
    });

    it('should detect title changes', () => {
      const currentIssues = [
        createBeadsIssue({ identifier: 'TEST-1', title: 'Updated Title', _beads: { raw_status: 'open' } }),
      ];
      const mockDb = {
        getProjectIssues: () => [
          createBeadsIssue({ identifier: 'TEST-1', title: 'Old Title', _beads: { raw_status: 'open' } }),
        ],
      };

      const result = buildChangeLog(currentIssues, Date.now() - 1000, mockDb, 'TEST');

      expect(result.updated_issues).toHaveLength(1);
      expect(result.updated_issues[0].change).toBe('title');
    });

    it('should limit results to prevent large blocks', () => {
      const currentIssues = Array.from({ length: 20 }, (_, i) =>
        createBeadsIssue({
          identifier: `TEST-${i}`,
          title: `Issue ${i}`,
          _beads: { raw_status: 'open' },
        })
      );
      const mockDb = { getProjectIssues: () => [] };

      const result = buildChangeLog(currentIssues, null, mockDb, 'TEST');

      expect(result.new_issues.length).toBeLessThanOrEqual(10);
    });
  });

  // ============================================================
  // buildScratchpad Tests
  // ============================================================
  describe('buildScratchpad', () => {
    it('should return empty scratchpad structure', () => {
      const result = buildScratchpad();

      expect(result.notes).toEqual([]);
      expect(result.observations).toEqual([]);
      expect(result.action_items).toEqual([]);
      expect(result.context).toEqual({});
    });

    it('should include usage guide', () => {
      const result = buildScratchpad();

      expect(result.usage_guide).toContain('scratchpad');
      expect(result.usage_guide).toContain('working memory');
    });

    it('should have stable structure for content hashing', () => {
      const result1 = buildScratchpad();
      const result2 = buildScratchpad();

      // Structure should be identical (no timestamps or random values)
      expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
    });
  });

  describe('buildExpression', () => {
    it('should return a string for pm role', () => {
      const result = buildExpression('pm');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(100);
    });

    it('should default to pm role', () => {
      const result = buildExpression();
      expect(result).toBe(buildExpression('pm'));
    });

    it('should include anti-slop base rules for all roles', () => {
      for (const role of ['pm', 'companion', 'developer']) {
        const result = buildExpression(role);
        expect(result).toContain('Communication Anti-Patterns');
        expect(result).toContain('Great question!');
        expect(result).toContain('certainly!');
        expect(result).toContain('happy to help');
      }
    });

    it('should include PM voice for pm role', () => {
      const result = buildExpression('pm');
      expect(result).toContain('PM Voice');
      expect(result).toContain('Terse and action-oriented');
      expect(result).not.toContain('Companion Voice');
      expect(result).not.toContain('Developer Voice');
    });

    it('should include Companion voice for companion role', () => {
      const result = buildExpression('companion');
      expect(result).toContain('Companion Voice');
      expect(result).not.toContain('PM Voice');
    });

    it('should include Developer voice for developer role', () => {
      const result = buildExpression('developer');
      expect(result).toContain('Developer Voice');
      expect(result).not.toContain('PM Voice');
    });

    it('should fall back to pm for unknown role', () => {
      const result = buildExpression('unknown');
      expect(result).toContain('PM Voice');
    });

    it('should be stable for content hashing', () => {
      const result1 = buildExpression('pm');
      const result2 = buildExpression('pm');
      expect(result1).toBe(result2);
    });
  });
});
