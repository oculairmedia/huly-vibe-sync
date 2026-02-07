import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';

const mockWatcher = {
  on: vi.fn(function () {
    return this;
  }),
  close: vi.fn().mockResolvedValue(undefined),
};

const mockChokidar = {
  watch: vi.fn().mockReturnValue(mockWatcher),
};

const mockFs = {
  existsSync: vi.fn(),
};

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock('chokidar', () => ({
  default: mockChokidar,
}));

vi.mock('fs', () => ({
  default: mockFs,
  existsSync: mockFs.existsSync,
}));

vi.mock('../../lib/logger.js', () => ({
  logger: mockLogger,
}));

const { BeadsWatcher } = await import('../../lib/BeadsWatcher.js');

describe('BeadsWatcher', () => {
  let watcher;
  let mockDb;
  let onBeadsChange;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockDb = {
      getProject: vi.fn(),
      getProjectsWithFilesystemPath: vi.fn().mockReturnValue([]),
    };

    onBeadsChange = vi.fn();

    watcher = new BeadsWatcher({
      db: mockDb,
      onBeadsChange,
      debounceDelay: 100,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('watchProject', () => {
    it('should return false when .beads directory does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = watcher.watchProject('PROJ', '/repo');

      expect(result).toBe(false);
      expect(mockFs.existsSync).toHaveBeenCalledWith(path.join('/repo', '.beads'));
      expect(mockChokidar.watch).not.toHaveBeenCalled();
    });

    it('should create watcher when .beads directory exists', () => {
      mockFs.existsSync.mockReturnValue(true);

      const result = watcher.watchProject('PROJ', '/repo');

      expect(result).toBe(true);
      expect(mockChokidar.watch).toHaveBeenCalledWith(
        path.join('/repo', '.beads'),
        expect.objectContaining({
          persistent: true,
          ignoreInitial: true,
          depth: 2,
          usePolling: true,
        })
      );
      expect(watcher.watchers.has('PROJ')).toBe(true);
      expect(watcher.pendingChanges.has('PROJ')).toBe(true);
    });
  });

  describe('handleChange', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      watcher.watchProject('PROJ', '/repo');
    });

    it('should ignore non-relevant files', () => {
      const scheduleSpy = vi.spyOn(watcher, 'scheduleSync');

      watcher.handleChange('PROJ', '/repo', '/repo/.beads/config.yaml', 'change');

      expect(watcher.stats.changesDetected).toBe(0);
      expect(scheduleSpy).not.toHaveBeenCalled();
      expect(watcher.pendingChanges.get('PROJ').size).toBe(0);
    });

    it.each([
      '/repo/.beads/issues.jsonl',
      '/repo/.beads/beads.db',
      '/repo/.beads/beads.db-wal',
      '/repo/.beads/beads.db-shm',
    ])('should detect realtime beads data changes for %s', changedFile => {
      const scheduleSpy = vi.spyOn(watcher, 'scheduleSync').mockImplementation(() => {});

      watcher.handleChange('PROJ', '/repo', changedFile, 'change');

      expect(watcher.stats.changesDetected).toBe(1);
      expect(watcher.pendingChanges.get('PROJ').size).toBe(1);
      expect(scheduleSpy).toHaveBeenCalledWith('PROJ', '/repo');
    });
  });

  describe('scheduleSync', () => {
    it('should debounce rapid sync scheduling', async () => {
      const triggerSpy = vi.spyOn(watcher, 'triggerSync').mockResolvedValue(undefined);

      watcher.scheduleSync('PROJ', '/repo');
      watcher.scheduleSync('PROJ', '/repo');

      vi.advanceTimersByTime(100);
      await vi.runOnlyPendingTimersAsync();

      expect(triggerSpy).toHaveBeenCalledTimes(1);
      expect(triggerSpy).toHaveBeenCalledWith('PROJ', '/repo');
    });
  });

  describe('triggerSync', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      watcher.watchProject('PROJ', '/repo');
    });

    it('should trigger callback with pending file changes', async () => {
      watcher.pendingChanges.get('PROJ').add('.beads/issues.jsonl');
      watcher.pendingChanges.get('PROJ').add('.beads/beads.db-wal');

      await watcher.triggerSync('PROJ', '/repo');

      expect(onBeadsChange).toHaveBeenCalledWith(
        expect.objectContaining({
          projectIdentifier: 'PROJ',
          projectPath: '/repo',
          changedFiles: expect.arrayContaining(['.beads/issues.jsonl', '.beads/beads.db-wal']),
          timestamp: expect.any(String),
        })
      );
      expect(watcher.stats.syncsTriggered).toBe(1);
      expect(watcher.pendingChanges.get('PROJ').size).toBe(0);
    });

    it('should do nothing when there are no pending changes', async () => {
      await watcher.triggerSync('PROJ', '/repo');

      expect(onBeadsChange).not.toHaveBeenCalled();
      expect(watcher.stats.syncsTriggered).toBe(0);
    });
  });

  describe('syncWithDatabase', () => {
    it('should watch projects that have filesystem paths and .beads dirs', async () => {
      mockDb.getProjectsWithFilesystemPath.mockReturnValue([
        { identifier: 'PROJ1', filesystem_path: '/repo/one' },
        { identifier: 'PROJ2', filesystem_path: '/repo/two' },
        { identifier: 'PROJ3', filesystem_path: null },
      ]);
      mockFs.existsSync.mockImplementation(testPath => {
        return testPath === path.join('/repo/one', '.beads');
      });

      const result = await watcher.syncWithDatabase();

      expect(result).toEqual({ watching: 1, available: 1 });
      expect(watcher.watchers.has('PROJ1')).toBe(true);
      expect(watcher.watchers.has('PROJ2')).toBe(false);
    });

    it('should return empty counts when db is missing', async () => {
      const watcherWithoutDb = new BeadsWatcher({ db: null, onBeadsChange });

      const result = await watcherWithoutDb.syncWithDatabase();

      expect(result).toEqual({ watching: 0, available: 0 });
    });
  });
});
