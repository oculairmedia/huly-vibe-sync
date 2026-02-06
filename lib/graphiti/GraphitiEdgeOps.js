/**
 * Graphiti Edge Operations - Edge creation and batch operations
 */

export class GraphitiEdgeOps {
  constructor(httpClient) {
    this._http = httpClient;
  }

  async createContainmentEdge(projectId, fileRelativePath) {
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

    this._http.log.debug({ projectId, file: fileRelativePath, edgeUuid }, 'Creating containment edge');

    try {
      const result = await this._http._fetch(`${this._http.baseUrl}/entity-edge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      this._http.stats.edgesCreated = (this._http.stats.edgesCreated || 0) + 1;
      return result;
    } catch (error) {
      if (error.message?.includes('HTTP 500')) {
        this._http.log.warn(
          { projectId, file: fileRelativePath, error: error.message },
          'Direct edge creation failed, using message queue fallback'
        );
        return this._createEdgeViaMessageQueue(projectId, fileRelativePath);
      }
      throw error;
    }
  }

  async _createEdgeViaMessageQueue(projectId, fileRelativePath) {
    const message = {
      content: `CODE_INDEX_EVENT: Project "${projectId}" contains file "${fileRelativePath}". This file is part of the ${projectId} project structure.`,
      role_type: 'system',
      role: 'code_indexer',
      name: 'file_containment',
      timestamp: new Date().toISOString(),
      source_description: 'huly-vibe-sync CodePerception',
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

  async createContainmentEdgesBatch(projectId, fileRelativePaths, batchSize = 50) {
    const results = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < fileRelativePaths.length; i += batchSize) {
      const batch = fileRelativePaths.slice(i, i + batchSize);

      const batchPromises = batch.map(async filePath => {
        try {
          await this.createContainmentEdge(projectId, filePath);
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push({ file: filePath, error: error.message });
        }
      });

      await Promise.all(batchPromises);

      if (i + batchSize < fileRelativePaths.length) {
        await this._http._delay(100);
      }
    }

    this._http.log.info(
      { projectId, total: fileRelativePaths.length, success: results.success, failed: results.failed },
      'Batch edge creation completed'
    );

    return results;
  }

  async createFileFunctionEdge(projectId, filePath, functionName) {
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

    this._http.log.debug({ filePath, functionName, edgeUuid }, 'Creating file-function edge');

    const result = await this._http._fetch(`${this._http.baseUrl}/entity-edge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    this._http.stats.edgesCreated = (this._http.stats.edgesCreated || 0) + 1;
    return result;
  }
}
