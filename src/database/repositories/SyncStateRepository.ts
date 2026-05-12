import type Database from 'better-sqlite3';
import { MetadataRepository } from './MetadataRepository';
import { SyncHistoryRepository } from './SyncHistoryRepository';

export class SyncStateRepository {
  private metadata: MetadataRepository;
  private history: SyncHistoryRepository;

  constructor(db: Database.Database) {
    this.metadata = new MetadataRepository(db);
    this.history = new SyncHistoryRepository(db);
  }

  getLastSync(): number | null {
    return this.metadata.getLastSync();
  }

  setLastSync(timestamp: number): void {
    this.metadata.setLastSync(timestamp);
  }

  startSyncRun(): number | bigint {
    return this.history.startSyncRun();
  }

  completeSyncRun(syncId: number | bigint, stats: Record<string, unknown>): void {
    this.history.completeSyncRun(syncId, stats as Parameters<SyncHistoryRepository['completeSyncRun']>[1]);
  }

  getRecentSyncs(limit = 10): unknown[] {
    return this.history.getRecentSyncs(limit);
  }
}
