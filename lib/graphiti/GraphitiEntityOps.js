/**
 * Graphiti Entity Operations - Entity CRUD and batch operations
 */

export class GraphitiEntityOps {
  constructor(httpClient) {
    this._http = httpClient;
  }

  async upsertEntity(entity) {
    const uuid = entity.uuid || (await this._http.getEntityUuid(entity.name));

    const requestBody = {
      uuid,
      name: entity.name,
      group_id: this._http.groupId,
      summary: entity.summary || '',
    };

    this._http.log.debug({ name: entity.name, uuid }, 'Upserting entity');

    const result = await this._http._fetch(`${this._http.baseUrl}/entity-node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    this._http.stats.entitiesCreated++;
    return result;
  }

  async upsertEntitiesBatch(entities, batchSize = 50) {
    const results = {
      success: 0,
      failed: 0,
      errors: [],
      successfulEntities: [],
    };

    for (let i = 0; i < entities.length; i += batchSize) {
      const batch = entities.slice(i, i + batchSize);

      const batchPromises = batch.map(async entity => {
        try {
          await this.upsertEntity(entity);
          results.success++;
          results.successfulEntities.push(entity.name);
        } catch (error) {
          results.failed++;
          results.errors.push({ entity: entity.name, error: error.message });
        }
      });

      await Promise.all(batchPromises);

      if (i + batchSize < entities.length) {
        await this._http._delay(100);
      }
    }

    this._http.log.info(
      { total: entities.length, success: results.success, failed: results.failed },
      'Batch upsert completed'
    );

    return results;
  }

  async updateNodeSummary(uuid, summary) {
    this._http.log.debug({ uuid }, 'Updating node summary');

    const result = await this._http._fetch(`${this._http.baseUrl}/nodes/${uuid}/summary`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary }),
    });

    this._http.stats.entitiesUpdated++;
    return result;
  }

  async pruneDeletedFiles(activeFiles) {
    this._http.log.info({ activeFileCount: activeFiles.length }, 'Pruning deleted files');

    const result = await this._http._fetch(`${this._http.baseUrl}/api/tools/prune-missing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id: this._http.groupId,
        active_files: activeFiles,
      }),
    });

    this._http.stats.pruneOperations++;

    if (result.invalidated_count > 0) {
      this._http.log.info(
        { invalidatedCount: result.invalidated_count, invalidatedFiles: result.invalidated_files },
        'Files marked as invalid'
      );
    }

    return result;
  }
}
