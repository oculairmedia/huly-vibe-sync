import type Database from 'better-sqlite3';
import { computeIssueContentHash, hasIssueContentChanged } from '../utils';

function toMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value);
  const n = Number(s);
  if (Number.isFinite(n) && n > 1e11) return n;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export class IssueRepository {
  constructor(private db: Database.Database) {}

  upsertIssue(issue: Record<string, unknown>): void {
    const now = Date.now();
    const contentHash = computeIssueContentHash(issue);

    this.db
      .prepare(
        `INSERT INTO issues (identifier, project_identifier, huly_id, vibe_task_id,
         title, description, status, priority, last_sync_at, created_at, updated_at,
         huly_modified_at, vibe_modified_at, vibe_status,
         parent_huly_id, parent_vibe_id, sub_issue_count, content_hash, huly_content_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(identifier) DO UPDATE SET
           title = excluded.title, description = excluded.description,
           status = excluded.status, priority = excluded.priority,
           vibe_task_id = COALESCE(excluded.vibe_task_id, vibe_task_id),
           last_sync_at = excluded.last_sync_at, updated_at = excluded.updated_at,
           huly_modified_at = COALESCE(excluded.huly_modified_at, huly_modified_at),
           vibe_modified_at = COALESCE(excluded.vibe_modified_at, vibe_modified_at),
           vibe_status = COALESCE(excluded.vibe_status, vibe_status),
           parent_huly_id = COALESCE(excluded.parent_huly_id, parent_huly_id),
           parent_vibe_id = COALESCE(excluded.parent_vibe_id, parent_vibe_id),
           sub_issue_count = COALESCE(excluded.sub_issue_count, sub_issue_count),
           content_hash = excluded.content_hash,
           huly_content_hash = COALESCE(excluded.huly_content_hash, huly_content_hash)`,
      )
      .run(
        issue.identifier, issue.project_identifier, issue.huly_id || null,
        issue.vibe_task_id || null, issue.title || issue.identifier || 'Untitled Issue',
        issue.description || '', issue.status || 'unknown', issue.priority || 'medium',
        now, issue.created_at || now, now, issue.huly_modified_at || null,
        issue.vibe_modified_at || null, issue.vibe_status || null,
        issue.parent_huly_id || null, issue.parent_vibe_id || null,
        issue.sub_issue_count || 0, contentHash, issue.huly_content_hash || null,
      );
  }

  getProjectIssues(projectIdentifier: string): unknown[] {
    return this.db
      .prepare('SELECT * FROM issues WHERE project_identifier = ? ORDER BY identifier')
      .all(projectIdentifier);
  }

  upsertBeadsIssue(projectIdentifier: string, issue: Record<string, unknown>): void {
    const now = Date.now();
    const beadsUpdatedAt = toMs(issue.updated_at);
    const createdAt = toMs(issue.created_at) ?? now;
    const identifier = String(issue.id ?? issue.identifier ?? '');
    if (!identifier) return;
    const labels = Array.isArray(issue.labels) ? JSON.stringify(issue.labels) : null;
    const blockedBy = Array.isArray(issue.blocked_by)
      ? JSON.stringify(issue.blocked_by)
      : Array.isArray(issue.blockedBy)
        ? JSON.stringify(issue.blockedBy)
        : null;
    this.db
      .prepare(
        `INSERT INTO issues (identifier, project_identifier, title, description, status, priority,
          last_sync_at, created_at, updated_at, beads_updated_at, parent_huly_id, sub_issue_count,
          content_hash, issue_type, assignee, labels_json, blocked_by_json, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'beads')
         ON CONFLICT(identifier) DO UPDATE SET
           title = excluded.title, description = excluded.description,
           status = excluded.status, priority = excluded.priority,
           last_sync_at = excluded.last_sync_at,
           updated_at = excluded.updated_at,
           beads_updated_at = excluded.beads_updated_at,
           parent_huly_id = COALESCE(excluded.parent_huly_id, parent_huly_id),
           sub_issue_count = COALESCE(excluded.sub_issue_count, sub_issue_count),
           content_hash = excluded.content_hash,
           issue_type = excluded.issue_type, assignee = excluded.assignee,
           labels_json = excluded.labels_json, blocked_by_json = excluded.blocked_by_json,
           source = 'beads'`,
      )
      .run(
        identifier,
        projectIdentifier,
        String(issue.title ?? identifier),
        String(issue.description ?? ''),
        String(issue.status ?? 'unknown'),
        String(issue.priority ?? 'medium'),
        now,
        createdAt,
        beadsUpdatedAt ?? now,
        beadsUpdatedAt ?? null,
        (issue.parent_huly_id ?? issue.parent ?? null) as string | null,
        Number(issue.sub_issue_count ?? issue.dependent_count ?? 0),
        computeIssueContentHash(issue),
        (issue.issue_type ?? issue.type ?? null) as string | null,
        (issue.assignee ?? issue.owner ?? null) as string | null,
        labels,
        blockedBy,
      );
  }

  getMaxBeadsUpdatedAt(projectIdentifier: string): number | null {
    const row = this.db
      .prepare('SELECT MAX(beads_updated_at) AS m FROM issues WHERE project_identifier = ? AND source = \'beads\'')
      .get(projectIdentifier) as { m: number | null } | undefined;
    return row?.m ?? null;
  }

  getIssue(identifier: string): unknown {
    return this.db.prepare('SELECT * FROM issues WHERE identifier = ?').get(identifier);
  }

  getIssueByVibeTaskId(projectIdentifier: string, vibeTaskId: number): unknown {
    return this.db
      .prepare('SELECT * FROM issues WHERE project_identifier = ? AND vibe_task_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(projectIdentifier, vibeTaskId);
  }

  markDeletedFromHuly(identifier: string) {
    return this.db
      .prepare('UPDATE issues SET deleted_from_huly = 1, updated_at = ? WHERE identifier = ?')
      .run(Date.now(), identifier);
  }

  isDeletedFromHuly(identifier: string): boolean {
    const row = this.db
      .prepare('SELECT deleted_from_huly FROM issues WHERE identifier = ?')
      .get(identifier) as { deleted_from_huly?: number } | undefined;
    return row?.deleted_from_huly === 1;
  }

  markDeletedFromVibe(identifier: string) {
    return this.db
      .prepare('UPDATE issues SET deleted_from_vibe = 1, vibe_task_id = NULL, updated_at = ? WHERE identifier = ?')
      .run(Date.now(), identifier);
  }

  deleteIssue(identifier: string) {
    return this.db.prepare('DELETE FROM issues WHERE identifier = ?').run(identifier);
  }

  getAllIssues(): unknown[] {
    return this.db.prepare('SELECT * FROM issues ORDER BY identifier').all();
  }

  getIssuesWithVibeTaskId(projectIdentifier: string | null = null): unknown[] {
    if (projectIdentifier) {
      return this.db
        .prepare('SELECT * FROM issues WHERE project_identifier = ? AND vibe_task_id IS NOT NULL AND deleted_from_vibe = 0 ORDER BY identifier')
        .all(projectIdentifier);
    }
    return this.db
      .prepare('SELECT * FROM issues WHERE vibe_task_id IS NOT NULL AND deleted_from_vibe = 0 ORDER BY identifier')
      .all();
  }

  getModifiedIssues(projectIdentifier: string, sinceTimestamp: number): unknown[] {
    return this.db
      .prepare('SELECT * FROM issues WHERE project_identifier = ? AND last_sync_at > ? ORDER BY identifier')
      .all(projectIdentifier, sinceTimestamp);
  }

  hasIssueChanged(identifier: string, newIssue: Record<string, unknown>): boolean {
    const stored = this.getIssue(identifier) as { content_hash?: string } | undefined;
    if (!stored || !stored.content_hash) return true;
    return hasIssueContentChanged(newIssue, stored.content_hash);
  }

  getIssuesWithContentMismatch(projectIdentifier: string): unknown[] {
    return this.db
      .prepare('SELECT * FROM issues WHERE project_identifier = ? AND content_hash IS NOT NULL AND huly_content_hash IS NOT NULL AND content_hash != huly_content_hash ORDER BY identifier')
      .all(projectIdentifier);
  }

  getChildIssuesByHulyParent(parentHulyId: string): unknown[] {
    return this.db
      .prepare('SELECT * FROM issues WHERE parent_huly_id = ? ORDER BY identifier')
      .all(parentHulyId);
  }

  getParentIssues(projectIdentifier: string): unknown[] {
    return this.db
      .prepare('SELECT * FROM issues WHERE project_identifier = ? AND sub_issue_count > 0 ORDER BY identifier')
      .all(projectIdentifier);
  }

  getChildIssues(projectIdentifier: string): unknown[] {
    return this.db
      .prepare('SELECT * FROM issues WHERE project_identifier = ? AND parent_huly_id IS NOT NULL ORDER BY identifier')
      .all(projectIdentifier);
  }

  updateParentChild(identifier: string, parentHulyId: string | null): void {
    this.db
      .prepare('UPDATE issues SET parent_huly_id = ?, updated_at = ? WHERE identifier = ?')
      .run(parentHulyId, Date.now(), identifier);
  }

  updateSubIssueCount(identifier: string, count: number): void {
    this.db
      .prepare('UPDATE issues SET sub_issue_count = ?, updated_at = ? WHERE identifier = ?')
      .run(count, Date.now(), identifier);
  }
}
