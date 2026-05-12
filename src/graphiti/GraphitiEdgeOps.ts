import type { GraphitiHttpClient } from './GraphitiHttpClient';

interface BatchEdgeResult {
  success: number;
  failed: number;
  errors: Array<{ file?: string; error: string }>;
}

export class GraphitiEdgeOps {
  private _http: GraphitiHttpClient;

  constructor(httpClient: GraphitiHttpClient) {
    this._http = httpClient;
  }

  async createContainmentEdge(projectId: string, fileRelativePath: string): Promise<unknown> {
    const sourceName = `Project:${projectId}`;
    const targetName = `File:${fileRelativePath}`;

    const [sourceUuid, targetUuid] = await Promise.all([
      this._http.getEntityUuid(sourceName),
      this._http.getEntityUuid(targetName),
    ]);

    const edgeUuid = await this._http.getEdgeUuid(sourceUuid, targetUuid, 'CONTAINS');

    const requestBody = {
      uuid: edgeUuid,
      source_node_uuid: sourceUuid,
      target_node_uuid: targetUuid,
      name: 'CONTAINS',
      group_id: this._http.groupId,
      fact: `Project ${projectId} contains file ${fileRelativePath}`,
    };

    (this._http.log as unknown as { debug?: (ctx: Record<string, unknown>, msg: string) => void }).debug?.(
      { projectId, file: fileRelativePath, edgeUuid },
      'Creating containment edge',
    );

    try {
      const result = await this._http._fetch(`${this._http.baseUrl}/entity-edge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      this._http.stats.edgesCreated = (this._http.stats.edgesCreated || 0) + 1;
      return result;
    } catch (error) {
      if ((error as Error).message?.includes('HTTP 500')) {
        (this._http.log as unknown as { warn?: (ctx: Record<string, unknown>, msg: string) => void }).warn?.(
          { projectId, file: fileRelativePath, error: (error as Error).message },
          'Direct edge creation failed, using message queue fallback',
        );
        return this._createEdgeViaMessageQueue(projectId, fileRelativePath);
      }
      throw error;
    }
  }

  async _createEdgeViaMessageQueue(projectId: string, fileRelativePath: string): Promise<unknown> {
    const message = {
      content: `CODE_INDEX_EVENT: Project "${projectId}" contains file "${fileRelativePath}". This file is part of the ${projectId} project structure.`,
      role_type: 'system',
      role: 'code_indexer',
      name: 'file_containment',
      timestamp: new Date().toISOString(),
      source_description: 'vibesync CodePerception',
    };

    const result = await this._http._fetch(`${this._http.baseUrl}/api/queue/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id: this._http.groupId,
        messages: [message],
      }),
    });

    this._http.stats.edgesFallback = (this._http.stats.edgesFallback || 0) + 1;
    return result;
  }

  async createContainmentEdgesBatch(
    projectId: string,
    fileRelativePaths: string[],
    batchSize: number = 50,
  ): Promise<BatchEdgeResult> {
    const results: BatchEdgeResult = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < fileRelativePaths.length; i += batchSize) {
      const batch = fileRelativePaths.slice(i, i + batchSize);

      const batchPromises = batch.map(async (filePath) => {
        try {
          await this.createContainmentEdge(projectId, filePath);
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push({ file: filePath, error: (error as Error).message });
        }
      });

      await Promise.all(batchPromises);

      if (i + batchSize < fileRelativePaths.length) {
        await this._http._delay(100);
      }
    }

    (this._http.log as unknown as { info?: (ctx: Record<string, unknown>, msg: string) => void }).info?.(
      {
        projectId,
        total: fileRelativePaths.length,
        success: results.success,
        failed: results.failed,
      },
      'Batch edge creation completed',
    );

    return results;
  }

  async createFileFunctionEdge(
    projectId: string,
    filePath: string,
    functionName: string,
  ): Promise<unknown> {
    const sourceName = `File:${filePath}`;
    const targetName = `function:${projectId}:${filePath}:${functionName}`;

    const [sourceUuid, targetUuid] = await Promise.all([
      this._http.getEntityUuid(sourceName),
      this._http.getEntityUuid(targetName),
    ]);

    const edgeUuid = await this._http.getEdgeUuid(sourceUuid, targetUuid, 'CONTAINS');

    const requestBody = {
      uuid: edgeUuid,
      source_node_uuid: sourceUuid,
      target_node_uuid: targetUuid,
      name: 'CONTAINS',
      group_id: this._http.groupId,
      fact: `File ${filePath} contains function ${functionName}`,
    };

    (this._http.log as unknown as { debug?: (ctx: Record<string, unknown>, msg: string) => void }).debug?.(
      { filePath, functionName, edgeUuid },
      'Creating file-function edge',
    );

    const result = await this._http._fetch(`${this._http.baseUrl}/entity-edge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    this._http.stats.edgesCreated = (this._http.stats.edgesCreated || 0) + 1;
    return result;
  }
}
