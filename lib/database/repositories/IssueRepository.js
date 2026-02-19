import { computeIssueContentHash, hasIssueContentChanged } from '../utils.js';

export class IssueRepository {
  constructor(db) {
    this.db = db;
  }

  upsertIssue(issue) {
    const now = Date.now();
    const contentHash = computeIssueContentHash(issue);

    const stmt = this.db.prepare(`
      INSERT INTO issues (
        identifier, project_identifier, huly_id, vibe_task_id, beads_issue_id,
        title, description, status, priority, last_sync_at, created_at, updated_at,
        huly_modified_at, vibe_modified_at, beads_modified_at, vibe_status, beads_status,
        parent_huly_id, parent_vibe_id, parent_beads_id, sub_issue_count,
        content_hash, huly_content_hash, beads_content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(identifier) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        status = excluded.status,
        priority = excluded.priority,
        vibe_task_id = COALESCE(excluded.vibe_task_id, vibe_task_id),
        beads_issue_id = COALESCE(excluded.beads_issue_id, beads_issue_id),
        last_sync_at = excluded.last_sync_at,
        updated_at = excluded.updated_at,
        huly_modified_at = COALESCE(excluded.huly_modified_at, huly_modified_at),
        vibe_modified_at = COALESCE(excluded.vibe_modified_at, vibe_modified_at),
        beads_modified_at = COALESCE(excluded.beads_modified_at, beads_modified_at),
        vibe_status = COALESCE(excluded.vibe_status, vibe_status),
        beads_status = COALESCE(excluded.beads_status, beads_status),
        parent_huly_id = COALESCE(excluded.parent_huly_id, parent_huly_id),
        parent_vibe_id = COALESCE(excluded.parent_vibe_id, parent_vibe_id),
        parent_beads_id = COALESCE(excluded.parent_beads_id, parent_beads_id),
        sub_issue_count = COALESCE(excluded.sub_issue_count, sub_issue_count),
        content_hash = excluded.content_hash,
        huly_content_hash = COALESCE(excluded.huly_content_hash, huly_content_hash),
        beads_content_hash = COALESCE(excluded.beads_content_hash, beads_content_hash)
    `);

    stmt.run(
      issue.identifier,
      issue.project_identifier,
      issue.huly_id || null,
      issue.vibe_task_id || null,
      issue.beads_issue_id || null,
      issue.title || issue.identifier || 'Untitled Issue',
      issue.description || '',
      issue.status || 'unknown',
      issue.priority || 'medium',
      now,
      issue.created_at || now,
      now,
      issue.huly_modified_at || null,
      issue.vibe_modified_at || null,
      issue.beads_modified_at || null,
      issue.vibe_status || null,
      issue.beads_status || null,
      issue.parent_huly_id || null,
      issue.parent_vibe_id || null,
      issue.parent_beads_id || null,
      issue.sub_issue_count || 0,
      contentHash,
      issue.huly_content_hash || null,
      issue.beads_content_hash || null
    );
  }

  getProjectIssues(projectIdentifier) {
    return this.db
      .prepare('SELECT * FROM issues WHERE project_identifier = ? ORDER BY identifier')
      .all(projectIdentifier);
  }

  getIssue(identifier) {
    return this.db.prepare('SELECT * FROM issues WHERE identifier = ?').get(identifier);
  }

  getIssueByBeadsId(projectIdentifier, beadsIssueId) {
    return this.db
      .prepare(
        'SELECT * FROM issues WHERE project_identifier = ? AND beads_issue_id = ? ORDER BY updated_at DESC LIMIT 1'
      )
      .get(projectIdentifier, beadsIssueId);
  }

  markDeletedFromHuly(identifier) {
    const stmt = this.db.prepare(`
      UPDATE issues SET deleted_from_huly = 1, updated_at = ?
      WHERE identifier = ?
    `);
    return stmt.run(Date.now(), identifier);
  }

  isDeletedFromHuly(identifier) {
    const row = this.db
      .prepare('SELECT deleted_from_huly FROM issues WHERE identifier = ?')
      .get(identifier);
    return row?.deleted_from_huly === 1;
  }

  markDeletedFromBeads(identifier) {
    const stmt = this.db.prepare(`
      UPDATE issues
      SET deleted_from_beads = 1, beads_issue_id = NULL, updated_at = ?
      WHERE identifier = ?
    `);
    return stmt.run(Date.now(), identifier);
  }

  deleteIssue(identifier) {
    const stmt = this.db.prepare('DELETE FROM issues WHERE identifier = ?');
    return stmt.run(identifier);
  }

  getAllIssues() {
    return this.db.prepare('SELECT * FROM issues ORDER BY identifier').all();
  }

  getIssuesWithBeadsIssueId(projectIdentifier = null) {
    if (projectIdentifier) {
      return this.db
        .prepare(
          `
        SELECT * FROM issues
        WHERE project_identifier = ?
          AND beads_issue_id IS NOT NULL
          AND deleted_from_beads = 0
        ORDER BY identifier
      `
        )
        .all(projectIdentifier);
    }

    return this.db
      .prepare(
        `
      SELECT * FROM issues
      WHERE beads_issue_id IS NOT NULL
        AND deleted_from_beads = 0
      ORDER BY identifier
    `
      )
      .all();
  }

  getModifiedIssues(projectIdentifier, sinceTimestamp) {
    return this.db
      .prepare(
        `
      SELECT * FROM issues
      WHERE project_identifier = ? AND last_sync_at > ?
      ORDER BY identifier
    `
      )
      .all(projectIdentifier, sinceTimestamp);
  }

  hasIssueChanged(identifier, newIssue) {
    const stored = this.getIssue(identifier);
    if (!stored || !stored.content_hash) return true;
    return hasIssueContentChanged(newIssue, stored.content_hash);
  }

  getIssuesWithContentMismatch(projectIdentifier) {
    return this.db
      .prepare(
        `
      SELECT * FROM issues
      WHERE project_identifier = ?
        AND content_hash IS NOT NULL
        AND huly_content_hash IS NOT NULL
        AND content_hash != huly_content_hash
      ORDER BY identifier
    `
      )
      .all(projectIdentifier);
  }

  getChildIssuesByHulyParent(parentHulyId) {
    return this.db
      .prepare('SELECT * FROM issues WHERE parent_huly_id = ? ORDER BY identifier')
      .all(parentHulyId);
  }

  getChildIssuesByBeadsParent(parentBeadsId) {
    return this.db
      .prepare('SELECT * FROM issues WHERE parent_beads_id = ? ORDER BY identifier')
      .all(parentBeadsId);
  }

  getParentIssues(projectIdentifier) {
    return this.db
      .prepare(
        `
      SELECT * FROM issues
      WHERE project_identifier = ? AND sub_issue_count > 0
      ORDER BY identifier
    `
      )
      .all(projectIdentifier);
  }

  getChildIssues(projectIdentifier) {
    return this.db
      .prepare(
        `
      SELECT * FROM issues
      WHERE project_identifier = ? AND parent_huly_id IS NOT NULL
      ORDER BY identifier
    `
      )
      .all(projectIdentifier);
  }

  updateParentChild(identifier, parentHulyId, parentBeadsId = null) {
    this.db
      .prepare(
        `
      UPDATE issues
      SET parent_huly_id = ?, parent_beads_id = ?, updated_at = ?
      WHERE identifier = ?
    `
      )
      .run(parentHulyId, parentBeadsId, Date.now(), identifier);
  }

  updateSubIssueCount(identifier, count) {
    this.db
      .prepare(
        `
      UPDATE issues
      SET sub_issue_count = ?, updated_at = ?
      WHERE identifier = ?
    `
      )
      .run(count, Date.now(), identifier);
  }
}
