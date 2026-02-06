/**
 * In-memory sync history storage
 * In production, this should be persisted to database
 */

export class SyncHistoryStore {
  constructor(maxEntries = 100) {
    this.history = [];
    this.maxEntries = maxEntries;
    this.mappings = new Map();
  }

  addEvent(event) {
    const eventId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const entry = {
      id: eventId,
      timestamp: new Date().toISOString(),
      ...event,
    };

    this.history.unshift(entry);

    if (this.history.length > this.maxEntries) {
      this.history = this.history.slice(0, this.maxEntries);
    }

    return eventId;
  }

  getHistory(limit = 20, offset = 0) {
    const total = this.history.length;
    const entries = this.history.slice(offset, offset + limit);

    return {
      total,
      limit,
      offset,
      entries,
      hasMore: offset + limit < total,
    };
  }

  getEvent(eventId) {
    return this.history.find(e => e.id === eventId) || null;
  }

  addMapping(hulyIdentifier, vibeTaskId, metadata = {}) {
    this.mappings.set(hulyIdentifier, {
      hulyIdentifier,
      vibeTaskId,
      lastSynced: new Date().toISOString(),
      ...metadata,
    });
  }

  getMappings() {
    return Array.from(this.mappings.values());
  }

  getMapping(hulyIdentifier) {
    return this.mappings.get(hulyIdentifier) || null;
  }

  clear() {
    this.history = [];
    this.mappings.clear();
  }
}

export const syncHistory = new SyncHistoryStore();
