interface SyncEvent {
  id: string;
  timestamp: string;
  type: string;
  projectId?: string | null;
  source?: string;
  [key: string]: unknown;
}

interface Mapping {
  hulyIdentifier: string;
  vibeTaskId: string;
  lastSynced: string;
  [key: string]: unknown;
}

export class SyncHistoryStore {
  history: SyncEvent[];
  maxEntries: number;
  mappings: Map<string, Mapping>;

  constructor(maxEntries = 100) {
    this.history = [];
    this.maxEntries = maxEntries;
    this.mappings = new Map();
  }

  addEvent(event: Omit<SyncEvent, 'id' | 'timestamp' | 'type'> & { type: string }): string {
    const eventId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const entry: SyncEvent = { id: eventId, timestamp: new Date().toISOString(), ...event };
    this.history.unshift(entry);
    if (this.history.length > this.maxEntries) {
      this.history = this.history.slice(0, this.maxEntries);
    }
    return eventId;
  }

  getHistory(limit = 20, offset = 0): { total: number; limit: number; offset: number; entries: SyncEvent[]; hasMore: boolean } {
    const total = this.history.length;
    const entries = this.history.slice(offset, offset + limit);
    return { total, limit, offset, entries, hasMore: offset + limit < total };
  }

  getEvent(eventId: string): SyncEvent | null {
    return this.history.find(e => e.id === eventId) || null;
  }

  addMapping(hulyIdentifier: string, vibeTaskId: string, metadata: Record<string, unknown> = {}): void {
    this.mappings.set(hulyIdentifier, { hulyIdentifier, vibeTaskId, lastSynced: new Date().toISOString(), ...metadata });
  }

  getMappings(): Mapping[] {
    return Array.from(this.mappings.values());
  }

  getMapping(hulyIdentifier: string): Mapping | null {
    return this.mappings.get(hulyIdentifier) || null;
  }

  clear(): void {
    this.history = [];
    this.mappings.clear();
  }
}

export const syncHistory = new SyncHistoryStore();
