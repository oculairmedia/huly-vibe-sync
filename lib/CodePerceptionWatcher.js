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
import crypto from 'crypto';
import { logger } from './logger.js';
import { GraphitiClient, createGraphitiClient } from './GraphitiClient.js';
import { FsAdapter } from './FsAdapter.js';
import { Clock } from './Clock.js';
import { parseFile, parseFiles, isSupported as isAstSupported } from './ASTParser.js';
import { ASTCache } from './ASTCache.js';

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
   * @param {Function} [options.onFileChange] - Callback when file changes: (projectId, filePath, changeType) => void
   */
  constructor(options) {
    this.config = options.config;
    this.db = options.db;
    this.onFileChange = options.onFileChange || null;

    // Injected dependencies (for testing)
    this.fs = options.fsAdapter || new FsAdapter();
    this.clock = options.clock || new Clock();

    // Configuration
    this.debounceMs = options.debounceMs || 2000;
    this.batchSize = options.batchSize || 50;
    this.maxFileSize = (options.maxFileSizeKb || 500) * 1024;

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
      '**/vendor/**',
      '**/static/vendor/**',
      '**/*.log',
      '**/.DS_Store',
      '**/package-lock.json',
      '**/yarn.lock',
      '**/pnpm-lock.yaml',
      '**/*.min.js',
      '**/*.min.css',
      '**/*.bundle.js',
      '**/*.map',
    ];

    const configExcludes = this.config.codePerception?.excludePatterns || [];
    for (const pattern of configExcludes) {
      if (pattern && !this.ignorePatterns.includes(pattern)) {
        this.ignorePatterns.push(pattern);
      }
    }

    // AST parsing configuration
    this.astEnabled = options.astEnabled ?? this.config.codePerception?.astEnabled ?? true;
    this.astConcurrency = options.astConcurrency ?? 10;
    this.astRateLimit = options.astRateLimit ?? 100;

    // State
    this.watchers = new Map(); // projectIdentifier -> chokidar watcher
    this.graphitiClients = new Map(); // projectIdentifier -> GraphitiClient
    this.astCaches = new Map(); // projectIdentifier -> ASTCache
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
      functionsSynced: 0,
      skippedUnchanged: 0,
      astParseSuccess: 0,
      astParseFailure: 0,
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

    if (!this.fs.exists(projectPath)) {
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

    if (this.astEnabled) {
      const astCache = new ASTCache({
        projectId: projectIdentifier,
        projectPath: projectPath,
      });
      astCache.load().catch(err => {
        this.log.warn({ err, project: projectIdentifier }, 'Failed to load AST cache');
      });
      this.astCaches.set(projectIdentifier, astCache);
    }

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

      const astCache = this.astCaches.get(projectIdentifier);
      if (astCache) {
        await astCache.save();
        this.astCaches.delete(projectIdentifier);
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
        const stats = this.fs.stat(filePath);
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

    if (this.onFileChange) {
      try {
        this.onFileChange(projectIdentifier, filePath, changeType);
      } catch (e) {
        this.log.warn({ err: e }, 'onFileChange callback failed');
      }
    }

    // Debounce processing
    this.scheduleProcessing(projectIdentifier);
  }

  /**
   * Track burst mode (many changes in short window)
   *
   * @private
   */
  trackBurst(projectIdentifier) {
    const now = this.clock.now();
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

    const now = this.clock.now();
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
      let projectEntityCreated = false;

      try {
        await client.upsertEntity({
          name: `Project:${projectIdentifier}`,
          summary: `Project ${projectIdentifier} code repository`,
        });
        projectEntityCreated = true;
      } catch (error) {
        this.log.error(
          { err: error, project: projectIdentifier },
          'Failed to create project entity - skipping edge creation'
        );
      }

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

        // Only create edges for successfully upserted entities AND if project entity exists
        const successfulFilePaths = result.successfulEntities.map(name =>
          name.replace(/^File:/, '')
        );

        if (projectEntityCreated && successfulFilePaths.length > 0) {
          const edgeResult = await client.createContainmentEdgesBatch(
            projectIdentifier,
            successfulFilePaths,
            this.batchSize
          );
          this.stats.edgesSynced = (this.stats.edgesSynced || 0) + edgeResult.success;

          if (edgeResult.failed > 0) {
            this.log.warn(
              { failed: edgeResult.failed, errors: edgeResult.errors },
              'Some edges failed to create'
            );
          }
        } else if (!projectEntityCreated) {
          this.log.warn(
            { project: projectIdentifier, files: result.success },
            'Skipped edge creation - project entity not available'
          );
        }

        // HVSYN-904: only run AST sync for successfully upserted file entities
        if (this.astEnabled && successfulFilePaths.length > 0) {
          const astResult = await this._processAstForFiles(
            projectIdentifier,
            projectPath,
            successfulFilePaths,
            client
          );
          this.stats.functionsSynced += astResult.functionsSynced;
          this.stats.astParseSuccess += astResult.parseSuccess;
          this.stats.astParseFailure += astResult.parseFailure;
        }
      }

      // Handle deletions with prune-missing
      if (deletedFiles.length > 0) {
        const activeFiles = await this.getActiveProjectFiles(projectPath);
        await client.pruneDeletedFiles(activeFiles);

        for (const [filePath] of changesToProcess) {
          if (changesToProcess.get(filePath) === 'unlink') {
            this.fileHashes.delete(filePath);
          }
        }

        if (this.astEnabled) {
          await this._handleDeletedFilesAst(projectIdentifier, projectPath, deletedFiles, client);
        }
      }

      this.log.info(
        {
          project: projectIdentifier,
          upserted: entitiesToUpsert.length,
          deleted: deletedFiles.length,
          functionsSynced: this.stats.functionsSynced,
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
      const content = this.fs.readFile(filePath);
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
      const content = this.fs.readFile(filePath, 'utf-8');
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
        const entries = this.fs.readdir(dir, { withFileTypes: true });
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
      'vendor',
      '.cache',
      '.tmp',
    ]);
    return ignoreDirs.has(name) || name.startsWith('.');
  }

  // ============================================================================
  // AST Processing
  // ============================================================================

  async _processAstForFiles(projectIdentifier, projectPath, relativePaths, client) {
    const result = { functionsSynced: 0, parseSuccess: 0, parseFailure: 0 };
    const astCache = this.astCaches.get(projectIdentifier);

    const astSupportedFiles = relativePaths.filter(p => isAstSupported(p));
    if (astSupportedFiles.length === 0) {
      return result;
    }

    const fullPaths = astSupportedFiles.map(p => path.join(projectPath, p));
    const parseResults = await parseFiles(fullPaths, { timeout: 30000 });

    const filesToSync = [];

    for (const parseResult of parseResults) {
      const relativePath = path.relative(projectPath, parseResult.file);

      if (parseResult.error) {
        result.parseFailure++;
        this.log.debug({ file: relativePath, error: parseResult.error }, 'AST parse failed');
        continue;
      }

      result.parseSuccess++;

      if (astCache) {
        const content = this.fs.readFile(parseResult.file, 'utf-8');
        const contentHash = ASTCache.computeHash(content);
        const diff = astCache.diff(relativePath, parseResult.functions);

        if (diff.added.length > 0 || diff.modified.length > 0 || diff.removed.length > 0) {
          filesToSync.push({
            filePath: relativePath,
            functions: parseResult.functions,
            diff,
          });
        }

        const stats = this.fs.stat(parseResult.file);
        astCache.set(relativePath, contentHash, stats.mtimeMs, parseResult.functions);
      } else {
        filesToSync.push({
          filePath: relativePath,
          functions: parseResult.functions,
          diff: null,
        });
      }
    }

    if (filesToSync.length === 0) {
      if (astCache) await astCache.save();
      return result;
    }

    const syncResult = await client.syncFilesWithFunctions({
      projectId: projectIdentifier,
      files: filesToSync.map(f => ({ filePath: f.filePath, functions: f.functions })),
      concurrency: this.astConcurrency,
      rateLimit: this.astRateLimit,
    });

    result.functionsSynced = syncResult.entities;

    if (syncResult.errors.length > 0) {
      this.log.warn(
        { project: projectIdentifier, errors: syncResult.errors.slice(0, 5) },
        'Some functions failed to sync'
      );
    }

    if (astCache) await astCache.save();

    this.log.debug(
      {
        project: projectIdentifier,
        files: filesToSync.length,
        functions: result.functionsSynced,
      },
      'AST sync completed'
    );

    return result;
  }

  async _handleDeletedFilesAst(projectIdentifier, projectPath, deletedRelativePaths, client) {
    const astCache = this.astCaches.get(projectIdentifier);
    if (!astCache) return;

    for (const relativePath of deletedRelativePaths) {
      const cached = astCache.get(relativePath);
      if (cached && cached.functions.length > 0) {
        const functionNames = cached.functions.map(f => f.name);
        try {
          await client.deleteFunctions(projectIdentifier, relativePath, functionNames);
          this.log.debug(
            { file: relativePath, functions: functionNames.length },
            'Deleted functions for removed file'
          );
        } catch (err) {
          this.log.warn({ err, file: relativePath }, 'Failed to delete functions');
        }
      }
      astCache.remove(relativePath);
    }

    await astCache.save();
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

    // HVSYN-905: ensure Project entity exists before creating file edges
    let projectEntityCreated = false;
    try {
      await client.upsertEntity({
        name: `Project:${projectIdentifier}`,
        summary: `Project ${projectIdentifier} code repository`,
      });
      projectEntityCreated = true;
    } catch (error) {
      this.log.error(
        { err: error, project: projectIdentifier },
        'Failed to create project entity in initial sync'
      );
    }

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

      if (projectEntityCreated && result.successfulEntities.length > 0) {
        const successfulFilePaths = result.successfulEntities.map(name =>
          name.replace(/^File:/, '')
        );
        const edgeResult = await client.createContainmentEdgesBatch(
          projectIdentifier,
          successfulFilePaths,
          this.batchSize
        );
        this.log.info(
          {
            project: projectIdentifier,
            files: files.length,
            synced: result.success,
            failed: result.failed,
            edges: edgeResult.success,
            edgesFailed: edgeResult.failed,
          },
          'Initial sync completed'
        );
      } else {
        this.log.info(
          {
            project: projectIdentifier,
            files: files.length,
            synced: result.success,
            failed: result.failed,
            edges: 0,
            projectEntityCreated,
          },
          'Initial sync completed (edges skipped)'
        );
      }
    }
  }

  /**
   * Perform initial AST sync of all supported files in project.
   * Parses all .js, .ts, .py files and syncs function entities to Graphiti.
   *
   * @param {string} projectIdentifier - Project identifier
   * @param {string} projectPath - Project path
   * @param {Object} [options] - Sync options
   * @param {number} [options.concurrency=10] - Max concurrent file parses
   * @param {number} [options.rateLimit=100] - Max Graphiti ops per second
   * @returns {Promise<Object>} Sync results
   */
  async astInitialSync(projectIdentifier, projectPath, options = {}) {
    const { concurrency = 10, rateLimit = 100 } = options;

    const client = this.graphitiClients.get(projectIdentifier);
    if (!client) {
      this.log.warn({ project: projectIdentifier }, 'No Graphiti client for AST initial sync');
      return { filesProcessed: 0, functionsSynced: 0, errors: [] };
    }

    if (!this.astEnabled) {
      this.log.warn({ project: projectIdentifier }, 'AST parsing is disabled');
      return { filesProcessed: 0, functionsSynced: 0, errors: [] };
    }

    this.log.info(
      { project: projectIdentifier, concurrency, rateLimit },
      'Starting AST initial sync'
    );
    const startTime = Date.now();

    // HVSYN-905: ensure Project entity exists before creating file edges
    let projectEntityCreated = false;
    try {
      await client.upsertEntity({
        name: `Project:${projectIdentifier}`,
        summary: `Project ${projectIdentifier} code repository`,
      });
      projectEntityCreated = true;
    } catch (error) {
      this.log.error(
        { err: error, project: projectIdentifier },
        'Failed to create project entity in AST initial sync'
      );
    }

    const allFiles = await this.getActiveProjectFiles(projectPath);
    const astFiles = allFiles.filter(f => isAstSupported(f));

    if (astFiles.length === 0) {
      this.log.info({ project: projectIdentifier }, 'No AST-supported files found');
      return { filesProcessed: 0, functionsSynced: 0, errors: [] };
    }

    this.log.info(
      { project: projectIdentifier, totalFiles: allFiles.length, astFiles: astFiles.length },
      'Found files for AST sync'
    );

    const result = {
      filesProcessed: 0,
      filesSkipped: 0,
      functionsSynced: 0,
      parseSuccess: 0,
      parseFailure: 0,
      errors: [],
    };

    const BATCH_SIZE = 50;
    const astCache = this.astCaches.get(projectIdentifier);

    for (let i = 0; i < astFiles.length; i += BATCH_SIZE) {
      const batch = astFiles.slice(i, i + BATCH_SIZE);
      const fullPaths = batch.map(f => path.join(projectPath, f));

      const parseResults = await parseFiles(fullPaths, { timeout: 30000 });

      const filesToSync = [];

      for (const parseResult of parseResults) {
        const relativePath = path.relative(projectPath, parseResult.file);

        if (parseResult.error) {
          result.parseFailure++;
          result.errors.push({ file: relativePath, error: parseResult.error });
          continue;
        }

        result.parseSuccess++;

        if (parseResult.functions.length === 0) {
          result.filesSkipped++;
          continue;
        }

        filesToSync.push({
          filePath: relativePath,
          functions: parseResult.functions,
        });

        if (astCache) {
          try {
            const content = this.fs.readFile(parseResult.file, 'utf-8');
            const contentHash = ASTCache.computeHash(content);
            const stats = this.fs.stat(parseResult.file);
            astCache.set(relativePath, contentHash, stats.mtimeMs, parseResult.functions);
          } catch (e) {}
        }
      }

      if (filesToSync.length > 0) {
        try {
          // Create file entities FIRST (required for edges to work)
          const fileEntities = [];
          for (const fileData of filesToSync) {
            const fullPath = path.join(projectPath, fileData.filePath);
            const summary = await this.extractFileSummary(fullPath);
            fileEntities.push({
              name: `File:${fileData.filePath}`,
              summary,
            });
          }

          let successfulEntityNames = [];

          if (fileEntities.length > 0) {
            const fileResult = await client.upsertEntitiesBatch(fileEntities, this.batchSize);
            successfulEntityNames = fileResult.successfulEntities;
            this.log.debug(
              { fileEntities: fileEntities.length, success: fileResult.success },
              'File entities created for AST sync'
            );

            if (projectEntityCreated && successfulEntityNames.length > 0) {
              const successfulPaths = successfulEntityNames.map(name => name.replace(/^File:/, ''));
              await client.createContainmentEdgesBatch(
                projectIdentifier,
                successfulPaths,
                this.batchSize
              );
            }
          }

          const verifiedFiles = filesToSync.filter(f =>
            successfulEntityNames.includes(`File:${f.filePath}`)
          );

          const syncResult = await client.syncFilesWithFunctions({
            projectId: projectIdentifier,
            files: verifiedFiles,
            concurrency,
            rateLimit,
          });

          result.filesProcessed += verifiedFiles.length;
          result.functionsSynced += syncResult.entities;

          if (syncResult.errors.length > 0) {
            result.errors.push(...syncResult.errors.slice(0, 5));
          }
        } catch (err) {
          this.log.error({ err, batch: i }, 'Batch sync failed');
          result.errors.push({ batch: i, error: err.message });
        }
      }

      this.log.debug(
        {
          project: projectIdentifier,
          batch: Math.floor(i / BATCH_SIZE) + 1,
          processed: result.filesProcessed,
        },
        'AST batch processed'
      );
    }

    if (astCache) {
      await astCache.save();
    }

    const elapsed = Date.now() - startTime;
    this.log.info(
      {
        project: projectIdentifier,
        filesProcessed: result.filesProcessed,
        functionsSynced: result.functionsSynced,
        parseSuccess: result.parseSuccess,
        parseFailure: result.parseFailure,
        elapsed,
        filesPerSecond: Math.round((result.filesProcessed / elapsed) * 1000),
      },
      'AST initial sync completed'
    );

    this.stats.astParseSuccess += result.parseSuccess;
    this.stats.astParseFailure += result.parseFailure;
    this.stats.functionsSynced += result.functionsSynced;

    return result;
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

    const totalAstAttempts = this.stats.astParseSuccess + this.stats.astParseFailure;
    const astSuccessRate =
      totalAstAttempts > 0
        ? Math.round((this.stats.astParseSuccess / totalAstAttempts) * 100)
        : 100;

    return {
      ...this.stats,
      projectsWatched: this.watchers.size,
      pendingChanges: Array.from(this.pendingChanges.values()).reduce((sum, m) => sum + m.size, 0),
      astSuccessRate,
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

      this.logHealthMetrics();
    } catch (error) {
      this.log.error({ err: error }, 'Failed to sync watched projects');
    }
  }

  logHealthMetrics() {
    const {
      filesWatched,
      changesDetected,
      entitiesSynced,
      functionsSynced,
      skippedUnchanged,
      astParseSuccess,
      astParseFailure,
      errors,
    } = this.stats;
    const pending = Array.from(this.pendingChanges.values()).reduce((sum, m) => sum + m.size, 0);
    const totalAstAttempts = astParseSuccess + astParseFailure;
    const astSuccessRate =
      totalAstAttempts > 0 ? Math.round((astParseSuccess / totalAstAttempts) * 100) : 100;

    this.log.info(
      {
        projects: this.watchers.size,
        filesWatched,
        changesDetected,
        entitiesSynced,
        functionsSynced,
        astSuccessRate: `${astSuccessRate}%`,
        skippedUnchanged,
        pending,
        errors,
      },
      '[CodePerception] Health metrics'
    );
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
