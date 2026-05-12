import chokidar from 'chokidar';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from './logger';

const DEBOUNCE_DELAY = 2000;

interface WatcherInfo {
  watcher: ReturnType<typeof chokidar.watch>;
  projectPath: string;
  bookSlug: string;
}

interface BookStackWatcherOptions {
  db: { getProjectsWithFilesystemPath: () => Array<{ identifier: string; filesystem_path: string }> };
  bookstackService: {
    config: { docsSubdir: string };
    getBookSlugForProject: (id: string) => string | null;
  };
  onBookStackChange: ((event: {
    projectIdentifier: string;
    projectPath: string;
    changedFiles: string[];
    timestamp: string;
  }) => Promise<void>) | null;
  debounceDelay?: number;
}

interface WatcherStats {
  projectsWatched: number;
  changesDetected: number;
  syncsTriggered: number;
}

export class BookStackWatcher {
  private db: BookStackWatcherOptions['db'];
  private bookstackService: BookStackWatcherOptions['bookstackService'];
  private onBookStackChange: BookStackWatcherOptions['onBookStackChange'];
  private debounceDelay: number;
  private watchers: Map<string, WatcherInfo>;
  private pendingChanges: Map<string, Set<string>>;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>>;
  private stats: WatcherStats;

  constructor(options: BookStackWatcherOptions) {
    this.db = options.db;
    this.bookstackService = options.bookstackService;
    this.onBookStackChange = options.onBookStackChange;
    this.debounceDelay = options.debounceDelay ?? DEBOUNCE_DELAY;
    this.watchers = new Map();
    this.pendingChanges = new Map();
    this.debounceTimers = new Map();
    this.stats = {
      projectsWatched: 0,
      changesDetected: 0,
      syncsTriggered: 0,
    };
  }

  watchProject(projectIdentifier: string, projectPath: string, bookSlug: string): boolean {
    if (this.watchers.has(projectIdentifier)) {
      return true;
    }

    const docsDir = path.join(projectPath, this.bookstackService.config.docsSubdir, bookSlug);

    if (!fs.existsSync(docsDir)) {
      logger.debug({ project: projectIdentifier, docsDir }, 'No BookStack docs directory found');
      return false;
    }

    try {
      const watcher = chokidar.watch(docsDir, {
        persistent: true,
        ignoreInitial: true,
        depth: 3,
        usePolling: true,
        interval: 1000,
        binaryInterval: 1000,
        awaitWriteFinish: {
          stabilityThreshold: 500,
          pollInterval: 1000,
        },
        ignored: [/(^|[/\\])\../, /node_modules/],
      });

      watcher
        .on('add', (filePath: string) =>
          this.handleChange(projectIdentifier, projectPath, filePath, 'add'),
        )
        .on('change', (filePath: string) =>
          this.handleChange(projectIdentifier, projectPath, filePath, 'change'),
        )
        .on('unlink', (filePath: string) =>
          this.handleChange(projectIdentifier, projectPath, filePath, 'unlink'),
        )
        .on('error', (error: unknown) => {
          logger.error({ project: projectIdentifier, err: error }, 'BookStack watcher error');
        })
        .on('ready', () => {
          logger.info({ project: projectIdentifier, docsDir }, 'BookStack watcher ready');
        });

      this.watchers.set(projectIdentifier, { watcher, projectPath, bookSlug });
      this.pendingChanges.set(projectIdentifier, new Set());
      this.stats.projectsWatched++;

      logger.info(
        { project: projectIdentifier, docsDir },
        'Started watching BookStack docs directory',
      );

      return true;
    } catch (error) {
      logger.error(
        { project: projectIdentifier, docsDir, err: error },
        'Failed to start BookStack watcher',
      );
      return false;
    }
  }

  async unwatchProject(projectIdentifier: string): Promise<void> {
    const watcherInfo = this.watchers.get(projectIdentifier);
    if (watcherInfo) {
      await watcherInfo.watcher.close();
      this.watchers.delete(projectIdentifier);
      this.pendingChanges.delete(projectIdentifier);

      const timer = this.debounceTimers.get(projectIdentifier);
      if (timer) {
        clearTimeout(timer);
        this.debounceTimers.delete(projectIdentifier);
      }

      this.stats.projectsWatched--;
      logger.info({ project: projectIdentifier }, 'Stopped watching BookStack docs directory');
    }
  }

  private handleChange(
    projectIdentifier: string,
    projectPath: string,
    filePath: string,
    eventType: string,
  ): void {
    if (!filePath.endsWith('.md')) {
      return;
    }

    if (eventType === 'unlink') {
      logger.warn(
        { project: projectIdentifier, file: path.relative(projectPath, filePath) },
        'BookStack doc file deleted - will NOT delete from BookStack (Phase 2 policy)',
      );
      return;
    }

    this.stats.changesDetected++;

    const relativePath = path.relative(projectPath, filePath);
    logger.debug(
      { project: projectIdentifier, file: relativePath, event: eventType },
      'BookStack doc file change detected',
    );

    const pending = this.pendingChanges.get(projectIdentifier);
    if (pending) {
      pending.add(filePath);
    }

    this.scheduleSync(projectIdentifier, projectPath);
  }

  private scheduleSync(projectIdentifier: string, projectPath: string): void {
    const existingTimer = this.debounceTimers.get(projectIdentifier);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(projectIdentifier);
      await this.triggerSync(projectIdentifier, projectPath);
    }, this.debounceDelay);

    this.debounceTimers.set(projectIdentifier, timer);
  }

  private async triggerSync(projectIdentifier: string, projectPath: string): Promise<void> {
    const pending = this.pendingChanges.get(projectIdentifier);
    const changedFiles = pending ? Array.from(pending) : [];

    if (pending) {
      pending.clear();
    }

    if (changedFiles.length === 0) {
      return;
    }

    logger.info(
      {
        project: projectIdentifier,
        fileCount: changedFiles.length,
        files: changedFiles.slice(0, 5).map((f) => path.relative(projectPath, f)),
      },
      'Triggering BookStack import from file changes',
    );

    this.stats.syncsTriggered++;

    if (this.onBookStackChange) {
      try {
        await this.onBookStackChange({
          projectIdentifier,
          projectPath,
          changedFiles,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error(
          { project: projectIdentifier, err: error },
          'Error in BookStack change callback',
        );
      }
    }
  }

  async syncWithDatabase(): Promise<{ watching: number; available: number }> {
    if (!this.db) {
      return { watching: 0, available: 0 };
    }

    const projects = this.db.getProjectsWithFilesystemPath();
    let available = 0;

    for (const project of projects) {
      const { identifier, filesystem_path } = project;
      if (!filesystem_path) continue;

      const bookSlug = this.bookstackService.getBookSlugForProject(identifier);
      if (!bookSlug) continue;

      const docsDir = path.join(
        filesystem_path,
        this.bookstackService.config.docsSubdir,
        bookSlug,
      );

      if (fs.existsSync(docsDir)) {
        available++;
        this.watchProject(identifier, filesystem_path, bookSlug);
      }
    }

    const activeProjectIds = new Set(projects.map((p) => p.identifier));
    for (const [projectIdentifier] of this.watchers) {
      if (!activeProjectIds.has(projectIdentifier)) {
        await this.unwatchProject(projectIdentifier);
      }
    }

    logger.info(
      { watching: this.watchers.size, available },
      'Synced BookStack watchers with database',
    );

    return { watching: this.watchers.size, available };
  }

  getStats(): WatcherStats & { watchedProjects: string[] } {
    return {
      ...this.stats,
      watchedProjects: Array.from(this.watchers.keys()),
    };
  }

  async closeAll(): Promise<void> {
    for (const [projectIdentifier] of this.watchers) {
      await this.unwatchProject(projectIdentifier);
    }
    logger.info('All BookStack watchers closed');
  }
}

export function createBookStackWatcher(options: BookStackWatcherOptions): BookStackWatcher {
  return new BookStackWatcher(options);
}

export default BookStackWatcher;
