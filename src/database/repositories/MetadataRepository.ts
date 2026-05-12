import type Database from 'better-sqlite3';

export interface MetadataRow {
  value: string;
}

export class MetadataRepository {
  constructor(private db: Database.Database) {}

  getLastSync(): number | null {
    const row = this.db.prepare('SELECT value FROM sync_metadata WHERE key = ?').get('last_sync') as MetadataRow | undefined;
    return row ? parseInt(row.value, 10) : null;
  }

  setLastSync(timestamp: number): void {
    this.db
      .prepare('INSERT OR REPLACE INTO sync_metadata (key, value, updated_at) VALUES (?, ?, ?)')
      .run('last_sync', timestamp.toString(), Date.now());
  }
}
