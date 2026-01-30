/**
 * FileWatcher Unit Tests
 *
 * Comprehensive tests for the FileWatcher class that watches project directories
 * for file changes and triggers incremental uploads to Letta.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// --- Mock logger ---
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => mockLogger),
};
vi.mock('../../lib/logger.js', () => ({
  logger: { child: vi.fn(() => mockLogger) },
}));

// --- Mock chokidar ---
let lastCreatedWatcher;
class MockWatcher extends EventEmitter {
  constructor() {
    super();
    this._projectMeta = null;
    this.closed = false;
    lastCreatedWatcher = this;
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  getWatched() {
    return { '/test/src': ['file1.js', 'file2.js'], '/test/lib': ['util.js'] };
  }
}

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => new MockWatcher()),
  },
}));

// --- Mock fs ---
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    statSync: vi.fn(() => ({ size: 1024 })),
    readFileSync: vi.fn(() => Buffer.from('file-content')),
  },
  existsSync: vi.fn(() => true),
  statSync: vi.fn(() => ({ size: 1024 })),
  readFileSync: vi.fn(() => Buffer.from('file-content')),
}));

// --- Mock crypto ---
const mockHashInstance = {
  update: vi.fn().mockReturnThis(),
  digest: vi.fn(() => 'abc123hash'),
};
vi.mock('crypto', () => ({
  default: {
    createHash: vi.fn(() => mockHashInstance),
  },
  createHash: vi.fn(() => mockHashInstance),
}));

import { FileWatcher } from '../../lib/FileWatcher.js';
import chokidar from 'chokidar';
import fs from 'fs';
import crypto from 'crypto';

// --- Helpers ---
function createMockLettaService() {
  return {
    apiURL: 'http://localhost:8283/v1',
    password: 'test-password',
    deleteFile: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockDb() {
  return {
    getProjectFile: vi.fn(),
    deleteProjectFile: vi.fn(),
    upsertProjectFile: vi.fn(),
    getProjectsWithLettaFolders: vi.fn(() => []),
  };
}

// --- Mock fetch/FormData/Blob globally ---
const mockFetchResponse = {
  ok: true,
  status: 200,
  json: vi.fn().mockResolvedValue({ id: 'file-123' }),
};

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue(mockFetchResponse);
  global.FormData = class {
    constructor() {
      this._data = {};
    }
    append(key, value, name) {
      this._data[key] = { value, name };
    }
  };
  global.Blob = class {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options?.type;
    }
  };
});

// ============================================================
// TESTS
// ============================================================

describe('FileWatcher', () => {
  let watcher;
  let mockLettaService;
  let mockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();
    mockHashInstance.update.mockReturnThis();
    mockHashInstance.digest.mockReturnValue('abc123hash');
    mockFetchResponse.ok = true;
    mockFetchResponse.status = 200;
    mockFetchResponse.json = vi.fn().mockResolvedValue({ id: 'file-123' });

    mockLettaService = createMockLettaService();
    mockDb = createMockDb();
    watcher = new FileWatcher(mockLettaService, mockDb);
  });

  afterEach(async () => {
    await watcher.shutdown();
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------
  // constructor
  // --------------------------------------------------------
  describe('constructor', () => {
    it('should set default configuration values', () => {
      expect(watcher.debounceMs).toBe(1000);
      expect(watcher.batchIntervalMs).toBe(5000);
      expect(watcher.maxBatchSize).toBe(50);
    });

    it('should allow options to override defaults', () => {
      const custom = new FileWatcher(mockLettaService, mockDb, {
        debounceMs: 2000,
        batchIntervalMs: 10000,
        maxBatchSize: 100,
      });
      expect(custom.debounceMs).toBe(2000);
      expect(custom.batchIntervalMs).toBe(10000);
      expect(custom.maxBatchSize).toBe(100);
    });

    it('should initialize state maps and sets', () => {
      expect(watcher.watchers).toBeInstanceOf(Map);
      expect(watcher.watchers.size).toBe(0);
      expect(watcher.pendingChanges).toBeInstanceOf(Map);
      expect(watcher.debounceTimers).toBeInstanceOf(Map);
      expect(watcher.processing).toBeInstanceOf(Set);
    });

    it('should initialize stats with zeroes', () => {
      expect(watcher.stats).toEqual({
        filesWatched: 0,
        changesDetected: 0,
        uploadsTriggered: 0,
        errors: 0,
      });
    });

    it('should store lettaService and db references', () => {
      expect(watcher.lettaService).toBe(mockLettaService);
      expect(watcher.db).toBe(mockDb);
    });

    it('should set up allowed extensions', () => {
      expect(watcher.allowedExtensions).toBeInstanceOf(Set);
      expect(watcher.allowedExtensions.has('.js')).toBe(true);
      expect(watcher.allowedExtensions.has('.md')).toBe(true);
      expect(watcher.allowedExtensions.has('.exe')).toBe(false);
    });
  });

  // --------------------------------------------------------
  // watchProject
  // --------------------------------------------------------
  describe('watchProject', () => {
    it('should create chokidar watcher with correct options', () => {
      watcher.watchProject('PROJ', '/test/path', 'folder-1');

      expect(chokidar.watch).toHaveBeenCalledWith(
        '/test/path',
        expect.objectContaining({
          persistent: true,
          ignoreInitial: true,
          depth: 10,
        })
      );
      expect(watcher.watchers.has('PROJ')).toBe(true);
    });

    it('should skip if already watching', () => {
      watcher.watchProject('PROJ', '/test/path', 'folder-1');
      chokidar.watch.mockClear();

      watcher.watchProject('PROJ', '/test/path', 'folder-1');
      expect(chokidar.watch).not.toHaveBeenCalled();
    });

    it('should skip if path does not exist', () => {
      fs.existsSync.mockReturnValueOnce(false);

      watcher.watchProject('PROJ', '/nonexistent', 'folder-1');
      expect(chokidar.watch).not.toHaveBeenCalled();
      expect(watcher.watchers.has('PROJ')).toBe(false);
    });

    it('should set _projectMeta on the watcher', () => {
      watcher.watchProject('PROJ', '/test/path', 'folder-1');

      const w = watcher.watchers.get('PROJ');
      expect(w._projectMeta).toEqual({
        projectIdentifier: 'PROJ',
        projectPath: '/test/path',
        folderId: 'folder-1',
      });
    });

    it('should handle add event by calling handleChange', () => {
      const spy = vi.spyOn(watcher, 'handleChange').mockImplementation(() => {});
      watcher.watchProject('PROJ', '/test/path', 'folder-1');

      const w = watcher.watchers.get('PROJ');
      w.emit('add', '/test/path/file.js');

      expect(spy).toHaveBeenCalledWith('PROJ', '/test/path/file.js', 'add');
    });

    it('should handle change event', () => {
      const spy = vi.spyOn(watcher, 'handleChange').mockImplementation(() => {});
      watcher.watchProject('PROJ', '/test/path', 'folder-1');

      const w = watcher.watchers.get('PROJ');
      w.emit('change', '/test/path/file.js');

      expect(spy).toHaveBeenCalledWith('PROJ', '/test/path/file.js', 'change');
    });

    it('should handle unlink event', () => {
      const spy = vi.spyOn(watcher, 'handleChange').mockImplementation(() => {});
      watcher.watchProject('PROJ', '/test/path', 'folder-1');

      const w = watcher.watchers.get('PROJ');
      w.emit('unlink', '/test/path/file.js');

      expect(spy).toHaveBeenCalledWith('PROJ', '/test/path/file.js', 'unlink');
    });

    it('should handle error event and increment stats.errors', () => {
      watcher.watchProject('PROJ', '/test/path', 'folder-1');

      const w = watcher.watchers.get('PROJ');
      w.emit('error', new Error('watch error'));

      expect(watcher.stats.errors).toBe(1);
    });

    it('should handle ready event and update filesWatched stat', () => {
      watcher.watchProject('PROJ', '/test/path', 'folder-1');

      const w = watcher.watchers.get('PROJ');
      w.emit('ready');

      // MockWatcher.getWatched returns 3 files
      expect(watcher.stats.filesWatched).toBe(3);
    });
  });

  // --------------------------------------------------------
  // unwatchProject
  // --------------------------------------------------------
  describe('unwatchProject', () => {
    it('should close watcher and clean up state', async () => {
      watcher.watchProject('PROJ', '/test/path', 'folder-1');
      expect(watcher.watchers.has('PROJ')).toBe(true);

      await watcher.unwatchProject('PROJ');

      expect(watcher.watchers.has('PROJ')).toBe(false);
      expect(watcher.pendingChanges.has('PROJ')).toBe(false);
    });

    it('should clear debounce timer', async () => {
      watcher.watchProject('PROJ', '/test/path', 'folder-1');
      // Set a fake debounce timer
      watcher.debounceTimers.set(
        'PROJ',
        setTimeout(() => {}, 10000)
      );

      await watcher.unwatchProject('PROJ');

      expect(watcher.debounceTimers.has('PROJ')).toBe(false);
    });

    it('should handle non-existent project gracefully', async () => {
      // Should not throw
      await watcher.unwatchProject('NONEXISTENT');
    });
  });

  // --------------------------------------------------------
  // handleChange
  // --------------------------------------------------------
  describe('handleChange', () => {
    it('should filter by extension - reject .exe', () => {
      watcher.handleChange('PROJ', '/test/path/file.exe', 'add');

      expect(watcher.stats.changesDetected).toBe(0);
    });

    it('should filter by extension - accept .js', () => {
      vi.spyOn(watcher, 'scheduleProcessing').mockImplementation(() => {});

      watcher.handleChange('PROJ', '/test/path/file.js', 'add');

      expect(watcher.stats.changesDetected).toBe(1);
    });

    it('should skip large files (>512KB)', () => {
      fs.statSync.mockReturnValueOnce({ size: 600000 });
      vi.spyOn(watcher, 'scheduleProcessing').mockImplementation(() => {});

      watcher.handleChange('PROJ', '/test/path/file.js', 'add');

      expect(watcher.stats.changesDetected).toBe(0);
    });

    it('should handle stat errors (file deleted between event and stat)', () => {
      fs.statSync.mockImplementationOnce(() => {
        throw new Error('ENOENT');
      });
      vi.spyOn(watcher, 'scheduleProcessing').mockImplementation(() => {});

      watcher.handleChange('PROJ', '/test/path/file.js', 'add');

      expect(watcher.stats.changesDetected).toBe(0);
    });

    it('should skip unlink files without size check', () => {
      vi.spyOn(watcher, 'scheduleProcessing').mockImplementation(() => {});
      fs.statSync.mockClear();

      watcher.handleChange('PROJ', '/test/path/file.js', 'unlink');

      // statSync should NOT be called for unlink
      expect(fs.statSync).not.toHaveBeenCalled();
      expect(watcher.stats.changesDetected).toBe(1);
    });

    it('should add to pending changes map', () => {
      vi.spyOn(watcher, 'scheduleProcessing').mockImplementation(() => {});

      watcher.handleChange('PROJ', '/test/path/file.js', 'add');

      expect(watcher.pendingChanges.has('PROJ')).toBe(true);
      expect(watcher.pendingChanges.get('PROJ').get('/test/path/file.js')).toBe('add');
    });

    it('should increment changesDetected stat', () => {
      vi.spyOn(watcher, 'scheduleProcessing').mockImplementation(() => {});

      watcher.handleChange('PROJ', '/test/path/a.js', 'add');
      watcher.handleChange('PROJ', '/test/path/b.ts', 'change');

      expect(watcher.stats.changesDetected).toBe(2);
    });

    it('should schedule processing', () => {
      const spy = vi.spyOn(watcher, 'scheduleProcessing').mockImplementation(() => {});

      watcher.handleChange('PROJ', '/test/path/file.js', 'add');

      expect(spy).toHaveBeenCalledWith('PROJ');
    });
  });

  // --------------------------------------------------------
  // scheduleProcessing
  // --------------------------------------------------------
  describe('scheduleProcessing', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should set a debounce timer', () => {
      watcher.processPendingChanges = vi.fn();
      watcher.scheduleProcessing('PROJ');

      expect(watcher.debounceTimers.has('PROJ')).toBe(true);
      expect(watcher.processPendingChanges).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);

      expect(watcher.processPendingChanges).toHaveBeenCalledWith('PROJ');
    });

    it('should clear existing timer before setting new one', () => {
      watcher.processPendingChanges = vi.fn();

      watcher.scheduleProcessing('PROJ');
      watcher.scheduleProcessing('PROJ'); // Second call resets

      vi.advanceTimersByTime(1000);

      // Should only be called once (debounced)
      expect(watcher.processPendingChanges).toHaveBeenCalledTimes(1);
    });

    it('should debounce processing to configured debounceMs', () => {
      const custom = new FileWatcher(mockLettaService, mockDb, { debounceMs: 3000 });
      custom.processPendingChanges = vi.fn();

      custom.scheduleProcessing('PROJ');

      vi.advanceTimersByTime(1000);
      expect(custom.processPendingChanges).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2000);
      expect(custom.processPendingChanges).toHaveBeenCalledWith('PROJ');
    });
  });

  // --------------------------------------------------------
  // processPendingChanges
  // --------------------------------------------------------
  describe('processPendingChanges', () => {
    it('should skip if already processing (prevent concurrent)', async () => {
      watcher.processing.add('PROJ');
      const spy = vi.spyOn(watcher, 'scheduleProcessing').mockImplementation(() => {});

      await watcher.processPendingChanges('PROJ');

      // Should reschedule instead of processing
      expect(spy).toHaveBeenCalledWith('PROJ');
    });

    it('should skip if no changes', async () => {
      // No pending changes for this project
      await watcher.processPendingChanges('PROJ');

      // Should not log processing
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ project: 'PROJ', changeCount: expect.any(Number) }),
        expect.any(String)
      );
    });

    it('should skip if changes map is empty', async () => {
      watcher.pendingChanges.set('PROJ', new Map());

      await watcher.processPendingChanges('PROJ');

      expect(watcher.processing.has('PROJ')).toBe(false);
    });

    it('should skip if no watcher', async () => {
      watcher.pendingChanges.set('PROJ', new Map([['/test/file.js', 'add']]));
      // No watcher set up for PROJ

      await watcher.processPendingChanges('PROJ');

      // Should not throw, should not process
      expect(watcher.processing.has('PROJ')).toBe(false);
    });

    it('should handle file updates (add/change)', async () => {
      watcher.watchProject('PROJ', '/test/path', 'folder-1');
      watcher.pendingChanges.set('PROJ', new Map([['/test/path/file.js', 'add']]));

      const spy = vi.spyOn(watcher, 'handleFileUpdate').mockResolvedValue('uploaded');

      await watcher.processPendingChanges('PROJ');

      expect(spy).toHaveBeenCalledWith('PROJ', 'file.js', '/test/path/file.js', 'folder-1');
      expect(watcher.stats.uploadsTriggered).toBe(1);
    });

    it('should handle file deletes (unlink)', async () => {
      watcher.watchProject('PROJ', '/test/path', 'folder-1');
      watcher.pendingChanges.set('PROJ', new Map([['/test/path/file.js', 'unlink']]));

      const spy = vi.spyOn(watcher, 'handleFileDelete').mockResolvedValue();

      await watcher.processPendingChanges('PROJ');

      expect(spy).toHaveBeenCalledWith('PROJ', 'file.js', 'folder-1');
    });

    it('should count uploaded/deleted/skipped/errors', async () => {
      watcher.watchProject('PROJ', '/test/path', 'folder-1');
      watcher.pendingChanges.set(
        'PROJ',
        new Map([
          ['/test/path/a.js', 'add'],
          ['/test/path/b.js', 'change'],
          ['/test/path/c.js', 'unlink'],
        ])
      );

      vi.spyOn(watcher, 'handleFileUpdate')
        .mockResolvedValueOnce('uploaded')
        .mockResolvedValueOnce('skipped');
      vi.spyOn(watcher, 'handleFileDelete').mockResolvedValue();

      await watcher.processPendingChanges('PROJ');

      expect(watcher.stats.uploadsTriggered).toBe(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ uploaded: 1, deleted: 1, skipped: 1, errors: 0 }),
        'File changes processed'
      );
    });

    it('should handle errors in individual file processing', async () => {
      watcher.watchProject('PROJ', '/test/path', 'folder-1');
      watcher.pendingChanges.set('PROJ', new Map([['/test/path/a.js', 'add']]));

      vi.spyOn(watcher, 'handleFileUpdate').mockRejectedValue(new Error('upload failed'));

      await watcher.processPendingChanges('PROJ');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ errors: 1 }),
        'File changes processed'
      );
    });

    it('should clear processing flag when done', async () => {
      watcher.watchProject('PROJ', '/test/path', 'folder-1');
      watcher.pendingChanges.set('PROJ', new Map([['/test/path/a.js', 'add']]));

      vi.spyOn(watcher, 'handleFileUpdate').mockResolvedValue('uploaded');

      await watcher.processPendingChanges('PROJ');

      expect(watcher.processing.has('PROJ')).toBe(false);
    });

    it('should clear pending changes after taking snapshot', async () => {
      watcher.watchProject('PROJ', '/test/path', 'folder-1');
      watcher.pendingChanges.set('PROJ', new Map([['/test/path/a.js', 'add']]));

      vi.spyOn(watcher, 'handleFileUpdate').mockResolvedValue('uploaded');

      await watcher.processPendingChanges('PROJ');

      expect(watcher.pendingChanges.get('PROJ').size).toBe(0);
    });
  });

  // --------------------------------------------------------
  // handleFileDelete
  // --------------------------------------------------------
  describe('handleFileDelete', () => {
    it('should delete from Letta and DB when tracked', async () => {
      mockDb.getProjectFile.mockReturnValue({
        letta_file_id: 'letta-file-1',
        relative_path: 'file.js',
      });

      await watcher.handleFileDelete('PROJ', 'file.js', 'folder-1');

      expect(mockLettaService.deleteFile).toHaveBeenCalledWith('folder-1', 'letta-file-1');
      expect(mockDb.deleteProjectFile).toHaveBeenCalledWith('PROJ', 'file.js');
    });

    it('should handle no tracked file gracefully', async () => {
      mockDb.getProjectFile.mockReturnValue(null);

      // Should not throw
      await watcher.handleFileDelete('PROJ', 'file.js', 'folder-1');

      expect(mockLettaService.deleteFile).not.toHaveBeenCalled();
      expect(mockDb.deleteProjectFile).not.toHaveBeenCalled();
    });

    it('should handle tracked file without letta_file_id', async () => {
      mockDb.getProjectFile.mockReturnValue({ relative_path: 'file.js' });

      await watcher.handleFileDelete('PROJ', 'file.js', 'folder-1');

      expect(mockLettaService.deleteFile).not.toHaveBeenCalled();
      expect(mockDb.deleteProjectFile).not.toHaveBeenCalled();
    });

    it('should handle Letta delete errors gracefully', async () => {
      mockDb.getProjectFile.mockReturnValue({
        letta_file_id: 'letta-file-1',
        relative_path: 'file.js',
      });
      mockLettaService.deleteFile.mockRejectedValueOnce(new Error('Letta error'));

      // Should not throw; should still delete from DB
      await watcher.handleFileDelete('PROJ', 'file.js', 'folder-1');

      expect(mockDb.deleteProjectFile).toHaveBeenCalledWith('PROJ', 'file.js');
    });
  });

  // --------------------------------------------------------
  // handleFileUpdate
  // --------------------------------------------------------
  describe('handleFileUpdate', () => {
    it('should return skipped when hash is null', async () => {
      vi.spyOn(watcher, 'computeFileHash').mockReturnValue(null);

      const result = await watcher.handleFileUpdate(
        'PROJ',
        'file.js',
        '/test/path/file.js',
        'folder-1'
      );

      expect(result).toBe('skipped');
    });

    it('should return skipped when hash unchanged', async () => {
      vi.spyOn(watcher, 'computeFileHash').mockReturnValue('samehash');
      mockDb.getProjectFile.mockReturnValue({
        content_hash: 'samehash',
        letta_file_id: 'letta-file-1',
      });

      const result = await watcher.handleFileUpdate(
        'PROJ',
        'file.js',
        '/test/path/file.js',
        'folder-1'
      );

      expect(result).toBe('skipped');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should delete old version then upload new', async () => {
      vi.spyOn(watcher, 'computeFileHash').mockReturnValue('newhash');
      mockDb.getProjectFile.mockReturnValue({
        content_hash: 'oldhash',
        letta_file_id: 'letta-file-old',
      });

      const result = await watcher.handleFileUpdate(
        'PROJ',
        'file.js',
        '/test/path/file.js',
        'folder-1'
      );

      expect(mockLettaService.deleteFile).toHaveBeenCalledWith('folder-1', 'letta-file-old');
      expect(global.fetch).toHaveBeenCalled();
      expect(result).toBe('uploaded');
    });

    it('should upload new file and update DB', async () => {
      vi.spyOn(watcher, 'computeFileHash').mockReturnValue('newhash');
      mockDb.getProjectFile.mockReturnValue(null);

      const result = await watcher.handleFileUpdate(
        'PROJ',
        'file.js',
        '/test/path/file.js',
        'folder-1'
      );

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8283/v1/sources/folder-1/upload',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer test-password' },
        })
      );

      expect(mockDb.upsertProjectFile).toHaveBeenCalledWith(
        expect.objectContaining({
          project_identifier: 'PROJ',
          relative_path: 'file.js',
          content_hash: 'newhash',
          letta_file_id: 'file-123',
        })
      );

      expect(result).toBe('uploaded');
    });

    it('should handle upload failure', async () => {
      vi.spyOn(watcher, 'computeFileHash').mockReturnValue('newhash');
      mockDb.getProjectFile.mockReturnValue(null);
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

      await expect(
        watcher.handleFileUpdate('PROJ', 'file.js', '/test/path/file.js', 'folder-1')
      ).rejects.toThrow('Upload failed: 500');
    });

    it('should ignore delete error for old version and still upload', async () => {
      vi.spyOn(watcher, 'computeFileHash').mockReturnValue('newhash');
      mockDb.getProjectFile.mockReturnValue({
        content_hash: 'oldhash',
        letta_file_id: 'letta-file-old',
      });
      mockLettaService.deleteFile.mockRejectedValueOnce(new Error('delete failed'));

      const result = await watcher.handleFileUpdate(
        'PROJ',
        'file.js',
        '/test/path/file.js',
        'folder-1'
      );

      expect(result).toBe('uploaded');
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------
  // computeFileHash
  // --------------------------------------------------------
  describe('computeFileHash', () => {
    it('should return MD5 hash of file content', () => {
      const hash = watcher.computeFileHash('/test/file.js');

      expect(crypto.createHash).toHaveBeenCalledWith('md5');
      expect(mockHashInstance.update).toHaveBeenCalled();
      expect(mockHashInstance.digest).toHaveBeenCalledWith('hex');
      expect(hash).toBe('abc123hash');
    });

    it('should return null on error', () => {
      fs.readFileSync.mockImplementationOnce(() => {
        throw new Error('ENOENT');
      });

      const hash = watcher.computeFileHash('/nonexistent');

      expect(hash).toBeNull();
    });
  });

  // --------------------------------------------------------
  // getStats
  // --------------------------------------------------------
  describe('getStats', () => {
    it('should return stats with projectsWatched and pendingChanges', () => {
      const stats = watcher.getStats();

      expect(stats).toEqual({
        filesWatched: 0,
        changesDetected: 0,
        uploadsTriggered: 0,
        errors: 0,
        projectsWatched: 0,
        pendingChanges: 0,
      });
    });

    it('should reflect watched projects count', () => {
      watcher.watchProject('PROJ1', '/path1', 'f1');
      watcher.watchProject('PROJ2', '/path2', 'f2');

      const stats = watcher.getStats();

      expect(stats.projectsWatched).toBe(2);
    });

    it('should reflect pending changes count', () => {
      watcher.pendingChanges.set(
        'PROJ',
        new Map([
          ['/a.js', 'add'],
          ['/b.js', 'change'],
        ])
      );

      const stats = watcher.getStats();

      expect(stats.pendingChanges).toBe(2);
    });
  });

  // --------------------------------------------------------
  // syncWatchedProjects
  // --------------------------------------------------------
  describe('syncWatchedProjects', () => {
    it('should start watching new projects from DB', async () => {
      mockDb.getProjectsWithLettaFolders.mockReturnValue([
        { identifier: 'NEW', filesystem_path: '/new/path', letta_folder_id: 'folder-new' },
      ]);

      const spy = vi.spyOn(watcher, 'watchProject');

      await watcher.syncWatchedProjects();

      expect(spy).toHaveBeenCalledWith('NEW', '/new/path', 'folder-new');
    });

    it('should skip already-watched projects', async () => {
      watcher.watchProject('EXISTING', '/existing', 'folder-e');
      chokidar.watch.mockClear();

      mockDb.getProjectsWithLettaFolders.mockReturnValue([
        { identifier: 'EXISTING', filesystem_path: '/existing', letta_folder_id: 'folder-e' },
      ]);

      await watcher.syncWatchedProjects();

      // watchProject should be called but internally skip (chokidar.watch not called again)
      expect(chokidar.watch).not.toHaveBeenCalled();
    });

    it('should skip projects without filesystem_path', async () => {
      mockDb.getProjectsWithLettaFolders.mockReturnValue([
        { identifier: 'NO_PATH', filesystem_path: null, letta_folder_id: 'folder-1' },
      ]);

      const spy = vi.spyOn(watcher, 'watchProject');

      await watcher.syncWatchedProjects();

      expect(spy).not.toHaveBeenCalled();
    });

    it('should skip projects without letta_folder_id', async () => {
      mockDb.getProjectsWithLettaFolders.mockReturnValue([
        { identifier: 'NO_FOLDER', filesystem_path: '/path', letta_folder_id: null },
      ]);

      const spy = vi.spyOn(watcher, 'watchProject');

      await watcher.syncWatchedProjects();

      expect(spy).not.toHaveBeenCalled();
    });

    it('should remove watchers for projects no longer in DB', async () => {
      watcher.watchProject('OLD_PROJ', '/old', 'folder-old');

      mockDb.getProjectsWithLettaFolders.mockReturnValue([
        // OLD_PROJ not in list
        { identifier: 'NEW_PROJ', filesystem_path: '/new', letta_folder_id: 'folder-new' },
      ]);

      const spy = vi.spyOn(watcher, 'unwatchProject');

      await watcher.syncWatchedProjects();

      expect(spy).toHaveBeenCalledWith('OLD_PROJ');
    });

    it('should handle errors gracefully', async () => {
      mockDb.getProjectsWithLettaFolders.mockImplementation(() => {
        throw new Error('DB error');
      });

      // Should not throw
      await watcher.syncWatchedProjects();

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------
  // shutdown
  // --------------------------------------------------------
  describe('shutdown', () => {
    it('should close all watchers', async () => {
      watcher.watchProject('P1', '/p1', 'f1');
      watcher.watchProject('P2', '/p2', 'f2');

      await watcher.shutdown();

      expect(watcher.watchers.size).toBe(0);
    });

    it('should clear all timers', async () => {
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

    it('should handle shutdown with no watchers', async () => {
      // Should not throw
      await watcher.shutdown();

      expect(watcher.watchers.size).toBe(0);
    });
  });
});
