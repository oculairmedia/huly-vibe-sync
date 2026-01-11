/**
 * Beads File Watcher
 *
 * Watches .beads directories in project folders for changes and triggers
 * Beads→Huly sync when modifications are detected.
 *
 * When USE_TEMPORAL_BEADS=true, uses durable Temporal workflows instead of
 * in-memory callbacks. This provides automatic retry, crash recovery, and
 * observability.
 *
 * @module BeadsWatcher
 */

import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import { logger } from './logger.js';

// Feature flag for Temporal integration
const USE_TEMPORAL_BEADS = process.env.USE_TEMPORAL_BEADS === 'true';

// Lazy-loaded Temporal client
let temporalClient = null;

/**
 * Get Temporal client (lazy initialization)
 */
async function getTemporalClient() {
  if (!temporalClient && USE_TEMPORAL_BEADS) {
    try {
      const { scheduleBeadsFileChange, isTemporalAvailable } = await import(
        '../temporal/dist/client.js'
      );

      if (await isTemporalAvailable()) {
        temporalClient = { scheduleBeadsFileChange };
        logger.info('[BeadsWatcher] Temporal integration enabled');
      } else {
        logger.warn('[BeadsWatcher] Temporal not available, using callback mode');
      }
    } catch (err) {
      logger.warn({ err }, '[BeadsWatcher] Failed to load Temporal client');
    }
  }
  return temporalClient;
}

/**
 * Debounce delay for batching rapid file changes (ms)
 */
const DEBOUNCE_DELAY = 2000;

/**
 * BeadsWatcher class
 * Watches .beads directories for file changes and triggers sync callbacks
 */
export class BeadsWatcher {
  /**
   * Create a new BeadsWatcher
   * @param {Object} options - Watcher options
   * @param {Object} options.db - Database instance
   * @param {Function} options.onBeadsChange - Callback when Beads changes detected
   * @param {number} [options.debounceDelay] - Debounce delay in ms (default: 2000)
   */
  constructor({ db, onBeadsChange, debounceDelay = DEBOUNCE_DELAY }) {
    this.db = db;
    this.onBeadsChange = onBeadsChange;
    this.debounceDelay = debounceDelay;
    this.watchers = new Map(); // projectIdentifier -> chokidar watcher
    this.pendingChanges = new Map(); // projectIdentifier -> Set of changed files
    this.debounceTimers = new Map(); // projectIdentifier -> timer
    this.stats = {
      projectsWatched: 0,
      changesDetected: 0,
      syncsTriggered: 0,
    };
  }

  /**
   * Start watching a project's .beads directory
   * @param {string} projectIdentifier - Project identifier (e.g., 'HVSYN')
   * @param {string} projectPath - Path to the project root
   * @returns {boolean} Whether watching started successfully
   */
  watchProject(projectIdentifier, projectPath) {
    // Check if already watching
    if (this.watchers.has(projectIdentifier)) {
      logger.debug({ project: projectIdentifier }, 'Already watching project');
      return true;
    }

    const beadsPath = path.join(projectPath, '.beads');

    // Check if .beads directory exists
    if (!fs.existsSync(beadsPath)) {
      logger.debug({ project: projectIdentifier, beadsPath }, 'No .beads directory found');
      return false;
    }

    try {
      const watcher = chokidar.watch(beadsPath, {
        persistent: true,
        ignoreInitial: true,
        depth: 2,
        usePolling: true,
        interval: 1000,
        binaryInterval: 1000,
        awaitWriteFinish: {
          stabilityThreshold: 500,
          pollInterval: 100,
        },
        ignored: [/(^|[\/\\])\..(?!beads)/, /node_modules/, /\.git/],
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
          logger.error({ project: projectIdentifier, err: error }, 'Beads watcher error');
        })
        .on('ready', () => {
          logger.info({ project: projectIdentifier, beadsPath }, 'Beads watcher ready');
        });

      this.watchers.set(projectIdentifier, { watcher, projectPath });
      this.pendingChanges.set(projectIdentifier, new Set());
      this.stats.projectsWatched++;

      logger.info({ project: projectIdentifier, beadsPath }, 'Started watching .beads directory');

      return true;
    } catch (error) {
      logger.error(
        { project: projectIdentifier, beadsPath, err: error },
        'Failed to start Beads watcher'
      );
      return false;
    }
  }

  /**
   * Stop watching a project
   * @param {string} projectIdentifier - Project identifier
   */
  async unwatchProject(projectIdentifier) {
    const watcherInfo = this.watchers.get(projectIdentifier);
    if (watcherInfo) {
      await watcherInfo.watcher.close();
      this.watchers.delete(projectIdentifier);
      this.pendingChanges.delete(projectIdentifier);

      // Clear any pending debounce timer
      const timer = this.debounceTimers.get(projectIdentifier);
      if (timer) {
        clearTimeout(timer);
        this.debounceTimers.delete(projectIdentifier);
      }

      this.stats.projectsWatched--;
      logger.info({ project: projectIdentifier }, 'Stopped watching .beads directory');
    }
  }

  /**
   * Handle a file change event
   * @param {string} projectIdentifier - Project identifier
   * @param {string} projectPath - Project root path
   * @param {string} filePath - Changed file path
   * @param {string} eventType - Event type (add, change, unlink)
   */
  handleChange(projectIdentifier, projectPath, filePath, eventType) {
    const relativePath = path.relative(projectPath, filePath);
    const fileName = path.basename(filePath);

    // Watch all beads data files including SQLite WAL mode files
    // SQLite WAL mode writes to beads.db-wal first, then checkpoints to beads.db
    const isRelevantFile =
      relativePath.includes('.beads/issues') ||
      relativePath.includes('.beads\\issues') ||
      fileName === 'issues.jsonl' ||
      fileName === 'beads.db' ||
      fileName === 'beads.db-wal' ||
      fileName === 'beads.db-shm';

    if (!isRelevantFile) {
      logger.debug(
        { project: projectIdentifier, file: relativePath, event: eventType },
        'Ignoring non-issue Beads file change'
      );
      return;
    }

    this.stats.changesDetected++;

    logger.debug(
      { project: projectIdentifier, file: relativePath, event: eventType },
      'Beads file change detected'
    );

    // Add to pending changes
    const pending = this.pendingChanges.get(projectIdentifier);
    if (pending) {
      pending.add(relativePath);
    }

    // Debounce: wait for changes to settle before triggering sync
    this.scheduleSync(projectIdentifier, projectPath);
  }

  /**
   * Schedule a debounced sync for a project
   * @param {string} projectIdentifier - Project identifier
   * @param {string} projectPath - Project root path
   */
  scheduleSync(projectIdentifier, projectPath) {
    // Clear existing timer
    const existingTimer = this.debounceTimers.get(projectIdentifier);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(projectIdentifier);
      await this.triggerSync(projectIdentifier, projectPath);
    }, this.debounceDelay);

    this.debounceTimers.set(projectIdentifier, timer);
  }

  /**
   * Trigger a sync for a project
   * @param {string} projectIdentifier - Project identifier
   * @param {string} projectPath - Project root path
   */
  async triggerSync(projectIdentifier, projectPath) {
    const pending = this.pendingChanges.get(projectIdentifier);
    const changedFiles = pending ? Array.from(pending) : [];

    // Clear pending changes
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
        files: changedFiles.slice(0, 5),
      },
      'Triggering Beads→Huly sync from file changes'
    );

    this.stats.syncsTriggered++;

    // Try Temporal workflow first (if enabled)
    const temporal = await getTemporalClient();
    if (temporal) {
      try {
        // Get vibeProjectId from database
        const project = this.db?.getProject?.(projectIdentifier);
        const vibeProjectId = project?.vibe_id?.toString() || '';

        if (!vibeProjectId) {
          logger.warn(
            { project: projectIdentifier },
            '[BeadsWatcher] No vibe_id found, falling back to callback'
          );
        } else {
          const { workflowId } = await temporal.scheduleBeadsFileChange({
            projectIdentifier,
            gitRepoPath: projectPath,
            vibeProjectId,
            changedFiles,
            timestamp: new Date().toISOString(),
          });

          logger.info(
            { project: projectIdentifier, workflowId },
            '[BeadsWatcher] Scheduled Temporal workflow for Beads sync'
          );
          return; // Temporal handled it
        }
      } catch (error) {
        logger.warn(
          { project: projectIdentifier, err: error },
          '[BeadsWatcher] Temporal failed, falling back to callback'
        );
      }
    }

    // Fallback to callback (legacy mode)
    if (this.onBeadsChange) {
      try {
        await this.onBeadsChange({
          projectIdentifier,
          projectPath,
          changedFiles,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ project: projectIdentifier, err: error }, 'Error in Beads change callback');
      }
    }
  }

  /**
   * Sync watchers with database - start watching all projects with .beads directories
   * @returns {Promise<{watching: number, available: number}>} Sync result
   */
  async syncWithDatabase() {
    if (!this.db) {
      logger.warn('No database available for BeadsWatcher sync');
      return { watching: 0, available: 0 };
    }

    // Get all projects with filesystem paths
    const projects = this.db.getProjectsWithFilesystemPath();
    let available = 0;

    for (const project of projects) {
      const { identifier, filesystem_path } = project;

      if (!filesystem_path) continue;

      // Check if .beads directory exists
      const beadsPath = path.join(filesystem_path, '.beads');
      if (fs.existsSync(beadsPath)) {
        available++;
        this.watchProject(identifier, filesystem_path);
      }
    }

    // Remove watchers for projects no longer in DB or without .beads
    const activeProjectIds = new Set(projects.map(p => p.identifier));
    for (const [projectIdentifier] of this.watchers) {
      if (!activeProjectIds.has(projectIdentifier)) {
        await this.unwatchProject(projectIdentifier);
      }
    }

    logger.info({ watching: this.watchers.size, available }, 'Synced Beads watchers with database');

    return { watching: this.watchers.size, available };
  }

  /**
   * Get watcher statistics
   * @returns {Object} Watcher stats
   */
  getStats() {
    return {
      ...this.stats,
      watchedProjects: Array.from(this.watchers.keys()),
    };
  }

  /**
   * Close all watchers
   */
  async closeAll() {
    for (const [projectIdentifier] of this.watchers) {
      await this.unwatchProject(projectIdentifier);
    }
    logger.info('All Beads watchers closed');
  }
}

/**
 * Create a BeadsWatcher instance
 * @param {Object} options - Watcher options
 * @returns {BeadsWatcher} Watcher instance
 */
export function createBeadsWatcher(options) {
  return new BeadsWatcher(options);
}

export default BeadsWatcher;
