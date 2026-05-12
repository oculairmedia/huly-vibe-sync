import path from 'path';
import { parseFiles, isSupported as isAstSupported } from './ASTParser.js';
import { ASTCache } from './ASTCache.js';
import { extractFileSummary, getActiveProjectFiles } from './FileUtils.js';
import { ModuleSummaryBuilder } from './ModuleSummaryBuilder.js';

type State = Record<string, any>;

export class ASTProcessor {
  _s: State;
  config: Record<string, unknown>;
  _moduleSummaryBuilder = new ModuleSummaryBuilder();

  constructor(state: State, config: Record<string, unknown>) {
    this._s = state;
    this.config = config;
  }

  async _processAstForFiles(projectIdentifier: string, projectPath: string, relativePaths: string[], _fileClient: unknown): Promise<{ modulesSynced: number; parseSuccess: number; parseFailure: number }> {
    const result = { modulesSynced: 0, parseSuccess: 0, parseFailure: 0 };
    const astCache = this._s.astCaches.get(projectIdentifier) as ASTCache | undefined;

    const astSupportedFiles = relativePaths.filter(p => isAstSupported(p));
    if (astSupportedFiles.length === 0) return result;

    const fullPaths = astSupportedFiles.map(p => path.join(projectPath, p));
    const parseResults = await parseFiles(fullPaths, { timeout: 30000 });

    let hasChanges = false;

    for (const parseResult of parseResults) {
      const relativePath = path.relative(projectPath, parseResult.file);
      if (parseResult.error) { result.parseFailure++; this._s.log.debug({ file: relativePath, error: parseResult.error }, 'AST parse failed'); continue; }
      result.parseSuccess++;

      if (astCache) {
        const content = this._s.fs.readFile(parseResult.file, 'utf-8') as string;
        const contentHash = ASTCache.computeHash(content);
        const diff = astCache.diff(relativePath, parseResult.functions);
        if (diff.added.length > 0 || diff.modified.length > 0 || diff.removed.length > 0) hasChanges = true;
        const stats = this._s.fs.stat(parseResult.file);
        astCache.set(relativePath, contentHash, stats.mtimeMs, parseResult.functions);
      } else {
        hasChanges = true;
      }
    }

    if (astCache) await astCache.save();

    if (hasChanges) {
      const moduleResult = await this._syncModuleSummaries(projectIdentifier);
      result.modulesSynced = moduleResult.modules;
    }

    this._s.log.debug({ project: projectIdentifier, files: astSupportedFiles.length, modulesSynced: result.modulesSynced }, 'AST module sync completed');
    return result;
  }

  async _handleDeletedFilesAst(projectIdentifier: string, _projectPath: string, deletedRelativePaths: string[], _client: unknown): Promise<void> {
    const astCache = this._s.astCaches.get(projectIdentifier) as ASTCache | undefined;
    if (!astCache) return;
    for (const relativePath of deletedRelativePaths) astCache.remove(relativePath);
    await astCache.save();
    await this._syncModuleSummaries(projectIdentifier);
  }

  async _syncModuleSummaries(projectIdentifier: string): Promise<{ modules: number; edges: number; errors: unknown[] }> {
    const astClient = this._s.astGraphitiClients.get(projectIdentifier);
    if (!astClient) { this._s.log.debug({ project: projectIdentifier }, 'No AST Graphiti client, skipping module sync'); return { modules: 0, edges: 0, errors: [] }; }
    const astCache = this._s.astCaches.get(projectIdentifier) as ASTCache | undefined;
    if (!astCache) return { modules: 0, edges: 0, errors: [] };

    const modules = this._moduleSummaryBuilder.buildModuleSummaries(astCache, projectIdentifier);
    const edges = this._moduleSummaryBuilder.buildDependencyEdges(astCache, projectIdentifier);
    if (modules.length === 0) return { modules: 0, edges: 0, errors: [] };

    const result: { modules: number; edges: number; errors: unknown[] } = { modules: 0, edges: 0, errors: [] };
    try {
      await (astClient as { upsertEntity: (opts: { name: string; summary: string }) => Promise<unknown> }).upsertEntity({ name: `Project:${projectIdentifier}`, summary: `Project ${projectIdentifier} code repository — module-level architecture` });
      const moduleEntities = modules.map((m: { name: string; summary: string }) => ({ name: m.name, summary: m.summary }));
      const syncResult = await (astClient as { syncModules: (opts: { projectId: string; modules: { name: string; summary: string }[]; edges: unknown[] }) => Promise<{ modules?: { success?: number; errors?: { error: string }[] }; containmentEdges?: { success: number }; dependencyEdges?: { success: number } }> }).syncModules({ projectId: projectIdentifier, modules: moduleEntities, edges });
      result.modules = syncResult.modules?.success || 0;
      result.edges = (syncResult.containmentEdges?.success || 0) + (syncResult.dependencyEdges?.success || 0);
      if (syncResult.modules?.errors?.length) result.errors.push(...syncResult.modules.errors.slice(0, 5));
      this._s.log.info({ project: projectIdentifier, modules: result.modules, dependencyEdges: syncResult.dependencyEdges?.success || 0 }, 'Module summaries synced to ast_ namespace');
    } catch (err) {
      this._s.log.error({ err, project: projectIdentifier }, 'Failed to sync module summaries');
      result.errors.push({ error: (err as Error).message });
    }
    return result;
  }

  async astInitialSync(projectIdentifier: string, projectPath: string, options: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const concurrency = (options.concurrency as number) || 10;
    const rateLimit = (options.rateLimit as number) || 100;

    const client = this._s.graphitiClients.get(projectIdentifier);
    if (!client) { this._s.log.warn({ project: projectIdentifier }, 'No Graphiti client for AST initial sync'); return { filesProcessed: 0, modulesSynced: 0, errors: [] }; }
    if (!this._s.astEnabled) { this._s.log.warn({ project: projectIdentifier }, 'AST parsing is disabled'); return { filesProcessed: 0, modulesSynced: 0, errors: [] }; }

    this._s.log.info({ project: projectIdentifier, concurrency, rateLimit }, 'Starting AST initial sync (module-level)');
    const startTime = Date.now();

    let projectEntityCreated = false;
    try {
      await (client as { upsertEntity: (opts: { name: string; summary: string }) => Promise<unknown> }).upsertEntity({ name: `Project:${projectIdentifier}`, summary: `Project ${projectIdentifier} code repository` });
      projectEntityCreated = true;
    } catch (error) {
      this._s.log.error({ err: error, project: projectIdentifier }, 'Failed to create project entity in AST initial sync');
    }

    const allFiles = await getActiveProjectFiles(this._s.fs, projectPath, this._s.allowedExtensions);
    const astFiles = allFiles.filter(f => isAstSupported(f));
    if (astFiles.length === 0) { this._s.log.info({ project: projectIdentifier }, 'No AST-supported files found'); return { filesProcessed: 0, modulesSynced: 0, errors: [] }; }

    this._s.log.info({ project: projectIdentifier, totalFiles: allFiles.length, astFiles: astFiles.length }, 'Found files for AST sync');

    const result = { filesProcessed: 0, filesSkipped: 0, modulesSynced: 0, parseSuccess: 0, parseFailure: 0, errors: [] as unknown[] };
    const BATCH_SIZE = 50;
    const astCache = this._s.astCaches.get(projectIdentifier) as ASTCache | undefined;

    for (let i = 0; i < astFiles.length; i += BATCH_SIZE) {
      const batch = astFiles.slice(i, i + BATCH_SIZE);
      const fullPaths = batch.map((f: string) => path.join(projectPath, f));
      const parseResults = await parseFiles(fullPaths, { timeout: 30000 });

      for (const parseResult of parseResults) {
        const relativePath = path.relative(projectPath, parseResult.file);
        if (parseResult.error) { result.parseFailure++; result.errors.push({ file: relativePath, error: parseResult.error }); continue; }
        result.parseSuccess++; result.filesProcessed++;
        if (parseResult.functions.length === 0) result.filesSkipped++;
        if (astCache) {
          try {
            const content = this._s.fs.readFile(parseResult.file, 'utf-8') as string;
            const contentHash = ASTCache.computeHash(content);
            const stats = this._s.fs.stat(parseResult.file);
            astCache.set(relativePath, contentHash, stats.mtimeMs, parseResult.functions);
          } catch (error: unknown) { this._s.log?.debug?.({ error: (error as Error).message, file: relativePath }, 'Failed to update AST cache'); }
        }
      }

      const fileEntities: { name: string; summary: string }[] = [];
      for (const parseResult of parseResults) {
        if (parseResult.error) continue;
        const relativePath = path.relative(projectPath, parseResult.file);
        const summary = await extractFileSummary(this._s.fs, this._s.log, parseResult.file);
        fileEntities.push({ name: `File:${relativePath}`, summary });
      }

      if (fileEntities.length > 0) {
        try {
          const uc = client as { upsertEntitiesBatch: (es: { name: string; summary: string }[], bs: number) => Promise<{ successfulEntities: string[] }>; createContainmentEdgesBatch: (pid: string, fps: string[], bs: number) => Promise<void> };
          const fileResult = await uc.upsertEntitiesBatch(fileEntities, this._s.batchSize);
          if (projectEntityCreated && fileResult.successfulEntities.length > 0) {
            const successfulPaths = fileResult.successfulEntities.map((n: string) => n.replace(/^File:/, ''));
            await uc.createContainmentEdgesBatch(projectIdentifier, successfulPaths, this._s.batchSize);
          }
        } catch (err) {
          this._s.log.error({ err, batch: i }, 'File entity batch sync failed');
          result.errors.push({ batch: i, error: (err as Error).message });
        }
      }

      this._s.log.debug({ project: projectIdentifier, batch: Math.floor(i / BATCH_SIZE) + 1, processed: result.filesProcessed }, 'AST batch processed');
    }

    if (astCache) await astCache.save();

    const moduleResult = await this._syncModuleSummaries(projectIdentifier);
    result.modulesSynced = moduleResult.modules;

    const elapsed = Date.now() - startTime;
    this._s.log.info({ project: projectIdentifier, filesProcessed: result.filesProcessed, modulesSynced: result.modulesSynced, parseSuccess: result.parseSuccess, parseFailure: result.parseFailure, elapsed, filesPerSecond: elapsed > 0 ? Math.round((result.filesProcessed / elapsed) * 1000) : 0 }, 'AST initial sync completed (module-level)');

    this._s.stats.astParseSuccess += result.parseSuccess;
    this._s.stats.astParseFailure += result.parseFailure;
    return result;
  }
}
