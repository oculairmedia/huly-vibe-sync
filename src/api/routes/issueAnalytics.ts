interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

type Granularity = 'day' | 'week' | 'month';

interface AnalyticsRange {
  timezone: string;
  granularity: Granularity;
  rangeStartMs: number;
  rangeEndMs: number;
  rangeStart: string;
  rangeEnd: string;
}

interface BucketBase {
  startMs: number;
  endMs: number;
  bucketStart: string;
  bucketEnd: string;
  label: string;
}

interface AnalyticsFilters {
  status: string | null;
  type: string | null;
  priority: string | null;
  assignee: string | null;
  labels: string[];
}

/** Loose issue shape accepted by analytics — same union of DB rows and bd-sourced records used by the route layer. */
export interface AnalyticsIssue {
  id?: string | number;
  identifier?: string;
  status?: string | null;
  priority?: string | number | null;
  type?: string;
  issue_type?: string | null;
  assignee?: string | null;
  owner?: string | null;
  labels?: string[] | string | null;
  labels_json?: string | null;
  tags?: string[] | string | null;
  title?: string;
  created_at?: number | string | null;
  createdAt?: string;
  updated_at?: number | string | null;
  updatedAt?: string;
  closed_at?: string | null | undefined;
  closedAt?: string | undefined;
  completed_at?: string | null;
  completedAt?: string;
  closed_by?: string | null;
  completed_by?: string | null;
  close_reason?: string | null;
  completion_reason?: string | null;
  beads_updated_at?: number | null;
  last_sync_at?: number | string | null;
}

const ISSUE_ANALYTICS_GRANULARITIES = new Set(['day', 'week', 'month']);
const CLOSED_ISSUE_STATUSES = new Set(['done', 'closed', 'resolved', 'complete', 'completed']);
const BLOCKED_ISSUE_STATUSES = new Set(['blocked']);
const DEFERRED_ISSUE_STATUSES = new Set(['deferred', 'snoozed', 'later']);
const IN_PROGRESS_ISSUE_STATUSES = new Set(['inprogress', 'in_progress', 'doing']);

function normalizeIssueStatus(status: unknown): string {
  if (!status) return 'open';
  const s = String(status).toLowerCase().trim();
  if (CLOSED_ISSUE_STATUSES.has(s)) return 'closed';
  if (BLOCKED_ISSUE_STATUSES.has(s)) return 'blocked';
  if (DEFERRED_ISSUE_STATUSES.has(s)) return 'deferred';
  if (IN_PROGRESS_ISSUE_STATUSES.has(s)) return 'in_progress';
  return 'open';
}

function toDateMs(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const d = new Date(value as string);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function toIsoTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  const d = new Date(value as number);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function getTimeZoneFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function getZonedParts(date: Date, timezone: string): ZonedParts {
  const parts = getTimeZoneFormatter(timezone).formatToParts(date);
  const byType: Record<string, string> = {};
  for (const p of parts) byType[p.type] = p.value;
  return {
    year: Number(byType.year), month: Number(byType.month), day: Number(byType.day),
    hour: Number(byType.hour), minute: Number(byType.minute), second: Number(byType.second),
  };
}

function getTimeZoneOffsetMinutes(date: Date, timezone: string): number {
  const parts = getZonedParts(date, timezone);
  const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((zonedAsUtc - date.getTime()) / 60_000);
}

function formatTimeZoneOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function zonedLocalToUtcMs(parts: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number }, timezone: string): number {
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0);
  let offset = getTimeZoneOffsetMinutes(new Date(guess), timezone);
  let utc = guess - offset * 60_000;
  offset = getTimeZoneOffsetMinutes(new Date(utc), timezone);
  utc = guess - offset * 60_000;
  return utc;
}

function formatZonedIso(date: Date, timezone: string): string {
  const p = getZonedParts(date, timezone);
  const offset = formatTimeZoneOffset(getTimeZoneOffsetMinutes(date, timezone));
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}${offset}`;
}

function getStartOfBucket(date: Date, timezone: string, granularity: Granularity): number {
  const parts = getZonedParts(date, timezone);
  if (granularity === 'month') {
    return zonedLocalToUtcMs({ year: parts.year, month: parts.month, day: 1 }, timezone);
  }
  if (granularity === 'week') {
    const noon = zonedLocalToUtcMs({ year: parts.year, month: parts.month, day: parts.day, hour: 12 }, timezone);
    const weekday = new Date(noon).getUTCDay() || 7;
    return zonedLocalToUtcMs({ year: parts.year, month: parts.month, day: parts.day - (weekday - 1) }, timezone);
  }
  return zonedLocalToUtcMs({ year: parts.year, month: parts.month, day: parts.day }, timezone);
}

function addBucket(startMs: number, timezone: string, granularity: Granularity): number {
  const p = getZonedParts(new Date(startMs), timezone);
  if (granularity === 'month') {
    return zonedLocalToUtcMs({ year: p.year, month: p.month + 1, day: 1 }, timezone);
  }
  return zonedLocalToUtcMs({ year: p.year, month: p.month, day: p.day + (granularity === 'week' ? 7 : 1) }, timezone);
}

function getBucketLabel(date: Date, timezone: string, granularity: Granularity): string {
  if (granularity === 'month') {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', year: 'numeric' }).format(date);
  }
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric' }).format(date);
}

function buildAnalyticsBuckets(rangeStartMs: number, rangeEndMs: number, timezone: string, granularity: Granularity): BucketBase[] {
  const buckets: BucketBase[] = [];
  let cursor = getStartOfBucket(new Date(rangeStartMs), timezone, granularity);
  while (cursor < rangeEndMs) {
    const next = addBucket(cursor, timezone, granularity);
    buckets.push({
      startMs: cursor, endMs: next,
      bucketStart: formatZonedIso(new Date(cursor), timezone),
      bucketEnd: formatZonedIso(new Date(next), timezone),
      label: getBucketLabel(new Date(cursor), timezone, granularity),
    });
    cursor = next;
  }
  return buckets;
}

function encodeCursor(value: number | string): string {
  return Buffer.from(String(value), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0;
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const offset = Number.parseInt(decoded, 10);
  return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

function parseIssueList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map((s) => String(s));
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try { return JSON.parse(value).filter(Boolean).map((s: unknown) => String(s)); } catch { /* fall through */ }
  }
  return String(value).split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}

export function parseAnalyticsFilters(url: URL): AnalyticsFilters {
  const status = url.searchParams.get('statusFilter') || url.searchParams.get('status');
  const type = url.searchParams.get('typeFilter') || url.searchParams.get('type');
  const priority = url.searchParams.get('priorityFilter') || url.searchParams.get('priority');
  const assignee = url.searchParams.get('assigneeFilter') || url.searchParams.get('assignee');
  const labels = parseIssueList(url.searchParams.get('labelFilter') || url.searchParams.get('label'));
  return { status, type, priority, assignee, labels };
}

function matchesIssueStatus(issueStatus: unknown, requestedStatus: string | null): boolean {
  if (!requestedStatus) return true;
  const i = String(issueStatus || '').toLowerCase();
  const r = requestedStatus.toLowerCase();
  return i === r || normalizeIssueStatus(i) === normalizeIssueStatus(r);
}

export function issueMatchesAnalyticsFilters(issue: AnalyticsIssue, filters: AnalyticsFilters): boolean {
  if (filters.status && !matchesIssueStatus(issue.status, filters.status)) return false;
  if (filters.type && String(issue.issue_type ?? issue.type ?? '') !== filters.type) return false;
  if (filters.priority && String(issue.priority ?? '') !== filters.priority) return false;
  if (filters.assignee && String(issue.assignee ?? issue.owner ?? '') !== filters.assignee) return false;
  if (filters.labels.length > 0) {
    const set = new Set(parseIssueList(issue.labels ?? issue.labels_json ?? issue.tags));
    if (!filters.labels.every((l) => set.has(l))) return false;
  }
  return true;
}

function getIssueCreatedMs(issue: AnalyticsIssue): number | null {
  return toDateMs(issue.created_at ?? issue.createdAt);
}

function getIssueCompletedMs(issue: AnalyticsIssue): number | null {
  if (normalizeIssueStatus(issue.status) !== 'closed') return null;
  return toDateMs(issue.closed_at ?? issue.closedAt ?? issue.completed_at ?? issue.completedAt ?? issue.updated_at);
}

export function getAnalyticsRange(url: URL): AnalyticsRange {
  const timezone = url.searchParams.get('timezone') || 'UTC';
  getTimeZoneFormatter(timezone).format(new Date());
  const granularity = (url.searchParams.get('granularity') || 'day') as Granularity;
  if (!ISSUE_ANALYTICS_GRANULARITIES.has(granularity)) {
    throw new Error('granularity must be one of: day, week, month');
  }
  const now = Date.now();
  const defaultStart = now - 30 * 24 * 60 * 60 * 1000;
  const rangeStartMs = toDateMs(url.searchParams.get('rangeStart')) ?? defaultStart;
  const rangeEndMs = toDateMs(url.searchParams.get('rangeEnd')) ?? now;
  if (rangeEndMs <= rangeStartMs) throw new Error('rangeEnd must be after rangeStart');
  return {
    timezone, granularity, rangeStartMs, rangeEndMs,
    rangeStart: formatZonedIso(new Date(rangeStartMs), timezone),
    rangeEnd: formatZonedIso(new Date(rangeEndMs), timezone),
  };
}

function getTimelinePagination(url: URL, defaultLimit = 25, maxLimit = 100): { limit: number; offset: number } {
  const requested = Number.parseInt(url.searchParams.get('timelineLimit') || url.searchParams.get('limit') || '', 10);
  const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : defaultLimit, 1), maxLimit);
  return { limit, offset: decodeCursor(url.searchParams.get('cursor')) };
}

export interface CompletedTimelineEntry {
  issueId: string;
  title: string;
  status: string;
  statusLabel: string;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  priority: string | null;
  type: string;
  assignee: string | null;
  labels: string[];
  completedBy: string | null;
  completionReason: string | null;
}

export interface AnalyticsBucket {
  bucketStart: string;
  bucketEnd: string;
  label: string;
}

export interface CreatedBucket extends AnalyticsBucket { createdCount: number }
export interface CompletedBucket extends AnalyticsBucket { completedCount: number }

function serializeCompletedTimelineIssue(issue: AnalyticsIssue, completedMs: number): CompletedTimelineEntry {
  const normalized = normalizeIssueStatus(issue.status);
  return {
    issueId: String(issue.identifier ?? issue.id ?? ''),
    title: issue.title ?? '',
    status: normalized,
    statusLabel: String(issue.status ?? normalized),
    completedAt: toIsoTimestamp(completedMs),
    createdAt: toIsoTimestamp(issue.created_at ?? issue.createdAt),
    updatedAt: toIsoTimestamp(issue.beads_updated_at ?? issue.updated_at ?? issue.last_sync_at ?? issue.created_at),
    priority: issue.priority == null ? null : String(issue.priority),
    type: issue.issue_type ?? issue.type ?? 'task',
    assignee: issue.assignee ?? issue.owner ?? null,
    labels: parseIssueList(issue.labels ?? issue.labels_json ?? issue.tags),
    completedBy: issue.closed_by ?? issue.completed_by ?? issue.owner ?? issue.assignee ?? null,
    completionReason: issue.close_reason ?? issue.completion_reason ?? null,
  };
}

export interface AnalyticsSummary {
  openCount: number;
  inProgressCount: number;
  completedCount: number;
  blockedCount: number;
  readyCount: number;
  totalCreatedInRange: number;
  totalCompletedInRange: number;
}

export interface AnalyticsResult {
  createdBuckets: CreatedBucket[];
  completedBuckets: CompletedBucket[];
  completedTimeline: CompletedTimelineEntry[];
  summary: AnalyticsSummary;
  nextTimelineCursor: string | null;
  timelinePage: { limit: number; has_more: boolean; total_known: number };
}

export function buildIssueAnalytics(issues: AnalyticsIssue[], range: AnalyticsRange, url: URL): AnalyticsResult {
  const filters = parseAnalyticsFilters(url);
  const filtered = issues.filter((i) => issueMatchesAnalyticsFilters(i, filters));
  const createdRaw = buildAnalyticsBuckets(range.rangeStartMs, range.rangeEndMs, range.timezone, range.granularity)
    .map((b) => ({ ...b, createdCount: 0 }));
  const completedRaw = buildAnalyticsBuckets(range.rangeStartMs, range.rangeEndMs, range.timezone, range.granularity)
    .map((b) => ({ ...b, completedCount: 0 }));
  const completedTimeline: CompletedTimelineEntry[] = [];
  const summary = {
    openCount: 0, inProgressCount: 0, completedCount: 0,
    blockedCount: 0, readyCount: 0,
    totalCreatedInRange: 0, totalCompletedInRange: 0,
  };

  for (const issue of filtered) {
    const s = normalizeIssueStatus(issue.status);
    if (s === 'closed') summary.completedCount++;
    else if (s === 'in_progress') summary.inProgressCount++;
    else if (s === 'blocked') summary.blockedCount++;
    else summary.openCount++;
    if (s !== 'closed' && s !== 'blocked' && s !== 'deferred') summary.readyCount++;

    const created = getIssueCreatedMs(issue);
    if (created !== null && created >= range.rangeStartMs && created < range.rangeEndMs) {
      summary.totalCreatedInRange++;
      const b = createdRaw.find((c) => created >= c.startMs && created < c.endMs);
      if (b) b.createdCount++;
    }

    const completed = getIssueCompletedMs(issue);
    if (completed !== null && completed >= range.rangeStartMs && completed < range.rangeEndMs) {
      summary.totalCompletedInRange++;
      const b = completedRaw.find((c) => completed >= c.startMs && completed < c.endMs);
      if (b) b.completedCount++;
      completedTimeline.push(serializeCompletedTimelineIssue(issue, completed));
    }
  }

  completedTimeline.sort((a, b) => (toDateMs(b.completedAt) ?? 0) - (toDateMs(a.completedAt) ?? 0));
  const { limit, offset } = getTimelinePagination(url);
  const pageItems = completedTimeline.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  const hasMore = nextOffset < completedTimeline.length;

  return {
    createdBuckets: createdRaw.map(({ startMs: _s, endMs: _e, ...rest }) => rest),
    completedBuckets: completedRaw.map(({ startMs: _s, endMs: _e, ...rest }) => rest),
    completedTimeline: pageItems,
    summary,
    nextTimelineCursor: hasMore ? encodeCursor(nextOffset) : null,
    timelinePage: { limit, has_more: hasMore, total_known: completedTimeline.length },
  };
}
