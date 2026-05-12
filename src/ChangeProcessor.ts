import path from 'path';
import { computeFileHash, extractFileSummary, getActiveProjectFiles } from './FileUtils.js';

type State = Record<string, any>;

export class ChangeProcessor {
  _s: State;
  config: Record<string, unknown>;

  constructor(state: State, config: Record<string, unknown>) {
    this._s = state;
    this.config = config;
  }

  async processPendingChanges(projectIdentifier: string): Promise<void> {
    if (this._s.processing.has(projectIdentifier)) {
      this._s._detector.scheduleProcessing(projectIdentifier);
      return;
    }

    const changes = this._s.pendingChanges.get(projectIdentifier) as Map<string, string> | undefined;
    if (!changes || changes.size === 0) return;

    const watcher = this._s.watchers.get(projectIdentifier);
    const client = this._s.graphitiClients.get(projectIdentifier);
    if (!watcher || !watcher._projectMeta || !client) return;

    const { projectPath } = watcher._projectMeta;
    const changesToProcess = new Map(changes);
    changes.clear();
    this._s.processing.add(projectIdentifier);

    try {
      const healthy = await (client as { healthCheck: () => Promise<boolean> }).healthCheck();
      if (!healthy) {
        this._s.log.warn({ project: projectIdentifier }, 'Graphiti unavailable, deferring sync');
        for (const [filePath, changeType] of changesToProcess) changes.set(filePath, changeType);
        this._s._detector.scheduleProcessing(projectIdentifier);
        return;
      }

      this._s.log.info({ project: projectIdentifier, changeCount: changesToProcess.size, burstMode: this._s._detector.isInBurstMode(projectIdentifier) }, 'Processing file changes');

      const entitiesToUpsert: { name: string; summary: string }[] = [];
      const deletedFiles: string[] = [];
      let projectEntityCreated = false;

      try {
        await (client as { upsertEntity: (opts: { name: string; summary: string }) => Promise<unknown> }).upsertEntity({ name: `Project:${projectIdentifier}`, summary: `Project ${projectIdentifier} code repository` });
        projectEntityCreated = true;
      } catch (error) {
        this._s.log.error({ err: error, project: projectIdentifier }, 'Failed to create project entity - skipping edge creation');
      }

      for (const [filePath, changeType] of changesToProcess) {
        const relativePath = path.relative(projectPath, filePath);
        if (changeType === 'unlink') {
          deletedFiles.push(relativePath);
        } else {
          const currentHash = computeFileHash(this._s.fs, filePath);
          if (!currentHash) continue;
          const previousHash = this._s.fileHashes.get(filePath);
          if (previousHash === currentHash) { this._s.stats.skippedUnchanged++; continue; }
          this._s.fileHashes.set(filePath, currentHash);
          const summary = await extractFileSummary(this._s.fs, this._s.log, filePath);
          entitiesToUpsert.push({ name: `File:${relativePath}`, summary });
        }
      }

      if (entitiesToUpsert.length > 0) {
        const uc = client as { upsertEntitiesBatch: (es: { name: string; summary: string }[], bs: number) => Promise<{ success: number; failed: number; errors: { entity: string; error: string }[]; successfulEntities: string[] }>; createContainmentEdgesBatch: (pid: string, fps: string[], bs: number) => Promise<{ success: number; failed: number; errors: { file: string; error: string }[] }> };
        const result = await uc.upsertEntitiesBatch(entitiesToUpsert, this._s.batchSize);
        this._s.stats.entitiesSynced += result.success;
        if (result.failed > 0) this._s.log.warn({ failed: result.failed, errors: result.errors }, 'Some entities failed to sync');

        const successfulFilePaths = result.successfulEntities.map((n: string) => n.replace(/^File:/, ''));
        if (projectEntityCreated && successfulFilePaths.length > 0) {
          const edgeResult = await uc.createContainmentEdgesBatch(projectIdentifier, successfulFilePaths, this._s.batchSize);
          this._s.stats.edgesSynced = (this._s.stats.edgesSynced || 0) + edgeResult.success;
          if (edgeResult.failed > 0) this._s.log.warn({ failed: edgeResult.failed, errors: edgeResult.errors }, 'Some edges failed to create');
        } else if (!projectEntityCreated) {
          this._s.log.warn({ project: projectIdentifier, files: result.success }, 'Skipped edge creation - project entity not available');
        }

        if (this._s.astEnabled && successfulFilePaths.length > 0) {
          const astResult = await this._s._astProcessor._processAstForFiles(projectIdentifier, projectPath, successfulFilePaths, client);
          this._s.stats.astParseSuccess += astResult.parseSuccess;
          this._s.stats.astParseFailure += astResult.parseFailure;
        }
      }

      if (deletedFiles.length > 0) {
        const activeFiles = await getActiveProjectFiles(this._s.fs, projectPath, this._s.allowedExtensions);
        await (client as { pruneDeletedFiles: (files: string[]) => Promise<void> }).pruneDeletedFiles(activeFiles);
        for (const [filePath] of changesToProcess) {
          if (changesToProcess.get(filePath) === 'unlink') this._s.fileHashes.delete(filePath);
        }
        if (this._s.astEnabled) {
          await this._s._astProcessor._handleDeletedFilesAst(projectIdentifier, projectPath, deletedFiles, client);
        }
      }

      this._s.log.info({ project: projectIdentifier, upserted: entitiesToUpsert.length, deleted: deletedFiles.length, skipped: this._s.stats.skippedUnchanged }, 'File changes processed');
    } catch (error) {
      this._s.stats.errors++;
      this._s.log.error({ err: error, project: projectIdentifier }, 'Error processing changes');
    } finally {
      this._s.processing.delete(projectIdentifier);
      this._s.burstMode.delete(projectIdentifier);
    }
  }
}
