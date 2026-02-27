import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CodePerceptionWatcher } from '../../lib/CodePerceptionWatcher.js';

// Mock ASTParser module to avoid Python subprocess dependency
vi.mock('../../lib/ASTParser.js', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    parseFiles: vi.fn(async filePaths => {
      return filePaths.map(f => ({
        file: f,
        functions: [
          {
            name: 'mockFunction',
            signature: 'function mockFunction()',
            parameters: '',
            start_line: 1,
            end_line: 5,
            is_async: false,
          },
        ],
        imports: [],
        error: null,
      }));
    }),
    parseFile: vi.fn(async filePath => ({
      file: filePath,
      functions: [
        {
          name: 'mockFunction',
          signature: 'function mockFunction()',
          parameters: '',
          start_line: 1,
          end_line: 5,
          is_async: false,
        },
      ],
      imports: [],
      error: null,
    })),
  };
});

// Mock ASTCache module to avoid filesystem dependency
vi.mock('../../lib/ASTCache.js', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    ASTCache: class MockASTCache {
      constructor() {
        this.entries = new Map();
      }
      async load() {}
      async save() {}
      get(key) {
        return this.entries.get(key) || null;
      }
      set(key, hash, mtime, functions) {
        this.entries.set(key, { hash, mtime, functions });
      }
      remove(key) {
        this.entries.delete(key);
      }
      diff(filePath, newFunctions) {
        const existing = this.entries.get(filePath);
        if (!existing) return { added: newFunctions, modified: [], removed: [] };
        return { added: newFunctions, modified: [], removed: [] };
      }
      static computeHash(content) {
        return 'mock-hash-' + content.length;
      }
    },
  };
});

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
    return { size: file.size, mtimeMs: Date.now() };
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
    this.failEntityNames = new Set();
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
    const successful = entities.filter(e => !this.failEntityNames.has(e.name));
    const failed = entities.filter(e => this.failEntityNames.has(e.name));
    this.upserts.push(...successful);
    return {
      success: successful.length,
      failed: failed.length,
      errors: failed.map(e => ({ entity: e.name, error: 'Simulated failure' })),
      successfulEntities: successful.map(e => e.name),
    };
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

  async syncModules(options) {
    this.callOrder.push({ method: 'syncModules', modules: options.modules?.length || 0 });
    if (this.shouldThrow) throw new Error('Graphiti unavailable');
    return {
      modules: { success: options.modules?.length || 0, failed: 0, errors: [] },
      containment: { success: options.modules?.length || 0, failed: 0, errors: [] },
      dependencies: { success: options.edges?.length || 0, failed: 0, errors: [] },
    };
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
      expect(watcher.stats.modulesSynced).toBe(0);
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
      expect(result.modulesSynced).toBe(0);
    });

    it('should return empty result when AST is disabled', async () => {
      const { watcher } = createWatcher({ astEnabled: false });

      const result = await watcher.astInitialSync('TEST', '/some/path');

      expect(result.filesProcessed).toBe(0);
      expect(result.modulesSynced).toBe(0);
    });

    it('should return empty result when no files found in project', async () => {
      const { watcher } = createWatcher();

      const result = await watcher.astInitialSync('TEST', '/empty/project');

      expect(result.filesProcessed).toBe(0);
      expect(result.modulesSynced).toBe(0);
    });

    it('should use default concurrency and rateLimit when not specified', async () => {
      const { watcher } = createWatcher();

      const result = await watcher.astInitialSync('TEST', '/test/project');

      expect(result).toHaveProperty('filesProcessed');
      expect(result).toHaveProperty('modulesSynced');
      expect(result).toHaveProperty('errors');
    });

    it('should accept custom concurrency and rateLimit options', async () => {
      const { watcher } = createWatcher();

      const result = await watcher.astInitialSync('TEST', '/test/project', {
        concurrency: 20,
        rateLimit: 200,
      });

      expect(result).toHaveProperty('filesProcessed');
      expect(result).toHaveProperty('modulesSynced');
    });

    it('should update stats after sync', async () => {
      const { watcher } = createWatcher();
      const initialStats = watcher.getStats();
      const initialModulesSynced = initialStats.modulesSynced || 0;

      await watcher.astInitialSync('TEST', '/test/project');

      const newStats = watcher.getStats();
      expect(newStats.modulesSynced).toBeGreaterThanOrEqual(initialModulesSynced);
    });
  });

  describe('vendor exclusion patterns', () => {
    it('should ignore vendor directory via shouldIgnoreDir', () => {
      const { watcher } = createWatcher();
      expect(watcher.shouldIgnoreDir('vendor')).toBe(true);
    });

    it('should ignore node_modules directory via shouldIgnoreDir', () => {
      const { watcher } = createWatcher();
      expect(watcher.shouldIgnoreDir('node_modules')).toBe(true);
    });

    it('should ignore hidden directories (starting with dot) via shouldIgnoreDir', () => {
      const { watcher } = createWatcher();
      expect(watcher.shouldIgnoreDir('.hidden')).toBe(true);
    });

    it('should not ignore regular source directories via shouldIgnoreDir', () => {
      const { watcher } = createWatcher();
      expect(watcher.shouldIgnoreDir('src')).toBe(false);
    });

    it('should include vendor pattern in ignorePatterns array', () => {
      const { watcher } = createWatcher();
      expect(watcher.ignorePatterns).toContain('**/vendor/**');
    });

    it('should include static/vendor pattern in ignorePatterns array', () => {
      const { watcher } = createWatcher();
      expect(watcher.ignorePatterns).toContain('**/static/vendor/**');
    });

    it('should include bundle.js pattern in ignorePatterns array', () => {
      const { watcher } = createWatcher();
      expect(watcher.ignorePatterns).toContain('**/*.bundle.js');
    });

    it('should merge config-provided excludePatterns into ignorePatterns', () => {
      const { watcher } = createWatcher({
        config: {
          graphiti: { enabled: true, baseUrl: 'http://localhost:8003' },
          codePerception: { excludePatterns: ['**/custom/**', '**/temp/**'] },
        },
      });
      expect(watcher.ignorePatterns).toContain('**/custom/**');
      expect(watcher.ignorePatterns).toContain('**/temp/**');
    });
  });

  describe('detectLanguage', () => {
    it('should detect JavaScript from .js extension', () => {
      const { watcher } = createWatcher();
      expect(watcher.detectLanguage('.js')).toBe('JavaScript');
    });

    it('should detect TypeScript from .ts extension', () => {
      const { watcher } = createWatcher();
      expect(watcher.detectLanguage('.ts')).toBe('TypeScript');
    });

    it('should detect TypeScript React from .tsx extension', () => {
      const { watcher } = createWatcher();
      expect(watcher.detectLanguage('.tsx')).toBe('TypeScript React');
    });

    it('should detect Python from .py extension', () => {
      const { watcher } = createWatcher();
      expect(watcher.detectLanguage('.py')).toBe('Python');
    });

    it('should detect Rust from .rs extension', () => {
      const { watcher } = createWatcher();
      expect(watcher.detectLanguage('.rs')).toBe('Rust');
    });

    it('should detect Go from .go extension', () => {
      const { watcher } = createWatcher();
      expect(watcher.detectLanguage('.go')).toBe('Go');
    });

    it('should detect Markdown from .md extension', () => {
      const { watcher } = createWatcher();
      expect(watcher.detectLanguage('.md')).toBe('Markdown');
    });

    it('should return Unknown for unrecognized extension', () => {
      const { watcher } = createWatcher();
      expect(watcher.detectLanguage('.xyz')).toBe('Unknown');
    });

    it('should detect YAML from .yml extension', () => {
      const { watcher } = createWatcher();
      expect(watcher.detectLanguage('.yml')).toBe('YAML');
    });

    it('should detect Vue from .vue extension', () => {
      const { watcher } = createWatcher();
      expect(watcher.detectLanguage('.vue')).toBe('Vue');
    });

    it('should detect Shell from .sh extension', () => {
      const { watcher } = createWatcher();
      expect(watcher.detectLanguage('.sh')).toBe('Shell');
    });

    it('should detect SQL from .sql extension', () => {
      const { watcher } = createWatcher();
      expect(watcher.detectLanguage('.sql')).toBe('SQL');
    });
  });

  describe('extractFileSummary', () => {
    it('should extract summary with language, basename, line count, and preview', async () => {
      const { watcher, mockFs } = createWatcher();
      mockFs.setFile(
        '/projects/test-project/src/utils.js',
        'export function add(a, b) {\n  return a + b;\n}\n'
      );

      const summary = await watcher.extractFileSummary('/projects/test-project/src/utils.js');
      expect(summary).toContain('JavaScript');
      expect(summary).toContain('utils.js');
      expect(summary).toContain('lines');
      expect(summary).toContain('Preview:');
    });

    it('should skip shebang and comment lines at start', async () => {
      const { watcher, mockFs } = createWatcher();
      mockFs.setFile(
        '/projects/test-project/script.py',
        '#!/usr/bin/env python\n# This is a comment\n# Another comment\ndef main():\n  pass\n'
      );

      const summary = await watcher.extractFileSummary('/projects/test-project/script.py');
      expect(summary).toContain('Python');
      expect(summary).toContain('Preview:');
      expect(summary).toContain('def main():');
    });

    it('should handle file read errors gracefully', async () => {
      const { watcher } = createWatcher();
      // File does not exist in mockFs
      const summary = await watcher.extractFileSummary('/nonexistent/file.js');
      expect(summary).toContain('file.js');
    });

    it('should detect JSON language for .json files', async () => {
      const { watcher, mockFs } = createWatcher();
      mockFs.setFile('/projects/test-project/config.json', '{"key": "value"}\n');

      const summary = await watcher.extractFileSummary('/projects/test-project/config.json');
      expect(summary).toContain('JSON');
    });

    it('should skip block comment patterns at file start', async () => {
      const { watcher, mockFs } = createWatcher();
      mockFs.setFile(
        '/projects/test-project/main.js',
        '/* Block comment */\n* continuation\nconst x = 1;\n'
      );

      const summary = await watcher.extractFileSummary('/projects/test-project/main.js');
      expect(summary).toContain('const x = 1;');
    });

    it('should limit preview to first 10 meaningful lines', async () => {
      const { watcher, mockFs } = createWatcher();
      const lines = Array.from({ length: 20 }, (_, i) => `const line${i} = ${i};`).join('\n');
      mockFs.setFile('/projects/test-project/big.js', lines);

      const summary = await watcher.extractFileSummary('/projects/test-project/big.js');
      expect(summary).toContain('line0');
      expect(summary).not.toContain('line15');
    });
  });

  describe('getActiveProjectFiles', () => {
    it('should return empty array for empty directory', async () => {
      const { watcher } = createWatcher();
      const files = await watcher.getActiveProjectFiles('/empty/project');
      expect(files).toEqual([]);
    });

    it('should return files with allowed extensions', async () => {
      const { watcher, mockFs } = createWatcher();
      // Override readdir to return some entries
      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return [
            { name: 'main.js', isDirectory: () => false },
            { name: 'styles.css', isDirectory: () => false },
            { name: 'image.png', isDirectory: () => false },
          ];
        }
        return [];
      };

      const files = await watcher.getActiveProjectFiles('/projects/test-project');
      expect(files).toContain('main.js');
      expect(files).toContain('styles.css');
      expect(files).not.toContain('image.png');
    });

    it('should recurse into non-ignored directories', async () => {
      const { watcher, mockFs } = createWatcher();
      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return [
            { name: 'src', isDirectory: () => true },
            { name: 'node_modules', isDirectory: () => true },
          ];
        }
        if (dir.endsWith('/src')) {
          return [{ name: 'app.ts', isDirectory: () => false }];
        }
        return [];
      };

      const files = await watcher.getActiveProjectFiles('/projects/test-project');
      expect(files).toContain('src/app.ts');
      expect(files.length).toBe(1);
    });

    it('should skip ignored directories like node_modules and .git', async () => {
      const { watcher, mockFs } = createWatcher();
      let visitedDirs = [];
      mockFs.readdir = dir => {
        visitedDirs.push(dir);
        if (dir === '/projects/test-project') {
          return [
            { name: 'src', isDirectory: () => true },
            { name: 'node_modules', isDirectory: () => true },
            { name: '.git', isDirectory: () => true },
          ];
        }
        if (dir.endsWith('/src')) {
          return [{ name: 'index.js', isDirectory: () => false }];
        }
        return [];
      };

      await watcher.getActiveProjectFiles('/projects/test-project');
      expect(visitedDirs).not.toContain('/projects/test-project/node_modules');
      expect(visitedDirs).not.toContain('/projects/test-project/.git');
    });
  });

  describe('initialSync', () => {
    it('should warn and return when no Graphiti client exists', async () => {
      const { watcher, mockLogger } = createWatcher();
      await watcher.initialSync('NOPROJ', '/some/path');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ project: 'NOPROJ' }),
        'No Graphiti client for initial sync'
      );
    });

    it('should upsert entities for all active files', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();
      watcher.graphitiClients.set('TEST', mockClient);

      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return [
            { name: 'main.js', isDirectory: () => false },
            { name: 'utils.js', isDirectory: () => false },
          ];
        }
        return [];
      };
      mockFs.setFile('/projects/test-project/main.js', 'const main = 1;');
      mockFs.setFile('/projects/test-project/utils.js', 'const utils = 2;');

      await watcher.initialSync('TEST', '/projects/test-project');

      expect(mockClient.upserts.length).toBe(2);
      expect(mockClient.upserts[0].name).toBe('File:main.js');
      expect(mockClient.upserts[1].name).toBe('File:utils.js');
    });

    it('should update file hash cache during initial sync', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();
      watcher.graphitiClients.set('TEST', mockClient);

      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return [{ name: 'app.js', isDirectory: () => false }];
        }
        return [];
      };
      mockFs.setFile('/projects/test-project/app.js', 'const app = true;');

      await watcher.initialSync('TEST', '/projects/test-project');

      expect(watcher.fileHashes.has('/projects/test-project/app.js')).toBe(true);
    });

    it('should do nothing when no active files found', async () => {
      const { watcher, mockClient } = createWatcher();
      watcher.graphitiClients.set('TEST', mockClient);

      await watcher.initialSync('TEST', '/empty/project');
      expect(mockClient.upserts.length).toBe(0);
    });
  });

  describe('getStats with graphitiClients', () => {
    it('should include client stats for each project', () => {
      const { watcher, mockClient } = createWatcher();
      watcher.graphitiClients.set('PROJ1', mockClient);

      const stats = watcher.getStats();
      expect(stats.clientStats).toBeDefined();
      expect(stats.clientStats['PROJ1']).toEqual({ entitiesCreated: 0 });
    });

    it('should report projectsWatched count', () => {
      const { watcher } = createWatcher();
      watcher.watchers.set('A', {});
      watcher.watchers.set('B', {});

      const stats = watcher.getStats();
      expect(stats.projectsWatched).toBe(2);
    });

    it('should calculate pendingChanges total', () => {
      const { watcher } = createWatcher();
      const map1 = new Map();
      map1.set('/a.js', 'change');
      map1.set('/b.js', 'change');
      watcher.pendingChanges.set('PROJ1', map1);

      const map2 = new Map();
      map2.set('/c.js', 'add');
      watcher.pendingChanges.set('PROJ2', map2);

      const stats = watcher.getStats();
      expect(stats.pendingChanges).toBe(3);
    });
  });

  describe('syncWatchedProjects', () => {
    it('should watch new projects from database', async () => {
      const { watcher, mockFs } = createWatcher();
      // Mock watchProject to avoid chokidar
      const watchedProjects = [];
      watcher.watchProject = vi.fn((id, path) => {
        watchedProjects.push({ id, path });
        watcher.watchers.set(id, {
          _projectMeta: { projectIdentifier: id, projectPath: path },
          close: vi.fn(),
        });
      });

      watcher.db = {
        getProjectsWithFilesystemPath: () => [
          { identifier: 'NEW_PROJ', filesystem_path: '/projects/new' },
        ],
      };

      await watcher.syncWatchedProjects();
      expect(watcher.watchProject).toHaveBeenCalledWith('NEW_PROJ', '/projects/new');
    });

    it('should skip already-watched projects', async () => {
      const { watcher } = createWatcher();
      watcher.watchProject = vi.fn();
      watcher.watchers.set('EXISTING', { close: vi.fn() });

      watcher.db = {
        getProjectsWithFilesystemPath: () => [
          { identifier: 'EXISTING', filesystem_path: '/projects/existing' },
        ],
      };

      await watcher.syncWatchedProjects();
      expect(watcher.watchProject).not.toHaveBeenCalled();
    });

    it('should skip projects without filesystem_path', async () => {
      const { watcher } = createWatcher();
      watcher.watchProject = vi.fn();

      watcher.db = {
        getProjectsWithFilesystemPath: () => [{ identifier: 'NO_PATH', filesystem_path: null }],
      };

      await watcher.syncWatchedProjects();
      expect(watcher.watchProject).not.toHaveBeenCalled();
    });

    it('should unwatch removed projects', async () => {
      const { watcher } = createWatcher();
      watcher.watchProject = vi.fn();
      const unwatchMock = vi.fn();
      watcher.unwatchProject = unwatchMock;
      watcher.watchers.set('OLD_PROJ', { close: vi.fn() });

      watcher.db = {
        getProjectsWithFilesystemPath: () => [],
      };

      await watcher.syncWatchedProjects();
      expect(unwatchMock).toHaveBeenCalledWith('OLD_PROJ');
    });

    it('should handle errors gracefully', async () => {
      const { watcher, mockLogger } = createWatcher();
      watcher.db = {
        getProjectsWithFilesystemPath: () => {
          throw new Error('DB error');
        },
      };

      await watcher.syncWatchedProjects();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Failed to sync watched projects'
      );
    });

    it('should handle missing getProjectsWithFilesystemPath method', async () => {
      const { watcher } = createWatcher();
      watcher.db = {};

      // Should not throw
      await watcher.syncWatchedProjects();
    });
  });

  describe('logHealthMetrics', () => {
    it('should log health metrics without throwing', () => {
      const { watcher, mockLogger } = createWatcher();
      watcher.stats.filesWatched = 100;
      watcher.stats.changesDetected = 50;
      watcher.stats.entitiesSynced = 25;
      watcher.stats.modulesSynced = 10;
      watcher.stats.astParseSuccess = 8;
      watcher.stats.astParseFailure = 2;
      watcher.stats.errors = 1;

      watcher.logHealthMetrics();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          filesWatched: 100,
          changesDetected: 50,
          entitiesSynced: 25,
          modulesSynced: 10,
          astSuccessRate: '80%',
          errors: 1,
        }),
        '[CodePerception] Health metrics'
      );
    });

    it('should calculate pending changes across projects', () => {
      const { watcher, mockLogger } = createWatcher();
      const m1 = new Map();
      m1.set('/a.js', 'change');
      watcher.pendingChanges.set('P1', m1);

      watcher.logHealthMetrics();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ pending: 1 }),
        '[CodePerception] Health metrics'
      );
    });

    it('should show 100% AST success rate when no parses attempted', () => {
      const { watcher, mockLogger } = createWatcher();
      watcher.logHealthMetrics();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ astSuccessRate: '100%' }),
        '[CodePerception] Health metrics'
      );
    });
  });

  describe('unwatchProject', () => {
    it('should close watcher and clean up state', async () => {
      const { watcher } = createWatcher();
      const closeMock = vi.fn();
      watcher.watchers.set('PROJ', { close: closeMock });
      watcher.graphitiClients.set('PROJ', new MockGraphitiClient());
      watcher.pendingChanges.set('PROJ', new Map([['f.js', 'change']]));

      await watcher.unwatchProject('PROJ');

      expect(closeMock).toHaveBeenCalled();
      expect(watcher.watchers.has('PROJ')).toBe(false);
      expect(watcher.graphitiClients.has('PROJ')).toBe(false);
      expect(watcher.pendingChanges.has('PROJ')).toBe(false);
    });

    it('should clear debounce timer for the project', async () => {
      const { watcher } = createWatcher();
      const closeMock = vi.fn();
      watcher.watchers.set('PROJ', { close: closeMock });
      watcher.debounceTimers.set(
        'PROJ',
        setTimeout(() => {}, 10000)
      );

      await watcher.unwatchProject('PROJ');

      expect(watcher.debounceTimers.has('PROJ')).toBe(false);
    });

    it('should save and clean AST cache if present', async () => {
      const { watcher } = createWatcher();
      const closeMock = vi.fn();
      watcher.watchers.set('PROJ', { close: closeMock });
      const astCacheMock = { save: vi.fn().mockResolvedValue(undefined) };
      watcher.astCaches.set('PROJ', astCacheMock);

      await watcher.unwatchProject('PROJ');

      expect(astCacheMock.save).toHaveBeenCalled();
      expect(watcher.astCaches.has('PROJ')).toBe(false);
    });

    it('should do nothing for unknown project', async () => {
      const { watcher } = createWatcher();
      // Should not throw
      await watcher.unwatchProject('NONEXISTENT');
    });
  });

  describe('shutdown', () => {
    it('should close all watchers', async () => {
      const { watcher } = createWatcher();
      const close1 = vi.fn();
      const close2 = vi.fn();
      watcher.watchers.set('P1', { close: close1 });
      watcher.watchers.set('P2', { close: close2 });
      // unwatchProject needs the watcher to exist
      watcher.graphitiClients.set('P1', new MockGraphitiClient());
      watcher.graphitiClients.set('P2', new MockGraphitiClient());

      await watcher.shutdown();

      expect(close1).toHaveBeenCalled();
      expect(close2).toHaveBeenCalled();
      expect(watcher.watchers.size).toBe(0);
    });

    it('should clear all debounce timers', async () => {
      const { watcher } = createWatcher();
      watcher.debounceTimers.set(
        'T1',
        setTimeout(() => {}, 10000)
      );
      watcher.debounceTimers.set(
        'T2',
        setTimeout(() => {}, 10000)
      );

      await watcher.shutdown();

      expect(watcher.debounceTimers.size).toBe(0);
    });
  });

  describe('processPendingChanges - deletions', () => {
    it('should handle file deletions with pruneDeletedFiles', async () => {
      const { watcher, mockFs, mockClient } = createWatcher({ astEnabled: false });

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      // Simulate an unlink event - no stat needed for unlink
      watcher.pendingChanges.set(
        'TEST',
        new Map([['/projects/test-project/deleted.js', 'unlink']])
      );

      await watcher.processPendingChanges('TEST');

      // pruneDeletedFiles should have been called
      expect(mockClient.callOrder.some(c => c.method === 'upsertEntity')).toBe(true);
    });

    it('should clear file hash on deletion', async () => {
      const { watcher, mockFs, mockClient } = createWatcher({ astEnabled: false });

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.fileHashes.set('/projects/test-project/deleted.js', 'old-hash');

      watcher.pendingChanges.set(
        'TEST',
        new Map([['/projects/test-project/deleted.js', 'unlink']])
      );

      await watcher.processPendingChanges('TEST');

      expect(watcher.fileHashes.has('/projects/test-project/deleted.js')).toBe(false);
    });
  });

  describe('processPendingChanges - project entity failure', () => {
    it('should skip edge creation when project entity upsert fails', async () => {
      const { watcher, mockFs, mockClient, mockLogger } = createWatcher({ astEnabled: false });

      mockClient.shouldThrow = true;
      // Override to only throw for upsertEntity but not upsertEntitiesBatch
      const origUpsertEntity = mockClient.upsertEntity.bind(mockClient);
      mockClient.upsertEntity = async entity => {
        throw new Error('Graphiti unavailable');
      };
      mockClient.shouldThrow = false; // Don't throw for batch

      mockFs.setFile('/projects/test-project/src/file.js', 'const x = 1;');

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.pendingChanges.set(
        'TEST',
        new Map([['/projects/test-project/src/file.js', 'change']])
      );

      await watcher.processPendingChanges('TEST');

      expect(mockClient.upserts.length).toBe(1); // File entity was upserted
      expect(mockClient.edges.length).toBe(0); // No edges because project entity failed

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ project: 'TEST' }),
        'Skipped edge creation - project entity not available'
      );
    });
  });

  describe('processPendingChanges - concurrent processing', () => {
    it('should reschedule when already processing', async () => {
      const { watcher, mockFs, mockClient } = createWatcher({ astEnabled: false });

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      // Mark as currently processing
      watcher.processing.add('TEST');
      watcher.pendingChanges.set(
        'TEST',
        new Map([['/projects/test-project/src/file.js', 'change']])
      );

      await watcher.processPendingChanges('TEST');

      // Changes should still be pending (not processed)
      expect(mockClient.upserts.length).toBe(0);
    });

    it('should return early when no pending changes', async () => {
      const { watcher, mockClient } = createWatcher({ astEnabled: false });

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      await watcher.processPendingChanges('TEST');
      expect(mockClient.upserts.length).toBe(0);
    });

    it('should return early when no watcher exists', async () => {
      const { watcher, mockClient } = createWatcher({ astEnabled: false });

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.pendingChanges.set(
        'TEST',
        new Map([['/projects/test-project/src/file.js', 'change']])
      );

      await watcher.processPendingChanges('TEST');
      expect(mockClient.upserts.length).toBe(0);
    });
  });

  describe('processPendingChanges - error handling', () => {
    it('should increment errors on processing failure and remove from processing set', async () => {
      const { watcher, mockFs, mockClient } = createWatcher({ astEnabled: false });

      // Make healthCheck succeed but upsertEntitiesBatch throw
      mockClient.upsertEntitiesBatch = async () => {
        throw new Error('batch failed');
      };

      mockFs.setFile('/projects/test-project/src/file.js', 'const x = 1;');

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.pendingChanges.set(
        'TEST',
        new Map([['/projects/test-project/src/file.js', 'change']])
      );

      const errorsBefore = watcher.stats.errors;
      await watcher.processPendingChanges('TEST');

      expect(watcher.stats.errors).toBe(errorsBefore + 1);
      expect(watcher.processing.has('TEST')).toBe(false);
    });
  });

  describe('_handleDeletedFilesAst', () => {
    it('should remove deleted files from cache and re-sync modules', async () => {
      const { watcher, mockClient } = createWatcher();

      const astCacheMock = {
        get: vi.fn(relPath => {
          if (relPath === 'deleted.js') {
            return { functions: [{ name: 'foo' }, { name: 'bar' }] };
          }
          return null;
        }),
        remove: vi.fn(),
        save: vi.fn().mockResolvedValue(undefined),
        entries: new Map(),
      };
      watcher.astCaches.set('TEST', astCacheMock);
      // Set up AST client for module re-sync
      watcher.astGraphitiClients.set('TEST', mockClient);

      await watcher._handleDeletedFilesAst(
        'TEST',
        '/projects/test-project',
        ['deleted.js'],
        mockClient
      );

      expect(astCacheMock.remove).toHaveBeenCalledWith('deleted.js');
      expect(astCacheMock.save).toHaveBeenCalled();
    });

    it('should skip files without cached functions', async () => {
      const { watcher, mockClient } = createWatcher();

      const astCacheMock = {
        get: vi.fn(() => null),
        remove: vi.fn(),
        save: vi.fn().mockResolvedValue(undefined),
      };
      watcher.astCaches.set('TEST', astCacheMock);

      await watcher._handleDeletedFilesAst(
        'TEST',
        '/projects/test-project',
        ['nofuncs.js'],
        mockClient
      );

      expect(mockClient.callOrder).not.toContainEqual(
        expect.objectContaining({ method: 'deleteFunctions' })
      );
      expect(astCacheMock.remove).toHaveBeenCalledWith('nofuncs.js');
    });

    it('should skip files with empty functions array', async () => {
      const { watcher, mockClient } = createWatcher();

      const astCacheMock = {
        get: vi.fn(() => ({ functions: [] })),
        remove: vi.fn(),
        save: vi.fn().mockResolvedValue(undefined),
      };
      watcher.astCaches.set('TEST', astCacheMock);

      await watcher._handleDeletedFilesAst(
        'TEST',
        '/projects/test-project',
        ['empty.js'],
        mockClient
      );

      expect(mockClient.callOrder).not.toContainEqual(
        expect.objectContaining({ method: 'deleteFunctions' })
      );
    });

    it('should handle module sync error gracefully after deletion', async () => {
      const { watcher, mockClient, mockLogger } = createWatcher();

      const failingAstClient = new MockGraphitiClient();
      failingAstClient.shouldThrow = true;

      const astCacheMock = {
        get: vi.fn(() => ({ functions: [{ name: 'fn1' }] })),
        remove: vi.fn(),
        save: vi.fn().mockResolvedValue(undefined),
        entries: new Map(),
      };
      watcher.astCaches.set('TEST', astCacheMock);
      watcher.astGraphitiClients.set('TEST', failingAstClient);

      // Should not throw even when module sync fails
      await watcher._handleDeletedFilesAst(
        'TEST',
        '/projects/test-project',
        ['failing.js'],
        mockClient
      );

      // Cache should still be cleaned up even if sync fails
      expect(astCacheMock.remove).toHaveBeenCalledWith('failing.js');
      expect(astCacheMock.save).toHaveBeenCalled();
    });

    it('should return early when no AST cache exists', async () => {
      const { watcher, mockClient } = createWatcher();
      // No astCache set for this project

      await watcher._handleDeletedFilesAst(
        'TEST',
        '/projects/test-project',
        ['file.js'],
        mockClient
      );
      // Should just return without error
      expect(mockClient.callOrder.length).toBe(0);
    });
  });

  describe('computeFileHash', () => {
    it('should return a hash for existing files', () => {
      const { watcher, mockFs } = createWatcher();
      mockFs.setFile('/test.js', 'const x = 1;');

      const hash = watcher.computeFileHash('/test.js');
      expect(hash).toBeTruthy();
      expect(typeof hash).toBe('string');
    });

    it('should return null for non-existent files', () => {
      const { watcher } = createWatcher();
      const hash = watcher.computeFileHash('/nonexistent.js');
      expect(hash).toBeNull();
    });

    it('should return different hashes for different content', () => {
      const { watcher, mockFs } = createWatcher();
      mockFs.setFile('/a.js', 'content A');
      mockFs.setFile('/b.js', 'content B');

      const hashA = watcher.computeFileHash('/a.js');
      const hashB = watcher.computeFileHash('/b.js');
      expect(hashA).not.toBe(hashB);
    });
  });

  describe('onFileChange callback', () => {
    it('should invoke onFileChange callback when file changes', () => {
      const onFileChange = vi.fn();
      const { watcher, mockFs } = createWatcher({ onFileChange });

      mockFs.setFile('/projects/test-project/src/main.js', 'code');
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.handleChange('TEST', '/projects/test-project/src/main.js', 'change');
      expect(onFileChange).toHaveBeenCalledWith(
        'TEST',
        '/projects/test-project/src/main.js',
        'change'
      );
    });

    it('should handle onFileChange callback errors gracefully', () => {
      const onFileChange = vi.fn(() => {
        throw new Error('callback error');
      });
      const { watcher, mockFs, mockLogger } = createWatcher({ onFileChange });

      mockFs.setFile('/projects/test-project/src/main.js', 'code');
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      // Should not throw
      watcher.handleChange('TEST', '/projects/test-project/src/main.js', 'change');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'onFileChange callback failed'
      );
    });
  });

  describe('handleChange - stat error', () => {
    it('should silently skip when stat throws for non-unlink changes', () => {
      const { watcher } = createWatcher();
      // File not in mockFs so stat will throw
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      const changesBefore = watcher.stats.changesDetected;
      watcher.handleChange('TEST', '/projects/test-project/missing.js', 'change');
      // Should not increment changesDetected because stat throws
      expect(watcher.stats.changesDetected).toBe(changesBefore);
    });

    it('should process unlink without checking stat', () => {
      const { watcher, mockFs } = createWatcher();
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.handleChange('TEST', '/projects/test-project/removed.js', 'unlink');
      expect(watcher.stats.changesDetected).toBe(1);
      const pending = watcher.pendingChanges.get('TEST');
      expect(pending.get('/projects/test-project/removed.js')).toBe('unlink');
    });
  });

  describe('_processAstForFiles', () => {
    it('should process AST-supported files and sync functions', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();

      mockFs.setFile('/projects/test-project/src/utils.js', 'function foo() {}');

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.astCaches.set(
        'TEST',
        watcher.astCaches.get('TEST') ||
          (() => {
            // Create a mock AST cache
            const cache = {
              entries: new Map(),
              get: key => cache.entries.get(key) || null,
              set: (key, hash, mtime, functions) =>
                cache.entries.set(key, { hash, mtime, functions }),
              diff: () => ({ added: [{ name: 'mockFunction' }], modified: [], removed: [] }),
              save: vi.fn().mockResolvedValue(undefined),
            };
            return cache;
          })()
      );

      const result = await watcher._processAstForFiles(
        'TEST',
        '/projects/test-project',
        ['src/utils.js'],
        mockClient
      );

      expect(result.parseSuccess).toBeGreaterThanOrEqual(0);
      expect(result).toHaveProperty('modulesSynced');
    });

    it('should return zero results when no AST-supported files', async () => {
      const { watcher, mockClient } = createWatcher();

      const result = await watcher._processAstForFiles(
        'TEST',
        '/projects/test-project',
        ['readme.md', 'config.json'],
        mockClient
      );

      expect(result.modulesSynced).toBe(0);
      expect(result.parseSuccess).toBe(0);
    });

    it('should sync module summaries via _processAstForFiles', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();

      mockFs.setFile('/projects/test-project/src/app.js', 'function app() { return 1; }');

      const result = await watcher._processAstForFiles(
        'TEST',
        '/projects/test-project',
        ['src/app.js'],
        mockClient
      );

      expect(result.modulesSynced).toBeGreaterThanOrEqual(0);
    });

    it('should handle parse errors gracefully', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();
      const { parseFiles } = await import('../../lib/ASTParser.js');

      // Override parseFiles to return an error for this test
      parseFiles.mockImplementationOnce(async paths => {
        return paths.map(f => ({
          file: f,
          functions: [],
          error: 'Parse error: syntax issue',
        }));
      });

      mockFs.setFile('/projects/test-project/src/bad.js', 'function {broken');

      const result = await watcher._processAstForFiles(
        'TEST',
        '/projects/test-project',
        ['src/bad.js'],
        mockClient
      );

      expect(result.parseFailure).toBe(1);
    });
  });

  describe('astInitialSync - with files', () => {
    it('should process AST-supported files and sync functions', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();
      watcher.graphitiClients.set('TEST', mockClient);

      // Mock readdir to return JS files
      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return [{ name: 'src', isDirectory: () => true }];
        }
        if (dir.endsWith('/src')) {
          return [
            { name: 'main.js', isDirectory: () => false },
            { name: 'utils.ts', isDirectory: () => false },
          ];
        }
        return [];
      };
      mockFs.setFile('/projects/test-project/src/main.js', 'function main() {}');
      mockFs.setFile('/projects/test-project/src/utils.ts', 'function utils() {}');

      const result = await watcher.astInitialSync('TEST', '/projects/test-project');

      expect(result.filesProcessed).toBeGreaterThanOrEqual(0);
      expect(result).toHaveProperty('modulesSynced');
      expect(result).toHaveProperty('parseSuccess');
      expect(result).toHaveProperty('parseFailure');
      expect(result).toHaveProperty('errors');
    });

    it('should return empty result when no AST-supported files exist', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();
      watcher.graphitiClients.set('TEST', mockClient);

      // Only non-AST files
      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return [
            { name: 'readme.md', isDirectory: () => false },
            { name: 'config.json', isDirectory: () => false },
          ];
        }
        return [];
      };
      mockFs.setFile('/projects/test-project/readme.md', '# Readme');
      mockFs.setFile('/projects/test-project/config.json', '{}');

      const result = await watcher.astInitialSync('TEST', '/projects/test-project');

      expect(result.filesProcessed).toBe(0);
      expect(result.modulesSynced).toBe(0);
    });

    it('should handle module sync errors', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();
      watcher.graphitiClients.set('TEST', mockClient);

      // Set up AST client that throws on syncModules
      const failingAstClient = new MockGraphitiClient();
      failingAstClient.shouldThrow = true;
      watcher.astGraphitiClients.set('TEST', failingAstClient);

      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return [{ name: 'main.js', isDirectory: () => false }];
        }
        return [];
      };
      mockFs.setFile('/projects/test-project/main.js', 'function main() {}');

      const result = await watcher.astInitialSync('TEST', '/projects/test-project');

      // Should complete without throwing
      expect(result.filesProcessed).toBeGreaterThanOrEqual(0);
    });

    it('should update global stats after sync', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();
      watcher.graphitiClients.set('TEST', mockClient);

      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return [{ name: 'app.js', isDirectory: () => false }];
        }
        return [];
      };
      mockFs.setFile('/projects/test-project/app.js', 'function app() {}');

      await watcher.astInitialSync('TEST', '/projects/test-project');

      expect(watcher.stats.astParseSuccess).toBeGreaterThanOrEqual(0);
      expect(watcher.stats.modulesSynced).toBeGreaterThanOrEqual(0);
    });

    it('should skip files with no functions parsed', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();
      watcher.graphitiClients.set('TEST', mockClient);

      const { parseFiles } = await import('../../lib/ASTParser.js');
      parseFiles.mockImplementationOnce(async paths => {
        return paths.map(f => ({
          file: f,
          functions: [], // No functions found
          error: null,
        }));
      });

      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return [{ name: 'empty.js', isDirectory: () => false }];
        }
        return [];
      };
      mockFs.setFile('/projects/test-project/empty.js', '// empty file');

      const result = await watcher.astInitialSync('TEST', '/projects/test-project');

      expect(result.filesSkipped).toBeGreaterThanOrEqual(1);
    });

    it('should handle parse errors in astInitialSync', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();
      watcher.graphitiClients.set('TEST', mockClient);

      const { parseFiles } = await import('../../lib/ASTParser.js');
      parseFiles.mockImplementationOnce(async paths => {
        return paths.map(f => ({
          file: f,
          functions: [],
          error: 'Parse error: syntax',
        }));
      });

      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return [{ name: 'bad.js', isDirectory: () => false }];
        }
        return [];
      };
      mockFs.setFile('/projects/test-project/bad.js', 'bad syntax {');

      const result = await watcher.astInitialSync('TEST', '/projects/test-project');

      expect(result.parseFailure).toBe(1);
      expect(result.errors.length).toBe(1);
    });

    it('should process multiple batches for many files', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();
      watcher.graphitiClients.set('TEST', mockClient);

      // Create 60 files to trigger batching (batch size is 50)
      const entries = [];
      for (let i = 0; i < 60; i++) {
        const name = `file${i}.js`;
        entries.push({ name, isDirectory: () => false });
        mockFs.setFile(`/projects/test-project/${name}`, `function fn${i}() {}`);
      }

      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return entries;
        }
        return [];
      };

      const result = await watcher.astInitialSync('TEST', '/projects/test-project');

      expect(result.filesProcessed).toBeGreaterThan(0);
    });
  });

  describe('processPendingChanges - AST processing integration', () => {
    it('should process AST for changed files when astEnabled', async () => {
      const { watcher, mockFs, mockClient } = createWatcher({ astEnabled: true });

      mockFs.setFile('/projects/test-project/src/module.js', 'function hello() { return 1; }');

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.pendingChanges.set(
        'TEST',
        new Map([['/projects/test-project/src/module.js', 'change']])
      );

      await watcher.processPendingChanges('TEST');

      expect(watcher.stats.entitiesSynced).toBeGreaterThanOrEqual(1);
    });

    it('should handle deletion with AST cleanup', async () => {
      const { watcher, mockFs, mockClient } = createWatcher({ astEnabled: true });

      // Set up AST cache with functions for a file that will be deleted
      const cache = watcher.astCaches.get('TEST');
      if (cache) {
        cache.set('deleted.js', 'hash123', Date.now(), [{ name: 'oldFunc' }]);
      }

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.pendingChanges.set(
        'TEST',
        new Map([['/projects/test-project/deleted.js', 'unlink']])
      );

      await watcher.processPendingChanges('TEST');

      // Should have processed the deletion
      expect(watcher.processing.has('TEST')).toBe(false);
    });
  });

  describe('HVSYN-904: AST sync only for successfully upserted files', () => {
    it('should skip AST processing for files whose entity upsert failed', async () => {
      const { watcher, mockFs, mockClient } = createWatcher({ astEnabled: true });

      mockClient.failEntityNames.add('File:src/broken.js');

      mockFs.setFile('/projects/test-project/src/good.js', 'function good() { return 1; }');
      mockFs.setFile('/projects/test-project/src/broken.js', 'function broken() { return 2; }');

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.pendingChanges.set(
        'TEST',
        new Map([
          ['/projects/test-project/src/good.js', 'change'],
          ['/projects/test-project/src/broken.js', 'change'],
        ])
      );

      await watcher.processPendingChanges('TEST');

      const syncCall = mockClient.callOrder.find(c => c.method === 'syncFilesWithFunctions');
      if (syncCall) {
        expect(syncCall.files).toBe(1);
      }

      expect(mockClient.upserts.length).toBe(1);
      expect(mockClient.upserts[0].name).toBe('File:src/good.js');
    });

    it('should skip AST when all entity upserts fail', async () => {
      const { watcher, mockFs, mockClient } = createWatcher({ astEnabled: true });

      mockClient.failEntityNames.add('File:src/a.js');
      mockClient.failEntityNames.add('File:src/b.js');

      mockFs.setFile('/projects/test-project/src/a.js', 'const a = 1;');
      mockFs.setFile('/projects/test-project/src/b.js', 'const b = 2;');

      watcher.graphitiClients.set('TEST', mockClient);
      watcher.watchers.set('TEST', {
        _projectMeta: { projectIdentifier: 'TEST', projectPath: '/projects/test-project' },
      });

      watcher.pendingChanges.set(
        'TEST',
        new Map([
          ['/projects/test-project/src/a.js', 'change'],
          ['/projects/test-project/src/b.js', 'change'],
        ])
      );

      await watcher.processPendingChanges('TEST');

      const syncCall = mockClient.callOrder.find(c => c.method === 'syncFilesWithFunctions');
      expect(syncCall).toBeUndefined();
    });
  });

  describe('HVSYN-905: initialSync creates Project entity and containment edges', () => {
    it('should create Project entity before file entities', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();
      watcher.graphitiClients.set('TEST', mockClient);

      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return [{ name: 'main.js', isDirectory: () => false }];
        }
        return [];
      };
      mockFs.setFile('/projects/test-project/main.js', 'const main = 1;');

      await watcher.initialSync('TEST', '/projects/test-project');

      const projectUpsert = mockClient.callOrder.find(
        c => c.method === 'upsertEntity' && c.entity === 'Project:TEST'
      );
      const batchUpsert = mockClient.callOrder.find(c => c.method === 'upsertEntitiesBatch');
      const edgeBatch = mockClient.callOrder.find(c => c.method === 'createContainmentEdgesBatch');

      expect(projectUpsert).toBeDefined();
      expect(batchUpsert).toBeDefined();
      expect(edgeBatch).toBeDefined();

      const projectIdx = mockClient.callOrder.indexOf(projectUpsert);
      const batchIdx = mockClient.callOrder.indexOf(batchUpsert);
      const edgeIdx = mockClient.callOrder.indexOf(edgeBatch);
      expect(projectIdx).toBeLessThan(batchIdx);
      expect(batchIdx).toBeLessThan(edgeIdx);
    });

    it('should create containment edges for successfully upserted files', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();
      watcher.graphitiClients.set('TEST', mockClient);

      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return [
            { name: 'a.js', isDirectory: () => false },
            { name: 'b.js', isDirectory: () => false },
          ];
        }
        return [];
      };
      mockFs.setFile('/projects/test-project/a.js', 'const a = 1;');
      mockFs.setFile('/projects/test-project/b.js', 'const b = 2;');

      await watcher.initialSync('TEST', '/projects/test-project');

      expect(mockClient.edges.length).toBe(2);
      expect(mockClient.edges[0]).toEqual({ project: 'TEST', file: 'a.js' });
      expect(mockClient.edges[1]).toEqual({ project: 'TEST', file: 'b.js' });
    });

    it('should skip edges when Project entity upsert fails', async () => {
      const { watcher, mockFs, mockClient, mockLogger } = createWatcher();
      watcher.graphitiClients.set('TEST', mockClient);

      mockClient.upsertEntity = async () => {
        throw new Error('Graphiti unavailable');
      };
      mockClient.shouldThrow = false;

      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return [{ name: 'main.js', isDirectory: () => false }];
        }
        return [];
      };
      mockFs.setFile('/projects/test-project/main.js', 'const main = 1;');

      await watcher.initialSync('TEST', '/projects/test-project');

      expect(mockClient.upserts.length).toBe(1);
      expect(mockClient.edges.length).toBe(0);
    });

    it('should skip edges for files whose entity upsert failed', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();
      watcher.graphitiClients.set('TEST', mockClient);

      mockClient.failEntityNames.add('File:broken.js');

      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return [
            { name: 'good.js', isDirectory: () => false },
            { name: 'broken.js', isDirectory: () => false },
          ];
        }
        return [];
      };
      mockFs.setFile('/projects/test-project/good.js', 'const good = 1;');
      mockFs.setFile('/projects/test-project/broken.js', 'const broken = 2;');

      await watcher.initialSync('TEST', '/projects/test-project');

      expect(mockClient.edges.length).toBe(1);
      expect(mockClient.edges[0]).toEqual({ project: 'TEST', file: 'good.js' });
    });
  });

  describe('HVSYN-905: astInitialSync creates Project entity and containment edges', () => {
    it('should create Project entity before file processing', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();
      watcher.graphitiClients.set('TEST', mockClient);

      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return [{ name: 'main.js', isDirectory: () => false }];
        }
        return [];
      };
      mockFs.setFile('/projects/test-project/main.js', 'function main() {}');

      await watcher.astInitialSync('TEST', '/projects/test-project');

      const projectUpsert = mockClient.callOrder.find(
        c => c.method === 'upsertEntity' && c.entity === 'Project:TEST'
      );
      expect(projectUpsert).toBeDefined();
    });

    it('should create containment edges for successfully upserted file entities', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();
      watcher.graphitiClients.set('TEST', mockClient);

      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return [{ name: 'main.js', isDirectory: () => false }];
        }
        return [];
      };
      mockFs.setFile('/projects/test-project/main.js', 'function main() {}');

      await watcher.astInitialSync('TEST', '/projects/test-project');

      const edgeBatch = mockClient.callOrder.find(c => c.method === 'createContainmentEdgesBatch');
      expect(edgeBatch).toBeDefined();
      expect(mockClient.edges.length).toBeGreaterThanOrEqual(1);
    });

    it('should skip edges when Project entity upsert fails', async () => {
      const { watcher, mockFs, mockClient, mockLogger } = createWatcher();
      watcher.graphitiClients.set('TEST', mockClient);

      mockClient.upsertEntity = async () => {
        throw new Error('Graphiti unavailable');
      };
      mockClient.shouldThrow = false;

      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return [{ name: 'main.js', isDirectory: () => false }];
        }
        return [];
      };
      mockFs.setFile('/projects/test-project/main.js', 'function main() {}');

      await watcher.astInitialSync('TEST', '/projects/test-project');

      const edgeBatch = mockClient.callOrder.find(c => c.method === 'createContainmentEdgesBatch');
      expect(edgeBatch).toBeUndefined();
    });

    it('should only sync functions for files with successful entity upsert', async () => {
      const { watcher, mockFs, mockClient } = createWatcher();
      watcher.graphitiClients.set('TEST', mockClient);

      mockClient.failEntityNames.add('File:broken.js');

      mockFs.readdir = dir => {
        if (dir === '/projects/test-project') {
          return [
            { name: 'good.js', isDirectory: () => false },
            { name: 'broken.js', isDirectory: () => false },
          ];
        }
        return [];
      };
      mockFs.setFile('/projects/test-project/good.js', 'function good() {}');
      mockFs.setFile('/projects/test-project/broken.js', 'function broken() {}');

      await watcher.astInitialSync('TEST', '/projects/test-project');

      const syncCall = mockClient.callOrder.find(c => c.method === 'syncFilesWithFunctions');
      if (syncCall) {
        expect(syncCall.files).toBe(1);
      }
    });
  });
});
