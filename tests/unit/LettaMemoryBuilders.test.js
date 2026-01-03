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
} from '../../lib/LettaMemoryBuilders.js';

describe('Letta Memory Block Builders', () => {
  // ============================================================
  // buildProjectMeta Tests
  // ============================================================
  describe('buildProjectMeta', () => {
    it('should build project metadata', () => {
      const hulyProject = {
        id: 'huly-123',
        identifier: 'TEST',
        name: 'Test Project',
        description: 'A test project',
      };
      const vibeProject = { id: 'vibe-456' };

      const result = buildProjectMeta(hulyProject, vibeProject, '/path/to/repo', 'https://github.com/test/repo');

      expect(result.name).toBe('Test Project');
      expect(result.identifier).toBe('TEST');
      expect(result.description).toBe('A test project');
      expect(result.huly.id).toBe('huly-123');
      expect(result.vibe.id).toBe('vibe-456');
      expect(result.repository.filesystem_path).toBe('/path/to/repo');
      expect(result.repository.git_url).toBe('https://github.com/test/repo');
    });

    it('should handle missing optional fields', () => {
      const hulyProject = { name: 'Minimal Project' };
      const vibeProject = { id: 'vibe-1' };

      const result = buildProjectMeta(hulyProject, vibeProject, null, null);

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
    it('should return static board configuration', () => {
      const result = buildBoardConfig();

      expect(result.status_mapping.huly_to_vibe.Backlog).toBe('todo');
      expect(result.status_mapping.huly_to_vibe.Done).toBe('done');
      expect(result.status_mapping.vibe_to_huly.done).toBe('Done');
      expect(result.workflow.sync_direction).toBe('bidirectional');
      expect(result.definitions_of_done.done).toBeDefined();
    });
  });

  // ============================================================
  // buildBoardMetrics Tests
  // ============================================================
  describe('buildBoardMetrics', () => {
    it('should calculate metrics from tasks', () => {
      const hulyIssues = [];
      const vibeTasks = [
        { status: 'todo' },
        { status: 'todo' },
        { status: 'inprogress' },
        { status: 'done' },
        { status: 'done' },
      ];

      const result = buildBoardMetrics(hulyIssues, vibeTasks);

      expect(result.total_tasks).toBe(5);
      expect(result.by_status.todo).toBe(2);
      expect(result.by_status.inprogress).toBe(1);
      expect(result.by_status.done).toBe(2);
      expect(result.wip_count).toBe(1); // inprogress + inreview
      expect(result.completion_rate).toBe('40.0%');
      expect(result.active_tasks).toBe(3); // todo + inprogress + inreview
    });

    it('should handle empty task list', () => {
      const result = buildBoardMetrics([], []);

      expect(result.total_tasks).toBe(0);
      expect(result.completion_rate).toBe('0%');
    });
  });

  // ============================================================
  // buildHotspots Tests
  // ============================================================
  describe('buildHotspots', () => {
    it('should identify blocked items by keywords', () => {
      const vibeTasks = [
        { id: '1', title: 'Normal task', status: 'todo' },
        { id: '2', title: 'Blocked by API', status: 'inprogress' },
        { id: '3', title: 'Waiting on review', description: '', status: 'inprogress' },
      ];

      const result = buildHotspots([], vibeTasks);

      expect(result.blocked_items).toHaveLength(2);
      expect(result.blocked_items[0].title).toBe('Blocked by API');
      expect(result.summary.blocked_count).toBe(2);
    });

    it('should identify ageing WIP items', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const vibeTasks = [
        { id: '1', title: 'Old task', status: 'inprogress', updated_at: tenDaysAgo },
      ];

      const result = buildHotspots([], vibeTasks);

      expect(result.ageing_wip).toHaveLength(1);
      expect(result.ageing_wip[0].age_days).toBeGreaterThanOrEqual(10);
    });

    it('should identify high priority todos', () => {
      const vibeTasks = [
        { id: '1', title: 'Urgent fix', status: 'todo', priority: 'urgent' },
        { id: '2', title: 'Normal task', status: 'todo', priority: 'medium' },
      ];

      const result = buildHotspots([], vibeTasks);

      expect(result.high_priority_todo).toHaveLength(1);
      expect(result.high_priority_todo[0].priority).toBe('urgent');
    });
  });

  // ============================================================
  // buildBacklogSummary Tests
  // ============================================================
  describe('buildBacklogSummary', () => {
    it('should summarize backlog by priority', () => {
      const vibeTasks = [
        { id: '1', title: 'Urgent', status: 'todo', priority: 'urgent' },
        { id: '2', title: 'High', status: 'todo', priority: 'high' },
        { id: '3', title: 'Medium', status: 'todo', priority: 'medium' },
        { id: '4', title: 'Done', status: 'done', priority: 'high' },
      ];

      const result = buildBacklogSummary([], vibeTasks);

      expect(result.total_backlog).toBe(3); // Only todo items
      expect(result.priority_breakdown.urgent).toBe(1);
      expect(result.priority_breakdown.high).toBe(1);
      expect(result.priority_breakdown.medium).toBe(1);
      expect(result.top_items).toHaveLength(3);
      expect(result.top_items[0].priority).toBe('urgent'); // Sorted by priority
    });

    it('should limit to top 15 items', () => {
      const vibeTasks = Array.from({ length: 20 }, (_, i) => ({
        id: `${i}`,
        title: `Task ${i}`,
        status: 'todo',
      }));

      const result = buildBacklogSummary([], vibeTasks);

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
          { type: 'issue.created', issue: 'TEST-1', title: 'New issue', status: 'Backlog', timestamp: '2025-01-15T10:00:00Z' },
          { type: 'issue.updated', issue: 'TEST-2', title: 'Updated', status: 'Done', timestamp: '2025-01-15T11:00:00Z' },
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

    it('should detect blocked spike pattern', () => {
      const activityData = {
        since: '2025-01-15T00:00:00Z',
        activities: [],
        summary: { created: 0, updated: 5, total: 5 },
        byStatus: { Blocked: 5 },
      };

      const result = buildRecentActivity(activityData);

      expect(result.patterns).toContainEqual(
        expect.objectContaining({ type: 'blocked_spike', severity: 'warning' }),
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
        expect.objectContaining({ type: 'high_activity', severity: 'info' }),
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
        expect.objectContaining({ type: 'completion_streak', severity: 'positive' }),
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
        expect.objectContaining({ type: 'no_activity', severity: 'info' }),
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
  // buildComponentsSummary Tests
  // ============================================================
  describe('buildComponentsSummary', () => {
    it('should build components summary with issue counts', () => {
      const components = [
        { label: 'Core', description: 'Core functionality' },
        { label: 'API', description: 'REST API endpoints' },
        { label: 'Docs', description: 'Documentation' },
      ];
      const hulyIssues = [
        { identifier: 'TEST-1', component: 'Core', status: 'Done' },
        { identifier: 'TEST-2', component: 'Core', status: 'Backlog' },
        { identifier: 'TEST-3', component: 'API', status: 'In Progress' },
        { identifier: 'TEST-4', component: null, status: 'Backlog' }, // Unassigned
      ];

      const result = buildComponentsSummary(components, hulyIssues);

      expect(result.total_components).toBe(3);
      expect(result.active_components).toBe(2); // Core and API have issues
      expect(result.empty_components).toBe(1); // Docs has no issues
      expect(result.unassigned_count).toBe(1);

      // Components should be sorted by issue count
      expect(result.components[0].label).toBe('Core');
      expect(result.components[0].issue_count).toBe(2);
      expect(result.components[0].status_breakdown.Done).toBe(1);
      expect(result.components[0].status_breakdown.Backlog).toBe(1);
    });

    it('should handle empty components list', () => {
      const hulyIssues = [
        { identifier: 'TEST-1', component: null, status: 'Backlog' },
      ];

      const result = buildComponentsSummary([], hulyIssues);

      expect(result.total_components).toBe(0);
      expect(result.components).toHaveLength(0);
      expect(result.unassigned_count).toBe(1);
      expect(result.summary).toContain('No components defined');
    });

    it('should handle null/undefined inputs', () => {
      const result = buildComponentsSummary(null, null);

      expect(result.total_components).toBe(0);
      expect(result.unassigned_count).toBe(0);
    });

    it('should include component descriptions', () => {
      const components = [
        { label: 'Beads Integration', description: 'Beads issue tracker sync' },
      ];
      const hulyIssues = [];

      const result = buildComponentsSummary(components, hulyIssues);

      expect(result.components[0].description).toBe('Beads issue tracker sync');
    });

    it('should deduplicate components by label', () => {
      const components = [
        { label: 'Core', description: 'First description' },
        { label: 'Core', description: 'Second description' }, // Duplicate
      ];
      const hulyIssues = [];

      const result = buildComponentsSummary(components, hulyIssues);

      // Should only have one Core component (first one wins)
      const coreComponents = result.components.filter(c => c.label === 'Core');
      expect(coreComponents).toHaveLength(1);
    });

    it('should calculate status breakdown per component', () => {
      const components = [
        { label: 'API', description: 'API endpoints' },
      ];
      const hulyIssues = [
        { identifier: 'TEST-1', component: 'API', status: 'Backlog' },
        { identifier: 'TEST-2', component: 'API', status: 'Backlog' },
        { identifier: 'TEST-3', component: 'API', status: 'Done' },
        { identifier: 'TEST-4', component: 'API', status: 'In Progress' },
      ];

      const result = buildComponentsSummary(components, hulyIssues);

      expect(result.components[0].status_breakdown).toEqual({
        'Backlog': 2,
        'Done': 1,
        'In Progress': 1,
      });
    });
  });

  // ============================================================
  // buildChangeLog Tests
  // ============================================================
  describe('buildChangeLog', () => {
    it('should mark all issues as new on first sync', () => {
      const currentIssues = [
        { identifier: 'TEST-1', title: 'Issue 1', status: 'Backlog' },
        { identifier: 'TEST-2', title: 'Issue 2', status: 'Done' },
      ];
      const mockDb = { getProjectIssues: () => [] };

      const result = buildChangeLog(currentIssues, null, mockDb, 'TEST');

      expect(result.summary.first_sync).toBe(true);
      expect(result.summary.new_count).toBe(2);
      expect(result.new_issues).toHaveLength(2);
    });

    it('should detect new issues', () => {
      const currentIssues = [
        { identifier: 'TEST-1', title: 'Existing', status: 'Backlog' },
        { identifier: 'TEST-2', title: 'New Issue', status: 'Backlog' },
      ];
      const mockDb = {
        getProjectIssues: () => [
          { identifier: 'TEST-1', title: 'Existing', status: 'Backlog' },
        ],
      };

      const result = buildChangeLog(currentIssues, Date.now() - 1000, mockDb, 'TEST');

      expect(result.summary.first_sync).toBe(false);
      expect(result.new_issues).toHaveLength(1);
      expect(result.new_issues[0].identifier).toBe('TEST-2');
    });

    it('should detect status transitions', () => {
      const currentIssues = [
        { identifier: 'TEST-1', title: 'Issue 1', status: 'Done' },
      ];
      const mockDb = {
        getProjectIssues: () => [
          { identifier: 'TEST-1', title: 'Issue 1', status: 'In Progress' },
        ],
      };

      const result = buildChangeLog(currentIssues, Date.now() - 1000, mockDb, 'TEST');

      expect(result.status_transitions).toHaveLength(1);
      expect(result.status_transitions[0].from).toBe('In Progress');
      expect(result.status_transitions[0].to).toBe('Done');
    });

    it('should detect closed/removed issues', () => {
      const currentIssues = [];
      const mockDb = {
        getProjectIssues: () => [
          { identifier: 'TEST-1', title: 'Removed Issue', status: 'Backlog' },
        ],
      };

      const result = buildChangeLog(currentIssues, Date.now() - 1000, mockDb, 'TEST');

      expect(result.closed_issues).toHaveLength(1);
      expect(result.closed_issues[0].identifier).toBe('TEST-1');
    });

    it('should detect title changes', () => {
      const currentIssues = [
        { identifier: 'TEST-1', title: 'Updated Title', status: 'Backlog' },
      ];
      const mockDb = {
        getProjectIssues: () => [
          { identifier: 'TEST-1', title: 'Old Title', status: 'Backlog' },
        ],
      };

      const result = buildChangeLog(currentIssues, Date.now() - 1000, mockDb, 'TEST');

      expect(result.updated_issues).toHaveLength(1);
      expect(result.updated_issues[0].change).toBe('title');
    });

    it('should limit results to prevent large blocks', () => {
      const currentIssues = Array.from({ length: 20 }, (_, i) => ({
        identifier: `TEST-${i}`,
        title: `Issue ${i}`,
        status: 'Backlog',
      }));
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
});
