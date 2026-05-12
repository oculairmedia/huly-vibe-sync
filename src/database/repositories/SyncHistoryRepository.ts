import type Database from 'better-sqlite3';

interface SyncCompletionStats {
  projectsProcessed?: number;
  projectsFailed?: number;
  issuesSynced?: number;
  errors?: unknown[];
  durationMs?: number;
}

export class SyncHistoryRepository {
  constructor(private db: Database.Database) {}

  startSyncRun(): number | bigint {
    const result = this.db
      .prepare('INSERT INTO sync_history (started_at) VALUES (?)')
      .run(Date.now());
    return result.lastInsertRowid;
  }

  completeSyncRun(syncId: number | bigint, stats: SyncCompletionStats): void {
    this.db
      .prepare(
        `UPDATE sync_history
         SET completed_at = ?, projects_processed = ?, projects_failed = ?,
             issues_synced = ?, errors = ?, duration_ms = ?
         WHERE id = ?`,
      )
      .run(
        Date.now(),
        stats.projectsProcessed || 0,
        stats.projectsFailed || 0,
        stats.issuesSynced || 0,
        JSON.stringify(stats.errors || []),
        stats.durationMs || 0,
        syncId,
      );
  }

  getRecentSyncs(limit = 10): unknown[] {
    return this.db
      .prepare('SELECT * FROM sync_history ORDER BY started_at DESC LIMIT ?')
      .all(limit);
  }
}
