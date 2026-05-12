import { GraphitiHttpClient } from './graphiti/GraphitiHttpClient';
import { GraphitiEntityOps } from './graphiti/GraphitiEntityOps';
import { GraphitiEdgeOps } from './graphiti/GraphitiEdgeOps';
import { GraphitiFunctionOps } from './graphiti/GraphitiFunctionOps';
import { GraphitiModuleOps } from './graphiti/GraphitiModuleOps';

export { RateLimiter } from './graphiti/GraphitiHttpClient';

interface GraphitiClientOptions {
  baseUrl: string;
  groupId: string;
  timeout?: number;
  retries?: number;
}

interface MessageOptions {
  content: string;
  name?: string;
  role?: string;
  timestamp?: Date;
}

interface GraphitiConfig {
  graphiti?: {
    enabled?: boolean;
    astEnabled?: boolean;
    apiUrl?: string;
    groupIdPrefix?: string;
    astGroupIdPrefix?: string;
    timeout?: number;
    retries?: number;
  };
}

export class GraphitiClient {
  private _http: GraphitiHttpClient;
  private _entities: GraphitiEntityOps;
  private _edges: GraphitiEdgeOps;
  private _functions: GraphitiFunctionOps;
  private _modules: GraphitiModuleOps;

  constructor(options: GraphitiClientOptions) {
    this._http = new GraphitiHttpClient(options);
    this._entities = new GraphitiEntityOps(this._http);
    this._edges = new GraphitiEdgeOps(this._http);
    this._functions = new GraphitiFunctionOps(this._http, this._entities, this._edges);
    this._modules = new GraphitiModuleOps(this._http, this._entities, this._edges);
  }

  get baseUrl(): string { return this._http.baseUrl; }
  get groupId(): string { return this._http.groupId; }
  get timeout(): number { return this._http.timeout; }
  get retries(): number { return this._http.retries; }
  get retryDelayMs(): number { return this._http.retryDelayMs; }
  get log() { return this._http.log; }
  get stats() { return this._http.stats; }
  set stats(v) { this._http.stats = v; }
  get uuidCache(): Map<string, string> | undefined { return this._http.uuidCache; }
  set uuidCache(v: Map<string, string> | undefined) { this._http.uuidCache = v as Map<string, string>; }

  getEntityUuid(...args: Parameters<GraphitiHttpClient['getEntityUuid']>) {
    return this._http.getEntityUuid(...args);
  }
  getEdgeUuid(...args: Parameters<GraphitiHttpClient['getEdgeUuid']>) {
    return this._http.getEdgeUuid(...args);
  }

  upsertEntity(...args: Parameters<GraphitiEntityOps['upsertEntity']>) {
    return this._entities.upsertEntity(...args);
  }
  upsertEntitiesBatch(...args: Parameters<GraphitiEntityOps['upsertEntitiesBatch']>) {
    return this._entities.upsertEntitiesBatch(...args);
  }
  updateNodeSummary(...args: Parameters<GraphitiEntityOps['updateNodeSummary']>) {
    return this._entities.updateNodeSummary(...args);
  }
  pruneDeletedFiles(...args: Parameters<GraphitiEntityOps['pruneDeletedFiles']>) {
    return this._entities.pruneDeletedFiles(...args);
  }

  createContainmentEdge(...args: Parameters<GraphitiEdgeOps['createContainmentEdge']>) {
    return this._edges.createContainmentEdge(...args);
  }
  _createEdgeViaMessageQueue(...args: Parameters<GraphitiEdgeOps['_createEdgeViaMessageQueue']>) {
    return this._edges._createEdgeViaMessageQueue(...args);
  }
  createContainmentEdgesBatch(...args: Parameters<GraphitiEdgeOps['createContainmentEdgesBatch']>) {
    return this._edges.createContainmentEdgesBatch(...args);
  }
  createFileFunctionEdge(...args: Parameters<GraphitiEdgeOps['createFileFunctionEdge']>) {
    return this._edges.createFileFunctionEdge(...args);
  }

  upsertFunction(...args: Parameters<GraphitiFunctionOps['upsertFunction']>) {
    return this._functions.upsertFunction(...args);
  }
  _buildFunctionSummary(...args: Parameters<GraphitiFunctionOps['_buildFunctionSummary']>) {
    return this._functions['_buildFunctionSummary'](...args);
  }
  upsertFunctionsWithEdges(...args: Parameters<GraphitiFunctionOps['upsertFunctionsWithEdges']>) {
    return this._functions.upsertFunctionsWithEdges(...args);
  }
  deleteFunctions(...args: Parameters<GraphitiFunctionOps['deleteFunctions']>) {
    return this._functions.deleteFunctions(...args);
  }
  syncFilesWithFunctions(...args: Parameters<GraphitiFunctionOps['syncFilesWithFunctions']>) {
    return this._functions.syncFilesWithFunctions(...args);
  }

  upsertModule(...args: Parameters<GraphitiModuleOps['upsertModule']>) {
    return this._modules.upsertModule.apply(this._modules, args);
  }
  upsertModulesBatch(...args: Parameters<GraphitiModuleOps['upsertModulesBatch']>) {
    return this._modules.upsertModulesBatch.apply(this._modules, args);
  }
  createDependencyEdge(...args: Parameters<GraphitiModuleOps['createDependencyEdge']>) {
    return this._modules.createDependencyEdge.apply(this._modules, args);
  }
  createDependencyEdgesBatch(...args: Parameters<GraphitiModuleOps['createDependencyEdgesBatch']>) {
    return this._modules.createDependencyEdgesBatch.apply(this._modules, args);
  }
  syncModules(...args: Parameters<GraphitiModuleOps['syncModules']>) {
    return this._modules.syncModules.apply(this._modules, args);
  }

  async addMessage(options: MessageOptions): Promise<unknown> {
    const message = {
      content: options.content,
      name: options.name || 'code_update',
      role: options.role || 'code_analyzer',
      role_type: 'user',
      timestamp: (options.timestamp || new Date()).toISOString(),
    };

    (this._http.log as unknown as { debug?: (ctx: Record<string, unknown>, msg: string) => void }).debug?.(
      { name: message.name },
      'Adding message',
    );

    return this._http._fetch(`${this._http.baseUrl}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id: this._http.groupId,
        messages: [message],
      }),
    });
  }

  getStats() { return this._http.getStats(); }
  resetStats() { return this._http.resetStats(); }
  healthCheck() { return this._http.healthCheck(); }

  _fetch(...args: Parameters<GraphitiHttpClient['_fetch']>) {
    return this._http._fetch(...args);
  }
  _isRetryableError(...args: Parameters<GraphitiHttpClient['_isRetryableError']>) {
    return this._http._isRetryableError(...args);
  }
  _delay(...args: Parameters<GraphitiHttpClient['_delay']>) {
    return this._http._delay(...args);
  }
  _parallelLimit(items: unknown[], operation: (item: unknown) => Promise<unknown>, limit: number) {
    return this._http._parallelLimit(items, operation, limit);
  }
}

export function createGraphitiClient(
  config: GraphitiConfig,
  projectIdentifier: string,
): GraphitiClient | null {
  if (!config.graphiti?.enabled) {
    return null;
  }

  const groupId = `${config.graphiti.groupIdPrefix || 'vibesync_'}${projectIdentifier}`;

  return new GraphitiClient({
    baseUrl: config.graphiti.apiUrl ?? '',
    groupId,
    timeout: config.graphiti.timeout || 30000,
    retries: config.graphiti.retries || 3,
  });
}

export function createAstGraphitiClient(
  config: GraphitiConfig,
  projectIdentifier: string,
): GraphitiClient | null {
  if (!config.graphiti?.enabled || config.graphiti?.astEnabled === false) {
    return null;
  }

  const groupId = `${config.graphiti.astGroupIdPrefix || 'ast_'}${projectIdentifier}`;

  return new GraphitiClient({
    baseUrl: config.graphiti.apiUrl ?? '',
    groupId,
    timeout: config.graphiti.timeout || 30000,
    retries: config.graphiti.retries || 3,
  });
}
