/**
 * File change detection and debounce scheduling
 */

import path from 'path';
import chokidar from 'chokidar';
import { createGraphitiClient } from '../GraphitiClient.js';
import { ASTCache } from '../ASTCache.js';

export class FileChangeDetector {
  constructor(state, config) {
    this._s = state;
    this.config = config;
  }

  watchProject(projectIdentifier, projectPath) {
    if (this._s.watchers.has(projectIdentifier)) {
      this._s.log.debug({ project: projectIdentifier }, 'Already watching project');
      return;
    }

    if (!this._s.fs.exists(projectPath)) {
      this._s.log.warn(
        { project: projectIdentifier, path: projectPath },
        'Project path does not exist'
      );
      return;
    }

    const client = createGraphitiClient(this.config, projectIdentifier);
    if (!client) {
      this._s.log.debug({ project: projectIdentifier }, 'Graphiti disabled, skipping watch');
      return;
    }
    this._s.graphitiClients.set(projectIdentifier, client);

    if (this._s.astEnabled) {
      const astCache = new ASTCache({
        projectId: projectIdentifier,
        projectPath: projectPath,
      });
      astCache.load().catch(err => {
        this._s.log.warn({ err, project: projectIdentifier }, 'Failed to load AST cache');
      });
      this._s.astCaches.set(projectIdentifier, astCache);
    }

    this._s.log.info(
      { project: projectIdentifier, path: projectPath },
      'Starting code perception watcher'
    );

    const watcher = chokidar.watch(projectPath, {
      ignored: this._s.ignorePatterns,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
      depth: 15,
    });

    watcher._projectMeta = {
      projectIdentifier,
      projectPath,
    };

    watcher
      .on('add', filePath => this.handleChange(projectIdentifier, filePath, 'add'))
      .on('change', filePath => this.handleChange(projectIdentifier, filePath, 'change'))
      .on('unlink', filePath => this.handleChange(projectIdentifier, filePath, 'unlink'))
      .on('error', error => {
        this._s.log.error({ err: error, project: projectIdentifier }, 'Watcher error');
        this._s.stats.errors++;
      })
      .on('ready', () => {
        const watched = watcher.getWatched();
        const fileCount = Object.values(watched).reduce((sum, files) => sum + files.length, 0);
        this._s.stats.filesWatched += fileCount;
        this._s.log.info(
          { project: projectIdentifier, files: fileCount },
          'Code perception watcher ready'
        );
      });

    this._s.watchers.set(projectIdentifier, watcher);
  }

  async unwatchProject(projectIdentifier) {
    const watcher = this._s.watchers.get(projectIdentifier);
    if (watcher) {
      await watcher.close();
      this._s.watchers.delete(projectIdentifier);
      this._s.graphitiClients.delete(projectIdentifier);
      this._s.pendingChanges.delete(projectIdentifier);

      const timer = this._s.debounceTimers.get(projectIdentifier);
      if (timer) {
        clearTimeout(timer);
        this._s.debounceTimers.delete(projectIdentifier);
      }

      const astCache = this._s.astCaches.get(projectIdentifier);
      if (astCache) {
        await astCache.save();
        this._s.astCaches.delete(projectIdentifier);
      }

      this._s.log.info({ project: projectIdentifier }, 'Stopped code perception watcher');
    }
  }

  handleChange(projectIdentifier, filePath, changeType) {
    const ext = path.extname(filePath).toLowerCase();
    if (!this._s.allowedExtensions.has(ext)) {
      return;
    }

    if (changeType !== 'unlink') {
      try {
        const stats = this._s.fs.stat(filePath);
        if (stats.size > this._s.maxFileSize) {
          this._s.log.debug({ file: filePath, size: stats.size }, 'Skipping large file');
          return;
        }
      } catch (e) {
        return;
      }
    }

    this._s.stats.changesDetected++;

    this.trackBurst(projectIdentifier);

    if (!this._s.pendingChanges.has(projectIdentifier)) {
      this._s.pendingChanges.set(projectIdentifier, new Map());
    }
    const pending = this._s.pendingChanges.get(projectIdentifier);

    if (pending.size >= this._s.maxPendingChanges) {
      const oldestKey = pending.keys().next().value;
      pending.delete(oldestKey);
      this._s.log.warn(
        { project: projectIdentifier, dropped: oldestKey },
        'Backpressure: dropped oldest pending change'
      );
    }

    pending.set(filePath, changeType);

    this._s.log.debug(
      { project: projectIdentifier, file: filePath, type: changeType },
      'File change detected'
    );

    if (this._s.onFileChange) {
      try {
        this._s.onFileChange(projectIdentifier, filePath, changeType);
      } catch (e) {
        this._s.log.warn({ err: e }, 'onFileChange callback failed');
      }
    }

    this.scheduleProcessing(projectIdentifier);
  }

  trackBurst(projectIdentifier) {
    const now = this._s.clock.now();
    let burst = this._s.burstMode.get(projectIdentifier);

    if (!burst || now - burst.startTime > this._s.burstWindowMs) {
      burst = { count: 1, startTime: now };
    } else {
      burst.count++;
    }

    this._s.burstMode.set(projectIdentifier, burst);
  }

  isInBurstMode(projectIdentifier) {
    const burst = this._s.burstMode.get(projectIdentifier);
    if (!burst) return false;

    const now = this._s.clock.now();
    if (now - burst.startTime > this._s.burstWindowMs) {
      return false;
    }

    return burst.count >= this._s.burstThreshold;
  }

  scheduleProcessing(projectIdentifier) {
    const existingTimer = this._s.debounceTimers.get(projectIdentifier);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const delay = this.isInBurstMode(projectIdentifier) ? this._s.debounceMs * 2 : this._s.debounceMs;

    const timer = setTimeout(() => {
      this._s.processPendingChanges(projectIdentifier);
    }, delay);

    this._s.debounceTimers.set(projectIdentifier, timer);
  }
}
