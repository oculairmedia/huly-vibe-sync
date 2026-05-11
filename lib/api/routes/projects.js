import path from 'path';
import fs from 'fs';

const ALLOWED_PROJECT_STATUSES = new Set(['active', 'archived']);
const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 100;
const STALE_AFTER_MS = 15 * 60 * 1000;
const TRACKER_PROVIDER = 'beads';
const CLOSED_ISSUE_STATUSES = new Set(['done', 'closed', 'resolved', 'complete', 'completed']);
const BLOCKED_ISSUE_STATUSES = new Set(['blocked']);
const DEFERRED_ISSUE_STATUSES = new Set(['deferred', 'snoozed', 'later']);
const IN_PROGRESS_ISSUE_STATUSES = new Set(['inprogress', 'in_progress', 'doing']);

function isAbsolutePath(value) {
  return typeof value === 'string' && value.trim().length > 0 && path.isAbsolute(value.trim());
}

function serializeProject(project) {
  if (!project) return null;

  return {
    identifier: project.identifier,
    name: project.name,
    tech_stack: project.tech_stack,
    letta_agent_id: project.letta_agent_id,
    status: project.status,
    last_scan_at: project.last_scan_at,
    issue_count: project.issue_count,
    filesystem_path: project.filesystem_path,
    git_url: project.git_url,
    beads_remote: serializeBeadsRemoteStatus(project),
    description: project.description,
    last_sync_at: project.last_sync_at,
  };
}

function serializeBeadsRemoteStatus(project) {
  if (!project) return null;

  return {
    owner: project.beads_remote_owner || null,
    repo: project.beads_remote_repo || null,
    url: project.beads_remote_url || null,
    name: project.beads_remote_name || null,
    status: project.beads_remote_status || 'not_provisioned',
    visibility: project.beads_remote_visibility || null,
    provisioned_at: toIsoTimestamp(project.beads_remote_provisioned_at),
    last_push_at: toIsoTimestamp(project.beads_remote_last_push_at),
    error: project.beads_remote_last_error || null,
  };
}

function toIsoTimestamp(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getProjectUpdatedAt(project) {
  return project?.updated_at || project?.last_checked_at || project?.last_sync_at || null;
}

function getProjectLastActivityAt(project) {
  return project?.last_sync_at || project?.last_checked_at || getProjectUpdatedAt(project);
}

function encodeCursor(value) {
  return Buffer.from(String(value), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return 0;
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const offset = Number.parseInt(decoded, 10);
  return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

function getPagination(url) {
  const requestedLimit = Number.parseInt(url.searchParams.get('limit') || '', 10);
  const limit = Math.min(
    Math.max(Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_PAGE_LIMIT, 1),
    MAX_PAGE_LIMIT,
  );
  const offset = decodeCursor(url.searchParams.get('cursor'));

  return { limit, offset };
}

function paginate(items, url) {
  const { limit, offset } = getPagination(url);
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  const hasMore = nextOffset < items.length;

  return {
    items: pageItems,
    page: {
      limit,
      next_cursor: hasMore ? encodeCursor(nextOffset) : null,
      has_more: hasMore,
      total_known: items.length,
    },
  };
}

function parseBooleanOption(value, defaultValue) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  }
  return defaultValue;
}

function getProjectIdentifiersFromBody(body) {
  const value = body?.identifiers || body?.projectIds || body?.project_ids || body?.projects;
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function getProjectsNeedingBeadsRemoteFromDb(db) {
  const candidates =
    db.projects?.getProjectsNeedingBeadsRemote?.() ||
    db.getAllProjects?.().filter(
      (project) =>
        project.status === 'active' &&
        project.filesystem_path &&
        (!project.beads_remote_url || ['pending', 'error'].includes(project.beads_remote_status)),
    ) ||
    [];

  return candidates.filter((project) => hasAccessibleBeadsDatabase(project));
}

function hasAccessibleBeadsDatabase(project) {
  if (!project?.filesystem_path) return false;
  if (String(project.filesystem_path).includes('/huly-sync-placeholders/')) return false;

  try {
    const beadsPath = path.join(project.filesystem_path, '.beads');
    fs.accessSync(beadsPath, fs.constants.R_OK | fs.constants.W_OK);
    if (!fs.statSync(beadsPath).isDirectory()) return false;

    fs.accessSync(path.join(beadsPath, 'config.yaml'), fs.constants.R_OK);

    const serverPidPath = path.join(beadsPath, 'dolt-server.pid');
    if (fs.existsSync(serverPidPath)) {
      fs.accessSync(serverPidPath, fs.constants.R_OK | fs.constants.W_OK);
    }

    fs.accessSync(path.join(beadsPath, 'dolt'), fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function isNonProvisionableBeadsError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /no beads database found|database "beads" not found|Dolt server unreachable|permission denied/i.test(
    message,
  );
}

function getBeadsRemoteBatchProjects(db, body = {}) {
  const identifiers = getProjectIdentifiersFromBody(body);
  const missing = [];
  const skipped = [];
  let projects;

  if (identifiers.length > 0) {
    projects = identifiers
      .map((identifier) => {
        const project = getProjectFromDb(db, identifier);
        if (!project) missing.push(identifier);
        return project;
      })
      .filter(Boolean);
  } else if (body.only_missing !== false && body.onlyMissing !== false) {
    projects =
      db.projects?.getProjectsNeedingBeadsRemote?.() ||
      db.getAllProjects?.().filter(
        (project) =>
          project.status === 'active' &&
          project.filesystem_path &&
          (!project.beads_remote_url || ['pending', 'error'].includes(project.beads_remote_status)),
      ) ||
      [];
  } else {
    projects = (db.getAllProjects?.() || []).filter(
      (project) => project.status === 'active' && project.filesystem_path,
    );
  }

  const accessibleProjects = [];
  for (const project of projects) {
    if (hasAccessibleBeadsDatabase(project)) {
      accessibleProjects.push(project);
    } else {
      skipped.push({
        identifier: project.identifier,
        status: 'skipped',
        reason: 'no_accessible_beads_database',
        filesystem_path: project.filesystem_path || null,
        error: null,
      });
    }
  }

  const requestedLimit = Number.parseInt(body.limit || body.max_projects || body.maxProjects || '', 10);
  return {
    projects:
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? accessibleProjects.slice(0, requestedLimit)
        : accessibleProjects,
    missing,
    skipped,
  };
}

function getDataFreshness(lastSyncAt, options = {}) {
  const lastSyncIso = toIsoTimestamp(lastSyncAt);
  const status = options.status || (lastSyncIso ? 'available' : 'unknown');
  const error = options.error || null;
  const source = options.source || null;
  const lastSyncTime = lastSyncAt ? new Date(lastSyncAt).getTime() : null;
  const isStale =
    status === 'available' && lastSyncTime ? Date.now() - lastSyncTime > STALE_AFTER_MS : false;

  return {
    status: error ? 'error' : status,
    last_sync_at: lastSyncIso,
    error,
    source,
    is_stale: isStale,
    stale_threshold_ms: STALE_AFTER_MS,
  };
}

function getSubresourceEtag(project, subresource, lastSyncAt) {
  const version = toIsoTimestamp(lastSyncAt) || toIsoTimestamp(getProjectUpdatedAt(project));
  return version ? `${project.identifier}:${subresource}:${version}` : null;
}

function getUnavailableFreshness(lastSyncAt, error) {
  return getDataFreshness(lastSyncAt, { error });
}

function summarizeTracker(project, issues, options = {}) {
  const activeStatuses = new Set(['todo', 'open', 'inprogress', 'in_progress', 'active', 'ready']);
  const workItems = Array.isArray(issues) ? issues : [];
  const dataFreshness = options.data_freshness || getDataFreshness(project?.last_sync_at);

  return {
    // Display/debug metadata only; clients should use capabilities, summary, and work item fields for logic.
    provider: TRACKER_PROVIDER,
    status: dataFreshness.status === 'error' ? 'error' : 'available',
    last_sync_at: toIsoTimestamp(project?.last_sync_at),
    data_freshness: dataFreshness,
    capabilities: {
      work_items: true,
      activity: true,
      agents: Boolean(project?.letta_agent_id),
      conversations: false,
      priority: true,
      status: true,
      parent_child: true,
      labels: false,
      dependencies: false,
    },
    summary: {
      total_known: workItems.length || toNumber(project?.issue_count),
      ready: workItems.filter((item) => activeStatuses.has(String(item.status || '').toLowerCase()))
        .length,
      in_progress: workItems.filter((item) =>
        ['inprogress', 'in_progress'].includes(String(item.status || '').toLowerCase()),
      ).length,
      blocked: workItems.filter((item) =>
        BLOCKED_ISSUE_STATUSES.has(String(item.status || '').toLowerCase()),
      ).length,
      closed_recent: workItems.filter((item) =>
        CLOSED_ISSUE_STATUSES.has(String(item.status || '').toLowerCase()),
      ).length,
    },
  };
}

function normalizeIssueStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (CLOSED_ISSUE_STATUSES.has(normalized)) return 'closed';
  if (BLOCKED_ISSUE_STATUSES.has(normalized)) return 'blocked';
  if (DEFERRED_ISSUE_STATUSES.has(normalized)) return 'deferred';
  if (IN_PROGRESS_ISSUE_STATUSES.has(normalized)) return 'in_progress';
  return 'open';
}

function getIssueTimestamp(issue) {
  return issue.updated_at || issue.last_sync_at || issue.created_at || null;
}

function parseIssueList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getIssueRefs(issues, ids) {
  const idSet = new Set(ids.filter(Boolean));
  return issues
    .filter((issue) => idSet.has(issue.identifier) || idSet.has(String(issue.huly_id || '')))
    .map((issue) => ({
      id: issue.identifier,
      projectId: issue.project_identifier,
      title: issue.title,
      status: normalizeIssueStatus(issue.status),
      priority: issue.priority || null,
    }));
}

function getIssueGraph(issue, projectIssues) {
  const blockedByIds = [
    ...parseIssueList(issue.blocked_by),
    issue.parent_huly_id,
    issue.parent_vibe_id,
  ].filter(Boolean);
  const blockedBy = getIssueRefs(projectIssues, blockedByIds);
  const blocks = projectIssues
    .filter(
      (candidate) =>
        candidate.parent_huly_id === issue.huly_id ||
        candidate.parent_vibe_id === issue.vibe_task_id,
    )
    .map((candidate) => ({
      id: candidate.identifier,
      projectId: candidate.project_identifier,
      title: candidate.title,
      status: normalizeIssueStatus(candidate.status),
      priority: candidate.priority || null,
    }));

  const status = normalizeIssueStatus(issue.status);
  const isBlocked = status === 'blocked' || blockedBy.length > 0;
  const ready = !isBlocked && status === 'open';

  return { blockedBy, blocks, isBlocked, ready };
}

function serializeAndroidIssue(issue, projectIssues = [], options = {}) {
  const graph = getIssueGraph(issue, projectIssues);
  const status = normalizeIssueStatus(issue.status);
  const criteria = parseIssueList(issue.acceptance_criteria || issue.acceptanceCriteria);

  return {
    id: issue.identifier,
    projectId: issue.project_identifier,
    provider: TRACKER_PROVIDER,
    title: issue.title,
    type: issue.issue_type || issue.type || (toNumber(issue.sub_issue_count) > 0 ? 'epic' : 'task'),
    priority: issue.priority || null,
    status,
    statusLabel: issue.status || status,
    ready: graph.ready,
    assignee: issue.assignee || null,
    blockedBy: graph.blockedBy,
    blocks: graph.blocks,
    isBlocked: graph.isBlocked,
    updatedAt: toIsoTimestamp(getIssueTimestamp(issue)),
    createdAt: toIsoTimestamp(issue.created_at),
    summary:
      issue.summary ||
      String(issue.description || '')
        .split('\n')
        .find(Boolean) ||
      null,
    acceptanceCriteria: criteria,
    labels: parseIssueList(issue.labels || issue.tags),
    parentId: issue.parent_huly_id || issue.parent_vibe_id || null,
    childCount: toNumber(issue.sub_issue_count),
    validationWarnings: criteria.length ? [] : [{ code: 'missing_acceptance_criteria' }],
    etag: `${issue.identifier}:${getIssueTimestamp(issue) || 'unknown'}`,
    ...(options.detail
      ? {
          description: issue.description || '',
          designNotes: issue.design_notes || issue.designNotes || null,
          notes: parseIssueList(issue.notes || issue.comments),
          timestamps: {
            created_at: toIsoTimestamp(issue.created_at),
            updated_at: toIsoTimestamp(issue.updated_at),
            last_sync_at: toIsoTimestamp(issue.last_sync_at),
          },
          metadata: {
            huly_id: issue.huly_id || null,
            vibe_task_id: issue.vibe_task_id || null,
            deleted_from_huly: Boolean(issue.deleted_from_huly),
            deleted_from_vibe: Boolean(issue.deleted_from_vibe),
          },
        }
      : {}),
  };
}

function filterAndroidIssues(issues, url) {
  const status = url.searchParams.get('status');
  const priority = url.searchParams.get('priority');
  const assignee = url.searchParams.get('assignee');
  const type = url.searchParams.get('type');
  const ready = url.searchParams.get('ready');
  const query = url.searchParams.get('q') || url.searchParams.get('query');
  const updatedSince =
    url.searchParams.get('updatedSince') || url.searchParams.get('updated_since');
  const sinceTime = updatedSince ? new Date(updatedSince).getTime() : null;

  return issues.filter((issue) => {
    const normalizedStatus = normalizeIssueStatus(issue.status);
    const serialized = serializeAndroidIssue(issue, issues);
    if (status && normalizedStatus !== status) return false;
    if (priority && String(issue.priority || '') !== priority) return false;
    if (assignee && String(issue.assignee || '') !== assignee) return false;
    if (type && String(serialized.type || '') !== type) return false;
    if (ready !== null && String(serialized.ready) !== ready) return false;
    if (query) {
      const haystack = `${issue.title || ''}\n${issue.description || ''}`.toLowerCase();
      if (!haystack.includes(query.toLowerCase())) return false;
    }
    if (sinceTime && (new Date(getIssueTimestamp(issue) || 0).getTime() || 0) <= sinceTime) {
      return false;
    }
    return true;
  });
}

function matchesIssueStatus(issueStatus, requestedStatus) {
  if (!requestedStatus) return true;
  const rawIssueStatus = String(issueStatus || '').toLowerCase();
  const rawRequestedStatus = String(requestedStatus || '').toLowerCase();
  return (
    rawIssueStatus === rawRequestedStatus ||
    normalizeIssueStatus(rawIssueStatus) === normalizeIssueStatus(rawRequestedStatus)
  );
}

function getIdempotencyKey(req, body) {
  return req.headers['idempotency-key'] || body.idempotency_key || body.idempotencyKey || null;
}

async function handleIssueMutation({
  req,
  res,
  pathname,
  parseJsonBody,
  sendJson,
  sendError,
  logger,
  db,
  beadsIssueService,
  action,
}) {
  if (!db) {
    sendError(res, 503, 'Database not available');
    return;
  }
  if (!beadsIssueService) {
    sendError(res, 503, 'Beads issue mutation service not available');
    return;
  }

  try {
    const issueId = decodeURIComponent(pathname.split('/')[3]);
    const issue = db.getIssue?.(issueId);

    if (!issue) {
      sendError(res, 404, 'Issue not found', { issueId });
      return;
    }

    const body = await parseJsonBody(req).catch(() => ({}));
    const expectedEtag = req.headers['if-match'] || body.if_match || body.ifMatch || null;
    const currentEtag = `${issue.identifier}:${getIssueTimestamp(issue) || 'unknown'}`;

    if (expectedEtag && expectedEtag !== currentEtag) {
      sendJson(res, 409, {
        error: 'Issue conflict',
        statusCode: 409,
        conflict: {
          reason: 'etag_mismatch',
          expected: expectedEtag,
          current: currentEtag,
          issueId,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const result = await beadsIssueService.mutateIssue({
      action,
      issue,
      body,
      idempotencyKey: getIdempotencyKey(req, body),
    });
    const refreshedIssue = db.getIssue?.(issueId) || issue;
    const projectIssues = getProjectIssuesFromDb(db, refreshedIssue.project_identifier);

    sendJson(res, 200, {
      schema_version: 1,
      mutation: {
        action,
        idempotency_key: getIdempotencyKey(req, body),
        applied: result.applied !== false,
        command: result.command || null,
      },
      issue: serializeAndroidIssue(refreshedIssue, projectIssues, { detail: true }),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ err: error, action }, 'Failed to mutate issue');
    sendError(res, 500, 'Failed to update issue', {
      error: error.message || 'Issue mutation failed',
    });
  }
}

function serializeProjectSummary(project, issues = [], options = {}) {
  const issueCount = toNumber(project?.issue_count, Array.isArray(issues) ? issues.length : 0);
  const updatedAt = getProjectUpdatedAt(project);

  return {
    id: project.identifier,
    identifier: project.identifier,
    name: project.name,
    status: project.status || 'active',
    tech_stack: project.tech_stack || null,
    repo: {
      provider: project.git_url ? 'git' : null,
      remote_url: project.git_url || null,
      filesystem_path: project.filesystem_path || null,
      branch: null,
      dirty: null,
    },
    agents: {
      total: project.letta_agent_id ? 1 : 0,
      active: project.letta_agent_id ? 1 : 0,
      default_agent_id: project.letta_agent_id || null,
    },
    conversations: {
      total_known: 0,
      has_more: false,
      last_conversation_id: null,
    },
    tracker: summarizeTracker({ ...project, issue_count: issueCount }, issues, options.tracker),
    last_activity_at: toIsoTimestamp(getProjectLastActivityAt(project)),
    updated_at: toIsoTimestamp(updatedAt),
    version: updatedAt ? String(updatedAt) : null,
    // Project etag is intentionally scoped to project summary/detail fields. Tracker or
    // subresource freshness changes are represented by subresource etags/freshness metadata.
    etag: updatedAt ? `${project.identifier}:${updatedAt}` : null,
  };
}

function serializeWorkItem(issue) {
  const status = issue.status || 'unknown';
  const isBlocked = String(status).toLowerCase() === 'blocked';

  return {
    id: issue.identifier,
    // Display/debug metadata only; clients should not branch behavior on provider strings.
    provider: TRACKER_PROVIDER,
    title: issue.title,
    status,
    priority: issue.priority || null,
    type: null,
    labels: [],
    assignee: null,
    blocked: isBlocked,
    dependency_count: 0,
    parent_id: issue.parent_huly_id || issue.parent_vibe_id || null,
    child_count: toNumber(issue.sub_issue_count),
    updated_at: toIsoTimestamp(issue.updated_at || issue.last_sync_at),
    created_at: toIsoTimestamp(issue.created_at),
    url: null,
    metadata: {
      vibe_task_id: issue.vibe_task_id || null,
      deleted_from_vibe: Boolean(issue.deleted_from_vibe),
      last_sync_at: toIsoTimestamp(issue.last_sync_at),
    },
  };
}

function getProjectFromDb(db, identifier) {
  const resolvedIdentifier = db.resolveProjectIdentifier?.(identifier) || identifier;
  return db.getProject?.(resolvedIdentifier) || null;
}

function getProjectIssuesFromDb(db, identifier) {
  const resolvedIdentifier = db.resolveProjectIdentifier?.(identifier) || identifier;
  return db.getProjectIssues?.(resolvedIdentifier) || [];
}

function normalizeBeadsIssueForRoutes(issue, projectIdentifier) {
  return {
    ...issue,
    identifier: issue.identifier || issue.id,
    project_identifier: issue.project_identifier || projectIdentifier,
    issue_type: issue.issue_type || issue.type,
    created_at: issue.created_at || issue.createdAt,
    updated_at: issue.updated_at || issue.updatedAt,
    closed_at: issue.closed_at || issue.closedAt,
    blocked_by: issue.blocked_by || issue.blockedBy,
    blocks: issue.blocks || [],
    parent_huly_id: issue.parent_huly_id || issue.parentId || issue.parent || null,
    parent_vibe_id: issue.parent_vibe_id || null,
    sub_issue_count: issue.sub_issue_count ?? issue.childCount ?? issue.dependent_count ?? 0,
    huly_id: issue.huly_id || issue.identifier || issue.id,
    vibe_task_id: issue.vibe_task_id || null,
    acceptance_criteria: issue.acceptance_criteria || issue.acceptanceCriteria,
    design_notes: issue.design_notes || issue.designNotes,
    last_sync_at: issue.last_sync_at || issue.updated_at || issue.updatedAt,
    deleted_from_huly: issue.deleted_from_huly || false,
    deleted_from_vibe: issue.deleted_from_vibe || false,
  };
}

async function getProjectIssuesWithBeadsFallback({
  db,
  project,
  projectIdentifier,
  beadsAdapter,
  logger,
  filters = {},
}) {
  const dbIssues = getProjectIssuesFromDb(db, projectIdentifier);

  if (dbIssues.length > 0 || !beadsAdapter || !project?.filesystem_path) {
    return { issues: dbIssues, source: 'database', error: null };
  }

  try {
    const beadsResult = await beadsAdapter.listIssues(project, filters, { forceRefresh: true });
    const issues = (beadsResult.items || [])
      .filter((issue) => issue?.id || issue?.identifier)
      .map((issue) => normalizeBeadsIssueForRoutes(issue, projectIdentifier));

    db.updateProjectActivity?.(projectIdentifier, issues.length);

    return { issues, source: 'beads', error: null };
  } catch (error) {
    logger?.warn?.(
      { err: error, project_identifier: projectIdentifier },
      'Failed to hydrate issues from Beads fallback',
    );
    return {
      issues: dbIssues,
      source: 'database',
      error: 'Issue data is temporarily unavailable from Beads',
    };
  }
}

function getBeadsListFilters(url) {
  const filters = {};
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

function getCanonicalProjectIdentifier(db, identifier) {
  return db.resolveProjectIdentifier?.(identifier) || identifier;
}

function getProjectLettaInfo(db, project) {
  return (
    db.projects?.getProjectLettaInfo?.(project.identifier) || {
      letta_agent_id: project.letta_agent_id || null,
      letta_folder_id: project.letta_folder_id || null,
      letta_source_id: project.letta_source_id || null,
      letta_last_sync_at: project.letta_last_sync_at || null,
    }
  );
}

export function registerProjectRoutes(app, deps) {
  const {
    db,
    codePerceptionWatcher,
    parseJsonBody,
    sendJson,
    sendError,
    logger,
    projectRegistry,
    doltHubProvisioner,
    beadsIssueService,
    beadsAdapter,
  } = deps;

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/projects' && method === 'GET',
    handle: async ({ res }) => {
      if (!db) {
        sendError(res, 503, 'Database not available');
        return;
      }

      try {
        const projects = db.getAllProjects?.() ?? db.getProjectSummary?.() ?? [];
        // Keep this endpoint strictly lightweight for mobile first paint: no per-project
        // work item, conversation, or full agent hydration here. Subresources hydrate later.
        const summaries = projects.map((project) => serializeProjectSummary(project));
        sendJson(res, 200, {
          total: summaries.length,
          projects: summaries,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get projects');
        sendError(res, 500, 'Failed to fetch projects', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/projects/beads-remote' && method === 'GET',
    handle: async ({ res, url }) => {
      if (!db) {
        sendError(res, 503, 'Database not available');
        return;
      }

      try {
        const onlyMissing = parseBooleanOption(url.searchParams.get('only_missing'), true);
        const projects = onlyMissing
          ? getProjectsNeedingBeadsRemoteFromDb(db)
          : (db.getAllProjects?.() || []).filter(
              (project) => project.status === 'active' && project.filesystem_path,
            );
        const provisioned = projects.filter(
          (project) => project.beads_remote_status === 'provisioned' && project.beads_remote_url,
        ).length;
        const failed = projects.filter((project) => project.beads_remote_status === 'error').length;

        sendJson(res, 200, {
          schema_version: 1,
          total: projects.length,
          summary: {
            provisioned,
            failed,
            needs_provisioning: projects.length - provisioned,
          },
          projects: projects.map((project) => ({
            identifier: project.identifier,
            name: project.name,
            filesystem_path: project.filesystem_path,
            beads_remote: serializeBeadsRemoteStatus(project),
          })),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to list Beads remote migration inventory');
        sendError(res, 500, 'Failed to list Beads remote migration inventory', {
          error: 'Beads remote inventory is temporarily unavailable',
        });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      pathname === '/api/projects/beads-remote/provision' && method === 'POST',
    handle: async ({ req, res }) => {
      if (!db) {
        sendError(res, 503, 'Database not available');
        return;
      }
      if (!doltHubProvisioner) {
        sendError(res, 503, 'DoltHub provisioning service not available');
        return;
      }

      const body = await parseJsonBody(req).catch(() => ({}));
      const push = body.push !== false;
      const continueOnError = body.continue_on_error !== false && body.continueOnError !== false;
      const { projects, missing, skipped } = getBeadsRemoteBatchProjects(db, body);
      const results = [];
      const errors = missing.map((identifier) => ({
        identifier,
        status: 'error',
        error: 'Project not found',
      }));

      for (const project of projects) {
        try {
          const provisioning = await doltHubProvisioner.provisionProject(project, { push });
          const refreshed = db.getProject?.(project.identifier) || project;
          results.push({
            identifier: project.identifier,
            status: provisioning.status,
            provisioning,
            beads_remote: serializeBeadsRemoteStatus(refreshed),
          });
        } catch (error) {
          if (isNonProvisionableBeadsError(error)) {
            skipped.push({
              identifier: project.identifier,
              status: 'skipped',
              reason: 'unusable_beads_database',
              filesystem_path: project.filesystem_path || null,
              error: error.message || 'Beads database is not usable for DoltHub provisioning',
            });
            continue;
          }

          const failure = {
            identifier: project.identifier,
            status: 'error',
            error: error.message || 'Beads remote provisioning failed',
          };
          errors.push(failure);
          if (!continueOnError) break;
        }
      }

      const statusCode = errors.length > 0 && results.length === 0 ? 500 : 200;
      sendJson(res, statusCode, {
        schema_version: 1,
        message: doltHubProvisioner.dryRun
          ? 'Beads remote batch provisioning dry run complete'
          : 'Beads remote batch provisioning complete',
        dry_run: Boolean(doltHubProvisioner.dryRun),
        push,
        total_requested: projects.length + missing.length + skipped.length,
        summary: {
          succeeded: results.length,
          failed: errors.length,
          skipped: skipped.length,
        },
        results,
        errors,
        skipped,
        timestamp: new Date().toISOString(),
      });
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => method === 'GET' && /^\/api\/projects\/[^/]+$/.test(pathname),
    handle: async ({ res, pathname }) => {
      if (!db) {
        sendError(res, 503, 'Database not available');
        return;
      }

      try {
        const identifier = decodeURIComponent(pathname.split('/')[3]);
        const projectIdentifier = getCanonicalProjectIdentifier(db, identifier);
        const project = getProjectFromDb(db, projectIdentifier);

        if (!project) {
          sendError(res, 404, 'Project not found', { identifier });
          return;
        }

        let issues = [];
        let trackerOptions = {};

        try {
          issues = getProjectIssuesFromDb(db, projectIdentifier);
        } catch (error) {
          logger.error(
            { err: error, project_identifier: projectIdentifier },
            'Failed to hydrate tracker',
          );
          trackerOptions = {
            data_freshness: getUnavailableFreshness(
              project.last_sync_at,
              'Tracker data is temporarily unavailable',
            ),
          };
        }

        sendJson(res, 200, {
          project: serializeProjectSummary(project, issues, { tracker: trackerOptions }),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get project detail');
        sendError(res, 500, 'Failed to fetch project', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      method === 'GET' && /^\/api\/projects\/[^/]+\/beads-remote$/.test(pathname),
    handle: async ({ res, pathname }) => {
      if (!db) {
        sendError(res, 503, 'Database not available');
        return;
      }

      try {
        const identifier = decodeURIComponent(pathname.split('/')[3]);
        const projectIdentifier = getCanonicalProjectIdentifier(db, identifier);
        const project = getProjectFromDb(db, projectIdentifier);

        if (!project) {
          sendError(res, 404, 'Project not found', { identifier });
          return;
        }

        sendJson(res, 200, {
          project_identifier: projectIdentifier,
          beads_remote: serializeBeadsRemoteStatus(project),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get Beads remote status');
        sendError(res, 500, 'Failed to fetch Beads remote status', {
          error: 'Beads remote status is temporarily unavailable',
        });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      method === 'POST' && /^\/api\/projects\/[^/]+\/beads-remote\/provision$/.test(pathname),
    handle: async ({ req, res, pathname }) => {
      if (!doltHubProvisioner) {
        sendError(res, 503, 'DoltHub provisioning service not available');
        return;
      }

      try {
        const identifier = decodeURIComponent(pathname.split('/')[3]);
        const projectIdentifier = getCanonicalProjectIdentifier(db, identifier);
        const project =
          getProjectFromDb(db, projectIdentifier) || projectRegistry?.getProject?.(identifier);

        if (!project) {
          sendError(res, 404, 'Project not found', { identifier });
          return;
        }

        if (!project.filesystem_path) {
          sendError(res, 400, 'Project has no filesystem path', { identifier });
          return;
        }

        const body = await parseJsonBody(req).catch(() => ({}));
        const result = await doltHubProvisioner.provisionProject(project, {
          push: body.push !== false,
        });

        sendJson(res, 200, {
          message: result.dry_run
            ? 'Beads remote provisioning dry run complete'
            : 'Beads remote provisioned',
          provisioning: result,
          beads_remote: serializeBeadsRemoteStatus(db?.getProject?.(projectIdentifier) || project),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to provision Beads remote');
        sendError(res, 500, 'Failed to provision Beads remote', {
          error: error.message || 'Beads remote provisioning failed',
        });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      method === 'GET' && /^\/api\/projects\/[^/]+\/agents$/.test(pathname),
    handle: async ({ res, pathname, url }) => {
      if (!db) {
        sendError(res, 503, 'Database not available');
        return;
      }

      try {
        const identifier = decodeURIComponent(pathname.split('/')[3]);
        const projectIdentifier = getCanonicalProjectIdentifier(db, identifier);
        const project = getProjectFromDb(db, projectIdentifier);

        if (!project) {
          sendError(res, 404, 'Project not found', { identifier });
          return;
        }

        let lettaInfo = null;
        let freshness = null;

        try {
          lettaInfo = getProjectLettaInfo(db, project);
          freshness = getDataFreshness(lettaInfo.letta_last_sync_at);
        } catch (error) {
          logger.error(
            { err: error, project_identifier: projectIdentifier },
            'Failed to hydrate agents',
          );
          lettaInfo = {};
          freshness = getUnavailableFreshness(
            project.letta_last_sync_at,
            'Agent data is temporarily unavailable',
          );
        }

        const agents = lettaInfo.letta_agent_id
          ? [
              {
                id: lettaInfo.letta_agent_id,
                name: project.name,
                role: 'project_pm',
                active: true,
                folder_id: lettaInfo.letta_folder_id || null,
                source_id: lettaInfo.letta_source_id || null,
                last_sync_at: toIsoTimestamp(lettaInfo.letta_last_sync_at),
              },
            ]
          : [];
        const page = paginate(agents, url);

        sendJson(res, 200, {
          project_identifier: projectIdentifier,
          agents: page.items,
          page: page.page,
          etag: getSubresourceEtag(project, 'agents', lettaInfo.letta_last_sync_at),
          data_freshness: freshness,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get project agents');
        sendError(res, 500, 'Failed to fetch project agents', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      method === 'GET' && /^\/api\/projects\/[^/]+\/conversations$/.test(pathname),
    handle: async ({ res, pathname, url }) => {
      if (!db) {
        sendError(res, 503, 'Database not available');
        return;
      }

      try {
        const identifier = decodeURIComponent(pathname.split('/')[3]);
        const projectIdentifier = getCanonicalProjectIdentifier(db, identifier);
        const project = getProjectFromDb(db, projectIdentifier);

        if (!project) {
          sendError(res, 404, 'Project not found', { identifier });
          return;
        }

        const page = paginate([], url);
        sendJson(res, 200, {
          project_identifier: projectIdentifier,
          conversations: page.items,
          page: page.page,
          tracker: {
            provider: 'letta',
            status: 'not_tracked',
            capabilities: { conversations: false },
          },
          etag: getSubresourceEtag(project, 'conversations', null),
          data_freshness: getDataFreshness(null, { status: 'unavailable' }),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get project conversations');
        sendError(res, 500, 'Failed to fetch project conversations', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      method === 'GET' && /^\/api\/projects\/[^/]+\/work-items$/.test(pathname),
    handle: async ({ res, pathname, url }) => {
      if (!db) {
        sendError(res, 503, 'Database not available');
        return;
      }

      try {
        const identifier = decodeURIComponent(pathname.split('/')[3]);
        const projectIdentifier = getCanonicalProjectIdentifier(db, identifier);
        const project = getProjectFromDb(db, projectIdentifier);

        if (!project) {
          sendError(res, 404, 'Project not found', { identifier });
          return;
        }

        const status = url.searchParams.get('status');
        const priority = url.searchParams.get('priority');
        let issues = [];
        let issueSource = 'database';
        let freshness = getDataFreshness(project.last_sync_at, { source: issueSource });

        try {
          const hydrated = await getProjectIssuesWithBeadsFallback({
            db,
            project,
            projectIdentifier,
            beadsAdapter,
            logger,
            filters: getBeadsListFilters(url),
          });
          issueSource = hydrated.source;
          freshness = hydrated.error
            ? getUnavailableFreshness(project.last_sync_at, hydrated.error)
            : getDataFreshness(project.last_sync_at, { source: issueSource });
          issues = hydrated.issues.filter((issue) => {
            if (!matchesIssueStatus(issue.status, status)) return false;
            if (priority && issue.priority !== priority) return false;
            return true;
          });
        } catch (error) {
          logger.error(
            { err: error, project_identifier: projectIdentifier },
            'Failed to hydrate work items',
          );
          freshness = getUnavailableFreshness(
            project.last_sync_at,
            'Work item data is temporarily unavailable',
          );
        }

        const page = paginate(issues.map(serializeWorkItem), url);

        sendJson(res, 200, {
          project_identifier: projectIdentifier,
          provider: TRACKER_PROVIDER,
          work_items: page.items.map((item, index) => ({
            ...item,
            cursor: encodeCursor(decodeCursor(url.searchParams.get('cursor')) + index + 1),
          })),
          page: page.page,
          etag: getSubresourceEtag(project, 'work-items', project.last_sync_at),
          data_freshness: freshness,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get project work items');
        sendError(res, 500, 'Failed to fetch project work items', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      method === 'GET' && /^\/api\/projects\/[^/]+\/issues$/.test(pathname),
    handle: async ({ res, pathname, url }) => {
      if (!db) {
        sendError(res, 503, 'Database not available');
        return;
      }

      try {
        const requestedProjectIdentifier = decodeURIComponent(pathname.split('/')[3]);
        const projectIdentifier = getCanonicalProjectIdentifier(db, requestedProjectIdentifier);
        const project = getProjectFromDb(db, projectIdentifier);

        if (!project) {
          sendError(res, 404, 'Project not found', { projectIdentifier });
          return;
        }

        const hydrated = await getProjectIssuesWithBeadsFallback({
          db,
          project,
          projectIdentifier,
          beadsAdapter,
          logger,
          filters: getBeadsListFilters(url),
        });
        const projectIssues = hydrated.issues;
        const filtered = filterAndroidIssues(projectIssues, url);
        const sort = url.searchParams.get('sort') || 'priority';
        const sorted = [...filtered].sort((a, b) => {
          if (sort === 'updated')
            return toNumber(getIssueTimestamp(b)) - toNumber(getIssueTimestamp(a));
          if (sort === 'created') return toNumber(b.created_at) - toNumber(a.created_at);
          return String(a.priority || '').localeCompare(String(b.priority || ''));
        });
        const page = paginate(
          sorted.map((issue) => serializeAndroidIssue(issue, projectIssues)),
          url,
        );

        sendJson(res, 200, {
          schema_version: 1,
          projectId: projectIdentifier,
          issues: page.items,
          page: page.page,
          etag: getSubresourceEtag(project, 'issues', project.last_sync_at),
          data_freshness: hydrated.error
            ? getUnavailableFreshness(project.last_sync_at, hydrated.error)
            : getDataFreshness(project.last_sync_at, { source: hydrated.source }),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get Android issues');
        sendError(res, 500, 'Failed to fetch issues', {
          error: 'Issue data is temporarily unavailable',
        });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      method === 'GET' && /^\/api\/projects\/[^/]+\/ready-work$/.test(pathname),
    handle: async ({ res, pathname, url }) => {
      if (!db) {
        sendError(res, 503, 'Database not available');
        return;
      }

      try {
        const requestedProjectIdentifier = decodeURIComponent(pathname.split('/')[3]);
        const projectIdentifier = getCanonicalProjectIdentifier(db, requestedProjectIdentifier);
        const project = getProjectFromDb(db, projectIdentifier);

        if (!project) {
          sendError(res, 404, 'Project not found', { projectIdentifier });
          return;
        }

        const hydrated = await getProjectIssuesWithBeadsFallback({
          db,
          project,
          projectIdentifier,
          beadsAdapter,
          logger,
        });
        const projectIssues = hydrated.issues;
        const readyIssues = projectIssues.filter(
          (issue) => serializeAndroidIssue(issue, projectIssues).ready,
        );
        const page = paginate(
          readyIssues.map((issue) => serializeAndroidIssue(issue, projectIssues)),
          url,
        );

        sendJson(res, 200, {
          schema_version: 1,
          projectId: projectIdentifier,
          readyWork: page.items,
          page: page.page,
          etag: getSubresourceEtag(project, 'ready-work', project.last_sync_at),
          data_freshness: hydrated.error
            ? getUnavailableFreshness(project.last_sync_at, hydrated.error)
            : getDataFreshness(project.last_sync_at, { source: hydrated.source }),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get ready work');
        sendError(res, 500, 'Failed to fetch ready work', {
          error: 'Ready work is temporarily unavailable',
        });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => method === 'GET' && /^\/api\/issues\/[^/]+$/.test(pathname),
    handle: async ({ res, pathname }) => {
      if (!db) {
        sendError(res, 503, 'Database not available');
        return;
      }

      try {
        const issueId = decodeURIComponent(pathname.split('/')[3]);
        const issue = db.getIssue?.(issueId);

        if (!issue) {
          sendError(res, 404, 'Issue not found', { issueId });
          return;
        }

        const projectIssues = getProjectIssuesFromDb(db, issue.project_identifier);
        sendJson(res, 200, {
          schema_version: 1,
          issue: serializeAndroidIssue(issue, projectIssues, { detail: true }),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get issue detail');
        sendError(res, 500, 'Failed to fetch issue', {
          error: 'Issue detail is temporarily unavailable',
        });
      }
    },
  });

  const mutationActions = new Map([
    ['claim', 'claim'],
    ['unclaim', 'unclaim'],
    ['status', 'update_status'],
    ['notes', 'add_note'],
    ['close', 'close'],
    ['reopen', 'reopen'],
  ]);

  app.registerRoute({
    match: ({ pathname, method }) => {
      if (method !== 'POST' && method !== 'PATCH') return false;
      const match = pathname.match(/^\/api\/issues\/[^/]+\/([^/]+)$/);
      return Boolean(match && mutationActions.has(match[1]));
    },
    handle: async ({ req, res, pathname }) => {
      const operation = pathname.split('/')[4];
      const action = mutationActions.get(operation);
      await handleIssueMutation({
        req,
        res,
        pathname,
        parseJsonBody,
        sendJson,
        sendError,
        logger,
        db,
        beadsIssueService,
        action,
      });
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      method === 'GET' && /^\/api\/projects\/[^/]+\/activity$/.test(pathname),
    handle: async ({ res, pathname, url }) => {
      if (!db) {
        sendError(res, 503, 'Database not available');
        return;
      }

      try {
        const identifier = decodeURIComponent(pathname.split('/')[3]);
        const projectIdentifier = getCanonicalProjectIdentifier(db, identifier);
        const project = getProjectFromDb(db, projectIdentifier);

        if (!project) {
          sendError(res, 404, 'Project not found', { identifier });
          return;
        }

        let syncs = [];
        let freshness = null;

        try {
          syncs = db.getRecentSyncs?.(MAX_PAGE_LIMIT) || [];
          freshness = getDataFreshness(syncs[0]?.completed_at || syncs[0]?.started_at || null);
        } catch (error) {
          logger.error(
            { err: error, project_identifier: projectIdentifier },
            'Failed to hydrate activity',
          );
          freshness = getUnavailableFreshness(null, 'Activity data is temporarily unavailable');
        }

        const activities = syncs.map((sync) => ({
          id: String(sync.id),
          type: 'sync',
          status: sync.completed_at ? 'completed' : 'running',
          project_identifier: projectIdentifier,
          occurred_at: toIsoTimestamp(sync.completed_at || sync.started_at),
          metadata: {
            projects_processed: toNumber(sync.projects_processed),
            projects_failed: toNumber(sync.projects_failed),
            issues_synced: toNumber(sync.issues_synced),
            duration_ms: sync.duration_ms || null,
          },
        }));
        const page = paginate(activities, url);

        sendJson(res, 200, {
          project_identifier: projectIdentifier,
          activity: page.items,
          page: page.page,
          etag: getSubresourceEtag(
            project,
            'activity',
            syncs[0]?.completed_at || syncs[0]?.started_at,
          ),
          data_freshness: freshness,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get project activity');
        sendError(res, 500, 'Failed to fetch project activity', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/registry/projects' && method === 'POST',
    handle: async ({ req, res }) => {
      if (!projectRegistry) {
        sendError(res, 503, 'ProjectRegistry not available');
        return;
      }

      try {
        const body = await parseJsonBody(req);
        const dirPath = typeof body.filesystem_path === 'string' ? body.filesystem_path.trim() : '';

        if (!dirPath) {
          sendError(res, 400, 'filesystem_path is required', { field: 'filesystem_path' });
          return;
        }

        if (!isAbsolutePath(dirPath)) {
          sendError(res, 400, 'filesystem_path must be an absolute path', {
            field: 'filesystem_path',
          });
          return;
        }

        const project = projectRegistry.registerProject(dirPath);
        const updatedProject = projectRegistry.updateProject(project.identifier, {
          name: typeof body.name === 'string' ? body.name.trim() : undefined,
          git_url: typeof body.git_url === 'string' ? body.git_url.trim() : undefined,
        });

        sendJson(res, 201, {
          message: 'Project registered',
          project: serializeProject(updatedProject || project),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to register project');
        const statusCode = error.message.includes('does not exist') ? 404 : 400;
        sendError(res, statusCode, 'Failed to register project', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      method === 'PATCH' && /^\/api\/registry\/projects\/[^/]+$/.test(pathname),
    handle: async ({ req, res, pathname }) => {
      if (!projectRegistry) {
        sendError(res, 503, 'ProjectRegistry not available');
        return;
      }

      try {
        const identifier = decodeURIComponent(pathname.split('/')[4]);
        const body = await parseJsonBody(req);
        const updates = {};

        if (body.filesystem_path !== undefined) {
          if (!isAbsolutePath(body.filesystem_path)) {
            sendError(res, 400, 'filesystem_path must be an absolute path', {
              field: 'filesystem_path',
            });
            return;
          }
          updates.filesystem_path = body.filesystem_path.trim();
        }

        if (body.git_url !== undefined) {
          updates.git_url = typeof body.git_url === 'string' ? body.git_url.trim() : body.git_url;
        }

        if (body.status !== undefined) {
          if (
            typeof body.status !== 'string' ||
            !ALLOWED_PROJECT_STATUSES.has(body.status.trim())
          ) {
            sendError(res, 400, 'status must be one of: active, archived', { field: 'status' });
            return;
          }

          updates.status = body.status.trim();
        }

        const project = projectRegistry.updateProject(identifier, updates);
        if (!project) {
          sendError(res, 404, 'Project not found', { identifier });
          return;
        }

        sendJson(res, 200, {
          message: 'Project updated',
          project: serializeProject(project),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to update project');
        const statusCode = error.message.includes('does not exist') ? 404 : 400;
        sendError(res, statusCode, 'Failed to update project', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      method === 'DELETE' && /^\/api\/registry\/projects\/[^/]+$/.test(pathname),
    handle: async ({ res, pathname }) => {
      if (!projectRegistry) {
        sendError(res, 503, 'ProjectRegistry not available');
        return;
      }

      try {
        const identifier = decodeURIComponent(pathname.split('/')[4]);
        const deleted = projectRegistry.deleteProject(identifier);

        if (!deleted) {
          sendError(res, 404, 'Project not found', { identifier });
          return;
        }

        sendJson(res, 200, {
          message: 'Project deleted',
          identifier,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to delete project');
        sendError(res, 500, 'Failed to delete project', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/registry/projects' && method === 'GET',
    handle: async ({ res, url }) => {
      if (!projectRegistry) {
        sendError(res, 503, 'ProjectRegistry not available');
        return;
      }

      try {
        const filters = {};
        const status = url.searchParams.get('status');
        const techStack = url.searchParams.get('tech_stack');

        if (status) filters.status = status;
        if (techStack) filters.tech_stack = techStack;

        const projects = projectRegistry.getProjects(filters);
        sendJson(res, 200, {
          total: projects.length,
          projects: projects.map(serializeProject),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get registry projects');
        sendError(res, 500, 'Failed to fetch projects', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      method === 'GET' && /^\/api\/registry\/projects\/[^/]+$/.test(pathname),
    handle: async ({ res, pathname }) => {
      if (!projectRegistry) {
        sendError(res, 503, 'ProjectRegistry not available');
        return;
      }

      try {
        const identifier = decodeURIComponent(pathname.split('/')[4]);
        const project = projectRegistry.getProject(identifier);

        if (!project) {
          sendError(res, 404, 'Project not found', { identifier });
          return;
        }

        sendJson(res, 200, {
          ...serializeProject(project),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get registry project');
        sendError(res, 500, 'Failed to fetch project', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      method === 'POST' && /^\/api\/registry\/projects\/[^/]+\/scan$/.test(pathname),
    handle: async ({ res, pathname }) => {
      if (!projectRegistry) {
        sendError(res, 503, 'ProjectRegistry not available');
        return;
      }

      try {
        const identifier = decodeURIComponent(pathname.split('/')[4]);
        const existing = projectRegistry.getProject(identifier);
        if (!existing) {
          sendError(res, 404, 'Project not found', { identifier });
          return;
        }

        const result = projectRegistry.scanProjects();
        const refreshed = projectRegistry.getProject(identifier);

        sendJson(res, 200, {
          message: 'Scan complete',
          scan: result,
          project: serializeProject(refreshed),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to scan projects');
        sendError(res, 500, 'Failed to scan projects', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      pathname.startsWith('/api/projects/') && pathname.includes('/issues') && method === 'GET',
    handle: async ({ res, pathname }) => {
      if (!db) {
        sendError(res, 503, 'Database not available');
        return;
      }

      try {
        const parts = pathname.split('/');
        const projectIdentifier = parts[3];
        const issues = db.getProjectIssues(projectIdentifier);

        sendJson(res, 200, {
          projectIdentifier,
          total: issues.length,
          issues,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get project issues');
        sendError(res, 500, 'Failed to fetch project issues', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) =>
      pathname.startsWith('/api/projects/') && pathname.endsWith('/ast-sync') && method === 'POST',
    handle: async ({ req, res, pathname }) => {
      if (!codePerceptionWatcher) {
        sendError(res, 503, 'Code perception watcher not available');
        return;
      }

      try {
        const parts = pathname.split('/');
        const projectIdentifier = parts[3];

        const projectPath = db?.getProjectFilesystemPath?.(projectIdentifier);
        if (!projectPath) {
          sendError(res, 404, 'Project not found or has no filesystem path', {
            projectIdentifier,
          });
          return;
        }

        const body = await parseJsonBody(req);
        const options = {
          concurrency: body.concurrency || 10,
          rateLimit: body.rateLimit || 100,
        };

        logger.info(
          { projectIdentifier, projectPath, options },
          'Starting AST initial sync via API',
        );

        const result = await codePerceptionWatcher.astInitialSync(
          projectIdentifier,
          projectPath,
          options,
        );

        sendJson(res, 200, {
          status: 'complete',
          projectIdentifier,
          ...result,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error }, 'AST initial sync failed');
        sendError(res, 500, 'AST initial sync failed', { error: error.message });
      }
    },
  });
}
