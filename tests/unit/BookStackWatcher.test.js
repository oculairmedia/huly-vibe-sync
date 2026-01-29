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

const { BookStackWatcher } = await import('../../lib/BookStackWatcher.js');

describe('BookStackWatcher', () => {
  let watcher;
  let mockDb;
  let mockBookstackService;
  let onBookStackChange;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockDb = {
      getProjectsWithFilesystemPath: vi.fn().mockReturnValue([]),
    };

    mockBookstackService = {
      config: {
        docsSubdir: 'docs/bookstack',
      },
      getBookSlugForProject: vi.fn(),
    };

    onBookStackChange = vi.fn();

    watcher = new BookStackWatcher({
      db: mockDb,
      bookstackService: mockBookstackService,
      onBookStackChange,
      debounceDelay: 100,
    });

    mockWatcher.on.mockClear();
    mockWatcher.close.mockClear();
    mockChokidar.watch.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('watchProject', () => {
    it('should return false when docs dir does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = watcher.watchProject('proj-1', '/project/path', 'my-book');

      expect(result).toBe(false);
      expect(mockFs.existsSync).toHaveBeenCalledWith(
        path.join('/project/path', 'docs/bookstack', 'my-book')
      );
      expect(mockChokidar.watch).not.toHaveBeenCalled();
    });

    it('should start watcher when docs dir exists', () => {
      mockFs.existsSync.mockReturnValue(true);

      const result = watcher.watchProject('proj-1', '/project/path', 'my-book');

      expect(result).toBe(true);
      expect(mockChokidar.watch).toHaveBeenCalledWith(
        path.join('/project/path', 'docs/bookstack', 'my-book'),
        expect.objectContaining({
          persistent: true,
          ignoreInitial: true,
          depth: 3,
          usePolling: true,
        })
      );
      expect(mockWatcher.on).toHaveBeenCalledWith('add', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('change', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('unlink', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('ready', expect.any(Function));
    });

    it('should increment projectsWatched stat', () => {
      mockFs.existsSync.mockReturnValue(true);

      expect(watcher.stats.projectsWatched).toBe(0);
      watcher.watchProject('proj-1', '/project/path', 'my-book');
      expect(watcher.stats.projectsWatched).toBe(1);
    });

    it('should return true if already watching project', () => {
      mockFs.existsSync.mockReturnValue(true);

      watcher.watchProject('proj-1', '/project/path', 'my-book');
      const result = watcher.watchProject('proj-1', '/project/path', 'my-book');

      expect(result).toBe(true);
      expect(mockChokidar.watch).toHaveBeenCalledTimes(1);
    });

    it('should store watcher info in map', () => {
      mockFs.existsSync.mockReturnValue(true);

      watcher.watchProject('proj-1', '/project/path', 'my-book');

      expect(watcher.watchers.has('proj-1')).toBe(true);
      const info = watcher.watchers.get('proj-1');
      expect(info).toHaveProperty('watcher');
      expect(info).toHaveProperty('projectPath', '/project/path');
      expect(info).toHaveProperty('bookSlug', 'my-book');
    });

    it('should initialize pending changes set', () => {
      mockFs.existsSync.mockReturnValue(true);

      watcher.watchProject('proj-1', '/project/path', 'my-book');

      expect(watcher.pendingChanges.has('proj-1')).toBe(true);
      expect(watcher.pendingChanges.get('proj-1')).toBeInstanceOf(Set);
    });
  });

  describe('unwatchProject', () => {
    it('should close watcher and clear timers', async () => {
      mockFs.existsSync.mockReturnValue(true);
      watcher.watchProject('proj-1', '/project/path', 'my-book');

      await watcher.unwatchProject('proj-1');

      expect(mockWatcher.close).toHaveBeenCalled();
      expect(watcher.watchers.has('proj-1')).toBe(false);
      expect(watcher.pendingChanges.has('proj-1')).toBe(false);
    });

    it('should decrement projectsWatched stat', async () => {
      mockFs.existsSync.mockReturnValue(true);
      watcher.watchProject('proj-1', '/project/path', 'my-book');
      expect(watcher.stats.projectsWatched).toBe(1);

      await watcher.unwatchProject('proj-1');

      expect(watcher.stats.projectsWatched).toBe(0);
    });

    it('should clear debounce timer if exists', async () => {
      mockFs.existsSync.mockReturnValue(true);
      watcher.watchProject('proj-1', '/project/path', 'my-book');

      const timer = setTimeout(() => {}, 1000);
      watcher.debounceTimers.set('proj-1', timer);

      await watcher.unwatchProject('proj-1');

      expect(watcher.debounceTimers.has('proj-1')).toBe(false);
    });

    it('should do nothing if project not being watched', async () => {
      await expect(watcher.unwatchProject('nonexistent')).resolves.toBeUndefined();
      expect(mockWatcher.close).not.toHaveBeenCalled();
    });
  });

  describe('handleChange', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      watcher.watchProject('proj-1', '/project/path', 'my-book');
    });

    it('should ignore non-.md files', () => {
      watcher.handleChange('proj-1', '/project/path', '/project/path/file.txt', 'add');

      expect(watcher.stats.changesDetected).toBe(0);
      expect(watcher.pendingChanges.get('proj-1').size).toBe(0);
    });

    it('should log warning for unlink events and not trigger sync', () => {
      watcher.handleChange(
        'proj-1',
        '/project/path',
        '/project/path/docs/bookstack/my-book/file.md',
        'unlink'
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          project: 'proj-1',
          file: expect.stringContaining('file.md'),
        }),
        expect.stringContaining('deleted')
      );
      expect(watcher.stats.changesDetected).toBe(0);
      expect(watcher.pendingChanges.get('proj-1').size).toBe(0);
    });

    it('should detect .md file changes', () => {
      watcher.handleChange(
        'proj-1',
        '/project/path',
        '/project/path/docs/bookstack/my-book/file.md',
        'add'
      );

      expect(watcher.stats.changesDetected).toBe(1);
      expect(
        watcher.pendingChanges.get('proj-1').has('/project/path/docs/bookstack/my-book/file.md')
      ).toBe(true);
    });

    it('should increment changesDetected stat', () => {
      expect(watcher.stats.changesDetected).toBe(0);

      watcher.handleChange('proj-1', '/project/path', '/project/path/file1.md', 'add');
      expect(watcher.stats.changesDetected).toBe(1);

      watcher.handleChange('proj-1', '/project/path', '/project/path/file2.md', 'change');
      expect(watcher.stats.changesDetected).toBe(2);
    });

    it('should add file to pending changes', () => {
      const filePath = '/project/path/docs/bookstack/my-book/file.md';
      watcher.handleChange('proj-1', '/project/path', filePath, 'add');

      expect(watcher.pendingChanges.get('proj-1')).toContain(filePath);
    });

    it('should schedule sync on change', () => {
      const scheduleSyncSpy = vi.spyOn(watcher, 'scheduleSync');

      watcher.handleChange('proj-1', '/project/path', '/project/path/file.md', 'add');

      expect(scheduleSyncSpy).toHaveBeenCalledWith('proj-1', '/project/path');
    });
  });

  describe('triggerSync', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      watcher.watchProject('proj-1', '/project/path', 'my-book');
    });

    it('should call onBookStackChange callback with changed files', async () => {
      const filePath = '/project/path/docs/bookstack/my-book/file.md';
      watcher.pendingChanges.get('proj-1').add(filePath);

      await watcher.triggerSync('proj-1', '/project/path');

      expect(onBookStackChange).toHaveBeenCalledWith(
        expect.objectContaining({
          projectIdentifier: 'proj-1',
          projectPath: '/project/path',
          changedFiles: [filePath],
          timestamp: expect.any(String),
        })
      );
    });

    it('should increment syncsTriggered stat', async () => {
      watcher.pendingChanges.get('proj-1').add('/project/path/file.md');

      expect(watcher.stats.syncsTriggered).toBe(0);
      await watcher.triggerSync('proj-1', '/project/path');
      expect(watcher.stats.syncsTriggered).toBe(1);
    });

    it('should do nothing when no pending changes', async () => {
      await watcher.triggerSync('proj-1', '/project/path');

      expect(onBookStackChange).not.toHaveBeenCalled();
      expect(watcher.stats.syncsTriggered).toBe(0);
    });

    it('should clear pending changes after sync', async () => {
      watcher.pendingChanges.get('proj-1').add('/project/path/file.md');

      await watcher.triggerSync('proj-1', '/project/path');

      expect(watcher.pendingChanges.get('proj-1').size).toBe(0);
    });

    it('should handle callback errors gracefully', async () => {
      onBookStackChange.mockRejectedValue(new Error('Callback error'));
      watcher.pendingChanges.get('proj-1').add('/project/path/file.md');

      await expect(watcher.triggerSync('proj-1', '/project/path')).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ project: 'proj-1' }),
        expect.stringContaining('Error in BookStack change callback')
      );
    });
  });

  describe('syncWithDatabase', () => {
    it('should watch projects with matching book slugs and existing docs dirs', async () => {
      mockDb.getProjectsWithFilesystemPath.mockReturnValue([
        { identifier: 'proj-1', filesystem_path: '/path/1' },
        { identifier: 'proj-2', filesystem_path: '/path/2' },
      ]);

      mockBookstackService.getBookSlugForProject.mockImplementation(id => {
        return id === 'proj-1' ? 'book-1' : 'book-2';
      });

      mockFs.existsSync.mockReturnValue(true);

      const result = await watcher.syncWithDatabase();

      expect(result.available).toBe(2);
      expect(result.watching).toBe(2);
      expect(watcher.watchers.size).toBe(2);
    });

    it('should remove watchers for removed projects', async () => {
      mockFs.existsSync.mockReturnValue(true);
      watcher.watchProject('proj-1', '/path/1', 'book-1');
      watcher.watchProject('proj-2', '/path/2', 'book-2');

      mockDb.getProjectsWithFilesystemPath.mockReturnValue([
        { identifier: 'proj-1', filesystem_path: '/path/1' },
      ]);

      mockBookstackService.getBookSlugForProject.mockReturnValue('book-1');

      await watcher.syncWithDatabase();

      expect(watcher.watchers.has('proj-1')).toBe(true);
      expect(watcher.watchers.has('proj-2')).toBe(false);
    });

    it('should skip projects without filesystem_path', async () => {
      mockDb.getProjectsWithFilesystemPath.mockReturnValue([
        { identifier: 'proj-1', filesystem_path: null },
      ]);

      const result = await watcher.syncWithDatabase();

      expect(result.available).toBe(0);
      expect(result.watching).toBe(0);
    });

    it('should skip projects without book slug', async () => {
      mockDb.getProjectsWithFilesystemPath.mockReturnValue([
        { identifier: 'proj-1', filesystem_path: '/path/1' },
      ]);

      mockBookstackService.getBookSlugForProject.mockReturnValue(null);

      const result = await watcher.syncWithDatabase();

      expect(result.available).toBe(0);
      expect(result.watching).toBe(0);
    });

    it('should skip projects without existing docs dir', async () => {
      mockDb.getProjectsWithFilesystemPath.mockReturnValue([
        { identifier: 'proj-1', filesystem_path: '/path/1' },
      ]);

      mockBookstackService.getBookSlugForProject.mockReturnValue('book-1');
      mockFs.existsSync.mockReturnValue(false);

      const result = await watcher.syncWithDatabase();

      expect(result.available).toBe(0);
      expect(result.watching).toBe(0);
    });

    it('should return early if no db', async () => {
      const watcherNoDb = new BookStackWatcher({
        db: null,
        bookstackService: mockBookstackService,
        onBookStackChange,
      });

      const result = await watcherNoDb.syncWithDatabase();

      expect(result).toEqual({ watching: 0, available: 0 });
    });
  });

  describe('closeAll', () => {
    it('should close all watchers', async () => {
      mockFs.existsSync.mockReturnValue(true);
      watcher.watchProject('proj-1', '/path/1', 'book-1');
      watcher.watchProject('proj-2', '/path/2', 'book-2');

      await watcher.closeAll();

      expect(mockWatcher.close).toHaveBeenCalledTimes(2);
      expect(watcher.watchers.size).toBe(0);
    });

    it('should log when all watchers closed', async () => {
      mockFs.existsSync.mockReturnValue(true);
      watcher.watchProject('proj-1', '/path/1', 'book-1');

      await watcher.closeAll();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('All BookStack watchers closed')
      );
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      mockFs.existsSync.mockReturnValue(true);
      watcher.watchProject('proj-1', '/path/1', 'book-1');
      watcher.watchProject('proj-2', '/path/2', 'book-2');

      watcher.stats.changesDetected = 5;
      watcher.stats.syncsTriggered = 2;

      const stats = watcher.getStats();

      expect(stats).toEqual({
        projectsWatched: 2,
        changesDetected: 5,
        syncsTriggered: 2,
        watchedProjects: ['proj-1', 'proj-2'],
      });
    });

    it('should include watched projects list', () => {
      mockFs.existsSync.mockReturnValue(true);
      watcher.watchProject('proj-1', '/path/1', 'book-1');

      const stats = watcher.getStats();

      expect(stats.watchedProjects).toContain('proj-1');
    });
  });

  describe('debouncing', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      watcher.watchProject('proj-1', '/project/path', 'my-book');
    });

    it('should debounce multiple changes', async () => {
      watcher.handleChange('proj-1', '/project/path', '/project/path/file1.md', 'add');
      watcher.handleChange('proj-1', '/project/path', '/project/path/file2.md', 'add');
      watcher.handleChange('proj-1', '/project/path', '/project/path/file3.md', 'add');

      expect(onBookStackChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);

      expect(onBookStackChange).toHaveBeenCalledTimes(1);
      expect(onBookStackChange).toHaveBeenCalledWith(
        expect.objectContaining({
          changedFiles: expect.arrayContaining([
            '/project/path/file1.md',
            '/project/path/file2.md',
            '/project/path/file3.md',
          ]),
        })
      );
    });

    it('should reset debounce timer on new changes', async () => {
      watcher.handleChange('proj-1', '/project/path', '/project/path/file1.md', 'add');
      vi.advanceTimersByTime(50);

      watcher.handleChange('proj-1', '/project/path', '/project/path/file2.md', 'add');
      vi.advanceTimersByTime(50);

      expect(onBookStackChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);

      expect(onBookStackChange).toHaveBeenCalledTimes(1);
    });
  });

  describe('chokidar event handlers', () => {
    it('should register add event handler', () => {
      mockFs.existsSync.mockReturnValue(true);
      watcher.watchProject('proj-1', '/project/path', 'my-book');

      expect(mockWatcher.on).toHaveBeenCalledWith('add', expect.any(Function));
    });

    it('should register change event handler', () => {
      mockFs.existsSync.mockReturnValue(true);
      watcher.watchProject('proj-1', '/project/path', 'my-book');

      expect(mockWatcher.on).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should register unlink event handler', () => {
      mockFs.existsSync.mockReturnValue(true);
      watcher.watchProject('proj-1', '/project/path', 'my-book');

      expect(mockWatcher.on).toHaveBeenCalledWith('unlink', expect.any(Function));
    });

    it('should register error event handler', () => {
      mockFs.existsSync.mockReturnValue(true);
      watcher.watchProject('proj-1', '/project/path', 'my-book');

      expect(mockWatcher.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should register ready event handler', () => {
      mockFs.existsSync.mockReturnValue(true);
      watcher.watchProject('proj-1', '/project/path', 'my-book');

      expect(mockWatcher.on).toHaveBeenCalledWith('ready', expect.any(Function));
    });
  });
});
