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
 *
 * Data source: beads issue tracker (.beads/ directory)
 * Use BeadsDataFetcher.js to fetch normalized issue data for these builders.
 */

/**
 * Build project metadata snapshot for Letta agent memory
 *
 * @param {Object} project - Project registry object
 * @param {string} repoPath - Filesystem path to repository
 * @param {string} gitUrl - Git remote URL
 * @returns {Object} Project metadata snapshot
 */
export function buildProjectMeta(project, repoPath, gitUrl) {
  return {
    name: project.name,
    identifier: project.identifier || project.name,
    description: project.description || '',
    status: project.status || 'active',
    repository: {
      filesystem_path: repoPath || null,
      git_url: gitUrl || null,
    },
  };
}

/**
 * Build board configuration snapshot for Letta agent memory
 * Documents the beads workflow and priority system
 *
 * @returns {Object} Board configuration snapshot
 */
export function buildBoardConfig() {
  return {
    statuses: {
      open: 'Task not yet started or in backlog',
      'in-progress': 'Task actively being worked on',
      closed: 'Task completed or cancelled',
    },
    priorities: {
      P0: 'Urgent - critical blocker requiring immediate attention',
      P1: 'High - important issue that should be addressed soon',
      P2: 'Medium - normal priority task',
      P3: 'Low - nice to have, can be deferred',
      P4: 'Backlog - no immediate plans to address',
    },
    workflow: {
      description: 'Beads git-tracked issue tracker workflow',
      status_flow: 'open → in-progress → closed',
      note: 'Status changes are tracked in .beads/interactions.jsonl',
    },
    wip_policies: {
      description: 'Work-in-progress limits not enforced at tracker level',
      note: 'Teams should manage WIP limits through process and discipline',
    },
  };
}

/**
 * Build board metrics snapshot from beads issues
 *
 * @param {Array} issues - Array of normalized beads issues
 * @returns {Object} Board metrics snapshot
 */
export function buildBoardMetrics(issues) {
  // Use raw beads statuses for accurate counting
  const statusCounts = {
    open: 0,
    'in-progress': 0,
    closed: 0,
  };

  issues.forEach(issue => {
    const rawStatus = issue._beads?.raw_status || 'open';
    if (Object.hasOwn(statusCounts, rawStatus)) {
      statusCounts[rawStatus]++;
    }
  });

  const total = issues.length;
  const completionRate = total > 0 ? ((statusCounts.closed / total) * 100).toFixed(1) : 0;

  return {
    total_tasks: total,
    by_status: statusCounts,
    wip_count: statusCounts['in-progress'],
    completion_rate: `${completionRate}%`,
    active_tasks: statusCounts.open + statusCounts['in-progress'],
    // NOTE: No snapshot_time - would cause unnecessary updates on every sync
    // Content hashing detects actual metric changes (status counts, WIP, etc.)
  };
}

/**
 * Build hotspots snapshot - identify problematic or notable items
 *
 * @param {Array} issues - Array of normalized beads issues
 * @returns {Object} Hotspots snapshot
 */
export function buildHotspots(issues) {
  const hotspots = {
    blocked_items: [],
    ageing_wip: [],
    high_priority_open: [],
  };

  const now = Date.now();
  const AGEING_THRESHOLD_DAYS = 7;
  const AGEING_THRESHOLD_MS = AGEING_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

  issues.forEach(issue => {
    const rawStatus = issue._beads?.raw_status || 'open';
    const title = issue.title || '';
    const description = issue.description || '';

    // Detect blocked items by keywords
    const blockedKeywords = ['blocked', 'blocker', 'waiting on', 'waiting for', 'stuck'];
    const isBlocked = blockedKeywords.some(
      keyword =>
        title.toLowerCase().includes(keyword) || description.toLowerCase().includes(keyword)
    );

    if (isBlocked) {
      hotspots.blocked_items.push({
        id: issue.identifier || issue.id,
        title: title,
        status: rawStatus,
      });
    }

    // Detect ageing work in progress
    if (rawStatus === 'in-progress' && issue.modifiedOn) {
      const updatedAt =
        typeof issue.modifiedOn === 'number'
          ? issue.modifiedOn
          : new Date(issue.modifiedOn).getTime();
      const age = now - updatedAt;

      if (age > AGEING_THRESHOLD_MS) {
        const ageInDays = Math.floor(age / (24 * 60 * 60 * 1000));
        hotspots.ageing_wip.push({
          id: issue.identifier || issue.id,
          title: title,
          age_days: ageInDays,
          last_updated: issue.modifiedOn,
        });
      }
    }

    // Detect high priority open items (P0, P1)
    if (rawStatus === 'open' && issue.priority) {
      const priority = issue.priority.toLowerCase();
      if (priority === 'urgent' || priority === 'high') {
        hotspots.high_priority_open.push({
          id: issue.identifier || issue.id,
          title: title,
          priority: issue.priority,
        });
      }
    }
  });

  // Sort ageing WIP by age (oldest first)
  hotspots.ageing_wip.sort((a, b) => b.age_days - a.age_days);

  // Limit to top items
  hotspots.blocked_items = hotspots.blocked_items.slice(0, 10);
  hotspots.ageing_wip = hotspots.ageing_wip.slice(0, 10);
  hotspots.high_priority_open = hotspots.high_priority_open.slice(0, 10);

  return {
    ...hotspots,
    summary: {
      blocked_count: hotspots.blocked_items.length,
      ageing_wip_count: hotspots.ageing_wip.length,
      high_priority_count: hotspots.high_priority_open.length,
    },
  };
}

/**
 * Build backlog summary - top priority items waiting to be started
 *
 * @param {Array} issues - Array of normalized beads issues
 * @returns {Object} Backlog summary
 */
export function buildBacklogSummary(issues) {
  // Filter for open issues (beads status: open)
  const openItems = issues.filter(issue => {
    const rawStatus = issue._beads?.raw_status;
    return rawStatus === 'open';
  });

  // Sort by priority (urgent=P0 first, none=P4 last)
  const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

  openItems.sort((a, b) => {
    const aPriority = (a.priority || 'none').toLowerCase();
    const bPriority = (b.priority || 'none').toLowerCase();
    const aOrder = priorityOrder[aPriority] !== undefined ? priorityOrder[aPriority] : 4;
    const bOrder = priorityOrder[bPriority] !== undefined ? priorityOrder[bPriority] : 4;
    return aOrder - bOrder;
  });

  const topItems = openItems.slice(0, 15).map(issue => ({
    id: issue.identifier || issue.id,
    title: issue.title || 'Untitled',
    priority: issue.priority || 'none',
  }));

  return {
    total_backlog: openItems.length,
    top_items: topItems,
    priority_breakdown: {
      urgent: openItems.filter(t => (t.priority || '').toLowerCase() === 'urgent').length,
      high: openItems.filter(t => (t.priority || '').toLowerCase() === 'high').length,
      medium: openItems.filter(t => (t.priority || '').toLowerCase() === 'medium').length,
      low: openItems.filter(t => (t.priority || '').toLowerCase() === 'low').length,
    },
  };
}

/**
 * Build recent activity block from beads interactions
 * Provides the agent with awareness of what changed recently
 *
 * @param {Object} activityData - Activity data from fetchRecentActivity()
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

  // Pattern: High activity (many changes)
  if (summary?.total >= 20) {
    patterns.push({
      type: 'high_activity',
      message: `High activity: ${summary.total} changes since ${since}`,
      severity: 'info',
    });
  }

  // Pattern: Lots of completions (beads status: closed/Done)
  if (byStatus?.Done && byStatus.Done >= 5) {
    patterns.push({
      type: 'completion_streak',
      message: `Good progress: ${byStatus.Done} items completed`,
      severity: 'positive',
    });
  }

  // Pattern: Many items in progress
  if (byStatus?.['In Progress'] && byStatus['In Progress'] >= 5) {
    patterns.push({
      type: 'high_wip',
      message: `${byStatus['In Progress']} items in progress - monitor for bottlenecks`,
      severity: 'info',
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
 * Build components summary block from beads issue types
 * Provides the agent with understanding of project structure by issue type
 *
 * @param {Array} issues - Array of normalized beads issues
 * @returns {Object} Components summary for agent memory
 */
export function buildComponentsSummary(issues) {
  if (!issues || issues.length === 0) {
    return {
      types: [],
      total_types: 0,
      untyped_count: 0,
      summary: 'No issues found',
    };
  }

  // Count issues per type and by status
  const typeStats = new Map();

  // Process all issues and group by type
  let untypedCount = 0;

  issues.forEach(issue => {
    const issueType = issue.component || 'untyped'; // component field maps to issue_type
    const rawStatus = issue._beads?.raw_status || 'open';

    if (issueType === 'untyped' || !issueType) {
      untypedCount++;
      return;
    }

    if (!typeStats.has(issueType)) {
      typeStats.set(issueType, {
        type: issueType,
        issue_count: 0,
        status_breakdown: {},
      });
    }

    const stats = typeStats.get(issueType);
    stats.issue_count++;
    stats.status_breakdown[rawStatus] = (stats.status_breakdown[rawStatus] || 0) + 1;
  });

  // Convert to array and sort by issue count (most active first)
  const typesList = Array.from(typeStats.values()).sort(
    (a, b) => b.issue_count - a.issue_count
  );

  return {
    types: typesList,
    total_types: typesList.length,
    untyped_count: untypedCount,
    summary: `${typesList.length} issue types, ${untypedCount} untyped issues`,
  };
}

/**
 * Build change log - track changes since last sync
 *
 * @param {Array} currentIssues - Current beads issues from this sync
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
        status: issue._beads?.raw_status || 'open',
      });
    }
  });

  // Find updated issues (status changed)
  currentIssues.forEach(issue => {
    const previous = previousMap.get(issue.identifier);
    if (previous) {
      const currentStatus = issue._beads?.raw_status;
      const previousStatus = previous._beads?.raw_status;

      // Check for status change
      if (previousStatus !== currentStatus) {
        changes.status_transitions.push({
          identifier: issue.identifier,
          title: issue.title,
          from: previousStatus,
          to: currentStatus,
        });
        changes.updated_issues.push({
          identifier: issue.identifier,
          title: issue.title,
          change: 'status',
          from: previousStatus,
          to: currentStatus,
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
        last_status: issue._beads?.raw_status || 'unknown',
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
 * Build expression block - communication style and anti-slop guard
 *
 * Defines HOW the agent communicates. Prevents AI slop patterns
 * (performative warmth, filler phrases, unnecessary hedging) and
 * establishes a distinct voice.
 *
 * Architecture: shared base + role-specific layer.
 * - Base: anti-slop rules all agents inherit
 * - Role layer: PM agents get terse/delivery-oriented style
 *
 * The sync service sets this once. Agents may refine their own
 * expression over time via core_memory tools.
 *
 * @param {string} [role='pm'] - Agent role: 'pm', 'companion', 'developer'
 * @returns {string} Expression block content
 */
export function buildExpression(role = 'pm') {
  const base = `## Communication Anti-Patterns (NEVER do these)

- Never open with "Great question!", "That's a really good idea!", "Excellent choice!", or any praise of the input. Respond to the substance.
- Never say "certainly!", "absolutely!", "of course!" as affirmations. Just do the thing or state the fact.
- Never say "I'd be happy to help" or "I'm here to help". Just help.
- Never use "Let me think about that..." or "That's an interesting point..." as filler. Think, then speak.
- Never hedge with "I think maybe possibly..." when you have a clear position. State it.
- Never pad responses with "As mentioned earlier..." or "As I said before...". Just say the thing.
- Never use emoji as emphasis unless the context genuinely calls for it.
- Never start a response with "So," or "Well," — these are verbal tics, not written style.
- Never apologize for being direct. Directness is the style.
- Never use corporate filler: "leverage", "synergize", "circle back", "align on", "unpack", "deep dive" as verbs.

## Formatting Rules

- Lead with the answer or decision, then context if needed. Never bury the lede.
- Use bullet points for lists of 3+ items. Don't narrate what could be a list.
- Use code blocks for identifiers, file paths, commands. Not for emphasis.
- One blank line between sections. No walls of text, no excessive whitespace.
- Tables for comparisons. Prose for reasoning. Pick the right tool.`;

  const pmLayer = `

## PM Voice

- Terse and action-oriented. No filler, no pleasantries beyond brief acknowledgment.
- Lead with decisions, not discussion. "Do X" not "What do you think about X?"
- When approving: approve and immediately state what's next.
- When rejecting: state why in one sentence, then state what to do instead.
- Every response ends with a clear action item or decision. No open-ended musings.
- Match urgency to priority. P0 gets imperative tone. P3 gets matter-of-fact.
- Don't perform warmth. If something went well, note the outcome, not the effort.
- When uncertain, say "I don't know yet — here's how I'll find out" not "That's a great question, let me explore that."`;

  const companionLayer = `

## Companion Voice

- Warm but not performative. Genuine interest, not scripted empathy.
- Listen more than speak. Ask follow-up questions that show you retained context.
- Use humor sparingly and naturally — never forced.
- Match the other person's energy. If they're terse, be concise. If they're expansive, engage fully.
- Remember details and reference them later. This is how trust builds.`;

  const developerLayer = `

## Developer Voice

- Technical precision first. Use exact terms — "function", not "thing"; "race condition", not "timing issue".
- Show your work. When you make a decision, name the tradeoff.
- Code speaks louder than prose. When explaining, include the snippet.
- Be honest about uncertainty. "I'm not sure this handles the edge case where..." is more useful than false confidence.
- No status updates ("I'm working on..."). Just do the work, show the result.`;

  const layers = { pm: pmLayer, companion: companionLayer, developer: developerLayer };
  const roleLayer = layers[role] || pmLayer;

  return base + roleLayer;
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
// ============================================================
// SQL-BASED BUILDER VARIANTS
//
// These accept pre-aggregated data from DoltQueryService SQL queries,
// avoiding the need to normalize/loop over full issue arrays.
// ============================================================

/**
 * Build board metrics from pre-aggregated SQL status counts.
 *
 * @param {Array<{status: string, count: number}>} statusCounts - Rows from
 *   `SELECT status, COUNT(*) AS count FROM issues GROUP BY status`
 * @returns {Object} Board metrics snapshot (same shape as buildBoardMetrics)
 */
export function buildBoardMetricsFromSQL(statusCounts) {
  const byStatus = { open: 0, 'in-progress': 0, closed: 0 };
  let total = 0;

  for (const row of statusCounts) {
    const status = row.status;
    const count = Number(row.count);
    if (Object.hasOwn(byStatus, status)) {
      byStatus[status] = count;
    }
    total += count;
  }

  const completionRate = total > 0 ? ((byStatus.closed / total) * 100).toFixed(1) : 0;

  return {
    total_tasks: total,
    by_status: byStatus,
    wip_count: byStatus['in-progress'],
    completion_rate: `${completionRate}%`,
    active_tasks: byStatus.open + byStatus['in-progress'],
  };
}

/**
 * Build backlog summary from pre-sorted open issues (from SQL ORDER BY priority ASC).
 *
 * Expects rows from `getOpenByPriority()` — already filtered to status='open'
 * and sorted by priority ascending (0=urgent first).
 *
 * @param {Array<Object>} openIssues - Pre-sorted open issues from SQL
 * @returns {Object} Backlog summary (same shape as buildBacklogSummary)
 */
export function buildBacklogSummaryFromSQL(openIssues) {
  const PRIORITY_MAP = { 0: 'urgent', 1: 'high', 2: 'medium', 3: 'low', 4: 'none' };

  const topItems = openIssues.slice(0, 15).map(issue => ({
    id: issue.id,
    title: issue.title || 'Untitled',
    priority: PRIORITY_MAP[issue.priority] || 'none',
  }));

  const priorityBreakdown = { urgent: 0, high: 0, medium: 0, low: 0 };
  for (const issue of openIssues) {
    const label = PRIORITY_MAP[issue.priority] || 'none';
    if (label in priorityBreakdown) {
      priorityBreakdown[label]++;
    }
  }

  return {
    total_backlog: openIssues.length,
    top_items: topItems,
    priority_breakdown: priorityBreakdown,
  };
}

/**
 * Build hotspots from pre-filtered SQL result sets.
 *
 * @param {Object} params
 * @param {Array<Object>} params.blocked - Issues matching blocked keywords
 * @param {Array<Object>} params.agingWip - In-progress issues older than threshold
 * @param {Array<Object>} params.highPriority - Open issues with priority <= 1
 * @returns {Object} Hotspots snapshot (same shape as buildHotspots)
 */
export function buildHotspotsFromSQL({ blocked, agingWip, highPriority }) {
  const PRIORITY_MAP = { 0: 'urgent', 1: 'high', 2: 'medium', 3: 'low', 4: 'none' };
  const now = Date.now();

  const blockedItems = (blocked || []).slice(0, 10).map(issue => ({
    id: issue.id,
    title: issue.title || '',
    status: issue.status || 'open',
  }));

  const ageingWipItems = (agingWip || []).map(issue => {
    const updatedAt = issue.updated_at
      ? new Date(issue.updated_at).getTime()
      : now;
    const ageInDays = Math.floor((now - updatedAt) / (24 * 60 * 60 * 1000));
    return {
      id: issue.id,
      title: issue.title || '',
      age_days: ageInDays,
      last_updated: updatedAt,
    };
  });

  // Sort by age descending and limit
  ageingWipItems.sort((a, b) => b.age_days - a.age_days);
  const limitedAgeing = ageingWipItems.slice(0, 10);

  const highPriorityItems = (highPriority || []).slice(0, 10).map(issue => ({
    id: issue.id,
    title: issue.title || '',
    priority: PRIORITY_MAP[issue.priority] || 'high',
  }));

  return {
    blocked_items: blockedItems,
    ageing_wip: limitedAgeing,
    high_priority_open: highPriorityItems,
    summary: {
      blocked_count: blockedItems.length,
      ageing_wip_count: limitedAgeing.length,
      high_priority_count: highPriorityItems.length,
    },
  };
}

/**
 * Build components summary from pre-grouped SQL data.
 *
 * @param {Array<{issue_type: string, status: string, count: number}>} typeStats - Rows from
 *   `SELECT issue_type, status, COUNT(*) AS count FROM issues GROUP BY issue_type, status`
 * @returns {Object} Components summary (same shape as buildComponentsSummary)
 */
export function buildComponentsSummaryFromSQL(typeStats) {
  if (!typeStats || typeStats.length === 0) {
    return {
      types: [],
      total_types: 0,
      untyped_count: 0,
      summary: 'No issues found',
    };
  }

  const typeMap = new Map();
  let untypedCount = 0;

  for (const row of typeStats) {
    const issueType = row.issue_type || 'untyped';
    const count = Number(row.count);

    if (issueType === 'untyped' || !issueType) {
      untypedCount += count;
      continue;
    }

    if (!typeMap.has(issueType)) {
      typeMap.set(issueType, {
        type: issueType,
        issue_count: 0,
        status_breakdown: {},
      });
    }

    const stats = typeMap.get(issueType);
    stats.issue_count += count;
    stats.status_breakdown[row.status] = (stats.status_breakdown[row.status] || 0) + count;
  }

  const typesList = Array.from(typeMap.values()).sort(
    (a, b) => b.issue_count - a.issue_count
  );

  return {
    types: typesList,
    total_types: typesList.length,
    untyped_count: untypedCount,
    summary: `${typesList.length} issue types, ${untypedCount} untyped issues`,
  };
}

/**
 * Build recent activity block from Dolt diff data (SQL-based variant).
 *
 * Takes the classified diff data produced by `DoltQueryService.getRecentActivityFromDolt()`
 * and produces the same output shape as `buildRecentActivity()`, including pattern detection.
 *
 * @param {Object} doltChanges - Output from `getRecentActivityFromDolt()`
 * @param {Array<Object>} doltChanges.changes - Classified diff rows
 * @param {Object} doltChanges.summary - Counts: { created, updated, closed, deleted, total }
 * @param {Object} doltChanges.byStatus - Counts keyed by status
 * @param {string|null} doltChanges.since - ISO timestamp of the base commit
 * @returns {Object} Recent activity summary (same shape as buildRecentActivity)
 */
export function buildRecentActivityFromSQL(doltChanges) {
  if (!doltChanges || !doltChanges.changes) {
    return {
      since: null,
      summary: { created: 0, updated: 0, closed: 0, deleted: 0, total: 0 },
      by_status: {},
      recent_items: [],
      patterns: [],
    };
  }

  const { changes, summary, byStatus, since } = doltChanges;

  // Map diff changes to recent items (limit to 10)
  const recentItems = changes.slice(0, 10).map(change => ({
    type: change.action === 'created' ? 'issue.created'
      : change.action === 'closed' ? 'issue.closed'
      : change.action === 'deleted' ? 'issue.deleted'
      : 'issue.updated',
    issue: change.id,
    title: change.title,
    status: change.to_status || change.from_status || '',
    from_status: change.from_status,
    to_status: change.to_status,
    timestamp: change.updated_at,
  }));

  // Detect patterns
  const patterns = [];

  // Pattern: High activity (many changes)
  if (summary.total >= 20) {
    patterns.push({
      type: 'high_activity',
      message: `High activity: ${summary.total} changes since ${since || 'unknown'}`,
      severity: 'info',
    });
  }

  // Pattern: Lots of completions (closed status in Dolt)
  if (summary.closed >= 5) {
    patterns.push({
      type: 'completion_streak',
      message: `Good progress: ${summary.closed} items completed`,
      severity: 'positive',
    });
  }

  // Pattern: Many items moved to in-progress
  const inProgressCount = byStatus['in-progress'] || 0;
  if (inProgressCount >= 5) {
    patterns.push({
      type: 'high_wip',
      message: `${inProgressCount} items in progress - monitor for bottlenecks`,
      severity: 'info',
    });
  }

  // Pattern: No activity
  if (summary.total === 0) {
    patterns.push({
      type: 'no_activity',
      message: 'No recent activity detected',
      severity: 'info',
    });
  }

  return {
    since,
    summary: {
      created: summary.created || 0,
      updated: summary.updated || 0,
      closed: summary.closed || 0,
      deleted: summary.deleted || 0,
      total: summary.total || 0,
    },
    by_status: byStatus || {},
    recent_items: recentItems,
    patterns,
  };
}

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
