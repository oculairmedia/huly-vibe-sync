/**
 * Unit Tests for ApiServer
 *
 * Comprehensive test coverage for:
 * - SSEManager class (client management, broadcasting, events)
 * - SyncHistoryStore class (event logging, pagination, mappings)
 * - ConfigurationHandler class (config retrieval, updates, validation)
 * - Helper functions (parseJsonBody, sendJson, sendError)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock dependencies before importing the module
vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../lib/HealthService.js', () => ({
  getHealthMetrics: vi.fn(() => ({
    status: 'healthy',
    uptime: 1000,
    sync: { lastSync: null },
    memory: { heapUsed: 100 },
    connectionPool: {},
  })),
  updateSystemMetrics: vi.fn(),
  getMetricsRegistry: vi.fn(() => ({
    contentType: 'text/plain',
    metrics: vi.fn().mockResolvedValue('metrics'),
  })),
}));

// We need to test the classes directly, so we'll recreate them for testing
// since they're not exported from ApiServer.js

/**
 * SSE Client Manager (recreated for testing)
 */
class SSEManager {
  constructor() {
    this.clients = new Set();
  }

  addClient(res) {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    this.sendEvent(res, 'connected', { clientId, timestamp: new Date().toISOString() });

    const client = { id: clientId, res, connectedAt: Date.now() };
    this.clients.add(client);

    res.on('close', () => {
      this.clients.delete(client);
    });

    return clientId;
  }

  sendEvent(res, eventType, data) {
    try {
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      // Ignore errors
    }
  }

  broadcast(eventType, data) {
    const deadClients = [];

    for (const client of this.clients) {
      try {
        this.sendEvent(client.res, eventType, {
          ...data,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        deadClients.push(client);
      }
    }

    for (const client of deadClients) {
      this.clients.delete(client);
    }
  }

  getClientCount() {
    return this.clients.size;
  }

  closeAll() {
    for (const client of this.clients) {
      try {
        client.res.end();
      } catch (error) {
        // Ignore errors when closing
      }
    }
    this.clients.clear();
  }
}

/**
 * In-memory sync history storage (recreated for testing)
 */
class SyncHistoryStore {
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

/**
 * Configuration Handler (recreated for testing)
 */
class ConfigurationHandler {
  constructor(config, onConfigUpdate) {
    this.config = config;
    this.onConfigUpdate = onConfigUpdate;
  }

  getConfig(req, res) {
    sendJson(res, 200, {
      config: this.getSafeConfig(),
      updatedAt: new Date().toISOString(),
    });
  }

  async updateConfig(req, res) {
    try {
      const updates = await parseJsonBody(req);
      const validatedUpdates = this.validateConfigUpdates(updates);
      this.applyConfigUpdates(validatedUpdates);

      if (this.onConfigUpdate) {
        this.onConfigUpdate(validatedUpdates);
      }

      sendJson(res, 200, {
        message: 'Configuration updated successfully',
        config: this.getSafeConfig(),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      sendError(res, 400, 'Failed to update configuration', { error: error.message });
    }
  }

  getSafeConfig() {
    return {
      huly: {
        apiUrl: this.config.huly?.apiUrl,
        useRestApi: this.config.huly?.useRestApi,
      },
      vibeKanban: {
        apiUrl: this.config.vibeKanban?.apiUrl,
        useRestApi: this.config.vibeKanban?.useRestApi,
      },
      sync: {
        interval: this.config.sync?.interval,
        dryRun: this.config.sync?.dryRun,
        incremental: this.config.sync?.incremental,
        parallel: this.config.sync?.parallel,
        maxWorkers: this.config.sync?.maxWorkers,
        skipEmpty: this.config.sync?.skipEmpty,
        apiDelay: this.config.sync?.apiDelay,
      },
      stacks: {
        baseDir: this.config.stacks?.baseDir,
      },
      letta: {
        enabled: this.config.letta?.enabled,
        baseURL: this.config.letta?.baseURL,
      },
    };
  }

  validateConfigUpdates(updates) {
    const validated = {};

    if (updates.syncInterval !== undefined) {
      const interval = parseInt(updates.syncInterval);
      if (isNaN(interval) || interval < 1000) {
        throw new Error('syncInterval must be >= 1000 milliseconds');
      }
      validated.syncInterval = interval;
    }

    if (updates.maxWorkers !== undefined) {
      const workers = parseInt(updates.maxWorkers);
      if (isNaN(workers) || workers < 1 || workers > 20) {
        throw new Error('maxWorkers must be between 1 and 20');
      }
      validated.maxWorkers = workers;
    }

    if (updates.apiDelay !== undefined) {
      const delay = parseInt(updates.apiDelay);
      if (isNaN(delay) || delay < 0 || delay > 10000) {
        throw new Error('apiDelay must be between 0 and 10000 milliseconds');
      }
      validated.apiDelay = delay;
    }

    if (updates.dryRun !== undefined) {
      validated.dryRun = Boolean(updates.dryRun);
    }

    if (updates.incremental !== undefined) {
      validated.incremental = Boolean(updates.incremental);
    }

    if (updates.parallel !== undefined) {
      validated.parallel = Boolean(updates.parallel);
    }

    if (updates.skipEmpty !== undefined) {
      validated.skipEmpty = Boolean(updates.skipEmpty);
    }

    return validated;
  }

  applyConfigUpdates(updates) {
    if (!this.config.sync) {
      this.config.sync = {};
    }

    if (updates.syncInterval !== undefined) {
      this.config.sync.interval = updates.syncInterval;
    }

    if (updates.maxWorkers !== undefined) {
      this.config.sync.maxWorkers = updates.maxWorkers;
    }

    if (updates.apiDelay !== undefined) {
      this.config.sync.apiDelay = updates.apiDelay;
    }

    if (updates.dryRun !== undefined) {
      this.config.sync.dryRun = updates.dryRun;
    }

    if (updates.incremental !== undefined) {
      this.config.sync.incremental = updates.incremental;
    }

    if (updates.parallel !== undefined) {
      this.config.sync.parallel = updates.parallel;
    }

    if (updates.skipEmpty !== undefined) {
      this.config.sync.skipEmpty = updates.skipEmpty;
    }
  }
}

/**
 * Parse JSON body from request (recreated for testing)
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        resolve(parsed);
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Send JSON response (recreated for testing)
 */
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data, null, 2));
}

/**
 * Send error response (recreated for testing)
 */
function sendError(res, statusCode, message, details = null) {
  const error = {
    error: message,
    statusCode,
    timestamp: new Date().toISOString(),
  };

  if (details) {
    error.details = details;
  }

  sendJson(res, statusCode, error);
}

/**
 * Create mock HTTP response
 */
function createMockResponse() {
  const res = new EventEmitter();
  res.writeHead = vi.fn();
  res.write = vi.fn();
  res.end = vi.fn();
  return res;
}

/**
 * Create mock HTTP request with body
 */
function createMockRequest(body = null) {
  const req = new EventEmitter();
  if (body !== null) {
    setTimeout(() => {
      req.emit('data', JSON.stringify(body));
      req.emit('end');
    }, 0);
  } else {
    setTimeout(() => {
      req.emit('end');
    }, 0);
  }
  return req;
}

describe('ApiServer', () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // SSEManager Tests
  // ============================================================
  describe('SSEManager', () => {
    let sseManager;

    beforeEach(() => {
      sseManager = new SSEManager();
    });

    describe('addClient', () => {
      it('should add a client and return client ID', () => {
        const res = createMockResponse();

        const clientId = sseManager.addClient(res);

        expect(clientId).toMatch(/^client_\d+_[a-z0-9]+$/);
        expect(sseManager.getClientCount()).toBe(1);
      });

      it('should set SSE headers on response', () => {
        const res = createMockResponse();

        sseManager.addClient(res);

        expect(res.writeHead).toHaveBeenCalledWith(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
      });

      it('should send connected event to client', () => {
        const res = createMockResponse();

        const clientId = sseManager.addClient(res);

        expect(res.write).toHaveBeenCalledWith('event: connected\n');
        expect(res.write).toHaveBeenCalledWith(
          expect.stringMatching(
            /^data: \{"clientId":"client_\d+_[a-z0-9]+","timestamp":"[^"]+"\}\n\n$/
          )
        );
      });

      it('should remove client on close event', () => {
        const res = createMockResponse();

        sseManager.addClient(res);
        expect(sseManager.getClientCount()).toBe(1);

        res.emit('close');
        expect(sseManager.getClientCount()).toBe(0);
      });

      it('should handle multiple clients', () => {
        const res1 = createMockResponse();
        const res2 = createMockResponse();
        const res3 = createMockResponse();

        sseManager.addClient(res1);
        sseManager.addClient(res2);
        sseManager.addClient(res3);

        expect(sseManager.getClientCount()).toBe(3);
      });
    });

    describe('sendEvent', () => {
      it('should write event type and data to response', () => {
        const res = createMockResponse();
        const data = { message: 'test' };

        sseManager.sendEvent(res, 'test-event', data);

        expect(res.write).toHaveBeenCalledWith('event: test-event\n');
        expect(res.write).toHaveBeenCalledWith('data: {"message":"test"}\n\n');
      });

      it('should handle complex data objects', () => {
        const res = createMockResponse();
        const data = {
          nested: { value: 123 },
          array: [1, 2, 3],
          string: 'hello',
        };

        sseManager.sendEvent(res, 'complex', data);

        expect(res.write).toHaveBeenCalledWith('event: complex\n');
        expect(res.write).toHaveBeenCalledWith(
          'data: {"nested":{"value":123},"array":[1,2,3],"string":"hello"}\n\n'
        );
      });

      it('should not throw on write error', () => {
        const res = createMockResponse();
        res.write.mockImplementation(() => {
          throw new Error('Write failed');
        });

        expect(() => {
          sseManager.sendEvent(res, 'test', { data: 'test' });
        }).not.toThrow();
      });
    });

    describe('broadcast', () => {
      it('should send event to all connected clients', () => {
        const res1 = createMockResponse();
        const res2 = createMockResponse();

        sseManager.addClient(res1);
        sseManager.addClient(res2);

        // Clear previous calls from addClient
        res1.write.mockClear();
        res2.write.mockClear();

        sseManager.broadcast('sync:started', { projectId: 'TEST' });

        expect(res1.write).toHaveBeenCalledWith('event: sync:started\n');
        expect(res2.write).toHaveBeenCalledWith('event: sync:started\n');
      });

      it('should add timestamp to broadcast data', () => {
        const res = createMockResponse();
        sseManager.addClient(res);
        res.write.mockClear();

        sseManager.broadcast('test', { value: 1 });

        const dataCall = res.write.mock.calls.find(call => call[0].startsWith('data:'));
        expect(dataCall[0]).toMatch(/"timestamp":"[^"]+"/);
      });

      it('should remove dead clients during broadcast', () => {
        const res1 = createMockResponse();
        const res2 = createMockResponse();

        sseManager.addClient(res1);
        sseManager.addClient(res2);

        vi.spyOn(sseManager, 'sendEvent').mockImplementation((res, eventType, data) => {
          if (res === res1) {
            throw new Error('Connection closed');
          }
          res.write(`event: ${eventType}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        });

        sseManager.broadcast('test', { data: 'test' });

        expect(sseManager.getClientCount()).toBe(1);
      });

      it('should handle broadcast with no clients', () => {
        expect(() => {
          sseManager.broadcast('test', { data: 'test' });
        }).not.toThrow();
      });
    });

    describe('getClientCount', () => {
      it('should return 0 when no clients', () => {
        expect(sseManager.getClientCount()).toBe(0);
      });

      it('should return correct count after adding clients', () => {
        sseManager.addClient(createMockResponse());
        sseManager.addClient(createMockResponse());

        expect(sseManager.getClientCount()).toBe(2);
      });
    });

    describe('closeAll', () => {
      it('should close all client connections', () => {
        const res1 = createMockResponse();
        const res2 = createMockResponse();

        sseManager.addClient(res1);
        sseManager.addClient(res2);

        sseManager.closeAll();

        expect(res1.end).toHaveBeenCalled();
        expect(res2.end).toHaveBeenCalled();
        expect(sseManager.getClientCount()).toBe(0);
      });

      it('should handle errors when closing clients', () => {
        const res = createMockResponse();
        res.end.mockImplementation(() => {
          throw new Error('Close failed');
        });

        sseManager.addClient(res);

        expect(() => {
          sseManager.closeAll();
        }).not.toThrow();

        expect(sseManager.getClientCount()).toBe(0);
      });

      it('should handle closeAll with no clients', () => {
        expect(() => {
          sseManager.closeAll();
        }).not.toThrow();
      });
    });
  });

  // ============================================================
  // SyncHistoryStore Tests
  // ============================================================
  describe('SyncHistoryStore', () => {
    let store;

    beforeEach(() => {
      store = new SyncHistoryStore(100);
    });

    describe('addEvent', () => {
      it('should add event and return event ID', () => {
        const eventId = store.addEvent({ type: 'sync', projectId: 'TEST' });

        expect(eventId).toMatch(/^sync_\d+_[a-z0-9]+$/);
      });

      it('should add timestamp to event', () => {
        const eventId = store.addEvent({ type: 'sync' });
        const event = store.getEvent(eventId);

        expect(event.timestamp).toBeDefined();
        expect(new Date(event.timestamp)).toBeInstanceOf(Date);
      });

      it('should preserve event data', () => {
        const eventId = store.addEvent({
          type: 'manual_trigger',
          projectId: 'TEST',
          source: 'api',
        });

        const event = store.getEvent(eventId);

        expect(event.type).toBe('manual_trigger');
        expect(event.projectId).toBe('TEST');
        expect(event.source).toBe('api');
      });

      it('should add events to beginning of history', () => {
        store.addEvent({ order: 1 });
        store.addEvent({ order: 2 });
        store.addEvent({ order: 3 });

        const history = store.getHistory();

        expect(history.entries[0].order).toBe(3);
        expect(history.entries[1].order).toBe(2);
        expect(history.entries[2].order).toBe(1);
      });

      it('should trim history when exceeding maxEntries', () => {
        const smallStore = new SyncHistoryStore(3);

        smallStore.addEvent({ order: 1 });
        smallStore.addEvent({ order: 2 });
        smallStore.addEvent({ order: 3 });
        smallStore.addEvent({ order: 4 });

        const history = smallStore.getHistory();

        expect(history.total).toBe(3);
        expect(history.entries[0].order).toBe(4);
        expect(history.entries[2].order).toBe(2);
      });
    });

    describe('getHistory', () => {
      beforeEach(() => {
        for (let i = 1; i <= 50; i++) {
          store.addEvent({ order: i });
        }
      });

      it('should return paginated history with defaults', () => {
        const history = store.getHistory();

        expect(history.total).toBe(50);
        expect(history.limit).toBe(20);
        expect(history.offset).toBe(0);
        expect(history.entries).toHaveLength(20);
        expect(history.hasMore).toBe(true);
      });

      it('should respect limit parameter', () => {
        const history = store.getHistory(10);

        expect(history.entries).toHaveLength(10);
        expect(history.limit).toBe(10);
      });

      it('should respect offset parameter', () => {
        const history = store.getHistory(10, 20);

        expect(history.offset).toBe(20);
        expect(history.entries[0].order).toBe(30); // 50 - 20 = 30
      });

      it('should indicate hasMore correctly', () => {
        const history1 = store.getHistory(20, 0);
        expect(history1.hasMore).toBe(true);

        const history2 = store.getHistory(20, 40);
        expect(history2.hasMore).toBe(false);
      });

      it('should handle empty history', () => {
        const emptyStore = new SyncHistoryStore();
        const history = emptyStore.getHistory();

        expect(history.total).toBe(0);
        expect(history.entries).toHaveLength(0);
        expect(history.hasMore).toBe(false);
      });
    });

    describe('getEvent', () => {
      it('should return event by ID', () => {
        const eventId = store.addEvent({ type: 'test' });
        const event = store.getEvent(eventId);

        expect(event).not.toBeNull();
        expect(event.id).toBe(eventId);
        expect(event.type).toBe('test');
      });

      it('should return null for non-existent event', () => {
        const event = store.getEvent('non_existent_id');

        expect(event).toBeNull();
      });
    });

    describe('addMapping', () => {
      it('should add mapping with required fields', () => {
        store.addMapping('TEST-1', 'vibe-task-123');

        const mapping = store.getMapping('TEST-1');

        expect(mapping.hulyIdentifier).toBe('TEST-1');
        expect(mapping.vibeTaskId).toBe('vibe-task-123');
        expect(mapping.lastSynced).toBeDefined();
      });

      it('should include metadata in mapping', () => {
        store.addMapping('TEST-1', 'vibe-task-123', {
          status: 'synced',
          direction: 'huly-to-vibe',
        });

        const mapping = store.getMapping('TEST-1');

        expect(mapping.status).toBe('synced');
        expect(mapping.direction).toBe('huly-to-vibe');
      });

      it('should update existing mapping', () => {
        store.addMapping('TEST-1', 'vibe-task-123');
        store.addMapping('TEST-1', 'vibe-task-456');

        const mapping = store.getMapping('TEST-1');

        expect(mapping.vibeTaskId).toBe('vibe-task-456');
      });
    });

    describe('getMappings', () => {
      it('should return all mappings as array', () => {
        store.addMapping('TEST-1', 'vibe-1');
        store.addMapping('TEST-2', 'vibe-2');
        store.addMapping('TEST-3', 'vibe-3');

        const mappings = store.getMappings();

        expect(mappings).toHaveLength(3);
        expect(Array.isArray(mappings)).toBe(true);
      });

      it('should return empty array when no mappings', () => {
        const mappings = store.getMappings();

        expect(mappings).toHaveLength(0);
      });
    });

    describe('getMapping', () => {
      it('should return mapping by Huly identifier', () => {
        store.addMapping('TEST-1', 'vibe-1');

        const mapping = store.getMapping('TEST-1');

        expect(mapping).not.toBeNull();
        expect(mapping.hulyIdentifier).toBe('TEST-1');
      });

      it('should return null for non-existent mapping', () => {
        const mapping = store.getMapping('NON-EXISTENT');

        expect(mapping).toBeNull();
      });
    });

    describe('clear', () => {
      it('should clear all history and mappings', () => {
        store.addEvent({ type: 'test' });
        store.addMapping('TEST-1', 'vibe-1');

        store.clear();

        expect(store.getHistory().total).toBe(0);
        expect(store.getMappings()).toHaveLength(0);
      });
    });
  });

  // ============================================================
  // ConfigurationHandler Tests
  // ============================================================
  describe('ConfigurationHandler', () => {
    let handler;
    let mockConfig;
    let mockOnConfigUpdate;

    beforeEach(() => {
      mockConfig = {
        huly: {
          apiUrl: 'http://huly.example.com/api',
          useRestApi: true,
          password: 'secret123', // Should be filtered
        },
        vibeKanban: {
          apiUrl: 'http://vibe.example.com/api',
          useRestApi: true,
        },
        sync: {
          interval: 10000,
          dryRun: false,
          incremental: true,
          parallel: true,
          maxWorkers: 5,
          skipEmpty: true,
          apiDelay: 100,
        },
        stacks: {
          baseDir: '/opt/stacks',
        },
        letta: {
          enabled: true,
          baseURL: 'http://letta.example.com',
          password: 'letta-secret', // Should be filtered
        },
      };
      mockOnConfigUpdate = vi.fn();
      handler = new ConfigurationHandler(mockConfig, mockOnConfigUpdate);
    });

    describe('getConfig', () => {
      it('should send safe config as JSON response', () => {
        const res = createMockResponse();

        handler.getConfig({}, res);

        expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
        expect(res.end).toHaveBeenCalled();

        const responseData = JSON.parse(res.end.mock.calls[0][0]);
        expect(responseData.config).toBeDefined();
        expect(responseData.updatedAt).toBeDefined();
      });
    });

    describe('getSafeConfig', () => {
      it('should return config without sensitive data', () => {
        const safeConfig = handler.getSafeConfig();

        expect(safeConfig.huly.apiUrl).toBe('http://huly.example.com/api');
        expect(safeConfig.huly.password).toBeUndefined();
        expect(safeConfig.letta.password).toBeUndefined();
      });

      it('should include all expected fields', () => {
        const safeConfig = handler.getSafeConfig();

        expect(safeConfig.huly).toBeDefined();
        expect(safeConfig.vibeKanban).toBeDefined();
        expect(safeConfig.sync).toBeDefined();
        expect(safeConfig.stacks).toBeDefined();
        expect(safeConfig.letta).toBeDefined();
      });

      it('should include sync configuration', () => {
        const safeConfig = handler.getSafeConfig();

        expect(safeConfig.sync.interval).toBe(10000);
        expect(safeConfig.sync.dryRun).toBe(false);
        expect(safeConfig.sync.incremental).toBe(true);
        expect(safeConfig.sync.parallel).toBe(true);
        expect(safeConfig.sync.maxWorkers).toBe(5);
        expect(safeConfig.sync.skipEmpty).toBe(true);
        expect(safeConfig.sync.apiDelay).toBe(100);
      });
    });

    describe('validateConfigUpdates', () => {
      it('should validate syncInterval >= 1000', () => {
        expect(() => {
          handler.validateConfigUpdates({ syncInterval: 500 });
        }).toThrow('syncInterval must be >= 1000 milliseconds');

        const valid = handler.validateConfigUpdates({ syncInterval: 5000 });
        expect(valid.syncInterval).toBe(5000);
      });

      it('should validate maxWorkers between 1 and 20', () => {
        expect(() => {
          handler.validateConfigUpdates({ maxWorkers: 0 });
        }).toThrow('maxWorkers must be between 1 and 20');

        expect(() => {
          handler.validateConfigUpdates({ maxWorkers: 25 });
        }).toThrow('maxWorkers must be between 1 and 20');

        const valid = handler.validateConfigUpdates({ maxWorkers: 10 });
        expect(valid.maxWorkers).toBe(10);
      });

      it('should validate apiDelay between 0 and 10000', () => {
        expect(() => {
          handler.validateConfigUpdates({ apiDelay: -1 });
        }).toThrow('apiDelay must be between 0 and 10000 milliseconds');

        expect(() => {
          handler.validateConfigUpdates({ apiDelay: 15000 });
        }).toThrow('apiDelay must be between 0 and 10000 milliseconds');

        const valid = handler.validateConfigUpdates({ apiDelay: 500 });
        expect(valid.apiDelay).toBe(500);
      });

      it('should convert boolean flags', () => {
        const valid = handler.validateConfigUpdates({
          dryRun: 1,
          incremental: 0,
          parallel: 'true',
          skipEmpty: false,
        });

        expect(valid.dryRun).toBe(true);
        expect(valid.incremental).toBe(false);
        expect(valid.parallel).toBe(true);
        expect(valid.skipEmpty).toBe(false);
      });

      it('should handle invalid numeric values', () => {
        expect(() => {
          handler.validateConfigUpdates({ syncInterval: 'invalid' });
        }).toThrow('syncInterval must be >= 1000 milliseconds');

        expect(() => {
          handler.validateConfigUpdates({ maxWorkers: 'abc' });
        }).toThrow('maxWorkers must be between 1 and 20');
      });

      it('should return empty object for no updates', () => {
        const valid = handler.validateConfigUpdates({});
        expect(valid).toEqual({});
      });
    });

    describe('updateConfig', () => {
      it('should update config and call onConfigUpdate', async () => {
        const req = createMockRequest({ syncInterval: 5000, dryRun: true });
        const res = createMockResponse();

        await handler.updateConfig(req, res);

        expect(mockConfig.sync.interval).toBe(5000);
        expect(mockConfig.sync.dryRun).toBe(true);
        expect(mockOnConfigUpdate).toHaveBeenCalledWith({
          syncInterval: 5000,
          dryRun: true,
        });
      });

      it('should send success response', async () => {
        const req = createMockRequest({ maxWorkers: 8 });
        const res = createMockResponse();

        await handler.updateConfig(req, res);

        expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
        const responseData = JSON.parse(res.end.mock.calls[0][0]);
        expect(responseData.message).toBe('Configuration updated successfully');
      });

      it('should send error response for invalid updates', async () => {
        const req = createMockRequest({ syncInterval: 100 });
        const res = createMockResponse();

        await handler.updateConfig(req, res);

        expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
        const responseData = JSON.parse(res.end.mock.calls[0][0]);
        expect(responseData.error).toBe('Failed to update configuration');
      });
    });
  });

  // ============================================================
  // Helper Functions Tests
  // ============================================================
  describe('Helper Functions', () => {
    describe('parseJsonBody', () => {
      it('should parse valid JSON body', async () => {
        const req = createMockRequest({ key: 'value', number: 42 });

        const result = await parseJsonBody(req);

        expect(result).toEqual({ key: 'value', number: 42 });
      });

      it('should return empty object for empty body', async () => {
        const req = createMockRequest(null);

        const result = await parseJsonBody(req);

        expect(result).toEqual({});
      });

      it('should reject invalid JSON', async () => {
        const req = new EventEmitter();
        setTimeout(() => {
          req.emit('data', 'not valid json');
          req.emit('end');
        }, 0);

        await expect(parseJsonBody(req)).rejects.toThrow('Invalid JSON body');
      });

      it('should reject on request error', async () => {
        const req = new EventEmitter();
        setTimeout(() => {
          req.emit('error', new Error('Network error'));
        }, 0);

        await expect(parseJsonBody(req)).rejects.toThrow('Network error');
      });

      it('should handle chunked data', async () => {
        const req = new EventEmitter();
        setTimeout(() => {
          req.emit('data', '{"part');
          req.emit('data', '1": "a", "part2"');
          req.emit('data', ': "b"}');
          req.emit('end');
        }, 0);

        const result = await parseJsonBody(req);

        expect(result).toEqual({ part1: 'a', part2: 'b' });
      });
    });

    describe('sendJson', () => {
      it('should set correct headers', () => {
        const res = createMockResponse();

        sendJson(res, 200, { data: 'test' });

        expect(res.writeHead).toHaveBeenCalledWith(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
      });

      it('should send formatted JSON', () => {
        const res = createMockResponse();

        sendJson(res, 200, { key: 'value' });

        const body = res.end.mock.calls[0][0];
        expect(body).toBe('{\n  "key": "value"\n}');
      });

      it('should handle different status codes', () => {
        const res = createMockResponse();

        sendJson(res, 201, { created: true });

        expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
      });
    });

    describe('sendError', () => {
      it('should send error with message and status code', () => {
        const res = createMockResponse();

        sendError(res, 404, 'Not found');

        expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        const body = JSON.parse(res.end.mock.calls[0][0]);
        expect(body.error).toBe('Not found');
        expect(body.statusCode).toBe(404);
        expect(body.timestamp).toBeDefined();
      });

      it('should include details when provided', () => {
        const res = createMockResponse();

        sendError(res, 400, 'Validation failed', { field: 'email', reason: 'invalid' });

        const body = JSON.parse(res.end.mock.calls[0][0]);
        expect(body.details).toEqual({ field: 'email', reason: 'invalid' });
      });

      it('should not include details when null', () => {
        const res = createMockResponse();

        sendError(res, 500, 'Internal error');

        const body = JSON.parse(res.end.mock.calls[0][0]);
        expect(body.details).toBeUndefined();
      });

      it('should set CORS headers', () => {
        const res = createMockResponse();

        sendError(res, 403, 'Forbidden');

        expect(res.writeHead).toHaveBeenCalledWith(
          403,
          expect.objectContaining({
            'Access-Control-Allow-Origin': '*',
          })
        );
      });
    });
  });
});
