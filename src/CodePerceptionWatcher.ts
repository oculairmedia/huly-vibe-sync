import path from 'path';
import { logger } from './logger';
import { FsAdapter } from './FsAdapter';
import { Clock } from './Clock';
import { FileChangeDetector } from './FileChangeDetector.js';
import { ChangeProcessor } from './ChangeProcessor.js';
import { ASTProcessor } from './ASTProcessor.js';
import {
  computeFileHash,
  extractFileSummary,
  getActiveProjectFiles,
  detectLanguage,
  shouldIgnoreDir,
  shouldIgnorePath,
} from './FileUtils.js';

type GraphitiClient = {
  upsertEntity: (opts: { name: string; summary: string }) => Promise<unknown>;
  upsertEntitiesBatch: (entities: { name: string; summary: string }[], batchSize: number) => Promise<{ success: number; failed: number; successfulEntities: string[] }>;
  createContainmentEdgesBatch: (projectId: string, filePaths: string[], batchSize: number) => Promise<{ success: number; failed: number }>;
  getStats: () => Record<string, unknown>;
};

interface WatcherStats {
  filesWatched: number;
  changesDetected: number;
  entitiesSynced: number;
  modulesSynced: number;
  skippedUnchanged: number;
  astParseSuccess: number;
  astParseFailure: number;
  errors: number;
}

interface CodePerceptionConfig {
  codePerception?: {
    excludePatterns?: string[];
    sourceRoots?: string[];
    allowlistMode?: boolean;
    astEnabled?: boolean;
  };
}

interface CodePerceptionOptions {
  config: CodePerceptionConfig;
  db: {
    getProjectsWithFilesystemPath?: () => { identifier: string; filesystem_path: string | null }[];
  };
  onFileChange?: ((change: unknown) => void) | null;
  fsAdapter?: FsAdapter;
  clock?: Clock;
  debounceMs?: number;
  batchSize?: number;
  maxFileSizeKb?: number;
  astEnabled?: boolean;
  astConcurrency?: number;
  astRateLimit?: number;
}

type ChangeType = 'add' | 'change' | 'unlink';

export class CodePerceptionWatcher {
  config: CodePerceptionConfig;
  db: CodePerceptionOptions['db'];
  onFileChange: CodePerceptionOptions['onFileChange'];
  fs: FsAdapter;
  clock: Clock;
  debounceMs: number;
  batchSize: number;
  maxFileSize: number;
  allowedExtensions: Set<string>;
  ignorePatterns: string[];
  sourceRoots: string[];
  allowlistMode: boolean;
  astEnabled: boolean;
  astConcurrency: number;
  astRateLimit: number;

  watchers: Map<string, unknown>;
  graphitiClients: Map<string, GraphitiClient>;
  astGraphitiClients: Map<string, GraphitiClient>;
  astCaches: Map<string, unknown>;
  pendingChanges: Map<string, Map<string, ChangeType>>;
  fileHashes: Map<string, string>;
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>;
  processing: Set<string>;
  burstMode: Map<string, boolean>;

  burstThreshold: number;
  burstWindowMs: number;
  maxPendingChanges: number;

  stats: WatcherStats;

  log = logger.child({ service: 'CodePerceptionWatcher' });

  _detector: FileChangeDetector;
  _processor: ChangeProcessor;
  _astProcessor: ASTProcessor;

  constructor(options: CodePerceptionOptions) {
    this.config = options.config;
    this.db = options.db;
    this.onFileChange = options.onFileChange || null;
    this.fs = options.fsAdapter || new FsAdapter();
    this.clock = options.clock || new Clock();
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
      '**/node_modules/**', '**/.git/**', '**/target/**', '**/dist/**',
      '**/build/**', '**/__pycache__/**', '**/.venv/**', '**/venv/**',
      '**/.next/**', '**/.nuxt/**', '**/coverage/**', '**/vendor/**',
      '**/static/vendor/**', '**/*.log', '**/.DS_Store',
      '**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml',
      '**/*.min.js', '**/*.min.css', '**/*.bundle.js', '**/*.map',
      '**/.vibesync-cache/**', '**/.beads/**', '**/data/clients/**',
      '**/mcp-servers/**/data/clients/**', '**/*.sqlite', '**/*.sqlite-*',
      '**/*.db', '**/*.db-*', '**/*.pid', '**/*.sock',
    ];

    const configExcludes = this.config.codePerception?.excludePatterns || [];
    for (const pattern of configExcludes) {
      if (pattern && !this.ignorePatterns.includes(pattern)) {
        this.ignorePatterns.push(pattern);
      }
    }

    this.sourceRoots = this.config.codePerception?.sourceRoots || [];
    this.allowlistMode = this.config.codePerception?.allowlistMode || false;
    this.astEnabled = options.astEnabled ?? this.config.codePerception?.astEnabled ?? true;
    this.astConcurrency = options.astConcurrency ?? 10;
    this.astRateLimit = options.astRateLimit ?? 100;

    this.watchers = new Map();
    this.graphitiClients = new Map();
    this.astGraphitiClients = new Map();
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
      filesWatched: 0, changesDetected: 0, entitiesSynced: 0,
      modulesSynced: 0, skippedUnchanged: 0, astParseSuccess: 0,
      astParseFailure: 0, errors: 0,
    };

    const state = this as unknown as Record<string, unknown>;
    this._detector = new FileChangeDetector(state, this.config as Record<string, unknown>);
    this._processor = new ChangeProcessor(state, this.config as Record<string, unknown>);
    this._astProcessor = new ASTProcessor(state, this.config as Record<string, unknown>);
  }

  watchProject(projectIdentifier: string, projectPath: string): unknown {
    return this._detector.watchProject(projectIdentifier, projectPath);
  }

  unwatchProject(projectIdentifier: string): unknown {
    return this._detector.unwatchProject(projectIdentifier);
  }

  handleChange(projectIdentifier: string, filePath: string, changeType: ChangeType): unknown {
    return this._detector.handleChange(projectIdentifier, filePath, changeType);
  }

  trackBurst(projectIdentifier: string): unknown {
    return this._detector.trackBurst(projectIdentifier);
  }

  isInBurstMode(projectIdentifier: string): boolean {
    return this._detector.isInBurstMode(projectIdentifier);
  }

  scheduleProcessing(projectIdentifier: string): unknown {
    return this._detector.scheduleProcessing(projectIdentifier);
  }

  processPendingChanges(projectIdentifier: string): unknown {
    return this._processor.processPendingChanges(projectIdentifier);
  }

  computeFileHash(filePath: string): string | null {
    return computeFileHash(this.fs as never, filePath) as string | null;
  }

  extractFileSummary(filePath: string): Promise<string | null> {
    return extractFileSummary(this.fs as never, this.log, filePath) as Promise<string>;
  }

  detectLanguage(ext: string): string | null {
    return detectLanguage(ext) as string | null;
  }

  getActiveProjectFiles(projectPath: string): Promise<string[]> {
    return getActiveProjectFiles(this.fs as never, projectPath, this.allowedExtensions) as Promise<string[]>;
  }

  shouldIgnoreDir(name: string): boolean {
    return shouldIgnoreDir(name);
  }

  shouldIgnorePath(filePath: string, projectPath: string | null = null): boolean {
    return (shouldIgnorePath as (fp: string, ignorePatterns: string[], sourceRoots: string[], allowlistMode: boolean, projPath: string | null) => boolean)(filePath, this.ignorePatterns, this.sourceRoots, this.allowlistMode, projectPath);
  }

  _processAstForFiles(projectIdentifier: string, projectPath: string, relativePaths: string[], client: GraphitiClient): unknown {
    return this._astProcessor._processAstForFiles(projectIdentifier, projectPath, relativePaths, client);
  }

  _handleDeletedFilesAst(projectIdentifier: string, projectPath: string, deletedRelativePaths: string[], client: GraphitiClient): unknown {
    return this._astProcessor._handleDeletedFilesAst(projectIdentifier, projectPath, deletedRelativePaths, client);
  }

  async astInitialSync(projectIdentifier: string, projectPath: string, options: Record<string, unknown> = {}): Promise<unknown> {
    return this._astProcessor.astInitialSync(projectIdentifier, projectPath, options);
  }

  async initialSync(projectIdentifier: string, projectPath: string): Promise<void> {
    const client = this.graphitiClients.get(projectIdentifier);
    if (!client) {
      this.log.warn({ project: projectIdentifier }, 'No Graphiti client for initial sync');
      return;
    }

    this.log.info({ project: projectIdentifier }, 'Starting initial sync');
    let projectEntityCreated = false;

    try {
      await client.upsertEntity({ name: `Project:${projectIdentifier}`, summary: `Project ${projectIdentifier} code repository` });
      projectEntityCreated = true;
    } catch (error) {
      this.log.error({ err: error, project: projectIdentifier }, 'Failed to create project entity in initial sync');
    }

    const files = await this.getActiveProjectFiles(projectPath);
    const entities: { name: string; summary: string }[] = [];

    for (const relativePath of files) {
      const fullPath = path.join(projectPath, relativePath);
      const summary = await this.extractFileSummary(fullPath);
      entities.push({ name: `File:${relativePath}`, summary: summary || '' });
      const hash = this.computeFileHash(fullPath);
      if (hash) this.fileHashes.set(fullPath, hash);
    }

    if (entities.length > 0) {
      const result = await client.upsertEntitiesBatch(entities, this.batchSize);
      const edges = projectEntityCreated && result.successfulEntities.length > 0
        ? await client.createContainmentEdgesBatch(projectIdentifier, result.successfulEntities.map(n => n.replace(/^File:/, '')), this.batchSize)
        : { success: 0, failed: 0 };

      this.log.info({
        project: projectIdentifier, files: files.length,
        synced: result.success, failed: result.failed,
        edges: edges.success, edgesFailed: edges.failed,
      }, projectEntityCreated && result.successfulEntities.length > 0
        ? 'Initial sync completed' : 'Initial sync completed (edges skipped)');
    }
  }

  getStats(): WatcherStats & {
    projectsWatched: number;
    pendingChanges: number;
    astSuccessRate: number;
    clientStats: Record<string, Record<string, unknown>>;
    astClientStats: Record<string, Record<string, unknown>>;
  } {
    const clientStats: Record<string, Record<string, unknown>> = {};
    for (const [projectId, client] of this.graphitiClients) {
      clientStats[projectId] = client.getStats();
    }
    const astClientStats: Record<string, Record<string, unknown>> = {};
    for (const [projectId, client] of this.astGraphitiClients) {
      astClientStats[projectId] = client.getStats();
    }

    const totalAstAttempts = this.stats.astParseSuccess + this.stats.astParseFailure;
    const astSuccessRate = totalAstAttempts > 0
      ? Math.round((this.stats.astParseSuccess / totalAstAttempts) * 100) : 100;

    return {
      ...this.stats,
      projectsWatched: this.watchers.size,
      pendingChanges: Array.from(this.pendingChanges.values()).reduce((sum: number, m) => sum + m.size, 0),
      astSuccessRate,
      clientStats,
      astClientStats,
    };
  }

  async syncWatchedProjects(): Promise<void> {
    try {
      const projectsWithPaths = this.db.getProjectsWithFilesystemPath
        ? this.db.getProjectsWithFilesystemPath() : [];

      for (const project of projectsWithPaths) {
        const { identifier, filesystem_path } = project;
        if (this.watchers.has(identifier)) continue;
        if (!filesystem_path) continue;
        this.watchProject(identifier, filesystem_path);
      }

      const activeProjectIds = new Set(projectsWithPaths.map(p => p.identifier));
      for (const [projectIdentifier] of this.watchers) {
        if (!activeProjectIds.has(projectIdentifier)) {
          await this.unwatchProject(projectIdentifier);
        }
      }

      this.log.info({ watching: this.watchers.size, available: projectsWithPaths.length }, 'Synced code perception watchers');
      this.logHealthMetrics();
    } catch (error) {
      this.log.error({ err: error }, 'Failed to sync watched projects');
    }
  }

  logHealthMetrics(): void {
    const { filesWatched, changesDetected, entitiesSynced, modulesSynced, skippedUnchanged, astParseSuccess, astParseFailure, errors } = this.stats;
    const pending = Array.from(this.pendingChanges.values()).reduce((sum: number, m) => sum + m.size, 0);
    const totalAstAttempts = astParseSuccess + astParseFailure;
    const astSuccessRate = totalAstAttempts > 0 ? Math.round((astParseSuccess / totalAstAttempts) * 100) : 100;

    this.log.info({
      projects: this.watchers.size, filesWatched, changesDetected,
      entitiesSynced, modulesSynced, astSuccessRate: `${astSuccessRate}%`,
      skippedUnchanged, pending, errors,
    }, '[CodePerception] Health metrics');
  }

  async shutdown(): Promise<void> {
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
