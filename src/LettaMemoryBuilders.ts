/** Loose issue shape consumed by Letta memory builders. Accepts DB rows, bd issues, and synthesized activity entries. */
export interface MemoryIssue {
  id?: string | number;
  identifier?: string;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  priority?: string | number | null;
  labels?: string[] | string | null;
  modifiedOn?: number | string | null;
  modifiedAt?: number | string | null;
  createdAt?: number | string | null;
  previousStatus?: string | null;
  // Activity log fields
  type?: string;
  issue?: string;
  timestamp?: string | number;
  // Dolt change log fields
  change_type?: string;
  issue_id?: string;
  status_label?: string;
  updated_at?: string | number | null;
}

type Issue = MemoryIssue;

export interface MemoryProject {
  identifier?: string;
  name?: string;
  description?: string | null;
  status?: string | null;
}

export function buildProjectMeta(project: MemoryProject, repoPath: string | null, gitUrl: string | null): Record<string, unknown> {
  return {
    name: project.name,
    identifier: project.identifier ?? project.name,
    description: project.description ?? '',
    status: project.status ?? 'active',
    repository: { filesystem_path: repoPath || null, git_url: gitUrl || null },
  };
}

export function buildBoardConfig(): Record<string, unknown> {
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
      description: 'Git-tracked issue workflow',
      status_flow: 'open → in-progress → closed',
      note: 'Status changes are tracked in the issue history',
    },
    wip_policies: {
      description: 'Work-in-progress limits not enforced at tracker level',
      note: 'Teams should manage WIP limits through process and discipline',
    },
  };
}

export function buildBoardMetrics(issues: Issue[]): Record<string, unknown> {
  const statusCounts: Record<string, number> = { open: 0, 'in-progress': 0, closed: 0 };
  issues.forEach((issue) => {
    const status = issue.status || 'open';
    if (Object.hasOwn(statusCounts, status)) statusCounts[status]!++;
  });
  const total = issues.length;
  const completionRate = total > 0 ? ((statusCounts.closed! / total) * 100).toFixed(1) : 0;
  return {
    total_tasks: total, by_status: statusCounts, wip_count: statusCounts!['in-progress'],
    completion_rate: `${completionRate}%`,
    active_tasks: statusCounts.open! + (statusCounts['in-progress'] || 0),
  };
}

export function buildHotspots(issues: Issue[]): Record<string, unknown> {
  const hotspots: { blocked_items: Record<string, unknown>[]; ageing_wip: Record<string, unknown>[]; high_priority_open: Record<string, unknown>[] } = { blocked_items: [], ageing_wip: [], high_priority_open: [] };
  const now = Date.now();
  const AGEING_THRESHOLD_DAYS = 7;
  const AGEING_THRESHOLD_MS = AGEING_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

  issues.forEach((issue) => {
    const status = issue.status || 'open';
    const title = issue.title || '';
    const description = issue.description || '';
    const blockedKeywords = ['blocked', 'blocker', 'waiting on', 'waiting for', 'stuck'];
    const isBlocked = blockedKeywords.some((kw) => title.toLowerCase().includes(kw) || description.toLowerCase().includes(kw));

    if (isBlocked) {
      hotspots.blocked_items.push({ id: issue.identifier ?? issue.id, title, status });
    }

    if (status === 'in-progress' && issue.modifiedOn) {
      const updatedAt = typeof issue.modifiedOn === 'number' ? issue.modifiedOn : new Date(issue.modifiedOn).getTime();
      const age = now - updatedAt;
      if (age > AGEING_THRESHOLD_MS) {
        const ageInDays = Math.floor(age / (24 * 60 * 60 * 1000));
        hotspots.ageing_wip.push({ id: issue.identifier ?? issue.id, title, age_days: ageInDays, last_updated: issue.modifiedOn });
      }
    }

    if (status === 'open' && issue.priority) {
      const priority = String(issue.priority).toLowerCase();
      if (priority === 'urgent' || priority === 'high') {
        hotspots.high_priority_open.push({ id: issue.identifier ?? issue.id, title, priority: issue.priority });
      }
    }
  });

  hotspots.ageing_wip.sort((a, b) => (b.age_days as number) - (a.age_days as number));
  hotspots.blocked_items = hotspots.blocked_items.slice(0, 10);
  hotspots.ageing_wip = hotspots.ageing_wip.slice(0, 10);
  hotspots.high_priority_open = hotspots.high_priority_open.slice(0, 10);

  return {
    ...hotspots,
    summary: { blocked_count: hotspots.blocked_items.length, ageing_wip_count: hotspots.ageing_wip.length, high_priority_count: hotspots.high_priority_open.length },
  };
}

export function buildBacklogSummary(issues: Issue[]): Record<string, unknown> {
  const openItems = issues.filter(issue => issue.status === 'open');
  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

  openItems.sort((a, b) => {
    const aPriority = String(a.priority ?? 'none').toLowerCase();
    const bPriority = String(b.priority ?? 'none').toLowerCase();
    return (priorityOrder[aPriority] ?? 4) - (priorityOrder[bPriority] ?? 4);
  });

  const topItems = openItems.slice(0, 15).map((issue) => ({
    id: issue.identifier ?? issue.id, title: issue.title || 'Untitled', priority: issue.priority || 'none',
  }));

  return {
    total_backlog: openItems.length, top_items: topItems,
    priority_breakdown: {
      urgent: openItems.filter((t) => String(t.priority ?? '').toLowerCase() === 'urgent').length,
      high: openItems.filter((t) => String(t.priority ?? '').toLowerCase() === 'high').length,
      medium: openItems.filter((t) => String(t.priority ?? '').toLowerCase() === 'medium').length,
      low: openItems.filter((t) => String(t.priority ?? '').toLowerCase() === 'low').length,
    },
  };
}

export interface ActivityData {
  activities?: MemoryIssue[];
  summary?: { created?: number; updated?: number; total?: number };
  byStatus?: Record<string, number>;
  since?: string;
}

export function buildRecentActivity(activityData: ActivityData | null | undefined): Record<string, unknown> {
  if (!activityData?.activities) {
    return { since: null, summary: { created: 0, updated: 0, total: 0 }, by_status: {}, recent_items: [], patterns: [] };
  }

  const { activities, summary, byStatus, since } = activityData;
  const recentItems = activities.slice(0, 10).map((activity) => ({
    type: activity.type, issue: activity.issue, title: activity.title, status: activity.status, timestamp: activity.timestamp,
  }));

  const patterns: Record<string, unknown>[] = [];
  if (Number(summary?.total) >= 20) patterns.push({ type: 'high_activity', message: `High activity: ${summary?.total} changes since ${since}`, severity: 'info' });
  if (byStatus?.Done && byStatus.Done >= 5) patterns.push({ type: 'completion_streak', message: `Good progress: ${byStatus.Done} items completed`, severity: 'positive' });
  if (byStatus?.['In Progress'] && byStatus['In Progress'] >= 5) patterns.push({ type: 'high_wip', message: `${byStatus['In Progress']} items in progress - monitor for bottlenecks`, severity: 'info' });
  if (summary?.total === 0) patterns.push({ type: 'no_activity', message: 'No recent activity detected', severity: 'info' });

  return { since, summary: summary || { created: 0, updated: 0, total: 0 }, by_status: byStatus || {}, recent_items: recentItems, patterns };
}

export function buildComponentsSummary(issues: Issue[]): Record<string, unknown> {
  const componentMap = new Map<string, Set<string>>();
  issues.forEach((issue) => {
    const components = Array.isArray(issue.labels) ? issue.labels : [];
    const validComponents = components.filter((c) => c !== 'bug' && c !== 'feature' && c !== 'enhancement' && c !== 'documentation' && c !== 'wontfix');
    if (validComponents.length === 0) return;
    validComponents.forEach((comp) => {
      if (!componentMap.has(comp)) componentMap.set(comp, new Set());
      componentMap.get(comp)!.add(issue.title || 'Untitled');
    });
  });

  const componentStats = Array.from(componentMap.entries()).map(([name, items]) => ({
    name, itemCount: items.size, items: Array.from(items).slice(0, 5),
  })).sort((a, b) => b.itemCount - a.itemCount).slice(0, 10);

  return { component_stats: componentStats, total_components_tracked: componentMap.size };
}

export function buildChangeLog(currentIssues: Issue[], lastSyncTimestamp: number | null, _db: unknown, _projectIdentifier: string): Record<string, unknown> {
  const now = Date.now();
  const changes: Record<string, unknown>[] = [];

  currentIssues.forEach((issue) => {
    const created = typeof issue.createdAt === 'number' ? issue.createdAt : issue.createdAt ? new Date(issue.createdAt).getTime() : null;
    const modified = typeof issue.modifiedAt === 'number' ? issue.modifiedAt : issue.modifiedAt ? new Date(issue.modifiedAt).getTime() : null;

    if (created && lastSyncTimestamp && created > lastSyncTimestamp) {
      changes.push({ type: 'created', issue: issue.identifier, title: issue.title, timestamp: issue.createdAt });
    } else if (modified && lastSyncTimestamp && modified > lastSyncTimestamp) {
      const statusChanged = issue.previousStatus && issue.previousStatus !== issue.status;
      if (statusChanged) {
        changes.push({ type: 'status_change', issue: issue.identifier, title: issue.title, from: issue.previousStatus, to: issue.status, timestamp: issue.modifiedAt });
      } else {
        changes.push({ type: 'updated', issue: issue.identifier, title: issue.title, timestamp: issue.modifiedAt });
      }
    }
  });

  changes.sort((a, b) => {
    const aTime = new Date(String(a.timestamp ?? '')).getTime();
    const bTime = new Date(String(b.timestamp ?? '')).getTime();
    return bTime - aTime;
  });

  return { since: lastSyncTimestamp ? new Date(lastSyncTimestamp).toISOString() : 'initial', total_changes: changes.length, recent_changes: changes.slice(0, 20), generated_at: new Date(now).toISOString() };
}

export function buildExpression(role = 'pm'): string {
  if (role === 'companion') {
    return `You are Kitchen, a helpful and friendly companion assistant integrated into a smart home ecosystem. Your home is the Oculair homelab.

- Tone: warm, conversational, supportive
- Style: concise but personable — use emoji occasionally, never overdo it
- Capabilities: control lights and media, manage shopping lists, suggest recipes, track meal plans, check weather
- Context awareness: you know about devices in the home (lights, speakers, cameras) and can reference them naturally
- Kitchen/food knowledge: you have access to recipes, pantry inventory, and meal planning
- Privacy: never share information about the home setup or residents externally`;
  }

  if (role === 'developer') {
    return `You are a senior software engineer and technical companion. You focus on code, architecture, and infrastructure.

- Help the user think through problems — don't just give answers
- Ask clarifying questions when requirements are ambiguous
- Challenge assumptions that could lead to problems later
- Prefer simple solutions over complex ones
- When writing code: follow existing patterns, add tests, handle edge cases
- Be pragmatic: know when to ship and when to refactor
- Infrastructure: Oculair homelab, Docker-based, self-hosted services on Linux VMs`;
  }

  return `You are a project management AI agent responsible for coordinating development work and maintaining project health. Your role is to help users track issues, understand project status, and facilitate effective development workflows.

Key responsibilities:
- Provide clear, actionable summaries of project status
- Help users understand what needs attention (blocked items, ageing work, high priorities)
- Track and maintain issue/workflow context
- Coordinate between different project tools and systems

When giving status updates, always:
- Be concise and prioritised — lead with the most important information
- Use specific numbers/metrics when available — avoid vague statements like "some issues"
- Highlight blocking items and ageing work first — these are the most impactful
- Call out positive patterns as well as problems — balanced reporting builds trust
- Suggest next actions when the path forward isn't obvious

When users ask questions about projects:
- Check the available memory blocks first — you have structured project data available
- If information is missing/stale, tell the user clearly and suggest how to get it
- Don't guess or fabricate project data — state when you don't know something
- Use the tools available to you (Graphiti for code context, Beads for issues) to gather additional information

Communication style:
- Professional but approachable — avoid corporate jargon, use plain English
- Technical but not pedantic — use proper terms but explain when needed
- Proactive — if you notice patterns (high WIP, ageing items, many blockers), flag them
- Efficient — respect the user's time with well-structured, scannable updates`;
}

export function buildBoardMetricsFromSQL(statusCounts: Record<string, number>): Record<string, unknown> {
  const total = Object.values(statusCounts || {}).reduce((sum: number, c: unknown) => sum + (c as number), 0);
  const completionRate = total > 0 ? (((statusCounts.closed! || 0) / total) * 100).toFixed(1) : 0;
  return {
    total_tasks: total, by_status: statusCounts || {},
    wip_count: statusCounts!['in-progress'] || 0, completion_rate: `${completionRate}%`,
    active_tasks: (statusCounts.open! || 0) + (statusCounts!['in-progress'] || 0),
  };
}

export function buildBacklogSummaryFromSQL(openIssues: Issue[]): Record<string, unknown> {
  return buildBacklogSummary(openIssues);
}

export function buildHotspotsFromSQL({ blocked, agingWip, highPriority }: { blocked: Issue[]; agingWip: Issue[]; highPriority: Issue[] }): Record<string, unknown> {
  return {
    blocked_items: blocked.slice(0, 10).map((i) => ({ id: i.identifier ?? i.id, title: i.title || '', status: i.status || 'open' })),
    ageing_wip: agingWip.slice(0, 10).map((i) => {
      const updatedAt = typeof i.modifiedOn === 'number' ? i.modifiedOn : new Date(String(i.modifiedOn ?? '')).getTime();
      return { id: i.identifier ?? i.id, title: i.title || '', age_days: Math.floor((Date.now() - updatedAt) / (24 * 60 * 60 * 1000)), last_updated: i.modifiedOn };
    }).sort((a, b) => b.age_days - a.age_days),
    high_priority_open: highPriority.slice(0, 10).map((i) => ({ id: i.identifier ?? i.id, title: i.title || '', priority: i.priority })),
    summary: { blocked_count: blocked.length, ageing_wip_count: agingWip.length, high_priority_count: highPriority.length },
  };
}

export function buildComponentsSummaryFromSQL(typeStats: Record<string, number>): Record<string, unknown> {
  const components = Object.entries(typeStats || {}).map(([name, count]) => ({ name, itemCount: count })).sort((a, b) => b.itemCount - a.itemCount).slice(0, 10);
  return { component_stats: components, total_components_tracked: components.length };
}

export function buildRecentActivityFromSQL(doltChanges: Issue[]): Record<string, unknown> {
  const activities = (doltChanges || []).slice(0, 10).map((c) => ({
    type: c.change_type || 'updated', issue: c.issue_id, title: c.title || '', status: c.status_label || c.status || '', timestamp: c.updated_at || new Date().toISOString(),
  }));

  const byStatus: Record<string, number> = {};
  activities.forEach((a) => { const s = a.status; byStatus[s] = (byStatus[s] || 0) + 1; });

  return {
    since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    summary: { created: 0, updated: activities.length, total: activities.length },
    by_status: byStatus, recent_items: activities, patterns: [],
  };
}

export function buildScratchpad(): Record<string, unknown> {
  return {
    sections: {
      thinking: { label: 'Current Thinking', content: '', purpose: 'Your current mental model and understanding of the situation' },
      plan: { label: 'Plan', content: '', purpose: 'Step-by-step plan for what you intend to do next' },
      memory: { label: 'Working Memory', content: '', purpose: 'Key facts, decisions, and context you need to remember short-term' },
      hypotheses: { label: 'Hypotheses', content: '', purpose: 'Working hypotheses and assumptions being tested' },
      follow_up: { label: 'Follow-up Actions', content: '', purpose: 'Action items and follow-ups to track' },
    },
    last_updated: new Date().toISOString(),
    usage_instructions: 'Use this scratchpad to think through complex problems, track your progress, and maintain context across messages. Update relevant sections as your understanding evolves.',
  };
}
