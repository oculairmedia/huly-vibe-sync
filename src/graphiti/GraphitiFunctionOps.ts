import { RateLimiter } from './GraphitiHttpClient';
import type { GraphitiHttpClient } from './GraphitiHttpClient';
import type { GraphitiEntityOps } from './GraphitiEntityOps';
import type { GraphitiEdgeOps } from './GraphitiEdgeOps';

interface FunctionPayload {
  name: string;
  signature: string;
  docstring: string | undefined;
  start_line: number;
  end_line: number;
}

interface FunctionSummaryParts {
  signature: string;
  docstring: string | undefined;
  startLine: number;
  endLine: number;
}

interface FunctionUpsertOptions {
  projectId: string;
  filePath: string;
  name: string;
  signature: string;
  docstring: string | undefined;
  startLine: number;
  endLine: number;
}

interface SyncOptions {
  projectId: string;
  filePath: string;
  functions: FunctionPayload[];
  concurrency?: number;
  rateLimit?: number;
}

interface SyncResult {
  entities: { success: number; failed: number; errors: Array<{ function?: string; error: string }> };
  edges: { success: number; failed: number; errors: Array<{ function?: string; error: string }> };
}

interface FileSyncOptions {
  projectId: string;
  files: Array<{ filePath: string; functions: FunctionPayload[] }>;
  concurrency?: number;
  rateLimit?: number;
}

interface FileSyncResult {
  files: number;
  entities: number;
  edges: number;
  errors: Array<{ file?: string; function?: string; error: string }>;
}

export class GraphitiFunctionOps {
  private _http: GraphitiHttpClient;
  private _entities: GraphitiEntityOps;
  private _edges: GraphitiEdgeOps;

  constructor(
    httpClient: GraphitiHttpClient,
    entityOps: GraphitiEntityOps,
    edgeOps: GraphitiEdgeOps,
  ) {
    this._http = httpClient;
    this._entities = entityOps;
    this._edges = edgeOps;
  }

  async upsertFunction(options: FunctionUpsertOptions): Promise<unknown> {
    const { projectId, filePath, name, signature, docstring, startLine, endLine } = options;

    const entityName = `function:${projectId}:${filePath}:${name}`;
    const summary = this._buildFunctionSummary({ signature, docstring, startLine, endLine });

    return this._entities.upsertEntity({ name: entityName, summary });
  }

  private _buildFunctionSummary({ signature, docstring, startLine, endLine }: FunctionSummaryParts): string {
    const parts = [signature];
    if (docstring) {
      parts.push('');
      parts.push(docstring);
    }
    parts.push('');
    parts.push(`Lines: ${startLine}-${endLine}`);
    return parts.join('\n');
  }

  async upsertFunctionsWithEdges(options: SyncOptions): Promise<SyncResult> {
    const { projectId, filePath, functions, concurrency = 10, rateLimit = 100 } = options;

    if (functions.length === 0) {
      return { entities: { success: 0, failed: 0, errors: [] }, edges: { success: 0, failed: 0, errors: [] } };
    }

    const results: SyncResult = {
      entities: { success: 0, failed: 0, errors: [] },
      edges: { success: 0, failed: 0, errors: [] },
    };

    const rateLimiter = new RateLimiter(rateLimit);

    const processFunction = async (func: FunctionPayload): Promise<void> => {
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
        results.entities.errors.push({ function: func.name, error: (error as Error).message });
        return;
      }

      await rateLimiter.acquire();

      try {
        await this._edges.createFileFunctionEdge(projectId, filePath, func.name);
        results.edges.success++;
      } catch (error) {
        results.edges.failed++;
        results.edges.errors.push({ function: func.name, error: (error as Error).message });
      }
    };

    await this._http._parallelLimit(functions, processFunction, concurrency);

    (this._http.log as unknown as { info?: (ctx: Record<string, unknown>, msg: string) => void }).info?.(
      {
        filePath,
        functions: functions.length,
        entitiesSuccess: results.entities.success,
        edgesSuccess: results.edges.success,
      },
      'Functions batch upsert completed',
    );

    return results;
  }

  async deleteFunctions(
    projectId: string,
    filePath: string,
    functionNames: string[],
  ): Promise<{ deleted: number; failed: number; errors: Array<{ function: string; error: string }> }> {
    const results = { deleted: 0, failed: 0, errors: [] as Array<{ function: string; error: string }> };

    for (const name of functionNames) {
      const entityName = `function:${projectId}:${filePath}:${name}`;
      try {
        const uuid = await this._http.getEntityUuid(entityName);
        await this._http._fetch(`${this._http.baseUrl}/nodes/${uuid}`, {
          method: 'DELETE',
        });
        results.deleted++;
      } catch (error) {
        if (!(error as Error).message?.includes('HTTP 404')) {
          results.failed++;
          results.errors.push({ function: name, error: (error as Error).message });
        }
      }
    }

    (this._http.log as unknown as { info?: (ctx: Record<string, unknown>, msg: string) => void }).info?.(
      { filePath, deleted: results.deleted },
      'Functions deleted',
    );
    return results;
  }

  async syncFilesWithFunctions(options: FileSyncOptions): Promise<FileSyncResult> {
    const { projectId, files, concurrency = 10, rateLimit = 100 } = options;

    if (files.length === 0) {
      return { files: 0, entities: 0, edges: 0, errors: [] };
    }

    const results: FileSyncResult = { files: 0, entities: 0, edges: 0, errors: [] };
    const startTime = Date.now();

    const processFile = async (fileData: { filePath: string; functions: FunctionPayload[] }): Promise<void> => {
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
          results.errors.push(
            ...fileResults.entities.errors.map((e) => ({ file: filePath, ...e })),
          );
        }
        if (fileResults.edges.errors.length > 0) {
          results.errors.push(
            ...fileResults.edges.errors.map((e) => ({ file: filePath, ...e })),
          );
        }
      } catch (error) {
        results.errors.push({ file: filePath, error: (error as Error).message });
      }
    };

    await this._http._parallelLimit(files, processFile, concurrency);

    const elapsed = Date.now() - startTime;
    (this._http.log as unknown as { info?: (ctx: Record<string, unknown>, msg: string) => void }).info?.(
      {
        projectId,
        files: results.files,
        entities: results.entities,
        edges: results.edges,
        elapsed,
        filesPerSecond: Math.round((results.files / elapsed) * 1000),
      },
      'Bulk file sync completed',
    );

    return results;
  }
}
