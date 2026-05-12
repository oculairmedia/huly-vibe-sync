import type { GraphitiHttpClient } from './GraphitiHttpClient';
import type { GraphitiEntityOps } from './GraphitiEntityOps';
import type { GraphitiEdgeOps } from './GraphitiEdgeOps';

interface ModulePayload {
  name: string;
  summary: string;
}

interface ModuleBatchResult {
  success: number;
  failed: number;
  errors: Array<Record<string, unknown>>;
  successfulEntities?: string[];
}

interface DependencyEdgePayload {
  sourceModule: string;
  targetModule: string;
  fact: string;
}

interface EdgeBatchResult {
  success: number;
  failed: number;
  errors: Array<{ sourceModule?: string; targetModule?: string; module?: string; error: string }>;
}

interface SyncModulesOptions {
  projectId: string;
  modules: ModulePayload[];
  edges: DependencyEdgePayload[];
  concurrency?: number;
}

interface SyncModulesResult {
  modules: { success: number; failed: number; errors: Array<Record<string, unknown>> };
  containmentEdges: { success: number; failed: number; errors: Array<{ module?: string; error: string }> };
  dependencyEdges: { success: number; failed: number; errors: Array<{ sourceModule?: string; targetModule?: string; module?: string; error: string }> };
}

export class GraphitiModuleOps {
  private _http: GraphitiHttpClient;
  private _entities: GraphitiEntityOps;

  constructor(
    httpClient: GraphitiHttpClient,
    entityOps: GraphitiEntityOps,
    _edgeOps: GraphitiEdgeOps,
  ) {
    this._http = httpClient;
    this._entities = entityOps;
  }

  async upsertModule(options: ModulePayload): Promise<unknown> {
    const { name, summary } = options;
    return this._entities.upsertEntity({ name, summary });
  }

  async upsertModulesBatch(modules: ModulePayload[], batchSize: number = 50): Promise<ModuleBatchResult> {
    return this._entities.upsertEntitiesBatch(modules, batchSize);
  }

  async createDependencyEdge(
    sourceModuleName: string,
    targetModuleName: string,
    fact: string,
  ): Promise<unknown> {
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
      (this._http.log as unknown as { warn?: (ctx: Record<string, unknown>, msg: string) => void }).warn?.(
        { sourceModuleName, targetModuleName, error: (error as Error).message },
        'Failed to create module dependency edge',
      );
      throw error;
    }
  }

  async createDependencyEdgesBatch(edges: DependencyEdgePayload[], batchSize: number = 50): Promise<EdgeBatchResult> {
    const results: EdgeBatchResult = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < edges.length; i += batchSize) {
      const batch = edges.slice(i, i + batchSize);

      const batchPromises = batch.map(async (edge) => {
        try {
          await this.createDependencyEdge(edge.sourceModule, edge.targetModule, edge.fact);
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            sourceModule: edge.sourceModule,
            targetModule: edge.targetModule,
            error: (error as Error).message,
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

  async syncModules(options: SyncModulesOptions): Promise<SyncModulesResult> {
    const { projectId, modules, edges, concurrency = 10 } = options;

    const modulesResult = await this.upsertModulesBatch(modules);

    const containmentResults: { success: number; failed: number; errors: Array<{ module?: string; error: string }> } = {
      success: 0,
      failed: 0,
      errors: [],
    };
    const successfulModules = modulesResult.successfulEntities || [];

    const processModuleContainment = async (moduleName: string): Promise<void> => {
      try {
        await this._createProjectModuleContainmentEdge(projectId, moduleName);
        containmentResults.success++;
      } catch (error) {
        containmentResults.failed++;
        containmentResults.errors.push({ module: moduleName, error: (error as Error).message });
      }
    };

    await this._http._parallelLimit(successfulModules, processModuleContainment, concurrency);

    const dependencyResults = await this.createDependencyEdgesBatch(edges);

    const result: SyncModulesResult = {
      modules: {
        success: modulesResult.success,
        failed: modulesResult.failed,
        errors: modulesResult.errors,
      },
      containmentEdges: containmentResults,
      dependencyEdges: dependencyResults,
    };

    (this._http.log as unknown as { info?: (ctx: Record<string, unknown>, msg: string) => void }).info?.(
      {
        projectId,
        modulesSuccess: result.modules.success,
        modulesFailed: result.modules.failed,
        containmentEdgesSuccess: result.containmentEdges.success,
        containmentEdgesFailed: result.containmentEdges.failed,
        dependencyEdgesSuccess: result.dependencyEdges.success,
        dependencyEdgesFailed: result.dependencyEdges.failed,
      },
      'Module sync completed',
    );

    return result;
  }

  private async _createProjectModuleContainmentEdge(
    projectId: string,
    moduleName: string,
  ): Promise<unknown> {
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
