/**
 * CodePerceptionWatcher - Real-time code file watcher for Graphiti Knowledge Graph
 *
 * Watches project directories for file changes and syncs structural/semantic data
 * to the Graphiti Knowledge Graph. Acts as the "sensory organ" for code perception.
 *
 * Flow:
 * 1. FileWatcher (chokidar) detects file changes
 * 2. Debounce (2s) to ensure writes are complete
 * 3. Parse file, extract summary
 * 4. Hash delta check to avoid redundant syncs
 * 5. Push to Graphiti via GraphitiClient
 *
 * Features:
 * - Debouncing to handle rapid file changes
 * - Hash-based delta detection
 * - Burst protection for git checkout (batching)
 * - Graceful degradation when Graphiti is unavailable
 */

import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { logger } from './logger.js';
import { GraphitiClient, createGraphitiClient } from './GraphitiClient.js';

export class CodePerceptionWatcher {
  /**
   * Create a new CodePerceptionWatcher instance
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.config - Application config
   * @param {Object} options.db - Database instance for tracking
   * @param {number} [options.debounceMs=2000] - Debounce delay in ms
   * @param {number} [options.batchSize=50] - Max entities per batch
   * @param {number} [options.maxFileSizeKb=500] - Max file size to process in KB
   */
  constructor(options) {
    this.config = options.config;
    this.db = options.db;

    // Configuration
    this.debounceMs = options.debounceMs || 2000;
    this.batchSize = options.batchSize || 50;
    this.maxFileSize = (options.maxFileSizeKb || 500) * 1024; // Convert to bytes

    // File extension filter
    this.allowedExtensions = new Set([
      // Documentation
      '.md',
      '.txt',
      '.rst',
      // Config
      '.json',
      '.yaml',
      '.yml',
      '.toml',
      '.env',
      '.ini',
      // JavaScript/TypeScript
      '.js',
      '.ts',
      '.tsx',
      '.jsx',
      '.mjs',
      '.cjs',
      // Python
      '.py',
      // Other languages
      '.rs',
      '.go',
      '.java',
      '.rb',
      '.php',
      // Web
      '.html',
      '.css',
      '.scss',
      '.vue',
      '.svelte',
      // Data
      '.sql',
      '.graphql',
      // Shell
      '.sh',
      '.bash',
      '.zsh',
    ]);

    // Ignore patterns
    this.ignorePatterns = [
      '**/node_modules/**',
      '**/.git/**',
      '**/target/**',
      '**/dist/**',
      '**/build/**',
      '**/__pycache__/**',
      '**/.venv/**',
      '**/venv/**',
      '**/.next/**',
      '**/.nuxt/**',
      '**/coverage/**',
      '**/*.log',
      '**/.DS_Store',
      '**/package-lock.json',
      '**/yarn.lock',
      '**/pnpm-lock.yaml',
      '**/*.min.js',
      '**/*.min.css',
      '**/*.map',
    ];

    // State
    this.watchers = new Map(); // projectIdentifier -> chokidar watcher
    this.graphitiClients = new Map(); // projectIdentifier -> GraphitiClient
    this.pendingChanges = new Map(); // projectIdentifier -> Map<filePath, changeType>
    this.fileHashes = new Map(); // filePath -> contentHash
    this.debounceTimers = new Map(); // projectIdentifier -> timer
    this.processing = new Set(); // projectIdentifiers currently being processed
    this.burstMode = new Map(); // projectIdentifier -> { count: number, startTime: number }

    // Burst protection thresholds
    this.burstThreshold = 20; // Changes in burst window to trigger burst mode
    this.burstWindowMs = 3000; // Window to detect burst

    // Backpressure: max pending changes per project before dropping oldest
    this.maxPendingChanges = 500;

    // Stats
    this.stats = {
      filesWatched: 0,
      changesDetected: 0,
      entitiesSynced: 0,
      skippedUnchanged: 0,
      errors: 0,
    };

    this.log = logger.child({ service: 'CodePerceptionWatcher' });
  }

  // ============================================================================
  // Project Watching
  // ============================================================================

  /**
   * Start watching a project directory
   *
   * @param {string} projectIdentifier - Unique project identifier
   * @param {string} projectPath - Absolute path to project directory
   */
  watchProject(projectIdentifier, projectPath) {
    if (this.watchers.has(projectIdentifier)) {
      this.log.debug({ project: projectIdentifier }, 'Already watching project');
      return;
    }

    if (!fs.existsSync(projectPath)) {
      this.log.warn(
        { project: projectIdentifier, path: projectPath },
        'Project path does not exist'
      );
      return;
    }

    // Create GraphitiClient for this project
    const client = createGraphitiClient(this.config, projectIdentifier);
    if (!client) {
      this.log.debug({ project: projectIdentifier }, 'Graphiti disabled, skipping watch');
      return;
    }
    this.graphitiClients.set(projectIdentifier, client);

    this.log.info(
      { project: projectIdentifier, path: projectPath },
      'Starting code perception watcher'
    );

    const watcher = chokidar.watch(projectPath, {
      ignored: this.ignorePatterns,
      persistent: true,
      ignoreInitial: true, // Don't fire events for existing files on startup
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
      depth: 15, // Max directory depth
    });

    // Store project metadata with watcher
    watcher._projectMeta = {
      projectIdentifier,
      projectPath,
    };

    watcher
      .on('add', filePath => this.handleChange(projectIdentifier, filePath, 'add'))
      .on('change', filePath => this.handleChange(projectIdentifier, filePath, 'change'))
      .on('unlink', filePath => this.handleChange(projectIdentifier, filePath, 'unlink'))
      .on('error', error => {
        this.log.error({ err: error, project: projectIdentifier }, 'Watcher error');
        this.stats.errors++;
      })
      .on('ready', () => {
        const watched = watcher.getWatched();
        const fileCount = Object.values(watched).reduce((sum, files) => sum + files.length, 0);
        this.stats.filesWatched += fileCount;
        this.log.info(
          { project: projectIdentifier, files: fileCount },
          'Code perception watcher ready'
        );
      });

    this.watchers.set(projectIdentifier, watcher);
  }

  /**
   * Stop watching a project
   *
   * @param {string} projectIdentifier - Project to stop watching
   */
  async unwatchProject(projectIdentifier) {
    const watcher = this.watchers.get(projectIdentifier);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(projectIdentifier);
      this.graphitiClients.delete(projectIdentifier);
      this.pendingChanges.delete(projectIdentifier);

      const timer = this.debounceTimers.get(projectIdentifier);
      if (timer) {
        clearTimeout(timer);
        this.debounceTimers.delete(projectIdentifier);
      }

      this.log.info({ project: projectIdentifier }, 'Stopped code perception watcher');
    }
  }

  // ============================================================================
  // Change Handling
  // ============================================================================

  /**
   * Handle a file change event
   *
   * @private
   */
  handleChange(projectIdentifier, filePath, changeType) {
    // Filter by extension
    const ext = path.extname(filePath).toLowerCase();
    if (!this.allowedExtensions.has(ext)) {
      return;
    }

    // Check file size for add/change (skip large files)
    if (changeType !== 'unlink') {
      try {
        const stats = fs.statSync(filePath);
        if (stats.size > this.maxFileSize) {
          this.log.debug({ file: filePath, size: stats.size }, 'Skipping large file');
          return;
        }
      } catch (e) {
        // File might have been deleted between event and stat
        return;
      }
    }

    this.stats.changesDetected++;

    // Track burst mode
    this.trackBurst(projectIdentifier);

    // Add to pending changes
    if (!this.pendingChanges.has(projectIdentifier)) {
      this.pendingChanges.set(projectIdentifier, new Map());
    }
    const pending = this.pendingChanges.get(projectIdentifier);

    // Enforce queue cap - drop oldest when full
    if (pending.size >= this.maxPendingChanges) {
      const oldestKey = pending.keys().next().value;
      pending.delete(oldestKey);
      this.log.warn(
        { project: projectIdentifier, dropped: oldestKey },
        'Backpressure: dropped oldest pending change'
      );
    }

    pending.set(filePath, changeType);

    this.log.debug(
      { project: projectIdentifier, file: filePath, type: changeType },
      'File change detected'
    );

    // Debounce processing
    this.scheduleProcessing(projectIdentifier);
  }

  /**
   * Track burst mode (many changes in short window)
   *
   * @private
   */
  trackBurst(projectIdentifier) {
    const now = Date.now();
    let burst = this.burstMode.get(projectIdentifier);

    if (!burst || now - burst.startTime > this.burstWindowMs) {
      // Start new burst window
      burst = { count: 1, startTime: now };
    } else {
      burst.count++;
    }

    this.burstMode.set(projectIdentifier, burst);
  }

  /**
   * Check if in burst mode
   *
   * @private
   */
  isInBurstMode(projectIdentifier) {
    const burst = this.burstMode.get(projectIdentifier);
    if (!burst) return false;

    const now = Date.now();
    if (now - burst.startTime > this.burstWindowMs) {
      return false;
    }

    return burst.count >= this.burstThreshold;
  }

  /**
   * Schedule batch processing with debounce
   *
   * @private
   */
  scheduleProcessing(projectIdentifier) {
    // Clear existing timer
    const existingTimer = this.debounceTimers.get(projectIdentifier);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Use longer debounce in burst mode
    const delay = this.isInBurstMode(projectIdentifier) ? this.debounceMs * 2 : this.debounceMs;

    // Set new timer
    const timer = setTimeout(() => {
      this.processPendingChanges(projectIdentifier);
    }, delay);

    this.debounceTimers.set(projectIdentifier, timer);
  }

  // ============================================================================
  // Processing
  // ============================================================================

  /**
   * Process pending changes for a project
   *
   * @private
   */
  async processPendingChanges(projectIdentifier) {
    // Prevent concurrent processing for same project
    if (this.processing.has(projectIdentifier)) {
      // Reschedule
      this.scheduleProcessing(projectIdentifier);
      return;
    }

    const changes = this.pendingChanges.get(projectIdentifier);
    if (!changes || changes.size === 0) {
      return;
    }

    const watcher = this.watchers.get(projectIdentifier);
    const client = this.graphitiClients.get(projectIdentifier);
    if (!watcher || !watcher._projectMeta || !client) {
      return;
    }

    const { projectPath } = watcher._projectMeta;

    // Take a snapshot of changes and clear pending
    const changesToProcess = new Map(changes);
    changes.clear();

    this.processing.add(projectIdentifier);

    try {
      // Check if Graphiti is available
      const healthy = await client.healthCheck();
      if (!healthy) {
        this.log.warn({ project: projectIdentifier }, 'Graphiti unavailable, deferring sync');
        // Re-add changes for later
        for (const [filePath, changeType] of changesToProcess) {
          changes.set(filePath, changeType);
        }
        this.scheduleProcessing(projectIdentifier);
        return;
      }

      this.log.info(
        {
          project: projectIdentifier,
          changeCount: changesToProcess.size,
          burstMode: this.isInBurstMode(projectIdentifier),
        },
        'Processing file changes'
      );

      const entitiesToUpsert = [];
      const deletedFiles = [];

      for (const [filePath, changeType] of changesToProcess) {
        const relativePath = path.relative(projectPath, filePath);

        if (changeType === 'unlink') {
          deletedFiles.push(relativePath);
        } else {
          // Check hash delta
          const currentHash = this.computeFileHash(filePath);
          if (!currentHash) continue;

          const previousHash = this.fileHashes.get(filePath);
          if (previousHash === currentHash) {
            this.stats.skippedUnchanged++;
            continue;
          }

          // Update hash cache
          this.fileHashes.set(filePath, currentHash);

          // Extract summary from file
          const summary = await this.extractFileSummary(filePath);

          entitiesToUpsert.push({
            name: `File:${relativePath}`,
            summary,
          });
        }
      }

      // Batch upsert entities
      if (entitiesToUpsert.length > 0) {
        const result = await client.upsertEntitiesBatch(entitiesToUpsert, this.batchSize);
        this.stats.entitiesSynced += result.success;

        if (result.failed > 0) {
          this.log.warn(
            { failed: result.failed, errors: result.errors },
            'Some entities failed to sync'
          );
        }
      }

      // Handle deletions with prune-missing
      if (deletedFiles.length > 0) {
        // Get all currently active files in project
        const activeFiles = await this.getActiveProjectFiles(projectPath);
        await client.pruneDeletedFiles(activeFiles);

        // Clean up hash cache for deleted files
        for (const [filePath] of changesToProcess) {
          if (changesToProcess.get(filePath) === 'unlink') {
            this.fileHashes.delete(filePath);
          }
        }
      }

      this.log.info(
        {
          project: projectIdentifier,
          upserted: entitiesToUpsert.length,
          deleted: deletedFiles.length,
          skipped: this.stats.skippedUnchanged,
        },
        'File changes processed'
      );
    } catch (error) {
      this.stats.errors++;
      this.log.error({ err: error, project: projectIdentifier }, 'Error processing changes');
    } finally {
      this.processing.delete(projectIdentifier);
      this.burstMode.delete(projectIdentifier);
    }
  }

  // ============================================================================
  // File Processing
  // ============================================================================

  /**
   * Compute MD5 hash of file content
   *
   * @private
   */
  computeFileHash(filePath) {
    try {
      const content = fs.readFileSync(filePath);
      return crypto.createHash('md5').update(content).digest('hex');
    } catch (e) {
      return null;
    }
  }

  /**
   * Extract a summary from file content
   * Phase 1: Simple first-lines extraction
   * Future: Use Tree-sitter for AST-based extraction
   *
   * @private
   */
  async extractFileSummary(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const ext = path.extname(filePath).toLowerCase();
      const basename = path.basename(filePath);

      // Get language from extension
      const language = this.detectLanguage(ext);

      // Extract first meaningful lines (skip empty, comments at start)
      const lines = content.split('\n');
      const previewLines = [];
      let foundCode = false;

      for (const line of lines) {
        if (previewLines.length >= 10) break;

        const trimmed = line.trim();
        if (!trimmed) continue;

        // Skip shebang
        if (trimmed.startsWith('#!')) continue;

        // Skip common comment patterns at file start
        if (!foundCode) {
          if (
            trimmed.startsWith('//') ||
            trimmed.startsWith('#') ||
            trimmed.startsWith('/*') ||
            trimmed.startsWith('*') ||
            trimmed.startsWith('"""') ||
            trimmed.startsWith("'''")
          ) {
            continue;
          }
          foundCode = true;
        }

        previewLines.push(trimmed);
      }

      const preview = previewLines.join(' ').slice(0, 500);
      const lineCount = lines.length;
      const sizeKb = Math.round(content.length / 1024);

      return `${language} file "${basename}" (${lineCount} lines, ${sizeKb}KB). Preview: ${preview}`;
    } catch (e) {
      this.log.warn({ err: e, file: filePath }, 'Failed to extract summary');
      return `File: ${path.basename(filePath)}`;
    }
  }

  /**
   * Detect programming language from extension
   *
   * @private
   */
  detectLanguage(ext) {
    const languages = {
      '.js': 'JavaScript',
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript React',
      '.jsx': 'JavaScript React',
      '.py': 'Python',
      '.rs': 'Rust',
      '.go': 'Go',
      '.java': 'Java',
      '.rb': 'Ruby',
      '.php': 'PHP',
      '.md': 'Markdown',
      '.json': 'JSON',
      '.yaml': 'YAML',
      '.yml': 'YAML',
      '.toml': 'TOML',
      '.html': 'HTML',
      '.css': 'CSS',
      '.scss': 'SCSS',
      '.sql': 'SQL',
      '.graphql': 'GraphQL',
      '.sh': 'Shell',
      '.bash': 'Bash',
      '.vue': 'Vue',
      '.svelte': 'Svelte',
    };
    return languages[ext] || 'Unknown';
  }

  /**
   * Get list of active files in project
   *
   * @private
   */
  async getActiveProjectFiles(projectPath) {
    const files = [];

    const walk = dir => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          // Skip ignored directories
          if (entry.isDirectory()) {
            if (this.shouldIgnoreDir(entry.name)) continue;
            walk(fullPath);
          } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (this.allowedExtensions.has(ext)) {
              files.push(path.relative(projectPath, fullPath));
            }
          }
        }
      } catch (e) {
        // Ignore permission errors etc
      }
    };

    walk(projectPath);
    return files;
  }

  /**
   * Check if directory should be ignored
   *
   * @private
   */
  shouldIgnoreDir(name) {
    const ignoreDirs = new Set([
      'node_modules',
      '.git',
      'target',
      'dist',
      'build',
      '__pycache__',
      '.venv',
      'venv',
      '.next',
      '.nuxt',
      'coverage',
      '.cache',
      '.tmp',
    ]);
    return ignoreDirs.has(name) || name.startsWith('.');
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Perform initial sync of all files in project
   * Use when first connecting a project to Graphiti
   *
   * @param {string} projectIdentifier - Project identifier
   * @param {string} projectPath - Project path
   */
  async initialSync(projectIdentifier, projectPath) {
    const client = this.graphitiClients.get(projectIdentifier);
    if (!client) {
      this.log.warn({ project: projectIdentifier }, 'No Graphiti client for initial sync');
      return;
    }

    this.log.info({ project: projectIdentifier }, 'Starting initial sync');

    const files = await this.getActiveProjectFiles(projectPath);
    const entities = [];

    for (const relativePath of files) {
      const fullPath = path.join(projectPath, relativePath);
      const summary = await this.extractFileSummary(fullPath);

      entities.push({
        name: `File:${relativePath}`,
        summary,
      });

      // Update hash cache
      const hash = this.computeFileHash(fullPath);
      if (hash) {
        this.fileHashes.set(fullPath, hash);
      }
    }

    if (entities.length > 0) {
      const result = await client.upsertEntitiesBatch(entities, this.batchSize);
      this.log.info(
        {
          project: projectIdentifier,
          files: files.length,
          synced: result.success,
          failed: result.failed,
        },
        'Initial sync completed'
      );
    }
  }

  /**
   * Get current statistics
   *
   * @returns {Object} Stats object
   */
  getStats() {
    const clientStats = {};
    for (const [projectId, client] of this.graphitiClients) {
      clientStats[projectId] = client.getStats();
    }

    return {
      ...this.stats,
      projectsWatched: this.watchers.size,
      pendingChanges: Array.from(this.pendingChanges.values()).reduce((sum, m) => sum + m.size, 0),
      clientStats,
    };
  }

  /**
   * Sync watched projects from database
   * Call this after sync cycles to pick up new projects with filesystem paths
   */
  async syncWatchedProjects() {
    try {
      const projectsWithPaths = this.db.getProjectsWithFilesystemPath
        ? this.db.getProjectsWithFilesystemPath()
        : [];

      for (const project of projectsWithPaths) {
        const { identifier, filesystem_path } = project;

        if (this.watchers.has(identifier)) {
          continue;
        }

        if (!filesystem_path) {
          continue;
        }

        this.watchProject(identifier, filesystem_path);
      }

      const activeProjectIds = new Set(projectsWithPaths.map(p => p.identifier));
      for (const [projectIdentifier] of this.watchers) {
        if (!activeProjectIds.has(projectIdentifier)) {
          await this.unwatchProject(projectIdentifier);
        }
      }

      this.log.info(
        {
          watching: this.watchers.size,
          available: projectsWithPaths.length,
        },
        'Synced code perception watchers'
      );
    } catch (error) {
      this.log.error({ err: error }, 'Failed to sync watched projects');
    }
  }

  /**
   * Stop all watchers
   */
  async shutdown() {
    this.log.info('Shutting down code perception watchers');

    for (const [projectIdentifier] of this.watchers) {
      await this.unwatchProject(projectIdentifier);
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}
