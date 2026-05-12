import type { GraphitiHttpClient } from './GraphitiHttpClient';

interface EntityPayload {
  uuid?: string;
  name: string;
  summary?: string;
}

interface BatchResult {
  success: number;
  failed: number;
  errors: Array<{ entity?: string; error: string }>;
  successfulEntities: string[];
}

export class GraphitiEntityOps {
  private _http: GraphitiHttpClient;

  constructor(httpClient: GraphitiHttpClient) {
    this._http = httpClient;
  }

  async upsertEntity(entity: EntityPayload): Promise<unknown> {
    const uuid = entity.uuid || (await this._http.getEntityUuid(entity.name));

    const requestBody = {
      uuid,
      name: entity.name,
      group_id: this._http.groupId,
      summary: entity.summary || '',
    };

    (this._http.log as unknown as { debug?: (ctx: Record<string, unknown>, msg: string) => void }).debug?.(
      { name: entity.name, uuid },
      'Upserting entity',
    );

    const result = await this._http._fetch(`${this._http.baseUrl}/entity-node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    this._http.stats.entitiesCreated++;
    return result;
  }

  async upsertEntitiesBatch(entities: EntityPayload[], batchSize: number = 50): Promise<BatchResult> {
    const results: BatchResult = {
      success: 0,
      failed: 0,
      errors: [],
      successfulEntities: [],
    };

    for (let i = 0; i < entities.length; i += batchSize) {
      const batch = entities.slice(i, i + batchSize);

      const batchPromises = batch.map(async (entity) => {
        try {
          await this.upsertEntity(entity);
          results.success++;
          results.successfulEntities.push(entity.name);
        } catch (error) {
          results.failed++;
          results.errors.push({ entity: entity.name, error: (error as Error).message });
        }
      });

      await Promise.all(batchPromises);

      if (i + batchSize < entities.length) {
        await this._http._delay(100);
      }
    }

    (this._http.log as unknown as { info?: (ctx: Record<string, unknown>, msg: string) => void }).info?.(
      { total: entities.length, success: results.success, failed: results.failed },
      'Batch upsert completed',
    );

    return results;
  }

  async updateNodeSummary(uuid: string, summary: string): Promise<unknown> {
    (this._http.log as unknown as { debug?: (ctx: Record<string, unknown>, msg: string) => void }).debug?.(
      { uuid },
      'Updating node summary',
    );

    const result = await this._http._fetch(`${this._http.baseUrl}/nodes/${uuid}/summary`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary }),
    });

    this._http.stats.entitiesUpdated++;
    return result;
  }

  async pruneDeletedFiles(activeFiles: string[]): Promise<{ invalidated_count: number; invalidated_files?: string[] }> {
    (this._http.log as unknown as { info?: (ctx: Record<string, unknown>, msg: string) => void }).info?.(
      { activeFileCount: activeFiles.length },
      'Pruning deleted files',
    );

    const result = (await this._http._fetch(`${this._http.baseUrl}/api/tools/prune-missing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id: this._http.groupId,
        active_files: activeFiles,
      }),
    })) as { invalidated_count: number; invalidated_files?: string[] };

    this._http.stats.pruneOperations++;

    if (result.invalidated_count > 0) {
      (this._http.log as unknown as { info?: (ctx: Record<string, unknown>, msg: string) => void }).info?.(
        { invalidatedCount: result.invalidated_count, invalidatedFiles: result.invalidated_files },
        'Files marked as invalid',
      );
    }

    return result;
  }
}
