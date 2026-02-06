/**
 * Process pending file changes and sync to Graphiti
 */

import path from 'path';
import { computeFileHash, extractFileSummary, getActiveProjectFiles } from './FileUtils.js';
import { isSupported as isAstSupported } from '../ASTParser.js';

export class ChangeProcessor {
  constructor(state, config) {
    this._s = state;
    this.config = config;
  }

  async processPendingChanges(projectIdentifier) {
    if (this._s.processing.has(projectIdentifier)) {
      this._s._detector.scheduleProcessing(projectIdentifier);
      return;
    }

    const changes = this._s.pendingChanges.get(projectIdentifier);
    if (!changes || changes.size === 0) {
      return;
    }

    const watcher = this._s.watchers.get(projectIdentifier);
    const client = this._s.graphitiClients.get(projectIdentifier);
    if (!watcher || !watcher._projectMeta || !client) {
      return;
    }

    const { projectPath } = watcher._projectMeta;

    const changesToProcess = new Map(changes);
    changes.clear();

    this._s.processing.add(projectIdentifier);

    try {
      const healthy = await client.healthCheck();
      if (!healthy) {
        this._s.log.warn({ project: projectIdentifier }, 'Graphiti unavailable, deferring sync');
        for (const [filePath, changeType] of changesToProcess) {
          changes.set(filePath, changeType);
        }
        this._s._detector.scheduleProcessing(projectIdentifier);
        return;
      }

      this._s.log.info(
        {
          project: projectIdentifier,
          changeCount: changesToProcess.size,
          burstMode: this._s._detector.isInBurstMode(projectIdentifier),
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
        this._s.log.error(
          { err: error, project: projectIdentifier },
          'Failed to create project entity - skipping edge creation'
        );
      }

      for (const [filePath, changeType] of changesToProcess) {
        const relativePath = path.relative(projectPath, filePath);

        if (changeType === 'unlink') {
          deletedFiles.push(relativePath);
        } else {
          const currentHash = computeFileHash(this._s.fs, filePath);
          if (!currentHash) continue;

          const previousHash = this._s.fileHashes.get(filePath);
          if (previousHash === currentHash) {
            this._s.stats.skippedUnchanged++;
            continue;
          }

          this._s.fileHashes.set(filePath, currentHash);

          const summary = await extractFileSummary(this._s.fs, this._s.log, filePath);

          entitiesToUpsert.push({
            name: `File:${relativePath}`,
            summary,
          });
        }
      }

      if (entitiesToUpsert.length > 0) {
        const result = await client.upsertEntitiesBatch(entitiesToUpsert, this._s.batchSize);
        this._s.stats.entitiesSynced += result.success;

        if (result.failed > 0) {
          this._s.log.warn(
            { failed: result.failed, errors: result.errors },
            'Some entities failed to sync'
          );
        }

        const successfulFilePaths = result.successfulEntities.map(name =>
          name.replace(/^File:/, '')
        );

        if (projectEntityCreated && successfulFilePaths.length > 0) {
          const edgeResult = await client.createContainmentEdgesBatch(
            projectIdentifier,
            successfulFilePaths,
            this._s.batchSize
          );
          this._s.stats.edgesSynced = (this._s.stats.edgesSynced || 0) + edgeResult.success;

          if (edgeResult.failed > 0) {
            this._s.log.warn(
              { failed: edgeResult.failed, errors: edgeResult.errors },
              'Some edges failed to create'
            );
          }
        } else if (!projectEntityCreated) {
          this._s.log.warn(
            { project: projectIdentifier, files: result.success },
            'Skipped edge creation - project entity not available'
          );
        }

        if (this._s.astEnabled && successfulFilePaths.length > 0) {
          const astResult = await this._s._astProcessor._processAstForFiles(
            projectIdentifier,
            projectPath,
            successfulFilePaths,
            client
          );
          this._s.stats.functionsSynced += astResult.functionsSynced;
          this._s.stats.astParseSuccess += astResult.parseSuccess;
          this._s.stats.astParseFailure += astResult.parseFailure;
        }
      }

      if (deletedFiles.length > 0) {
        const activeFiles = await getActiveProjectFiles(
          this._s.fs,
          projectPath,
          this._s.allowedExtensions
        );
        await client.pruneDeletedFiles(activeFiles);

        for (const [filePath] of changesToProcess) {
          if (changesToProcess.get(filePath) === 'unlink') {
            this._s.fileHashes.delete(filePath);
          }
        }

        if (this._s.astEnabled) {
          await this._s._astProcessor._handleDeletedFilesAst(
            projectIdentifier,
            projectPath,
            deletedFiles,
            client
          );
        }
      }

      this._s.log.info(
        {
          project: projectIdentifier,
          upserted: entitiesToUpsert.length,
          deleted: deletedFiles.length,
          functionsSynced: this._s.stats.functionsSynced,
          skipped: this._s.stats.skippedUnchanged,
        },
        'File changes processed'
      );
    } catch (error) {
      this._s.stats.errors++;
      this._s.log.error({ err: error, project: projectIdentifier }, 'Error processing changes');
    } finally {
      this._s.processing.delete(projectIdentifier);
      this._s.burstMode.delete(projectIdentifier);
    }
  }
}
