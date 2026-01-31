export class MetadataRepository {
  constructor(db) {
    this.db = db;
  }

  getLastSync() {
    const row = this.db.prepare('SELECT value FROM sync_metadata WHERE key = ?').get('last_sync');
    return row ? parseInt(row.value) : null;
  }

  setLastSync(timestamp) {
    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO sync_metadata (key, value, updated_at)
        VALUES (?, ?, ?)
      `
      )
      .run('last_sync', timestamp.toString(), Date.now());
  }
}
