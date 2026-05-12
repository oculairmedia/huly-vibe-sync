import type Database from 'better-sqlite3';
import { computeIssueContentHash, hasIssueContentChanged } from '../utils';

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
