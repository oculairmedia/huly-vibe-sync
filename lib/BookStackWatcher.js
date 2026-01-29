import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import { logger } from './logger.js';

const DEBOUNCE_DELAY = 2000;

export class BookStackWatcher {
  constructor({ db, bookstackService, onBookStackChange, debounceDelay = DEBOUNCE_DELAY }) {
    this.db = db;
    this.bookstackService = bookstackService;
    this.onBookStackChange = onBookStackChange;
    this.debounceDelay = debounceDelay;
    this.watchers = new Map();
    this.pendingChanges = new Map();
    this.debounceTimers = new Map();
    this.stats = {
      projectsWatched: 0,
      changesDetected: 0,
      syncsTriggered: 0,
    };
  }

  watchProject(projectIdentifier, projectPath, bookSlug) {
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
          pollInterval: 100,
        },
        ignored: [/(^|[/\\])\../, /node_modules/],
      });

      watcher
        .on('add', filePath => this.handleChange(projectIdentifier, projectPath, filePath, 'add'))
        .on('change', filePath =>
          this.handleChange(projectIdentifier, projectPath, filePath, 'change')
        )
        .on('unlink', filePath =>
          this.handleChange(projectIdentifier, projectPath, filePath, 'unlink')
        )
        .on('error', error => {
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
        'Started watching BookStack docs directory'
      );

      return true;
    } catch (error) {
      logger.error(
        { project: projectIdentifier, docsDir, err: error },
        'Failed to start BookStack watcher'
      );
      return false;
    }
  }

  async unwatchProject(projectIdentifier) {
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

  handleChange(projectIdentifier, projectPath, filePath, eventType) {
    if (!filePath.endsWith('.md')) {
      return;
    }

    if (eventType === 'unlink') {
      logger.warn(
        { project: projectIdentifier, file: path.relative(projectPath, filePath) },
        'BookStack doc file deleted - will NOT delete from BookStack (Phase 2 policy)'
      );
      return;
    }

    this.stats.changesDetected++;

    const relativePath = path.relative(projectPath, filePath);
    logger.debug(
      { project: projectIdentifier, file: relativePath, event: eventType },
      'BookStack doc file change detected'
    );

    const pending = this.pendingChanges.get(projectIdentifier);
    if (pending) {
      pending.add(filePath);
    }

    this.scheduleSync(projectIdentifier, projectPath);
  }

  scheduleSync(projectIdentifier, projectPath) {
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

  async triggerSync(projectIdentifier, projectPath) {
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
        files: changedFiles.slice(0, 5).map(f => path.relative(projectPath, f)),
      },
      'Triggering BookStack import from file changes'
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
          'Error in BookStack change callback'
        );
      }
    }
  }

  async syncWithDatabase() {
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

      const docsDir = path.join(filesystem_path, this.bookstackService.config.docsSubdir, bookSlug);

      if (fs.existsSync(docsDir)) {
        available++;
        this.watchProject(identifier, filesystem_path, bookSlug);
      }
    }

    const activeProjectIds = new Set(projects.map(p => p.identifier));
    for (const [projectIdentifier] of this.watchers) {
      if (!activeProjectIds.has(projectIdentifier)) {
        await this.unwatchProject(projectIdentifier);
      }
    }

    logger.info(
      { watching: this.watchers.size, available },
      'Synced BookStack watchers with database'
    );

    return { watching: this.watchers.size, available };
  }

  getStats() {
    return {
      ...this.stats,
      watchedProjects: Array.from(this.watchers.keys()),
    };
  }

  async closeAll() {
    for (const [projectIdentifier] of this.watchers) {
      await this.unwatchProject(projectIdentifier);
    }
    logger.info('All BookStack watchers closed');
  }
}

export function createBookStackWatcher(options) {
  return new BookStackWatcher(options);
}

export default BookStackWatcher;
