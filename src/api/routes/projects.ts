import path from 'path';
import fs from 'fs';

const ALLOWED_PROJECT_STATUSES = new Set(['active', 'archived']);
const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 100;
const TRACKER_PROVIDER = 'beads';
const CLOSED_ISSUE_STATUSES = new Set(['done', 'closed', 'resolved', 'complete', 'completed']);
const BLOCKED_ISSUE_STATUSES = new Set(['blocked']);
const DEFERRED_ISSUE_STATUSES = new Set(['deferred', 'snoozed', 'later']);
const IN_PROGRESS_ISSUE_STATUSES = new Set(['inprogress', 'in_progress', 'doing']);

interface RouteDeps {
  db: { getProject?: (id: string) => Record<string, unknown> | null; getAllProjects?: (filters?: Record<string, unknown>) => Record<string, unknown>[]; getProjectIssues?: (id: string) => Record<string, unknown>[]; getIssue?: (id: string) => Record<string, unknown> | null } | null;
  config: Record<string, unknown>;
  parseJsonBody: (req: unknown) => Promise<Record<string, unknown>>;
  sendJson: (res: unknown, code: number, data: unknown) => void;
  sendError: (res: unknown, code: number, message: string, details?: Record<string, unknown>) => void;
  logger: { info: (obj: Record<string, unknown>, msg: string) => void; warn: (obj: Record<string, unknown>, msg: string) => void; error: (obj: Record<string, unknown>, msg: string) => void };
  projectRegistry: { registerProject?: (p: string) => Record<string, unknown> | null; getProject?: (id: string) => Record<string, unknown> | null; getProjects?: (filters?: Record<string, unknown>) => Record<string, unknown>[] } | null;
  doltHubProvisioner: { provisionProjectBeadsRemote?: (id: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>> } | null;
  beadsIssueService: { getIssue?: (id: string) => Record<string, unknown> | null; claimIssue?: (...args: unknown[]) => Promise<unknown>; unclaimIssue?: (...args: unknown[]) => Promise<unknown>; closeIssue?: (...args: unknown[]) => Promise<unknown>; reopenIssue?: (...args: unknown[]) => Promise<unknown>; updateIssueStatus?: (id: string, status: string, opts: Record<string, unknown>) => Promise<unknown>; addIssueNote?: (id: string, content: string, opts: Record<string, unknown>) => Promise<unknown> } | null;
  beadsAdapter: {
    listIssues?: (
      project: { identifier: string; filesystem_path?: string | null },
      filters?: Record<string, unknown>,
      options?: { forceRefresh?: boolean },
    ) => Promise<{ items: Record<string, unknown>[] }>;
    [key: string]: unknown;
  } | null;
  beadsIssueMirror?: {
    ensureFresh: (projectId: string, maxAgeMs?: number) => Promise<{ source: string; error: string | null; changed: number; durationMs: number }>;
  } | null;
}

interface RouteContext { pathname: string; method: string }
interface HandleContext { req: unknown; res: unknown; url: URL; pathname: string }

interface App {
  registerRoute(opts: { match: (ctx: RouteContext) => boolean; handle: (ctx: HandleContext) => Promise<void> }): void;
}

function isAbsolutePath(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && path.isAbsolute(value.trim());
}

function serializeProject(project: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!project) return null;
  return {
    identifier: project.identifier, name: project.name, tech_stack: project.tech_stack,
    letta_agent_id: project.letta_agent_id, status: project.status, last_scan_at: project.last_scan_at,
    issue_count: project.issue_count, filesystem_path: project.filesystem_path,
    git_url: project.git_url, beads_remote: serializeBeadsRemoteStatus(project),
    description: project.description, last_sync_at: project.last_sync_at,
  };
}

function serializeBeadsRemoteStatus(project: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!project) return null;
  return {
    owner: project.beads_remote_owner || null, repo: project.beads_remote_repo || null,
    url: project.beads_remote_url || null, name: project.beads_remote_name || null,
    status: project.beads_remote_status || 'not_provisioned',
    provisioned_at: toIsoTimestamp(project.beads_remote_provisioned_at),
    last_push_at: toIsoTimestamp(project.beads_remote_last_push_at),
    error: project.beads_remote_last_error || null,
  };
}

function toIsoTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  const date = new Date(value as number);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeIssueStatus(status: string | null | undefined): string {
  if (!status) return 'open';
  const s = status.toLowerCase().trim();
  if (CLOSED_ISSUE_STATUSES.has(s)) return 'closed';
  if (BLOCKED_ISSUE_STATUSES.has(s)) return 'blocked';
  if (DEFERRED_ISSUE_STATUSES.has(s)) return 'deferred';
  if (IN_PROGRESS_ISSUE_STATUSES.has(s)) return 'in_progress';
  return 'open';
}

function isIssueReady(issue: Record<string, unknown>): boolean {
  const status = normalizeIssueStatus(issue.status as string);
  if (status === 'closed' || status === 'blocked' || status === 'deferred') return false;
  return !issue.isBlocked && (!issue.blockedBy || (issue.blockedBy as unknown[]).length === 0);
}

function parseJsonArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((x) => String(x));
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try { return JSON.parse(value) as string[]; } catch { return []; }
  }
  return [];
}

function serializeIssueDetail(issue: Record<string, unknown>): Record<string, unknown> {
  const normalizedStatus = normalizeIssueStatus(issue.status as string);
  const labels = parseJsonArray(issue.labels ?? issue.labels_json);
  const blockedByIds = parseJsonArray(issue.blocked_by ?? issue.blocked_by_json ?? issue.blockedBy);
  const blockedByRefs = blockedByIds.map((id) => ({ id }));
  const updatedAt = toIsoTimestamp(issue.beads_updated_at ?? issue.updated_at ?? issue.updatedAt);
  const createdAt = toIsoTimestamp(issue.created_at ?? issue.createdAt);
  const lastSyncAt = toIsoTimestamp(issue.last_sync_at);
  const id = String(issue.identifier ?? issue.id ?? '');
  const projectId = String(issue.project_identifier ?? issue.projectId ?? issue.project_id ?? '');
  return {
    id,
    project_id: projectId,
    provider: (issue.source as string) || TRACKER_PROVIDER,
    title: String(issue.title ?? ''),
    type: (issue.issue_type ?? issue.type ?? 'task') as string,
    priority: String(issue.priority ?? 'medium'),
    status: normalizedStatus,
    status_label: String(issue.status ?? 'todo'),
    ready: isIssueReady(issue),
    assignee: (issue.assignee ?? issue.owner ?? null) as string | null,
    blocked_by: blockedByRefs,
    blocks: [],
    is_blocked: blockedByIds.length > 0 || normalizedStatus === 'blocked',
    updated_at: updatedAt,
    created_at: createdAt,
    summary: String(issue.title ?? '').slice(0, 200),
    acceptance_criteria: [],
    labels,
    parent_id: (issue.parent_huly_id ?? issue.parent_id ?? null) as string | null,
    child_count: Number(issue.sub_issue_count ?? 0),
    validation_warnings: [],
    etag: `${id}:${updatedAt ?? ''}`,
    description: String(issue.description ?? ''),
    design_notes: null,
    notes: [],
    comments: [],
    children: [],
    timestamps: {
      created_at: createdAt,
      updated_at: updatedAt,
      last_sync_at: lastSyncAt,
    },
    metadata: {
      huly_id: (issue.huly_id ?? null) as string | null,
      vibe_task_id: (issue.vibe_task_id ?? null) as number | null,
    },
  };
}

function serializeIssue(issue: Record<string, unknown>): Record<string, unknown> {
  if (!issue) return null as unknown as Record<string, unknown>;
  const normalizedStatus = normalizeIssueStatus(issue.status as string);
  return {
    id: issue.id || issue.identifier, projectId: issue.project_id || issue.projectId,
    provider: issue.provider || TRACKER_PROVIDER, title: issue.title || '', type: issue.type || 'task',
    priority: issue.priority || 'medium', status: normalizedStatus,
    statusLabel: issue.statusLabel || issue.status || 'todo',
    ready: isIssueReady(issue), assignee: issue.assignee || null,
    blockedBy: issue.blockedBy || [], blocks: issue.blocks || [],
    isBlocked: !!(issue.isBlocked || (issue.blockedBy && (issue.blockedBy as unknown[]).length > 0)),
    updatedAt: toIsoTimestamp(issue.updatedAt || issue.modifiedAt || issue.updated_at),
    summary: String(issue.summary || issue.title || '').slice(0, 200),
    acceptanceCriteria: issue.acceptanceCriteria || issue.acceptance_criteria || [],
    labels: issue.labels || [], validationWarnings: issue.validationWarnings || [],
    etag: `${issue.id || issue.identifier}:${issue.updatedAt || issue.modifiedAt || 0}`,
  };
}

function paginate<T>(items: T[], cursor?: string, limit = DEFAULT_PAGE_LIMIT): { items: T[]; next_cursor: string | null; has_more: boolean; total_known: number } {
  const effectiveLimit = Math.min(limit, MAX_PAGE_LIMIT);
  let startIdx = 0;
  if (cursor) {
    const idx = items.findIndex(item => {
      const r = item as Record<string, unknown>;
      return r.id === cursor || r.identifier === cursor;
    });
    if (idx >= 0) startIdx = idx + 1;
  }
  const slice = items.slice(startIdx, startIdx + effectiveLimit);
  const lastItem = slice[slice.length - 1] as Record<string, unknown> | undefined;
  return {
    items: slice,
    next_cursor: lastItem && slice.length === effectiveLimit ? Buffer.from(String(lastItem.id || lastItem.identifier)).toString('base64') : null,
    has_more: startIdx + effectiveLimit < items.length,
    total_known: items.length,
  };
}

function getBeadsListFilters(url: URL): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  const status = url.searchParams.get('status');
  const priority = url.searchParams.get('priority');
  const type = url.searchParams.get('type');
  const assignee = url.searchParams.get('assignee');
  if (status) filters.status = normalizeIssueStatus(status);
  if (priority) filters.priority = priority;
  if (type) filters.type = type;
  if (assignee) filters.assignee = assignee;
  return filters;
}

async function hydrateIssuesFromBeads(
  beadsAdapter: RouteDeps['beadsAdapter'],
  project: Record<string, unknown>,
  filters: Record<string, unknown>,
  logger: RouteDeps['logger'],
): Promise<{ issues: Record<string, unknown>[]; source: 'beads' | 'database'; error: string | null }> {
  if (!beadsAdapter?.listIssues || !project?.filesystem_path) {
    return { issues: [], source: 'database', error: null };
  }
  try {
    const result = await beadsAdapter.listIssues(
      project as { identifier: string; filesystem_path?: string | null },
      filters,
      { forceRefresh: true },
    );
    const issues = (result.items || []).filter((i: Record<string, unknown>) => i?.id || i?.identifier);
    return { issues, source: 'beads', error: null };
  } catch (error) {
    logger.warn(
      { err: error, project_identifier: project.identifier as string },
      'Failed to hydrate issues from Beads',
    );
    return { issues: [], source: 'database', error: 'Issue data temporarily unavailable from Beads' };
  }
}

export function registerProjectRoutes(app: App, deps: RouteDeps): void {
  const { db, sendJson, sendError, logger, projectRegistry, doltHubProvisioner, beadsIssueService, beadsAdapter, beadsIssueMirror } = deps;

  // GET /api/projects
  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/projects' && method === 'GET',
    handle: async ({ res, url }) => {
      if (!db) { sendError(res, 503, 'Database not available'); return; }
      try {
        const statusFilter = url.searchParams.get('status');
        const techStackFilter = url.searchParams.get('tech_stack');
        const mcpEnabledFilter = url.searchParams.get('mcp_enabled');
        const filters: Record<string, unknown> = {};
        if (statusFilter && ALLOWED_PROJECT_STATUSES.has(statusFilter)) filters.status = statusFilter;
        if (techStackFilter) filters.tech_stack = techStackFilter;
        if (mcpEnabledFilter !== null) filters.mcp_enabled = mcpEnabledFilter === 'true';
        const rows = db.getAllProjects ? db.getAllProjects(filters) : (projectRegistry?.getProjects ? projectRegistry.getProjects(filters) : []);
        const projects = rows.map((p: Record<string, unknown>) => serializeProject(p)).filter(Boolean);
        const cursorParam = url.searchParams.get('cursor');
        const limitParam = url.searchParams.get('limit');
        const paginated = cursorParam !== null || limitParam !== null;
        const timestamp = new Date().toISOString();
        if (paginated) {
          const limit = Math.min(toNumber(limitParam, DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
          const page = paginate(projects, cursorParam || undefined, limit);
          sendJson(res, 200, {
            total: page.total_known,
            projects: page.items,
            timestamp,
            page: { next_cursor: page.next_cursor, has_more: page.has_more, total_known: page.total_known },
          });
        } else {
          sendJson(res, 200, {
            total: projects.length,
            projects,
            timestamp,
            page: { next_cursor: null, has_more: false, total_known: projects.length },
          });
        }
      } catch (error) { logger.error({ err: error }, 'Failed to list projects'); sendError(res, 500, 'Failed to list projects', { error: (error as Error).message }); }
    },
  });

  // GET /api/projects/:id/issues
  app.registerRoute({
    match: ({ pathname, method }) => pathname.startsWith('/api/projects/') && pathname.endsWith('/issues') && method === 'GET',
    handle: async ({ res, url, pathname }) => {
      const projectId = pathname.replace('/api/projects/', '').replace('/issues', '');
      if (!db) { sendError(res, 503, 'Database not available'); return; }
      try {
        const project = db.getProject ? db.getProject(projectId) : (projectRegistry?.getProject ? projectRegistry.getProject(projectId) : null);
        if (!project) { sendError(res, 404, 'Project not found'); return; }
        let issueSource: 'database' | 'mirror' | 'beads' = 'database';
        let hydrationError: string | null = null;
        let mirrorResult: { source: string; error: string | null; changed: number; durationMs: number } | null = null;
        if (beadsIssueMirror?.ensureFresh && project.filesystem_path) {
          try { mirrorResult = await beadsIssueMirror.ensureFresh(projectId); }
          catch (mirrorErr) { logger.warn({ err: mirrorErr, project_identifier: projectId }, 'Mirror ensureFresh failed; serving stale DB rows'); }
          if (mirrorResult) {
            hydrationError = mirrorResult.error;
            issueSource = mirrorResult.source === 'cached' ? 'database' : 'mirror';
          }
        }
        let allIssues = (db.getProjectIssues ? db.getProjectIssues(projectId) : []) as Record<string, unknown>[];
        if (allIssues.length === 0 && beadsAdapter?.listIssues && project.filesystem_path) {
          const hydrated = await hydrateIssuesFromBeads(beadsAdapter, project, getBeadsListFilters(url), logger);
          if (hydrated.issues.length > 0) { allIssues = hydrated.issues; issueSource = 'beads'; }
          if (hydrated.error) hydrationError = hydrated.error;
        }
        let filtered = allIssues;
        const statusFilter = url.searchParams.get('status');
        const priorityFilter = url.searchParams.get('priority');
        const typeFilter = url.searchParams.get('type');
        const readyFilter = url.searchParams.get('ready');
        const q = url.searchParams.get('q');
        const updatedSince = url.searchParams.get('updatedSince') || url.searchParams.get('updated_since');
        const sort = url.searchParams.get('sort') || 'priority';

        if (statusFilter) { const statuses = statusFilter.split(',').map(s => s.trim().toLowerCase()); filtered = filtered.filter(i => statuses.includes(normalizeIssueStatus(i.status as string))); }
        if (priorityFilter) { const priorities = priorityFilter.split(',').map(p => p.trim().toLowerCase()); filtered = filtered.filter(i => priorities.includes(((i.priority as string) || 'medium').toLowerCase())); }
        if (typeFilter) filtered = filtered.filter(i => i.type === typeFilter);
        if (readyFilter === 'true') filtered = filtered.filter(i => isIssueReady(i));
        if (readyFilter === 'false') filtered = filtered.filter(i => !isIssueReady(i));
        if (q) { const query = q.toLowerCase(); filtered = filtered.filter(i => ((i.title as string) || '').toLowerCase().includes(query) || ((i.description as string) || '').toLowerCase().includes(query)); }
        if (updatedSince) { const since = toNumber(updatedSince); if (since) filtered = filtered.filter(i => { const t = toNumber(i.updatedAt || i.modifiedAt || i.updated_at); return t >= since; }); }

        if (sort === 'updated') filtered.sort((a, b) => { const at = toNumber(a.updatedAt || a.modifiedAt || a.updated_at); const bt = toNumber(b.updatedAt || b.modifiedAt || b.updated_at); return bt - at; });
        else if (sort === 'created') filtered.sort((a, b) => { const at = toNumber(a.createdAt || a.created_at); const bt = toNumber(b.createdAt || b.created_at); return bt - at; });
        else { const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }; filtered.sort((a, b) => (priorityOrder[((a.priority as string) || 'none').toLowerCase()] ?? 4) - (priorityOrder[((b.priority as string) || 'none').toLowerCase()] ?? 4)); }

        const serialized = filtered.map(serializeIssue);
        const cursor = url.searchParams.get('cursor');
        const limit = Math.min(toNumber(url.searchParams.get('limit'), DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
        const page = paginate(serialized, cursor || undefined, limit);
        const trackerStats = {
          total: allIssues.length, filtered: serialized.length,
          open: allIssues.filter(i => normalizeIssueStatus(i.status as string) === 'open').length,
          inProgress: allIssues.filter(i => normalizeIssueStatus(i.status as string) === 'in_progress').length,
          closed: allIssues.filter(i => normalizeIssueStatus(i.status as string) === 'closed').length,
          blocked: allIssues.filter(i => normalizeIssueStatus(i.status as string) === 'blocked').length,
        };
        const dataFreshness: Record<string, unknown> = { status: hydrationError ? 'stale' : 'fresh', last_sync_at: toIsoTimestamp(project.last_sync_at), source: issueSource };
        if (hydrationError) dataFreshness.error = hydrationError;
        sendJson(res, 200, { projectId, project: serializeProject(project), issues: page.items, tracker_stats: trackerStats, data_freshness: dataFreshness, page: { next_cursor: page.next_cursor, has_more: page.has_more, total_known: page.total_known } });
      } catch (error) { logger.error({ err: error }, 'Failed to list issues'); sendError(res, 500, 'Failed to list issues', { error: (error as Error).message }); }
    },
  });

  // GET /api/issues/:id
  app.registerRoute({
    match: ({ pathname, method }) => pathname.startsWith('/api/issues/') && !pathname.endsWith('/issues') && method === 'GET',
    handle: async ({ res, pathname }) => {
      const issueId = pathname.replace('/api/issues/', '');
      if (!db) { sendError(res, 503, 'Database not available'); return; }
      try {
        let issue = (db.getIssue ? db.getIssue(issueId) : null) as Record<string, unknown> | null;
        if (issue && beadsIssueMirror?.ensureFresh) {
          const projectId = String(issue.project_identifier ?? '');
          if (projectId) {
            try { await beadsIssueMirror.ensureFresh(projectId); }
            catch (mirrorErr) { logger.warn({ err: mirrorErr, issueId }, 'Mirror ensureFresh on detail failed'); }
            issue = (db.getIssue?.(issueId) ?? issue) as Record<string, unknown> | null;
          }
        }
        if (!issue && beadsIssueService?.getIssue) {
          issue = beadsIssueService.getIssue(issueId) as Record<string, unknown> | null;
        }
        if (!issue) { sendError(res, 404, 'Issue not found'); return; }
        sendJson(res, 200, { issue: serializeIssueDetail(issue), timestamp: new Date().toISOString() });
      } catch (error) { logger.error({ err: error }, 'Failed to get issue'); sendError(res, 500, 'Failed to get issue', { error: (error as Error).message }); }
    },
  });

  // GET /api/projects/:id/ready-work
  app.registerRoute({
    match: ({ pathname, method }) => pathname.startsWith('/api/projects/') && pathname.endsWith('/ready-work') && method === 'GET',
    handle: async ({ res, url, pathname }) => {
      const projectId = pathname.replace('/api/projects/', '').replace('/ready-work', '');
      if (!db) { sendError(res, 503, 'Database not available'); return; }
      try {
        const allIssues = (db.getProjectIssues ? db.getProjectIssues(projectId) : []) as Record<string, unknown>[];
        const ready = allIssues.filter(isIssueReady);
        const serialized = ready.map(serializeIssue);
        const cursor = url.searchParams.get('cursor');
        const limit = Math.min(toNumber(url.searchParams.get('limit'), DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
        const page = paginate(serialized, cursor || undefined, limit);
        sendJson(res, 200, { projectId, ready_work: page.items, page: { next_cursor: page.next_cursor, has_more: page.has_more, total_known: page.total_known } });
      } catch (error) { logger.error({ err: error }, 'Failed to get ready work'); sendError(res, 500, 'Failed to get ready work', { error: (error as Error).message }); }
    },
  });

  // GET /api/projects/:id
  app.registerRoute({
    match: ({ pathname, method }) => pathname.startsWith('/api/projects/') && pathname.split('/').length === 4 && method === 'GET',
    handle: async ({ res, pathname }) => {
      const projectId = pathname.split('/')[3]!;
      if (!db) { sendError(res, 503, 'Database not available'); return; }
      try {
        const project = db.getProject ? db.getProject(projectId) : (projectRegistry?.getProject ? projectRegistry.getProject(projectId) : null);
        if (!project) { sendError(res, 404, 'Project not found'); return; }
        sendJson(res, 200, { project: serializeProject(project), etag: `${project.identifier}:${project.last_scan_at || 0}` });
      } catch (error) { logger.error({ err: error }, 'Failed to get project'); sendError(res, 500, 'Failed to get project', { error: (error as Error).message }); }
    },
  });

  // POST /api/registry/projects
  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/registry/projects' && method === 'POST',
    handle: async ({ req, res }) => {
      try {
        const body = await deps.parseJsonBody(req);
        const { filesystem_path } = body;
        if (!filesystem_path || !isAbsolutePath(filesystem_path)) { sendError(res, 400, 'filesystem_path must be an absolute path'); return; }
        if (!fs.existsSync(filesystem_path as string)) { sendError(res, 400, 'Directory does not exist', { path: filesystem_path }); return; }
        const project = projectRegistry?.registerProject ? projectRegistry.registerProject(filesystem_path as string) : null;
        if (!project) { sendError(res, 500, 'Failed to register project'); return; }
        sendJson(res, 201, serializeProject(project));
      } catch (error) { logger.error({ err: error }, 'Failed to register project'); sendError(res, 500, 'Failed to register project', { error: (error as Error).message }); }
    },
  });

  // GET /api/registry/projects/:id
  app.registerRoute({
    match: ({ pathname, method }) => pathname.startsWith('/api/registry/projects/') && pathname.split('/').length === 5 && method === 'GET',
    handle: async ({ res, pathname }) => {
      const projectId = pathname.replace('/api/registry/projects/', '');
      try {
        const project = projectRegistry?.getProject ? projectRegistry.getProject(projectId) : null;
        if (!project) { sendError(res, 404, 'Project not found'); return; }
        sendJson(res, 200, serializeProject(project));
      } catch (error) { logger.error({ err: error }, 'Failed to get project'); sendError(res, 500, 'Failed to get project', { error: (error as Error).message }); }
    },
  });

  // POST /api/projects/:id/beads-remote/provision
  app.registerRoute({
    match: ({ pathname, method }) => pathname.startsWith('/api/projects/') && pathname.endsWith('/beads-remote/provision') && method === 'POST',
    handle: async ({ req, res, pathname }) => {
      const projectId = pathname.replace('/api/projects/', '').replace('/beads-remote/provision', '');
      try {
        if (!doltHubProvisioner?.provisionProjectBeadsRemote) { sendError(res, 503, 'DoltHub provisioning not available'); return; }
        const body = await deps.parseJsonBody(req);
        const result = await doltHubProvisioner.provisionProjectBeadsRemote(projectId, { push: body.push !== false });
        sendJson(res, 200, result);
      } catch (error) { logger.error({ err: error }, 'Failed to provision Beads remote'); sendError(res, 500, 'Failed to provision Beads remote', { error: (error as Error).message }); }
    },
  });

  // Issue mutations: claim, unclaim, close, reopen
  const ISSUE_MUTATIONS = ['claim', 'unclaim', 'close', 'reopen'] as const;
  for (const action of ISSUE_MUTATIONS) {
    const methodName = `${action}Issue` as const;
    app.registerRoute({
      match: ({ pathname, method }: RouteContext) => pathname.startsWith('/api/issues/') && pathname.endsWith(`/${action}`) && method === 'POST',
      handle: async ({ req, res, pathname }: HandleContext) => {
        const issueId = pathname.replace('/api/issues/', '').replace(`/${action}`, '');
        if (!beadsAdapter && !beadsIssueService) { sendError(res, 503, 'Issue mutation service not available'); return; }
        try {
          const reqHeaders = (req as { headers?: Record<string, string> }).headers || {};
          const idempotencyKey = reqHeaders['idempotency-key'] || reqHeaders['Idempotency-Key'];
          if (!idempotencyKey) { sendError(res, 400, 'Idempotency-Key header required'); return; }
          const body = await deps.parseJsonBody(req);
          let result: unknown;
          const service = beadsIssueService as Record<string, unknown>;
          if (typeof service[methodName] === 'function') {
            result = await (service[methodName] as (...args: unknown[]) => unknown)(issueId, { ...body, idempotencyKey });
          } else if (beadsAdapter) {
            result = await (beadsAdapter as { _handleBeadsAdapterMutation?: (...args: unknown[]) => unknown })._handleBeadsAdapterMutation?.(action, issueId, body, beadsAdapter, idempotencyKey);
          } else { sendError(res, 503, 'No issue mutation backend available'); return; }
          sendJson(res, 200, result);
        } catch (error) { logger.error({ err: error }, `Failed to ${action} issue`); sendError(res, 500, `Failed to ${action} issue`, { error: (error as Error).message }); }
      },
    });
  }

  // PATCH /api/issues/:id/status
  app.registerRoute({
    match: ({ pathname, method }) => pathname.startsWith('/api/issues/') && pathname.endsWith('/status') && method === 'PATCH',
    handle: async ({ req, res, pathname }) => {
      const issueId = pathname.replace('/api/issues/', '').replace('/status', '');
      if (!beadsIssueService?.updateIssueStatus) { sendError(res, 503, 'Issue mutation service not available'); return; }
      try {
        const body = await deps.parseJsonBody(req);
        const reqHeaders2 = (req as { headers?: Record<string, string> }).headers || {}; const idempotencyKey = reqHeaders2['idempotency-key'] || reqHeaders2['Idempotency-Key'];
        if (!idempotencyKey) { sendError(res, 400, 'Idempotency-Key header required'); return; }
        if (!body.status) { sendError(res, 400, 'status field required'); return; }
        const result = await beadsIssueService.updateIssueStatus(issueId, body.status as string, { idempotencyKey, ...body });
        sendJson(res, 200, result);
      } catch (error) { logger.error({ err: error }, 'Failed to update issue status'); sendError(res, 500, 'Failed to update issue status', { error: (error as Error).message }); }
    },
  });

  // POST /api/issues/:id/notes
  app.registerRoute({
    match: ({ pathname, method }) => pathname.startsWith('/api/issues/') && pathname.endsWith('/notes') && method === 'POST',
    handle: async ({ req, res, pathname }) => {
      const issueId = pathname.replace('/api/issues/', '').replace('/notes', '');
      if (!beadsIssueService?.addIssueNote) { sendError(res, 503, 'Issue mutation service not available'); return; }
      try {
        const body = await deps.parseJsonBody(req);
        const reqHeaders = (req as { headers?: Record<string, string> }).headers || {}; const idempotencyKey = reqHeaders['idempotency-key'] || reqHeaders['Idempotency-Key'];
        if (!idempotencyKey) { sendError(res, 400, 'Idempotency-Key header required'); return; }
        if (!body.content) { sendError(res, 400, 'content field required'); return; }
        const result = await beadsIssueService.addIssueNote(issueId, body.content as string, { idempotencyKey, ...body });
        sendJson(res, 200, result);
      } catch (error) { logger.error({ err: error }, 'Failed to add issue note'); sendError(res, 500, 'Failed to add issue note', { error: (error as Error).message }); }
    },
  });
}
