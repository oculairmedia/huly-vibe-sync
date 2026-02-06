/**
 * Graphiti Function Operations - Function entity management
 */

import { RateLimiter } from './GraphitiHttpClient.js';

export class GraphitiFunctionOps {
  constructor(httpClient, entityOps, edgeOps) {
    this._http = httpClient;
    this._entities = entityOps;
    this._edges = edgeOps;
  }

  async upsertFunction(options) {
    const { projectId, filePath, name, signature, docstring, startLine, endLine } = options;

    const entityName = `function:${projectId}:${filePath}:${name}`;
    const summary = this._buildFunctionSummary({ signature, docstring, startLine, endLine });

    return this._entities.upsertEntity({ name: entityName, summary });
  }

  _buildFunctionSummary({ signature, docstring, startLine, endLine }) {
    const parts = [signature];
    if (docstring) {
      parts.push('');
      parts.push(docstring);
    }
    parts.push('');
    parts.push(`Lines: ${startLine}-${endLine}`);
    return parts.join('\n');
  }

  async upsertFunctionsWithEdges(options) {
    const { projectId, filePath, functions, concurrency = 10, rateLimit = 100 } = options;

    if (functions.length === 0) {
      return { entities: { success: 0, failed: 0 }, edges: { success: 0, failed: 0 } };
    }

    const results = {
      entities: { success: 0, failed: 0, errors: [] },
      edges: { success: 0, failed: 0, errors: [] },
    };

    const rateLimiter = new RateLimiter(rateLimit);

    const processFunction = async func => {
      await rateLimiter.acquire();

      try {
        await this.upsertFunction({
          projectId,
          filePath,
          name: func.name,
          signature: func.signature,
          docstring: func.docstring,
          startLine: func.start_line,
          endLine: func.end_line,
        });
        results.entities.success++;
      } catch (error) {
        results.entities.failed++;
        results.entities.errors.push({ function: func.name, error: error.message });
        return;
      }

      await rateLimiter.acquire();

      try {
        await this._edges.createFileFunctionEdge(projectId, filePath, func.name);
        results.edges.success++;
      } catch (error) {
        results.edges.failed++;
        results.edges.errors.push({ function: func.name, error: error.message });
      }
    };

    await this._http._parallelLimit(functions, processFunction, concurrency);

    this._http.log.info(
      {
        filePath,
        functions: functions.length,
        entitiesSuccess: results.entities.success,
        edgesSuccess: results.edges.success,
      },
      'Functions batch upsert completed'
    );

    return results;
  }

  async deleteFunctions(projectId, filePath, functionNames) {
    const results = { deleted: 0, failed: 0, errors: [] };

    for (const name of functionNames) {
      const entityName = `function:${projectId}:${filePath}:${name}`;
      try {
        const uuid = await this._http.getEntityUuid(entityName);
        await this._http._fetch(`${this._http.baseUrl}/nodes/${uuid}`, {
          method: 'DELETE',
        });
        results.deleted++;
      } catch (error) {
        if (!error.message?.includes('HTTP 404')) {
          results.failed++;
          results.errors.push({ function: name, error: error.message });
        }
      }
    }

    this._http.log.info({ filePath, deleted: results.deleted }, 'Functions deleted');
    return results;
  }

  async syncFilesWithFunctions(options) {
    const { projectId, files, concurrency = 10, rateLimit = 100 } = options;

    if (files.length === 0) {
      return { files: 0, entities: 0, edges: 0, errors: [] };
    }

    const results = { files: 0, entities: 0, edges: 0, errors: [] };
    const startTime = Date.now();

    const processFile = async fileData => {
      const { filePath, functions } = fileData;

      try {
        const fileResults = await this.upsertFunctionsWithEdges({
          projectId,
          filePath,
          functions,
          concurrency: Math.min(concurrency, 5),
          rateLimit,
        });

        results.files++;
        results.entities += fileResults.entities.success;
        results.edges += fileResults.edges.success;

        if (fileResults.entities.errors.length > 0) {
          results.errors.push(...fileResults.entities.errors.map(e => ({ file: filePath, ...e })));
        }
        if (fileResults.edges.errors.length > 0) {
          results.errors.push(...fileResults.edges.errors.map(e => ({ file: filePath, ...e })));
        }
      } catch (error) {
        results.errors.push({ file: filePath, error: error.message });
      }
    };

    await this._http._parallelLimit(files, processFile, concurrency);

    const elapsed = Date.now() - startTime;
    this._http.log.info(
      {
        projectId,
        files: results.files,
        entities: results.entities,
        edges: results.edges,
        elapsed,
        filesPerSecond: Math.round((results.files / elapsed) * 1000),
      },
      'Bulk file sync completed'
    );

    return results;
  }
}
