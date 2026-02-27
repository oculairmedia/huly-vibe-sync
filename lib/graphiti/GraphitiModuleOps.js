/**
 * Graphiti Module Operations - Module entity and dependency edge management
 */

export class GraphitiModuleOps {
  constructor(httpClient, entityOps, edgeOps) {
    this._http = httpClient;
    this._entities = entityOps;
    this._edges = edgeOps;
  }

  /**
   * Upserts a single module entity.
   *
   * @param {{ name: string, summary: string }} options - Module entity payload.
   * @returns {Promise<object>} Upsert result.
   */
  async upsertModule(options) {
    const { name, summary } = options;
    return this._entities.upsertEntity({ name, summary });
  }

  /**
   * Upserts module entities in batches.
   *
   * @param {{ name: string, summary: string }[]} modules - Module entities to upsert.
   * @param {number} [batchSize=50] - Number of entities per batch.
   * @returns {Promise<{ success: number, failed: number, errors: Array<object>, successfulEntities: string[] }>} Batch result.
   */
  async upsertModulesBatch(modules, batchSize = 50) {
    return this._entities.upsertEntitiesBatch(modules, batchSize);
  }

  /**
   * Creates a DEPENDS_ON edge between two module entities.
   *
   * @param {string} sourceModuleName - Source module entity name.
   * @param {string} targetModuleName - Target module entity name.
   * @param {string} fact - Edge fact text.
   * @returns {Promise<object>} Edge creation result.
   */
  async createDependencyEdge(sourceModuleName, targetModuleName, fact) {
    try {
      const [sourceUuid, targetUuid] = await Promise.all([
        this._http.getEntityUuid(sourceModuleName),
        this._http.getEntityUuid(targetModuleName),
      ]);

      const edgeUuid = await this._http.getEdgeUuid(sourceUuid, targetUuid, 'DEPENDS_ON');
      const requestBody = {
        uuid: edgeUuid,
        source_node_uuid: sourceUuid,
        target_node_uuid: targetUuid,
        name: 'DEPENDS_ON',
        group_id: this._http.groupId,
        fact,
      };

      const result = await this._http._fetch(`${this._http.baseUrl}/entity-edge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      this._http.stats.edgesCreated = (this._http.stats.edgesCreated || 0) + 1;
      return result;
    } catch (error) {
      this._http.log.warn(
        { sourceModuleName, targetModuleName, error: error.message },
        'Failed to create module dependency edge'
      );
      throw error;
    }
  }

  /**
   * Creates dependency edges in batches.
   *
   * @param {{ sourceModule: string, targetModule: string, fact: string }[]} edges - Dependency edge payloads.
   * @param {number} [batchSize=50] - Number of edges per batch.
   * @returns {Promise<{ success: number, failed: number, errors: Array<object> }>} Batch result.
   */
  async createDependencyEdgesBatch(edges, batchSize = 50) {
    const results = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < edges.length; i += batchSize) {
      const batch = edges.slice(i, i + batchSize);

      const batchPromises = batch.map(async edge => {
        try {
          await this.createDependencyEdge(edge.sourceModule, edge.targetModule, edge.fact);
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            sourceModule: edge.sourceModule,
            targetModule: edge.targetModule,
            error: error.message,
          });
        }
      });

      await Promise.all(batchPromises);

      if (i + batchSize < edges.length) {
        await this._http._delay(100);
      }
    }

    return results;
  }

  /**
   * Synchronizes module entities and their relationships for a project.
   *
   * @param {{ projectId: string, modules: { name: string, summary: string }[], edges: { sourceModule: string, targetModule: string, fact: string }[], concurrency?: number }} options - Sync payload.
   * @returns {Promise<{ modules: { success: number, failed: number, errors: Array<object> }, containmentEdges: { success: number, failed: number, errors: Array<object> }, dependencyEdges: { success: number, failed: number, errors: Array<object> } }>} Sync result.
   */
  async syncModules(options) {
    const { projectId, modules, edges, concurrency = 10 } = options;

    const modulesResult = await this.upsertModulesBatch(modules);

    const containmentResults = { success: 0, failed: 0, errors: [] };
    const successfulModules = modulesResult.successfulEntities || [];

    const processModuleContainment = async moduleName => {
      try {
        await this._createProjectModuleContainmentEdge(projectId, moduleName);
        containmentResults.success++;
      } catch (error) {
        containmentResults.failed++;
        containmentResults.errors.push({ module: moduleName, error: error.message });
      }
    };

    await this._http._parallelLimit(successfulModules, processModuleContainment, concurrency);

    const dependencyResults = await this.createDependencyEdgesBatch(edges);

    const result = {
      modules: {
        success: modulesResult.success,
        failed: modulesResult.failed,
        errors: modulesResult.errors,
      },
      containmentEdges: containmentResults,
      dependencyEdges: dependencyResults,
    };

    this._http.log.info(
      {
        projectId,
        modulesSuccess: result.modules.success,
        modulesFailed: result.modules.failed,
        containmentEdgesSuccess: result.containmentEdges.success,
        containmentEdgesFailed: result.containmentEdges.failed,
        dependencyEdgesSuccess: result.dependencyEdges.success,
        dependencyEdgesFailed: result.dependencyEdges.failed,
      },
      'Module sync completed'
    );

    return result;
  }

  async _createProjectModuleContainmentEdge(projectId, moduleName) {
    const sourceName = `Project:${projectId}`;
    const targetName = moduleName;

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
      fact: `Project ${projectId} contains module ${moduleName}`,
    };

    const result = await this._http._fetch(`${this._http.baseUrl}/entity-edge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    this._http.stats.edgesCreated = (this._http.stats.edgesCreated || 0) + 1;
    return result;
  }
}
