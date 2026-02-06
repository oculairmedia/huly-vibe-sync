/**
 * AST parsing and function entity sync
 */

import path from 'path';
import { parseFiles, isSupported as isAstSupported } from '../ASTParser.js';
import { ASTCache } from '../ASTCache.js';
import { computeFileHash, extractFileSummary, getActiveProjectFiles } from './FileUtils.js';

export class ASTProcessor {
  constructor(state, config) {
    this._s = state;
    this.config = config;
  }

  async _processAstForFiles(projectIdentifier, projectPath, relativePaths, client) {
    const result = { functionsSynced: 0, parseSuccess: 0, parseFailure: 0 };
    const astCache = this._s.astCaches.get(projectIdentifier);

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
        this._s.log.debug({ file: relativePath, error: parseResult.error }, 'AST parse failed');
        continue;
      }

      result.parseSuccess++;

      if (astCache) {
        const content = this._s.fs.readFile(parseResult.file, 'utf-8');
        const contentHash = ASTCache.computeHash(content);
        const diff = astCache.diff(relativePath, parseResult.functions);

        if (diff.added.length > 0 || diff.modified.length > 0 || diff.removed.length > 0) {
          filesToSync.push({
            filePath: relativePath,
            functions: parseResult.functions,
            diff,
          });
        }

        const stats = this._s.fs.stat(parseResult.file);
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
      concurrency: this._s.astConcurrency,
      rateLimit: this._s.astRateLimit,
    });

    result.functionsSynced = syncResult.entities;

    if (syncResult.errors.length > 0) {
      this._s.log.warn(
        { project: projectIdentifier, errors: syncResult.errors.slice(0, 5) },
        'Some functions failed to sync'
      );
    }

    if (astCache) await astCache.save();

    this._s.log.debug(
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
    const astCache = this._s.astCaches.get(projectIdentifier);
    if (!astCache) return;

    for (const relativePath of deletedRelativePaths) {
      const cached = astCache.get(relativePath);
      if (cached && cached.functions.length > 0) {
        const functionNames = cached.functions.map(f => f.name);
        try {
          await client.deleteFunctions(projectIdentifier, relativePath, functionNames);
          this._s.log.debug(
            { file: relativePath, functions: functionNames.length },
            'Deleted functions for removed file'
          );
        } catch (err) {
          this._s.log.warn({ err, file: relativePath }, 'Failed to delete functions');
        }
      }
      astCache.remove(relativePath);
    }

    await astCache.save();
  }

  async astInitialSync(projectIdentifier, projectPath, options = {}) {
    const { concurrency = 10, rateLimit = 100 } = options;

    const client = this._s.graphitiClients.get(projectIdentifier);
    if (!client) {
      this._s.log.warn({ project: projectIdentifier }, 'No Graphiti client for AST initial sync');
      return { filesProcessed: 0, functionsSynced: 0, errors: [] };
    }

    if (!this._s.astEnabled) {
      this._s.log.warn({ project: projectIdentifier }, 'AST parsing is disabled');
      return { filesProcessed: 0, functionsSynced: 0, errors: [] };
    }

    this._s.log.info(
      { project: projectIdentifier, concurrency, rateLimit },
      'Starting AST initial sync'
    );
    const startTime = Date.now();

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
      return { filesProcessed: 0, functionsSynced: 0, errors: [] };
    }

    this._s.log.info(
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
    const astCache = this._s.astCaches.get(projectIdentifier);

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
            const content = this._s.fs.readFile(parseResult.file, 'utf-8');
            const contentHash = ASTCache.computeHash(content);
            const stats = this._s.fs.stat(parseResult.file);
            astCache.set(relativePath, contentHash, stats.mtimeMs, parseResult.functions);
          } catch (e) {}
        }
      }

      if (filesToSync.length > 0) {
        try {
          const fileEntities = [];
          for (const fileData of filesToSync) {
            const fullPath = path.join(projectPath, fileData.filePath);
            const summary = await extractFileSummary(this._s.fs, this._s.log, fullPath);
            fileEntities.push({
              name: `File:${fileData.filePath}`,
              summary,
            });
          }

          let successfulEntityNames = [];

          if (fileEntities.length > 0) {
            const fileResult = await client.upsertEntitiesBatch(fileEntities, this._s.batchSize);
            successfulEntityNames = fileResult.successfulEntities;
            this._s.log.debug(
              { fileEntities: fileEntities.length, success: fileResult.success },
              'File entities created for AST sync'
            );

            if (projectEntityCreated && successfulEntityNames.length > 0) {
              const successfulPaths = successfulEntityNames.map(name => name.replace(/^File:/, ''));
              await client.createContainmentEdgesBatch(
                projectIdentifier,
                successfulPaths,
                this._s.batchSize
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
          this._s.log.error({ err, batch: i }, 'Batch sync failed');
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

    const elapsed = Date.now() - startTime;
    this._s.log.info(
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

    this._s.stats.astParseSuccess += result.parseSuccess;
    this._s.stats.astParseFailure += result.parseFailure;
    this._s.stats.functionsSynced += result.functionsSynced;

    return result;
  }
}
