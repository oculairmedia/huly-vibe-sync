import { MetadataRepository } from './MetadataRepository.js';
import { SyncHistoryRepository } from './SyncHistoryRepository.js';

/**
 * SyncStateRepository
 *
 * Consolidates sync cursor/metadata and sync run history access behind one
 * repository boundary so SyncDatabase no longer needs to orchestrate both.
 */
export class SyncStateRepository {
  constructor(db) {
    this.metadata = new MetadataRepository(db);
    this.history = new SyncHistoryRepository(db);
  }

  getLastSync() {
    return this.metadata.getLastSync();
  }

  setLastSync(timestamp) {
    this.metadata.setLastSync(timestamp);
  }

  startSyncRun() {
    return this.history.startSyncRun();
  }

  completeSyncRun(syncId, stats) {
    this.history.completeSyncRun(syncId, stats);
  }

  getRecentSyncs(limit = 10) {
    return this.history.getRecentSyncs(limit);
  }
}
