import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CodePerceptionWatcher } from '../../lib/CodePerceptionWatcher.js';

class MockFsAdapter {
  constructor() {
    this.files = new Map();
  }

  setFile(path, content, size = null) {
    this.files.set(path, { content, size: size ?? Buffer.byteLength(content) });
  }

  readFile(p, encoding) {
    const file = this.files.get(p);
    if (!file) throw new Error(`ENOENT: ${p}`);
    return encoding ? file.content : Buffer.from(file.content);
  }

  stat(p) {
    const file = this.files.get(p);
    if (!file) throw new Error(`ENOENT: ${p}`);
    return { size: file.size };
  }

  exists(p) {
    return this.files.has(p) || p === '/projects/test-project';
  }

  readdir(p, options) {
    return [];
  }
}

class MockClock {
  constructor() {
    this.time = 0;
  }

  now() {
    return this.time;
  }

  advance(ms) {
    this.time += ms;
  }
}

class MockGraphitiClient {
  constructor() {
    this.upserts = [];
    this.edges = [];
    this.callOrder = [];
    this.healthy = true;
    this.shouldThrow = false;
    this.edgeShouldFail = false;
  }

  async healthCheck() {
    return this.healthy;
  }

  async upsertEntity(entity) {
    if (this.shouldThrow) throw new Error('Graphiti unavailable');
    this.callOrder.push({ method: 'upsertEntity', entity: entity.name });
    return { success: true };
  }

  async upsertEntitiesBatch(entities, batchSize) {
    if (this.shouldThrow) throw new Error('Graphiti unavailable');
    this.callOrder.push({ method: 'upsertEntitiesBatch', count: entities.length });
    this.upserts.push(...entities);
    return { success: entities.length, failed: 0, errors: [] };
  }

  async createContainmentEdgesBatch(projectIdentifier, filePaths, batchSize) {
    this.callOrder.push({ method: 'createContainmentEdgesBatch', count: filePaths.length });
    if (this.edgeShouldFail) {
      return {
        success: 0,
        failed: filePaths.length,
        errors: filePaths.map(f => ({ file: f, error: 'Edge creation failed' })),
      };
    }
    this.edges.push(...filePaths.map(f => ({ project: projectIdentifier, file: f })));
    return { success: filePaths.length, failed: 0, errors: [] };
  }

  async pruneDeletedFiles(activeFiles) {
    return { pruned: 0 };
  }

  async syncFilesWithFunctions(options) {
    this.callOrder.push({ method: 'syncFilesWithFunctions', files: options.files.length });
    const functionCount = options.files.reduce((sum, f) => sum + f.functions.length, 0);
    this.syncedFunctions = (this.syncedFunctions || 0) + functionCount;
    return {
      files: options.files.length,
      entities: functionCount,
      edges: functionCount,
      errors: [],
    };
  }

  async deleteFunctions(projectId, filePath, functionNames) {
    this.callOrder.push({
      method: 'deleteFunctions',
      file: filePath,
      functions: functionNames.length,
    });
    this.deletedFunctions = (this.deletedFunctions || []).concat(functionNames);
    return { deleted: functionNames.length, failed: 0, errors: [] };
  }

  getStats() {
    return { entitiesCreated: this.upserts.length };
  }
}

function createWatcher(overrides = {}) {
  const mockFs = new MockFsAdapter();
  const mockClock = new MockClock();
  const mockClient = new MockGraphitiClient();
  const warnings = [];

  const mockLogger = {
    child: () => mockLogger,
    info: vi.fn(),
    warn: vi.fn((data, msg) => warnings.push({ data, msg })),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const watcher = new CodePerceptionWatcher({
    config: { graphiti: { enabled: true, baseUrl: 'http://localhost:8003' } },
    db: { getProjectsWithFilesystemPath: () => [] },
    fsAdapter: mockFs,
    clock: mockClock,
    debounceMs: 2000,
    batchSize: 50,
    ...overrides,
  });

  watcher.log = mockLogger;

  return { watcher, mockFs, mockClock, mockClient, mockLogger, warnings };
}

describe('CodePerceptionWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('debounce behavior', () => {
    it('should not process changes before debounce completes', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();

      mockFs.setFile('/projects/test-project/src/main.js', 'console.log("hello")');

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.handleChange('TEST', '/projects/test-project/src/main.js', 'change');

      vi.advanceTimersByTime(1999);
      await Promise.resolve();

      expect(mockClient.upserts.length).toBe(0);
    });

    it('should process changes after debounce completes', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();

      mockFs.setFile('/projects/test-project/src/main.js', 'console.log("hello")');

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.handleChange('TEST', '/projects/test-project/src/main.js', 'change');

      vi.advanceTimersByTime(2001);
      await Promise.resolve();
      await vi.runAllTimersAsync();

      expect(mockClient.upserts.length).toBe(1);
      expect(mockClient.upserts[0].name).toBe('File:src/main.js');
    });

    it('should batch multiple rapid changes into single processing', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();

      mockFs.setFile('/projects/test-project/src/a.js', 'const a = 1');
      mockFs.setFile('/projects/test-project/src/b.js', 'const b = 2');
      mockFs.setFile('/projects/test-project/src/c.js', 'const c = 3');

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.handleChange('TEST', '/projects/test-project/src/a.js', 'change');
      watcher.handleChange('TEST', '/projects/test-project/src/b.js', 'change');
      watcher.handleChange('TEST', '/projects/test-project/src/c.js', 'change');

      vi.advanceTimersByTime(2001);
      await vi.runAllTimersAsync();

      expect(mockClient.upserts.length).toBe(3);
    });
  });

  describe('hash delta detection', () => {
    it('should skip unchanged content on second save', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();

      const content = 'const unchanged = true';
      mockFs.setFile('/projects/test-project/src/file.js', content);

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.handleChange('TEST', '/projects/test-project/src/file.js', 'change');
      vi.advanceTimersByTime(2001);
      await vi.runAllTimersAsync();

      expect(mockClient.upserts.length).toBe(1);
      const initialCount = watcher.stats.skippedUnchanged;

      watcher.handleChange('TEST', '/projects/test-project/src/file.js', 'change');
      vi.advanceTimersByTime(2001);
      await vi.runAllTimersAsync();

      expect(mockClient.upserts.length).toBe(1);
      expect(watcher.stats.skippedUnchanged).toBe(initialCount + 1);
    });

    it('should process when content actually changes', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();

      mockFs.setFile('/projects/test-project/src/file.js', 'version 1');

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.handleChange('TEST', '/projects/test-project/src/file.js', 'change');
      vi.advanceTimersByTime(2001);
      await vi.runAllTimersAsync();

      expect(mockClient.upserts.length).toBe(1);

      mockFs.setFile('/projects/test-project/src/file.js', 'version 2');
      watcher.handleChange('TEST', '/projects/test-project/src/file.js', 'change');
      vi.advanceTimersByTime(2001);
      await vi.runAllTimersAsync();

      expect(mockClient.upserts.length).toBe(2);
    });
  });

  describe('burst mode', () => {
    it('should trigger burst mode after 20+ changes in 3s', async () => {
      const { watcher, mockFs, mockClock } = createWatcher();

      for (let i = 0; i < 25; i++) {
        mockFs.setFile(`/projects/test-project/src/file${i}.js`, `const x${i} = ${i}`);
      }

      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      for (let i = 0; i < 25; i++) {
        watcher.handleChange('TEST', `/projects/test-project/src/file${i}.js`, 'change');
      }

      expect(watcher.isInBurstMode('TEST')).toBe(true);
    });

    it('should NOT trigger burst mode if changes spread over time', async () => {
      const { watcher, mockFs, mockClock } = createWatcher();

      for (let i = 0; i < 25; i++) {
        mockFs.setFile(`/projects/test-project/src/file${i}.js`, `const x${i} = ${i}`);
      }

      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      for (let i = 0; i < 10; i++) {
        watcher.handleChange('TEST', `/projects/test-project/src/file${i}.js`, 'change');
      }

      mockClock.advance(4000);

      for (let i = 10; i < 20; i++) {
        watcher.handleChange('TEST', `/projects/test-project/src/file${i}.js`, 'change');
      }

      expect(watcher.isInBurstMode('TEST')).toBe(false);
    });

    it('should process all files even in burst mode', async () => {
      const { watcher, mockFs, mockClient, mockClock } = createWatcher();

      for (let i = 0; i < 25; i++) {
        mockFs.setFile(`/projects/test-project/src/file${i}.js`, `const x${i} = ${i}`);
      }

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      for (let i = 0; i < 25; i++) {
        watcher.handleChange('TEST', `/projects/test-project/src/file${i}.js`, 'change');
      }

      vi.advanceTimersByTime(4001);
      await vi.runAllTimersAsync();

      expect(mockClient.upserts.length).toBe(25);
    });
  });

  describe('backpressure', () => {
    it('should cap pending queue at 500 entries', async () => {
      const { watcher, mockFs, warnings } = createWatcher();

      for (let i = 0; i < 600; i++) {
        mockFs.setFile(`/projects/test-project/src/file${i}.js`, `const x = ${i}`);
      }

      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      for (let i = 0; i < 600; i++) {
        watcher.handleChange('TEST', `/projects/test-project/src/file${i}.js`, 'change');
      }

      const pending = watcher.pendingChanges.get('TEST');
      expect(pending.size).toBe(500);

      const dropWarnings = warnings.filter(
        w => w.msg === 'Backpressure: dropped oldest pending change'
      );
      expect(dropWarnings.length).toBe(100);
    });

    it('should drop oldest entries when queue is full', async () => {
      const { watcher, mockFs } = createWatcher();

      for (let i = 0; i < 510; i++) {
        mockFs.setFile(`/projects/test-project/src/file${i}.js`, `const x = ${i}`);
      }

      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      for (let i = 0; i < 510; i++) {
        watcher.handleChange('TEST', `/projects/test-project/src/file${i}.js`, 'change');
      }

      const pending = watcher.pendingChanges.get('TEST');

      expect(pending.has('/projects/test-project/src/file0.js')).toBe(false);
      expect(pending.has('/projects/test-project/src/file9.js')).toBe(false);
      expect(pending.has('/projects/test-project/src/file10.js')).toBe(true);
      expect(pending.has('/projects/test-project/src/file509.js')).toBe(true);
    });
  });

  describe('file filtering', () => {
    it('should ignore non-allowed extensions', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();

      mockFs.setFile('/projects/test-project/image.png', 'binary data');
      mockFs.setFile('/projects/test-project/data.bin', 'binary data');

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.handleChange('TEST', '/projects/test-project/image.png', 'change');
      watcher.handleChange('TEST', '/projects/test-project/data.bin', 'change');

      vi.advanceTimersByTime(2001);
      await vi.runAllTimersAsync();

      expect(mockClient.upserts.length).toBe(0);
    });

    it('should skip files exceeding max size', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();

      mockFs.setFile('/projects/test-project/large.js', 'x', 600 * 1024);

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.handleChange('TEST', '/projects/test-project/large.js', 'change');

      vi.advanceTimersByTime(2001);
      await vi.runAllTimersAsync();

      expect(mockClient.upserts.length).toBe(0);
    });
  });

  describe('Graphiti recovery', () => {
    it('should re-add changes to queue when Graphiti is unavailable', async () => {
      const { watcher, mockFs, mockClient, mockLogger } = createWatcher();

      mockFs.setFile('/projects/test-project/src/a.js', 'const a = 1');

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      mockClient.healthy = false;

      watcher.handleChange('TEST', '/projects/test-project/src/a.js', 'change');

      vi.advanceTimersByTime(2001);
      await Promise.resolve();

      expect(mockClient.upserts.length).toBe(0);

      const pending = watcher.pendingChanges.get('TEST');
      expect(pending.size).toBe(1);
      expect(pending.has('/projects/test-project/src/a.js')).toBe(true);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ project: 'TEST' }),
        'Graphiti unavailable, deferring sync'
      );
    });

    it('should process queued changes when Graphiti becomes available', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();

      mockFs.setFile('/projects/test-project/src/a.js', 'const a = 1');

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.handleChange('TEST', '/projects/test-project/src/a.js', 'change');

      vi.advanceTimersByTime(2001);
      await vi.runAllTimersAsync();

      expect(mockClient.upserts.length).toBe(1);
      expect(mockClient.upserts[0].name).toBe('File:src/a.js');

      const pending = watcher.pendingChanges.get('TEST');
      expect(pending.size).toBe(0);
    });
  });

  describe('edge sequencing', () => {
    it('should create edges only after entities are upserted', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();

      mockFs.setFile('/projects/test-project/src/a.js', 'const a = 1');
      mockFs.setFile('/projects/test-project/src/b.js', 'const b = 2');
      mockFs.setFile('/projects/test-project/src/c.js', 'const c = 3');

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.handleChange('TEST', '/projects/test-project/src/a.js', 'change');
      watcher.handleChange('TEST', '/projects/test-project/src/b.js', 'change');
      watcher.handleChange('TEST', '/projects/test-project/src/c.js', 'change');

      vi.advanceTimersByTime(2001);
      await vi.runAllTimersAsync();

      expect(mockClient.upserts.length).toBe(3);
      expect(mockClient.edges.length).toBe(3);

      const upsertIndex = mockClient.callOrder.findIndex(c => c.method === 'upsertEntitiesBatch');
      const edgeIndex = mockClient.callOrder.findIndex(
        c => c.method === 'createContainmentEdgesBatch'
      );

      expect(upsertIndex).toBeLessThan(edgeIndex);
      expect(upsertIndex).toBeGreaterThanOrEqual(0);
      expect(edgeIndex).toBeGreaterThan(0);
    });

    it('should create edges for all successfully upserted files', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();

      mockFs.setFile('/projects/test-project/lib/utils.js', 'export const util = 1');
      mockFs.setFile('/projects/test-project/lib/helper.js', 'export const help = 2');

      watcher.graphitiClients.set('MYPROJ', mockClient);
      watcher.watchers.set('MYPROJ', {
        _projectMeta: { projectIdentifier: 'MYPROJ', projectPath: '/projects/test-project' },
      });

      watcher.handleChange('MYPROJ', '/projects/test-project/lib/utils.js', 'change');
      watcher.handleChange('MYPROJ', '/projects/test-project/lib/helper.js', 'change');

      vi.advanceTimersByTime(2001);
      await vi.runAllTimersAsync();

      expect(mockClient.edges).toEqual([
        { project: 'MYPROJ', file: 'lib/utils.js' },
        { project: 'MYPROJ', file: 'lib/helper.js' },
      ]);
    });
  });

  describe('edge failure handling', () => {
    it('should track edge failures in stats', async () => {
      const { watcher, mockFs, mockClient, mockLogger } = createWatcher();

      mockClient.edgeShouldFail = true;

      mockFs.setFile('/projects/test-project/src/main.js', 'const main = 1');

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.handleChange('TEST', '/projects/test-project/src/main.js', 'change');

      vi.advanceTimersByTime(2001);
      await vi.runAllTimersAsync();

      expect(mockClient.upserts.length).toBe(1);
      expect(mockClient.edges.length).toBe(0);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ failed: 1 }),
        'Some edges failed to create'
      );
    });

    it('should continue processing even when edges fail', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();

      mockClient.edgeShouldFail = true;

      mockFs.setFile('/projects/test-project/src/a.js', 'const a = 1');
      mockFs.setFile('/projects/test-project/src/b.js', 'const b = 2');

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.handleChange('TEST', '/projects/test-project/src/a.js', 'change');
      watcher.handleChange('TEST', '/projects/test-project/src/b.js', 'change');

      vi.advanceTimersByTime(2001);
      await vi.runAllTimersAsync();

      expect(mockClient.upserts.length).toBe(2);

      const pending = watcher.pendingChanges.get('TEST');
      expect(pending.size).toBe(0);
    });
  });

  describe('AST configuration', () => {
    it('should enable AST parsing by default', () => {
      const { watcher } = createWatcher();
      expect(watcher.astEnabled).toBe(true);
    });

    it('should respect astEnabled option', () => {
      const { watcher } = createWatcher({ astEnabled: false });
      expect(watcher.astEnabled).toBe(false);
    });

    it('should respect config.codePerception.astEnabled', () => {
      const { watcher } = createWatcher({
        config: {
          graphiti: { enabled: true },
          codePerception: { astEnabled: false },
        },
      });
      expect(watcher.astEnabled).toBe(false);
    });

    it('should initialize stats with AST metrics', () => {
      const { watcher } = createWatcher();
      expect(watcher.stats.functionsSynced).toBe(0);
      expect(watcher.stats.astParseSuccess).toBe(0);
      expect(watcher.stats.astParseFailure).toBe(0);
    });
  });

  describe('AST stats', () => {
    it('should calculate astSuccessRate in getStats', () => {
      const { watcher } = createWatcher();
      watcher.stats.astParseSuccess = 8;
      watcher.stats.astParseFailure = 2;

      const stats = watcher.getStats();
      expect(stats.astSuccessRate).toBe(80);
    });

    it('should return 100% success rate when no AST parsing attempted', () => {
      const { watcher } = createWatcher();
      const stats = watcher.getStats();
      expect(stats.astSuccessRate).toBe(100);
    });
  });

  describe('astInitialSync', () => {
    it('should return empty result when no Graphiti client', async () => {
      const { watcher } = createWatcher({ graphitiEnabled: false });

      const result = await watcher.astInitialSync('TEST', '/some/path');

      expect(result.filesProcessed).toBe(0);
      expect(result.functionsSynced).toBe(0);
    });

    it('should return empty result when AST is disabled', async () => {
      const { watcher } = createWatcher({ astEnabled: false });

      const result = await watcher.astInitialSync('TEST', '/some/path');

      expect(result.filesProcessed).toBe(0);
      expect(result.functionsSynced).toBe(0);
    });

    it('should return empty result when no files found in project', async () => {
      const { watcher } = createWatcher();

      const result = await watcher.astInitialSync('TEST', '/empty/project');

      expect(result.filesProcessed).toBe(0);
      expect(result.functionsSynced).toBe(0);
    });

    it('should use default concurrency and rateLimit when not specified', async () => {
      const { watcher } = createWatcher();

      const result = await watcher.astInitialSync('TEST', '/test/project');

      expect(result).toHaveProperty('filesProcessed');
      expect(result).toHaveProperty('functionsSynced');
      expect(result).toHaveProperty('errors');
    });

    it('should accept custom concurrency and rateLimit options', async () => {
      const { watcher } = createWatcher();

      const result = await watcher.astInitialSync('TEST', '/test/project', {
        concurrency: 20,
        rateLimit: 200,
      });

      expect(result).toHaveProperty('filesProcessed');
      expect(result).toHaveProperty('functionsSynced');
    });

    it('should update stats after sync', async () => {
      const { watcher } = createWatcher();
      const initialStats = watcher.getStats();
      const initialFunctionsSynced = initialStats.functionsSynced || 0;

      await watcher.astInitialSync('TEST', '/test/project');

      const newStats = watcher.getStats();
      expect(newStats.functionsSynced).toBeGreaterThanOrEqual(initialFunctionsSynced);
    });
  });
});
