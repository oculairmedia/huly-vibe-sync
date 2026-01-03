/**
 * LettaMemoryBuilders.js
 *
 * Pure functions for building Letta agent memory blocks.
 * Extracted from LettaService.js for better separation of concerns.
 *
 * These functions create structured data snapshots for various memory blocks:
 * - Project metadata
 * - Board configuration
 * - Board metrics
 * - Hotspots (blocked items, ageing WIP, high priority)
 * - Backlog summary
 * - Recent activity
 * - Components summary
 * - Change log
 * - Scratchpad
 */

/**
 * Build project metadata snapshot for Letta agent memory
 *
 * @param {Object} hulyProject - Huly project object
 * @param {Object} vibeProject - Vibe project object
 * @param {string} repoPath - Filesystem path to repository
 * @param {string} gitUrl - Git remote URL
 * @returns {Object} Project metadata snapshot
 */
export function buildProjectMeta(hulyProject, vibeProject, repoPath, gitUrl) {
  return {
    name: hulyProject.name,
    identifier: hulyProject.identifier || hulyProject.name,
    description: hulyProject.description || '',
    huly: {
      id: hulyProject.id,
      identifier: hulyProject.identifier,
    },
    vibe: {
      id: vibeProject.id,
      api_url: process.env.VIBE_API_URL,
    },
    repository: {
      filesystem_path: repoPath || null,
      git_url: gitUrl || null,
    },
    // NOTE: No timestamp - would cause unnecessary updates on every sync
    // Content hashing detects actual changes (name, description, paths, etc.)
  };
}

/**
 * Build board configuration snapshot for Letta agent memory
 * Documents the status mapping and workflow rules
 *
 * @returns {Object} Board configuration snapshot
 */
export function buildBoardConfig() {
  return {
    status_mapping: {
      huly_to_vibe: {
        Backlog: 'todo',
        Todo: 'todo',
        'In Progress': 'inprogress',
        'In Review': 'inreview',
        Done: 'done',
        Canceled: 'cancelled',
      },
      vibe_to_huly: {
        todo: 'Todo',
        inprogress: 'In Progress',
        inreview: 'In Review',
        done: 'Done',
        cancelled: 'Canceled',
      },
    },
    workflow: {
      description: 'Bidirectional sync between Huly and Vibe Kanban',
      sync_direction: 'bidirectional',
      conflict_resolution: 'last-write-wins',
    },
    wip_policies: {
      description: 'Work-in-progress limits not enforced by sync service',
      note: 'WIP limits should be managed within individual systems',
    },
    definitions_of_done: {
      todo: 'Task is in backlog, not yet started',
      inprogress: 'Task is actively being worked on',
      inreview: 'Task is complete and awaiting review',
      done: 'Task is complete and reviewed',
      cancelled: 'Task was abandoned or is no longer needed',
    },
  };
}

/**
 * Build board metrics snapshot from Huly issues and Vibe tasks
 *
 * @param {Array} hulyIssues - Array of Huly issues
 * @param {Array} vibeTasks - Array of Vibe tasks
 * @returns {Object} Board metrics snapshot
 */
export function buildBoardMetrics(hulyIssues, vibeTasks) {
  // Count by status (use Vibe tasks as source of truth for current status)
  const statusCounts = {
    todo: 0,
    inprogress: 0,
    inreview: 0,
    done: 0,
    cancelled: 0,
  };

  vibeTasks.forEach(task => {
    const status = (task.status || 'todo').toLowerCase();
    if (Object.hasOwn(statusCounts, status)) {
      statusCounts[status]++;
    }
  });

  // Calculate WIP (in progress + in review)
  const wip = statusCounts.inprogress + statusCounts.inreview;

  // Calculate total and completion rate
  const total = vibeTasks.length;
  const completionRate = total > 0 ? ((statusCounts.done / total) * 100).toFixed(1) : 0;

  return {
    total_tasks: total,
    by_status: statusCounts,
    wip_count: wip,
    completion_rate: `${completionRate}%`,
    active_tasks: statusCounts.todo + statusCounts.inprogress + statusCounts.inreview,
    // NOTE: No snapshot_time - would cause unnecessary updates on every sync
    // Content hashing detects actual metric changes (status counts, WIP, etc.)
  };
}

/**
 * Build hotspots snapshot - identify problematic or notable items
 *
 * @param {Array} hulyIssues - Array of Huly issues
 * @param {Array} vibeTasks - Array of Vibe tasks
 * @returns {Object} Hotspots snapshot
 */
export function buildHotspots(hulyIssues, vibeTasks) {
  const hotspots = {
    blocked_items: [],
    ageing_wip: [],
    high_priority_todo: [],
  };

  const now = Date.now();
  const AGEING_THRESHOLD_DAYS = 7;
  const AGEING_THRESHOLD_MS = AGEING_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

  vibeTasks.forEach(task => {
    const status = (task.status || 'todo').toLowerCase();
    const title = task.title || '';
    const description = task.description || '';

    // Identify blocked items (by keywords in title/description)
    const blockedKeywords = ['blocked', 'blocker', 'waiting on', 'waiting for', 'stuck'];
    const isBlocked = blockedKeywords.some(
      keyword =>
        title.toLowerCase().includes(keyword) || description.toLowerCase().includes(keyword),
    );

    if (isBlocked) {
      hotspots.blocked_items.push({
        id: task.id,
        title: title,
        status: status,
      });
    }

    // Find ageing WIP items (in progress for > 7 days)
    if (status === 'inprogress' && task.updated_at) {
      const updatedAt = new Date(task.updated_at).getTime();
      const age = now - updatedAt;

      if (age > AGEING_THRESHOLD_MS) {
        const ageInDays = Math.floor(age / (24 * 60 * 60 * 1000));
        hotspots.ageing_wip.push({
          id: task.id,
          title: title,
          age_days: ageInDays,
          last_updated: task.updated_at,
        });
      }
    }

    // Find high priority todo items (if priority field available)
    if (status === 'todo' && task.priority) {
      const priority = task.priority.toLowerCase();
      if (priority === 'high' || priority === 'urgent' || priority === 'critical') {
        hotspots.high_priority_todo.push({
          id: task.id,
          title: title,
          priority: task.priority,
        });
      }
    }
  });

  // Sort ageing WIP by age (oldest first)
  hotspots.ageing_wip.sort((a, b) => b.age_days - a.age_days);

  // Limit to top items
  hotspots.blocked_items = hotspots.blocked_items.slice(0, 10);
  hotspots.ageing_wip = hotspots.ageing_wip.slice(0, 10);
  hotspots.high_priority_todo = hotspots.high_priority_todo.slice(0, 10);

  return {
    ...hotspots,
    summary: {
      blocked_count: hotspots.blocked_items.length,
      ageing_wip_count: hotspots.ageing_wip.length,
      high_priority_count: hotspots.high_priority_todo.length,
    },
  };
}

/**
 * Build backlog summary - top priority items waiting to be started
 *
 * @param {Array} hulyIssues - Array of Huly issues
 * @param {Array} vibeTasks - Array of Vibe tasks
 * @returns {Object} Backlog summary
 */
export function buildBacklogSummary(hulyIssues, vibeTasks) {
  // Get todo items from Vibe tasks
  const todoItems = vibeTasks.filter(task => {
    const status = (task.status || 'todo').toLowerCase();
    return status === 'todo';
  });

  // Sort by priority (if available)
  const priorityOrder = { urgent: 1, high: 2, medium: 3, low: 4, none: 5 };

  todoItems.sort((a, b) => {
    const aPriority = (a.priority || 'none').toLowerCase();
    const bPriority = (b.priority || 'none').toLowerCase();
    const aOrder = priorityOrder[aPriority] || 5;
    const bOrder = priorityOrder[bPriority] || 5;
    return aOrder - bOrder;
  });

  // Take top 15 items
  const topItems = todoItems.slice(0, 15).map(task => ({
    id: task.id,
    title: task.title || 'Untitled',
    priority: task.priority || 'none',
    tags: task.tags || [],
  }));

  return {
    total_backlog: todoItems.length,
    top_items: topItems,
    priority_breakdown: {
      urgent: todoItems.filter(t => (t.priority || '').toLowerCase() === 'urgent').length,
      high: todoItems.filter(t => (t.priority || '').toLowerCase() === 'high').length,
      medium: todoItems.filter(t => (t.priority || '').toLowerCase() === 'medium').length,
      low: todoItems.filter(t => (t.priority || '').toLowerCase() === 'low').length,
    },
  };
}

/**
 * Build recent activity block from Huly activity feed
 * Provides the agent with awareness of what changed recently
 *
 * @param {Object} activityData - Activity feed response from Huly API
 * @returns {Object} Recent activity summary for agent memory
 */
export function buildRecentActivity(activityData) {
  if (!activityData || !activityData.activities) {
    return {
      since: null,
      summary: { created: 0, updated: 0, total: 0 },
      by_status: {},
      recent_items: [],
      patterns: [],
    };
  }

  const { activities, summary, byStatus, since } = activityData;

  // Extract recent items (limit to 10 most recent)
  const recentItems = activities.slice(0, 10).map(activity => ({
    type: activity.type,
    issue: activity.issue,
    title: activity.title,
    status: activity.status,
    timestamp: activity.timestamp,
  }));

  // Detect patterns for the agent to act on
  const patterns = [];

  // Pattern: Lots of items moved to blocked
  if (byStatus?.Blocked && byStatus.Blocked >= 3) {
    patterns.push({
      type: 'blocked_spike',
      message: `${byStatus.Blocked} items are now blocked - may need attention`,
      severity: 'warning',
    });
  }

  // Pattern: High activity (many changes)
  if (summary?.total >= 20) {
    patterns.push({
      type: 'high_activity',
      message: `High activity: ${summary.total} changes since ${since}`,
      severity: 'info',
    });
  }

  // Pattern: Lots of completions
  if (byStatus?.Done && byStatus.Done >= 5) {
    patterns.push({
      type: 'completion_streak',
      message: `Good progress: ${byStatus.Done} items completed`,
      severity: 'positive',
    });
  }

  // Pattern: No activity
  if (summary?.total === 0) {
    patterns.push({
      type: 'no_activity',
      message: 'No recent activity detected',
      severity: 'info',
    });
  }

  return {
    since: since,
    summary: summary || { created: 0, updated: 0, total: 0 },
    by_status: byStatus || {},
    recent_items: recentItems,
    patterns: patterns,
  };
}

/**
 * Build components summary block from Huly components and issues
 * Provides the agent with understanding of project structure and feature areas
 *
 * @param {Array} components - Array of component objects from Huly API
 * @param {Array} hulyIssues - Array of Huly issues (to calculate per-component stats)
 * @returns {Object} Components summary for agent memory
 */
export function buildComponentsSummary(components, hulyIssues) {
  if (!components || components.length === 0) {
    return {
      components: [],
      total_components: 0,
      unassigned_count: hulyIssues?.length || 0,
      summary: 'No components defined for this project',
    };
  }

  // Count issues per component and by status
  const componentStats = new Map();

  // Initialize stats for each component
  components.forEach(comp => {
    const label = comp.label || comp.name;
    if (!componentStats.has(label)) {
      componentStats.set(label, {
        label: label,
        description: comp.description || '',
        issue_count: 0,
        status_breakdown: {},
      });
    }
  });

  // Count issues per component
  let unassignedCount = 0;

  hulyIssues?.forEach(issue => {
    const componentLabel = issue.component;
    const status = issue.status || 'Unknown';

    if (componentLabel && componentStats.has(componentLabel)) {
      const stats = componentStats.get(componentLabel);
      stats.issue_count++;
      stats.status_breakdown[status] = (stats.status_breakdown[status] || 0) + 1;
    } else {
      unassignedCount++;
    }
  });

  // Convert to array and sort by issue count (most active first)
  const componentsList = Array.from(componentStats.values()).sort(
    (a, b) => b.issue_count - a.issue_count,
  );

  // Calculate summary stats
  const activeComponents = componentsList.filter(c => c.issue_count > 0);
  const emptyComponents = componentsList.filter(c => c.issue_count === 0);

  return {
    components: componentsList,
    total_components: componentsList.length,
    active_components: activeComponents.length,
    empty_components: emptyComponents.length,
    unassigned_count: unassignedCount,
    summary: `${activeComponents.length} active components, ${unassignedCount} unassigned issues`,
  };
}

/**
 * Build change log - track changes since last sync
 *
 * @param {Array} currentIssues - Current Huly issues from this sync
 * @param {number} lastSyncTimestamp - Timestamp of last sync (ms)
 * @param {Object} db - Database instance
 * @param {string} projectIdentifier - Project identifier
 * @returns {Object} Change log
 */
export function buildChangeLog(currentIssues, lastSyncTimestamp, db, projectIdentifier) {
  const changes = {
    new_issues: [],
    updated_issues: [],
    closed_issues: [],
    status_transitions: [],
  };

  // If first sync, all issues are "new"
  if (!lastSyncTimestamp) {
    changes.new_issues = currentIssues.slice(0, 10).map(issue => ({
      identifier: issue.identifier,
      title: issue.title,
    }));
    return {
      ...changes,
      summary: {
        new_count: currentIssues.length,
        updated_count: 0,
        closed_count: 0,
        first_sync: true,
      },
    };
  }

  // Get previous state from database
  const previousIssues = db.getProjectIssues(projectIdentifier);
  const previousMap = new Map(previousIssues.map(issue => [issue.identifier, issue]));
  const currentMap = new Map(currentIssues.map(issue => [issue.identifier, issue]));

  // Find new issues (in current but not in previous)
  currentIssues.forEach(issue => {
    if (!previousMap.has(issue.identifier)) {
      changes.new_issues.push({
        identifier: issue.identifier,
        title: issue.title,
        status: issue.status,
      });
    }
  });

  // Find updated issues (status changed)
  currentIssues.forEach(issue => {
    const previous = previousMap.get(issue.identifier);
    if (previous) {
      // Check for status change
      if (previous.status !== issue.status) {
        changes.status_transitions.push({
          identifier: issue.identifier,
          title: issue.title,
          from: previous.status,
          to: issue.status,
        });
        changes.updated_issues.push({
          identifier: issue.identifier,
          title: issue.title,
          change: 'status',
          from: previous.status,
          to: issue.status,
        });
      }
      // Check for title change
      else if (previous.title !== issue.title) {
        changes.updated_issues.push({
          identifier: issue.identifier,
          title: issue.title,
          change: 'title',
        });
      }
    }
  });

  // Find closed/removed issues (in previous but not in current)
  previousIssues.forEach(issue => {
    if (!currentMap.has(issue.identifier)) {
      changes.closed_issues.push({
        identifier: issue.identifier,
        title: issue.title,
        last_status: issue.status,
      });
    }
  });

  // Limit to most recent changes
  changes.new_issues = changes.new_issues.slice(0, 10);
  changes.updated_issues = changes.updated_issues.slice(0, 10);
  changes.closed_issues = changes.closed_issues.slice(0, 10);
  changes.status_transitions = changes.status_transitions.slice(0, 15);

  return {
    ...changes,
    summary: {
      new_count: changes.new_issues.length,
      updated_count: changes.updated_issues.length,
      closed_count: changes.closed_issues.length,
      status_transition_count: changes.status_transitions.length,
      first_sync: false,
    },
    // NOTE: No 'since' timestamp - would cause unnecessary updates on every sync
    // Content hashing detects actual changes (new/updated/closed issues)
  };
}

/**
 * Build scratchpad block - agent's working memory for notes and reasoning
 *
 * This block is intentionally kept minimal and stable to avoid unnecessary updates.
 * The agent can use this space to:
 * - Store temporary observations and insights
 * - Track action items or follow-ups
 * - Keep notes on patterns or anomalies
 * - Maintain reasoning chains across syncs
 *
 * The sync service only initializes this block - agents update it themselves via tools.
 *
 * @returns {Object} Scratchpad structure
 */
export function buildScratchpad() {
  return {
    notes: [
      // Agents can add notes here
      // Each note: { timestamp: ISO, content: string, tags: [] }
    ],
    observations: [
      // Pattern observations across sync cycles
      // Each observation: { timestamp: ISO, pattern: string, confidence: string }
    ],
    action_items: [
      // Things the agent wants to track or suggest
      // Each item: { timestamp: ISO, action: string, priority: string, status: string }
    ],
    context: {
      // Long-term context the agent wants to preserve
      // e.g., team preferences, known issues, workflow patterns
    },
    usage_guide: `
This scratchpad is your persistent working memory across sync cycles.

You can:
- Add notes about patterns you observe
- Track action items to follow up on
- Store context that helps with future analysis
- Keep reasoning chains between syncs

Update this block using the core_memory tools when you have insights worth preserving.
The sync service won't overwrite your updates - you control this space.
    `.trim(),
  };
}
