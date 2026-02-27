/**
 * AST parsing and module-level entity sync
 *
 * Parses source files with Tree-sitter, updates the AST cache,
 * then syncs module-level summaries (not per-function entities)
 * to the ast_ Graphiti namespace.
 */

import path from 'path';
import { parseFiles, isSupported as isAstSupported } from '../ASTParser.js';
import { ASTCache } from '../ASTCache.js';
import { computeFileHash, extractFileSummary, getActiveProjectFiles } from './FileUtils.js';
import { ModuleSummaryBuilder } from '../ModuleSummaryBuilder.js';

export class ASTProcessor {
  constructor(state, config) {
    this._s = state;
    this.config = config;
    this._moduleSummaryBuilder = new ModuleSummaryBuilder();
  }

  /**
   * Process AST for changed files and sync module summaries to ast_ namespace.
   *
   * Parses files, updates cache, then rebuilds affected module summaries.
   * Uses the ast_ namespaced Graphiti client (not the vibesync_ file client).
   */
  async _processAstForFiles(projectIdentifier, projectPath, relativePaths, _fileClient) {
    const result = { modulesSynced: 0, parseSuccess: 0, parseFailure: 0 };
    const astCache = this._s.astCaches.get(projectIdentifier);

    const astSupportedFiles = relativePaths.filter(p => isAstSupported(p));
    if (astSupportedFiles.length === 0) {
      return result;
    }

    const fullPaths = astSupportedFiles.map(p => path.join(projectPath, p));
    const parseResults = await parseFiles(fullPaths, { timeout: 30000 });

    let hasChanges = false;

    for (const parseResult of parseResults) {
      const relativePath = path.relative(projectPath, parseResult.file);

      if (parseResult.error) {
        result.parseFailure++;
        this._s.log.debug({ file: relativePath, error: parseResult.error }, 'AST parse failed');
        continue;
      }

      result.parseSuccess++;

      if (astCache) {
        const content = this._s.fs.readFile(parseResult.file, 'utf-8');
        const contentHash = ASTCache.computeHash(content);
        const diff = astCache.diff(relativePath, parseResult.functions);

        if (diff.added.length > 0 || diff.modified.length > 0 || diff.removed.length > 0) {
          hasChanges = true;
        }

        const stats = this._s.fs.stat(parseResult.file);
        astCache.set(relativePath, contentHash, stats.mtimeMs, parseResult.functions);
      } else {
        hasChanges = true;
      }
    }

    if (astCache) await astCache.save();

    // Sync module summaries to ast_ namespace if anything changed
    if (hasChanges) {
      const moduleResult = await this._syncModuleSummaries(projectIdentifier);
      result.modulesSynced = moduleResult.modules;
    }

    this._s.log.debug(
      {
        project: projectIdentifier,
        files: astSupportedFiles.length,
        modulesSynced: result.modulesSynced,
      },
      'AST module sync completed'
    );

    return result;
  }

  /**
   * Handle deleted files by removing them from the AST cache
   * and re-syncing module summaries.
   */
  async _handleDeletedFilesAst(projectIdentifier, projectPath, deletedRelativePaths, _client) {
    const astCache = this._s.astCaches.get(projectIdentifier);
    if (!astCache) return;

    for (const relativePath of deletedRelativePaths) {
      astCache.remove(relativePath);
    }

    await astCache.save();

    // Re-sync module summaries after deletions
    await this._syncModuleSummaries(projectIdentifier);
  }

  /**
   * Build module summaries from AST cache and sync to ast_ Graphiti namespace.
   *
   * @param {string} projectIdentifier
   * @returns {Promise<{ modules: number, edges: number, errors: Array<any> }>}
   */
  async _syncModuleSummaries(projectIdentifier) {
    const astClient = this._s.astGraphitiClients.get(projectIdentifier);
    if (!astClient) {
      this._s.log.debug(
        { project: projectIdentifier },
        'No AST Graphiti client, skipping module sync'
      );
      return { modules: 0, edges: 0, errors: [] };
    }

    const astCache = this._s.astCaches.get(projectIdentifier);
    if (!astCache) {
      return { modules: 0, edges: 0, errors: [] };
    }

    const modules = this._moduleSummaryBuilder.buildModuleSummaries(astCache, projectIdentifier);
    const edges = this._moduleSummaryBuilder.buildDependencyEdges(astCache, projectIdentifier);

    if (modules.length === 0) {
      return { modules: 0, edges: 0, errors: [] };
    }

    const result = { modules: 0, edges: 0, errors: [] };

    try {
      // Ensure project entity exists in ast_ namespace
      await astClient.upsertEntity({
        name: `Project:${projectIdentifier}`,
        summary: `Project ${projectIdentifier} code repository — module-level architecture`,
      });

      // Sync module entities
      const moduleEntities = modules.map(m => ({ name: m.name, summary: m.summary }));
      const syncResult = await astClient.syncModules({
        projectId: projectIdentifier,
        modules: moduleEntities,
        edges,
      });

      result.modules = syncResult.modules?.success || 0;
      result.edges =
        (syncResult.containmentEdges?.success || 0) + (syncResult.dependencyEdges?.success || 0);

      if (syncResult.modules?.errors?.length > 0) {
        result.errors.push(...syncResult.modules.errors.slice(0, 5));
      }

      this._s.log.info(
        {
          project: projectIdentifier,
          modules: result.modules,
          dependencyEdges: syncResult.dependencyEdges?.success || 0,
        },
        'Module summaries synced to ast_ namespace'
      );
    } catch (err) {
      this._s.log.error({ err, project: projectIdentifier }, 'Failed to sync module summaries');
      result.errors.push({ error: err.message });
    }

    return result;
  }

  /**
   * Full initial AST sync for a project.
   *
   * Parses all AST-supported files, populates cache,
   * then syncs module-level summaries to ast_ namespace.
   */
  async astInitialSync(projectIdentifier, projectPath, options = {}) {
    const { concurrency = 10, rateLimit = 100 } = options;

    const client = this._s.graphitiClients.get(projectIdentifier);
    if (!client) {
      this._s.log.warn({ project: projectIdentifier }, 'No Graphiti client for AST initial sync');
      return { filesProcessed: 0, modulesSynced: 0, errors: [] };
    }

    if (!this._s.astEnabled) {
      this._s.log.warn({ project: projectIdentifier }, 'AST parsing is disabled');
      return { filesProcessed: 0, modulesSynced: 0, errors: [] };
    }

    this._s.log.info(
      { project: projectIdentifier, concurrency, rateLimit },
      'Starting AST initial sync (module-level)'
    );
    const startTime = Date.now();

    // Ensure project entity in vibesync_ namespace
    let projectEntityCreated = false;
    try {
      await client.upsertEntity({
        name: `Project:${projectIdentifier}`,
        summary: `Project ${projectIdentifier} code repository`,
      });
      projectEntityCreated = true;
    } catch (error) {
      this._s.log.error(
        { err: error, project: projectIdentifier },
        'Failed to create project entity in AST initial sync'
      );
    }

    const allFiles = await getActiveProjectFiles(
      this._s.fs,
      projectPath,
      this._s.allowedExtensions
    );
    const astFiles = allFiles.filter(f => isAstSupported(f));

    if (astFiles.length === 0) {
      this._s.log.info({ project: projectIdentifier }, 'No AST-supported files found');
      return { filesProcessed: 0, modulesSynced: 0, errors: [] };
    }

    this._s.log.info(
      { project: projectIdentifier, totalFiles: allFiles.length, astFiles: astFiles.length },
      'Found files for AST sync'
    );

    const result = {
      filesProcessed: 0,
      filesSkipped: 0,
      modulesSynced: 0,
      parseSuccess: 0,
      parseFailure: 0,
      errors: [],
    };

    const BATCH_SIZE = 50;
    const astCache = this._s.astCaches.get(projectIdentifier);

    // Phase 1: Parse all files and populate cache
    for (let i = 0; i < astFiles.length; i += BATCH_SIZE) {
      const batch = astFiles.slice(i, i + BATCH_SIZE);
      const fullPaths = batch.map(f => path.join(projectPath, f));

      const parseResults = await parseFiles(fullPaths, { timeout: 30000 });

      for (const parseResult of parseResults) {
        const relativePath = path.relative(projectPath, parseResult.file);

        if (parseResult.error) {
          result.parseFailure++;
          result.errors.push({ file: relativePath, error: parseResult.error });
          continue;
        }

        result.parseSuccess++;
        result.filesProcessed++;

        if (parseResult.functions.length === 0) {
          result.filesSkipped++;
        }

        if (astCache) {
          try {
            const content = this._s.fs.readFile(parseResult.file, 'utf-8');
            const contentHash = ASTCache.computeHash(content);
            const stats = this._s.fs.stat(parseResult.file);
            astCache.set(relativePath, contentHash, stats.mtimeMs, parseResult.functions);
          } catch (e) {}
        }
      }

      // Also create File entities + Project→File edges in vibesync_ namespace
      const fileEntities = [];
      for (const parseResult of parseResults) {
        if (parseResult.error) continue;
        const relativePath = path.relative(projectPath, parseResult.file);
        const fullPath = parseResult.file;
        const summary = await extractFileSummary(this._s.fs, this._s.log, fullPath);
        fileEntities.push({ name: `File:${relativePath}`, summary });
      }

      if (fileEntities.length > 0) {
        try {
          const fileResult = await client.upsertEntitiesBatch(fileEntities, this._s.batchSize);

          if (projectEntityCreated && fileResult.successfulEntities.length > 0) {
            const successfulPaths = fileResult.successfulEntities.map(n => n.replace(/^File:/, ''));
            await client.createContainmentEdgesBatch(
              projectIdentifier,
              successfulPaths,
              this._s.batchSize
            );
          }
        } catch (err) {
          this._s.log.error({ err, batch: i }, 'File entity batch sync failed');
          result.errors.push({ batch: i, error: err.message });
        }
      }

      this._s.log.debug(
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

    // Phase 2: Build and sync module summaries to ast_ namespace
    const moduleResult = await this._syncModuleSummaries(projectIdentifier);
    result.modulesSynced = moduleResult.modules;

    const elapsed = Date.now() - startTime;
    this._s.log.info(
      {
        project: projectIdentifier,
        filesProcessed: result.filesProcessed,
        modulesSynced: result.modulesSynced,
        parseSuccess: result.parseSuccess,
        parseFailure: result.parseFailure,
        elapsed,
        filesPerSecond: elapsed > 0 ? Math.round((result.filesProcessed / elapsed) * 1000) : 0,
      },
      'AST initial sync completed (module-level)'
    );

    this._s.stats.astParseSuccess += result.parseSuccess;
    this._s.stats.astParseFailure += result.parseFailure;

    return result;
  }
}
