/**
 * CodePerceptionWatcher - Facade
 *
 * Delegates to:
 * - FileChangeDetector (lib/perception/FileChangeDetector.js)
 * - ChangeProcessor (lib/perception/ChangeProcessor.js)
 * - ASTProcessor (lib/perception/ASTProcessor.js)
 * - FileUtils (lib/perception/FileUtils.js)
 */

import path from 'path';
import { logger } from './logger.js';
import { FsAdapter } from './FsAdapter.js';
import { Clock } from './Clock.js';
import { FileChangeDetector } from './perception/FileChangeDetector.js';
import { ChangeProcessor } from './perception/ChangeProcessor.js';
import { ASTProcessor } from './perception/ASTProcessor.js';
import { computeFileHash, extractFileSummary, getActiveProjectFiles, detectLanguage, shouldIgnoreDir } from './perception/FileUtils.js';

export class CodePerceptionWatcher {
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

    this.allowedExtensions = new Set([
      '.md', '.txt', '.rst',
      '.json', '.yaml', '.yml', '.toml', '.env', '.ini',
      '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs',
      '.py',
      '.rs', '.go', '.java', '.rb', '.php',
      '.html', '.css', '.scss', '.vue', '.svelte',
      '.sql', '.graphql',
      '.sh', '.bash', '.zsh',
    ]);

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

    this.astEnabled = options.astEnabled ?? this.config.codePerception?.astEnabled ?? true;
    this.astConcurrency = options.astConcurrency ?? 10;
    this.astRateLimit = options.astRateLimit ?? 100;

    // State
    this.watchers = new Map();
    this.graphitiClients = new Map();      // vibesync_ namespace (file/project entities)
    this.astGraphitiClients = new Map();   // ast_ namespace (module-level entities)
    this.astCaches = new Map();
    this.pendingChanges = new Map();
    this.fileHashes = new Map();
    this.debounceTimers = new Map();
    this.processing = new Set();
    this.burstMode = new Map();

    this.burstThreshold = 20;
    this.burstWindowMs = 3000;
    this.maxPendingChanges = 500;

    this.stats = {
      filesWatched: 0,
      changesDetected: 0,
      entitiesSynced: 0,
      modulesSynced: 0,
      skippedUnchanged: 0,
      astParseSuccess: 0,
      astParseFailure: 0,
      errors: 0,
    };

    this.log = logger.child({ service: 'CodePerceptionWatcher' });

    // Shared state reference for sub-modules
    const state = this;

    // Sub-modules
    this._detector = new FileChangeDetector(state, this.config);
    this._processor = new ChangeProcessor(state, this.config);
    this._astProcessor = new ASTProcessor(state, this.config);
  }

  // Delegate to FileChangeDetector
  watchProject(projectIdentifier, projectPath) {
    return this._detector.watchProject(projectIdentifier, projectPath);
  }

  unwatchProject(projectIdentifier) {
    return this._detector.unwatchProject(projectIdentifier);
  }

  handleChange(projectIdentifier, filePath, changeType) {
    return this._detector.handleChange(projectIdentifier, filePath, changeType);
  }

  trackBurst(projectIdentifier) {
    return this._detector.trackBurst(projectIdentifier);
  }

  isInBurstMode(projectIdentifier) {
    return this._detector.isInBurstMode(projectIdentifier);
  }

  scheduleProcessing(projectIdentifier) {
    return this._detector.scheduleProcessing(projectIdentifier);
  }

  // Delegate to ChangeProcessor
  processPendingChanges(projectIdentifier) {
    return this._processor.processPendingChanges(projectIdentifier);
  }

  // Delegate to FileUtils (keep as instance methods for backward compat)
  computeFileHash(filePath) {
    return computeFileHash(this.fs, filePath);
  }

  extractFileSummary(filePath) {
    return extractFileSummary(this.fs, this.log, filePath);
  }

  detectLanguage(ext) {
    return detectLanguage(ext);
  }

  getActiveProjectFiles(projectPath) {
    return getActiveProjectFiles(this.fs, projectPath, this.allowedExtensions);
  }

  shouldIgnoreDir(name) {
    return shouldIgnoreDir(name);
  }

  // Delegate to ASTProcessor
  _processAstForFiles(projectIdentifier, projectPath, relativePaths, client) {
    return this._astProcessor._processAstForFiles(projectIdentifier, projectPath, relativePaths, client);
  }

  _handleDeletedFilesAst(projectIdentifier, projectPath, deletedRelativePaths, client) {
    return this._astProcessor._handleDeletedFilesAst(projectIdentifier, projectPath, deletedRelativePaths, client);
  }

  async astInitialSync(projectIdentifier, projectPath, options = {}) {
    return this._astProcessor.astInitialSync(projectIdentifier, projectPath, options);
  }

  // Facade-level methods that stay here (thin orchestration)
  async initialSync(projectIdentifier, projectPath) {
    const client = this.graphitiClients.get(projectIdentifier);
    if (!client) {
      this.log.warn({ project: projectIdentifier }, 'No Graphiti client for initial sync');
      return;
    }

    this.log.info({ project: projectIdentifier }, 'Starting initial sync');

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

  getStats() {
    const clientStats = {};
    for (const [projectId, client] of this.graphitiClients) {
      clientStats[projectId] = client.getStats();
    }
    const astClientStats = {};
    for (const [projectId, client] of this.astGraphitiClients) {
      astClientStats[projectId] = client.getStats();
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
      astClientStats,
    };
  }

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
      modulesSynced,
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
        modulesSynced,
        astSuccessRate: `${astSuccessRate}%`,
        skippedUnchanged,
        pending,
        errors,
      },
      '[CodePerception] Health metrics'
    );
  }

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
