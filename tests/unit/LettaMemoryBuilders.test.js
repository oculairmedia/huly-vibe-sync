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
  buildBoardMetricsFromSQL,
  buildBacklogSummaryFromSQL,
  buildHotspotsFromSQL,
  buildComponentsSummaryFromSQL,
  buildRecentActivityFromSQL,
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

  // ============================================================
  // SQL-Based Builder Variants
  // ============================================================

  describe('buildBoardMetricsFromSQL', () => {
    it('should build metrics from pre-aggregated status counts', () => {
      const statusCounts = [
        { status: 'open', count: 5 },
        { status: 'in-progress', count: 3 },
        { status: 'closed', count: 12 },
      ];

      const result = buildBoardMetricsFromSQL(statusCounts);

      expect(result.total_tasks).toBe(20);
      expect(result.by_status.open).toBe(5);
      expect(result.by_status['in-progress']).toBe(3);
      expect(result.by_status.closed).toBe(12);
      expect(result.wip_count).toBe(3);
      expect(result.completion_rate).toBe('60.0%');
      expect(result.active_tasks).toBe(8);
    });

    it('should handle empty status counts', () => {
      const result = buildBoardMetricsFromSQL([]);

      expect(result.total_tasks).toBe(0);
      expect(result.completion_rate).toBe('0%');
      expect(result.active_tasks).toBe(0);
    });

    it('should ignore unknown statuses in by_status but count them in total', () => {
      const statusCounts = [
        { status: 'open', count: 2 },
        { status: 'tombstone', count: 1 },
      ];

      const result = buildBoardMetricsFromSQL(statusCounts);

      expect(result.total_tasks).toBe(3);
      expect(result.by_status.open).toBe(2);
      // tombstone not in by_status keys
      expect(result.by_status.tombstone).toBeUndefined();
    });

    it('should produce same shape as buildBoardMetrics', () => {
      const issues = [
        createBeadsIssue({ _beads: { raw_status: 'open', raw_priority: 2 } }),
        createBeadsIssue({ _beads: { raw_status: 'closed', raw_priority: 2 } }),
      ];
      const arrayResult = buildBoardMetrics(issues);
      const sqlResult = buildBoardMetricsFromSQL([
        { status: 'open', count: 1 },
        { status: 'closed', count: 1 },
      ]);

      // Same keys
      expect(Object.keys(sqlResult).sort()).toEqual(Object.keys(arrayResult).sort());
    });
  });

  describe('buildBacklogSummaryFromSQL', () => {
    it('should build backlog from pre-sorted open issues', () => {
      const openIssues = [
        { id: 'i-1', title: 'Urgent fix', priority: 0 },
        { id: 'i-2', title: 'High fix', priority: 1 },
        { id: 'i-3', title: 'Medium task', priority: 2 },
        { id: 'i-4', title: 'Low task', priority: 3 },
      ];

      const result = buildBacklogSummaryFromSQL(openIssues);

      expect(result.total_backlog).toBe(4);
      expect(result.top_items).toHaveLength(4);
      expect(result.top_items[0].priority).toBe('urgent');
      expect(result.top_items[1].priority).toBe('high');
      expect(result.priority_breakdown.urgent).toBe(1);
      expect(result.priority_breakdown.high).toBe(1);
      expect(result.priority_breakdown.medium).toBe(1);
      expect(result.priority_breakdown.low).toBe(1);
    });

    it('should limit to top 15 items', () => {
      const openIssues = Array.from({ length: 20 }, (_, i) => ({
        id: `i-${i}`,
        title: `Task ${i}`,
        priority: 2,
      }));

      const result = buildBacklogSummaryFromSQL(openIssues);

      expect(result.total_backlog).toBe(20);
      expect(result.top_items).toHaveLength(15);
    });

    it('should handle empty list', () => {
      const result = buildBacklogSummaryFromSQL([]);

      expect(result.total_backlog).toBe(0);
      expect(result.top_items).toHaveLength(0);
    });
  });

  describe('buildHotspotsFromSQL', () => {
    it('should build hotspots from pre-filtered SQL results', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

      const result = buildHotspotsFromSQL({
        blocked: [
          { id: 'b-1', title: 'Blocked by API', status: 'in-progress' },
          { id: 'b-2', title: 'Waiting on review', status: 'open' },
        ],
        agingWip: [
          { id: 'a-1', title: 'Old task', status: 'in-progress', updated_at: tenDaysAgo },
        ],
        highPriority: [
          { id: 'h-1', title: 'Urgent fix', priority: 0 },
        ],
      });

      expect(result.blocked_items).toHaveLength(2);
      expect(result.blocked_items[0].id).toBe('b-1');
      expect(result.ageing_wip).toHaveLength(1);
      expect(result.ageing_wip[0].age_days).toBeGreaterThanOrEqual(10);
      expect(result.high_priority_open).toHaveLength(1);
      expect(result.high_priority_open[0].priority).toBe('urgent');
      expect(result.summary.blocked_count).toBe(2);
      expect(result.summary.ageing_wip_count).toBe(1);
      expect(result.summary.high_priority_count).toBe(1);
    });

    it('should handle empty arrays', () => {
      const result = buildHotspotsFromSQL({
        blocked: [],
        agingWip: [],
        highPriority: [],
      });

      expect(result.blocked_items).toHaveLength(0);
      expect(result.ageing_wip).toHaveLength(0);
      expect(result.high_priority_open).toHaveLength(0);
      expect(result.summary.blocked_count).toBe(0);
    });

    it('should limit each category to 10 items', () => {
      const blocked = Array.from({ length: 15 }, (_, i) => ({
        id: `b-${i}`, title: `Blocked ${i}`, status: 'open',
      }));

      const result = buildHotspotsFromSQL({
        blocked,
        agingWip: [],
        highPriority: [],
      });

      expect(result.blocked_items).toHaveLength(10);
    });

    it('should sort aging WIP by age descending', () => {
      const result = buildHotspotsFromSQL({
        blocked: [],
        agingWip: [
          { id: 'a-1', title: 'Newer', updated_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() },
          { id: 'a-2', title: 'Older', updated_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString() },
        ],
        highPriority: [],
      });

      expect(result.ageing_wip[0].id).toBe('a-2');
      expect(result.ageing_wip[1].id).toBe('a-1');
    });
  });

  describe('buildComponentsSummaryFromSQL', () => {
    it('should build from pre-grouped type stats', () => {
      const typeStats = [
        { issue_type: 'task', status: 'open', count: 5 },
        { issue_type: 'task', status: 'closed', count: 3 },
        { issue_type: 'bug', status: 'in-progress', count: 2 },
        { issue_type: 'bug', status: 'open', count: 1 },
      ];

      const result = buildComponentsSummaryFromSQL(typeStats);

      expect(result.total_types).toBe(2);
      expect(result.types[0].type).toBe('task'); // Most issues
      expect(result.types[0].issue_count).toBe(8);
      expect(result.types[0].status_breakdown.open).toBe(5);
      expect(result.types[0].status_breakdown.closed).toBe(3);
      expect(result.types[1].type).toBe('bug');
      expect(result.types[1].issue_count).toBe(3);
    });

    it('should track untyped issues', () => {
      const typeStats = [
        { issue_type: null, status: 'open', count: 4 },
        { issue_type: 'task', status: 'open', count: 2 },
      ];

      const result = buildComponentsSummaryFromSQL(typeStats);

      expect(result.total_types).toBe(1);
      expect(result.untyped_count).toBe(4);
    });

    it('should handle empty input', () => {
      const result = buildComponentsSummaryFromSQL([]);

      expect(result.total_types).toBe(0);
      expect(result.types).toHaveLength(0);
      expect(result.summary).toContain('No issues found');
    });

    it('should handle null input', () => {
      const result = buildComponentsSummaryFromSQL(null);

      expect(result.total_types).toBe(0);
      expect(result.untyped_count).toBe(0);
    });
  });

  // ============================================================
  // buildRecentActivityFromSQL Tests
  // ============================================================

  describe('buildRecentActivityFromSQL', () => {
    it('should build activity from Dolt diff changes', () => {
      const doltChanges = {
        changes: [
          { action: 'created', id: 'i-1', title: 'New issue', from_status: null, to_status: 'open', updated_at: '2025-06-01T10:00:00Z', diff_type: 'added' },
          { action: 'updated', id: 'i-2', title: 'Updated issue', from_status: 'open', to_status: 'in-progress', updated_at: '2025-06-01T11:00:00Z', diff_type: 'modified' },
          { action: 'closed', id: 'i-3', title: 'Closed issue', from_status: 'in-progress', to_status: 'closed', updated_at: '2025-06-01T12:00:00Z', diff_type: 'modified' },
          { action: 'deleted', id: 'i-4', title: 'Deleted issue', from_status: 'open', to_status: null, updated_at: '2025-06-01T13:00:00Z', diff_type: 'removed' },
        ],
        summary: { created: 1, updated: 1, closed: 1, deleted: 1, total: 4 },
        byStatus: { open: 1, 'in-progress': 1, closed: 1 },
        since: '2025-05-31T10:00:00Z',
      };

      const result = buildRecentActivityFromSQL(doltChanges);

      expect(result.since).toBe('2025-05-31T10:00:00Z');
      expect(result.summary.created).toBe(1);
      expect(result.summary.updated).toBe(1);
      expect(result.summary.closed).toBe(1);
      expect(result.summary.deleted).toBe(1);
      expect(result.summary.total).toBe(4);
      expect(result.by_status['in-progress']).toBe(1);
      expect(result.recent_items).toHaveLength(4);
      expect(result.recent_items[0].type).toBe('issue.created');
      expect(result.recent_items[1].type).toBe('issue.updated');
      expect(result.recent_items[2].type).toBe('issue.closed');
      expect(result.recent_items[3].type).toBe('issue.deleted');
    });

    it('should handle null/empty input', () => {
      const result = buildRecentActivityFromSQL(null);

      expect(result.since).toBeNull();
      expect(result.summary.total).toBe(0);
      expect(result.recent_items).toHaveLength(0);
      expect(result.patterns).toHaveLength(0);
    });

    it('should handle empty changes array', () => {
      const result = buildRecentActivityFromSQL({
        changes: [],
        summary: { created: 0, updated: 0, closed: 0, deleted: 0, total: 0 },
        byStatus: {},
        since: '2025-05-31T10:00:00Z',
      });

      expect(result.since).toBe('2025-05-31T10:00:00Z');
      expect(result.summary.total).toBe(0);
      expect(result.recent_items).toHaveLength(0);
    });

    it('should detect high_activity pattern', () => {
      const changes = Array.from({ length: 25 }, (_, i) => ({
        action: 'updated',
        id: `i-${i}`,
        title: `Issue ${i}`,
        from_status: 'open',
        to_status: 'open',
        updated_at: new Date().toISOString(),
        diff_type: 'modified',
      }));

      const result = buildRecentActivityFromSQL({
        changes,
        summary: { created: 0, updated: 25, closed: 0, deleted: 0, total: 25 },
        byStatus: { open: 25 },
        since: '2025-05-31T10:00:00Z',
      });

      expect(result.patterns).toContainEqual(
        expect.objectContaining({ type: 'high_activity', severity: 'info' })
      );
    });

    it('should detect completion_streak pattern', () => {
      const result = buildRecentActivityFromSQL({
        changes: Array.from({ length: 6 }, (_, i) => ({
          action: 'closed',
          id: `i-${i}`,
          title: `Issue ${i}`,
          from_status: 'in-progress',
          to_status: 'closed',
          updated_at: new Date().toISOString(),
          diff_type: 'modified',
        })),
        summary: { created: 0, updated: 0, closed: 6, deleted: 0, total: 6 },
        byStatus: { closed: 6 },
        since: '2025-05-31T10:00:00Z',
      });

      expect(result.patterns).toContainEqual(
        expect.objectContaining({ type: 'completion_streak', severity: 'positive' })
      );
    });

    it('should detect high_wip pattern', () => {
      const result = buildRecentActivityFromSQL({
        changes: Array.from({ length: 7 }, (_, i) => ({
          action: 'updated',
          id: `i-${i}`,
          title: `Issue ${i}`,
          from_status: 'open',
          to_status: 'in-progress',
          updated_at: new Date().toISOString(),
          diff_type: 'modified',
        })),
        summary: { created: 0, updated: 7, closed: 0, deleted: 0, total: 7 },
        byStatus: { 'in-progress': 7 },
        since: '2025-05-31T10:00:00Z',
      });

      expect(result.patterns).toContainEqual(
        expect.objectContaining({ type: 'high_wip', severity: 'info' })
      );
    });

    it('should detect no_activity pattern', () => {
      const result = buildRecentActivityFromSQL({
        changes: [],
        summary: { created: 0, updated: 0, closed: 0, deleted: 0, total: 0 },
        byStatus: {},
        since: '2025-05-31T10:00:00Z',
      });

      expect(result.patterns).toContainEqual(
        expect.objectContaining({ type: 'no_activity', severity: 'info' })
      );
    });

    it('should limit recent_items to 10', () => {
      const changes = Array.from({ length: 15 }, (_, i) => ({
        action: 'updated',
        id: `i-${i}`,
        title: `Issue ${i}`,
        from_status: 'open',
        to_status: 'open',
        updated_at: new Date().toISOString(),
        diff_type: 'modified',
      }));

      const result = buildRecentActivityFromSQL({
        changes,
        summary: { created: 0, updated: 15, closed: 0, deleted: 0, total: 15 },
        byStatus: { open: 15 },
        since: '2025-05-31T10:00:00Z',
      });

      expect(result.recent_items).toHaveLength(10);
    });

    it('should produce same output shape as buildRecentActivity', () => {
      const doltResult = buildRecentActivityFromSQL({
        changes: [
          { action: 'created', id: 'i-1', title: 'Issue', from_status: null, to_status: 'open', updated_at: new Date().toISOString(), diff_type: 'added' },
        ],
        summary: { created: 1, updated: 0, closed: 0, deleted: 0, total: 1 },
        byStatus: { open: 1 },
        since: '2025-05-31T10:00:00Z',
      });

      const arrayResult = buildRecentActivity({
        activities: [{ type: 'issue.created', issue: 'i-1', title: 'Issue', status: 'open', timestamp: new Date().toISOString() }],
        summary: { created: 1, updated: 0, total: 1 },
        byStatus: { open: 1 },
        since: '2025-05-31T10:00:00Z',
      });

      // Both should have the same top-level keys
      expect(Object.keys(doltResult).sort()).toEqual(Object.keys(arrayResult).sort());
      // Both should have patterns array
      expect(Array.isArray(doltResult.patterns)).toBe(true);
      expect(Array.isArray(arrayResult.patterns)).toBe(true);
    });
  });
});
