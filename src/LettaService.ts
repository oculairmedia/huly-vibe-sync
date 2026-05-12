import { LettaClient } from '@letta-ai/letta-client';
import { LettaConfig } from './letta/LettaConfig.js';
import { LettaAgentPersistenceService } from './letta/LettaAgentPersistenceService.js';
import { LettaMemoryService } from './letta/LettaMemoryService.js';
import { LettaAgentLifecycleService } from './letta/LettaAgentLifecycleService.js';
import { LettaToolService } from './letta/LettaToolService.js';
import { LettaFolderSourceService } from './letta/LettaFolderSourceService.js';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export class LettaService {
  _config: LettaConfig;
  client!: Any;
  baseURL!: string; apiURL!: string; password!: string;
  model!: string; embedding!: string;
  enableSleeptime!: boolean; sleeptimeFrequency!: number;
  lettaDir!: string; settingsPath!: string;
  controlAgentName!: string; sharedHumanBlockId!: string;
  _persistence!: LettaAgentPersistenceService;
  _memory!: LettaMemoryService;
  _lifecycle!: LettaAgentLifecycleService;
  _tools!: LettaToolService;
  _folders!: LettaFolderSourceService;
  _agentState!: Any; _folderCache!: Any; _sourceCache!: Any; _blockHashCache!: Any;
  _controlAgentCache: Any = null;
  fileService!: Any;

  constructor(baseURL: string, password: string, options: Record<string, unknown> = {}) {
    const client = new LettaClient({ baseUrl: baseURL, token: password });
    const config = new LettaConfig(baseURL, password, { ...options, client });

    this._config = config;
    Object.defineProperty(this, 'client', { get: () => this._config.client, set: (v: Any) => { this._config.client = v; }, enumerable: true, configurable: true });
    Object.defineProperty(this, 'baseURL', { value: config.baseURL, enumerable: true });
    Object.defineProperty(this, 'apiURL', { value: config.apiURL, enumerable: true });
    Object.defineProperty(this, 'password', { value: config.password, enumerable: true });
    Object.defineProperty(this, 'model', { value: config.model, enumerable: true });
    Object.defineProperty(this, 'embedding', { value: config.embedding, enumerable: true });
    Object.defineProperty(this, 'enableSleeptime', { value: config.enableSleeptime, enumerable: true });
    Object.defineProperty(this, 'sleeptimeFrequency', { value: config.sleeptimeFrequency, enumerable: true });
    Object.defineProperty(this, 'lettaDir', { value: config.lettaDir, enumerable: true });
    Object.defineProperty(this, 'settingsPath', { value: config.settingsPath, enumerable: true });
    Object.defineProperty(this, 'controlAgentName', { get: () => config.controlAgentName, set: (v: string) => { config.controlAgentName = v; }, enumerable: true, configurable: true });
    Object.defineProperty(this, 'sharedHumanBlockId', { get: () => config.sharedHumanBlockId, set: (v: string) => { config.sharedHumanBlockId = v; }, enumerable: true, configurable: true });

    this._persistence = new LettaAgentPersistenceService(config) as Any;
    this._memory = new LettaMemoryService(config as Any);
    this._lifecycle = new LettaAgentLifecycleService(config as Any, this._memory as Any, this._persistence as Any);
    this._tools = new LettaToolService(config as Any, this._lifecycle as Any);
    this._folders = new LettaFolderSourceService(config as Any, this);

    this._agentState = (this._persistence as Any)._agentState;
    this._folderCache = (this._folders as Any)._folderCache;
    this._sourceCache = (this._folders as Any)._sourceCache;
    this._blockHashCache = (this._memory as Any)._blockHashCache;
    Object.defineProperty(this, '_controlAgentCache', { get: () => (this._lifecycle as Any)._controlAgentCache, set: (v: Any) => { (this._lifecycle as Any)._controlAgentCache = v; }, enumerable: true, configurable: true });
    this.fileService = (this._folders as Any).fileService;
  }

  clearCache(): void { this._folders.clearCache(); (this._lifecycle as Any).clearControlAgentCache(); (this as Any)._controlAgentCache = null; console.log('[Letta] Cache cleared'); }

  async ensureControlAgent(): Promise<Any> { return this._lifecycle.ensureControlAgent(); }
  async getControlAgentConfig(agentId: string | null = null): Promise<Any> { return this._lifecycle.getControlAgentConfig(agentId); }
  async ensureAgent(projectIdentifier: string, projectName: string): Promise<Any> { return this._lifecycle.ensureAgent(projectIdentifier, projectName); }
  async getAgent(agentId: string): Promise<Any> { return this._lifecycle.getAgent(agentId); }
  async listAgents(filters: Record<string, unknown> = {}): Promise<Any> { return this._lifecycle.listAgents(filters); }
  _buildPersonaBlock(projectIdentifier: string, projectName: string): Any { return this._lifecycle._buildPersonaBlock(projectIdentifier, projectName); }

  _loadAgentState(): Any { return (this._persistence as Any)._loadAgentState(); }
  _saveAgentState(): Any { return (this._persistence as Any)._saveAgentState(); }
  getPersistedAgentId(projectIdentifier: string): Any { return this._persistence.getPersistedAgentId(projectIdentifier); }
  saveAgentId(projectIdentifier: string, agentId: string): Any { return this._persistence.saveAgentId(projectIdentifier, agentId); }
  saveAgentIdToProjectFolder(projectPath: string, agentId: string, projectInfo?: Any): Any { return this._persistence.saveAgentIdToProjectFolder(projectPath, agentId, projectInfo); }
  updateAgentsMdWithProjectInfo(projectPath: string, agentId: string, projectInfo: Any): Any { return (this._persistence as Any).updateAgentsMdWithProjectInfo(projectPath, agentId, projectInfo); }

  async attachPmTools(agentId: string): Promise<Any> { return this._tools.attachPmTools(agentId); }
  async syncToolsFromControl(agentId: string, forceSync = false): Promise<Any> { return this._tools.syncToolsFromControl(agentId, forceSync); }
  async attachMcpTools(agentId: string): Promise<Any> { return this._tools.attachMcpTools(agentId); }
  async _ensureMcpTool(name: string, url: string): Promise<Any> { return this._tools._ensureMcpTool(name, url); }
  async ensureSearchFolderPassagesTool(): Promise<Any> { return this._tools.ensureSearchFolderPassagesTool(); }
  async attachSearchFolderPassagesTool(agentId: string): Promise<Any> { return this._tools.attachSearchFolderPassagesTool(agentId); }
  async setAgentIdEnvVar(agentId: string): Promise<Any> { return this._tools.setAgentIdEnvVar(agentId); }

  async _updatePersonaBlock(agentId: string, personaContent: string): Promise<Any> { return (this._memory as Any)._updatePersonaBlock(agentId, personaContent); }
  async _ensureTemplateBlocks(agentId: string, opts: Any): Promise<Any> { return (this._memory as Any)._ensureTemplateBlocks(agentId, opts); }
  async _attachSharedHumanBlock(agentId: string): Promise<Any> { return (this._memory as Any)._attachSharedHumanBlock(agentId); }
  async upsertMemoryBlocks(agentId: string, blocks: Any): Promise<Any> { return this._memory.upsertMemoryBlocks(agentId, blocks); }
  _hashContent(content: Any): Any { return this._memory._hashContent(content); }
  async initializeScratchpad(agentId: string): Promise<Any> { return this._memory.initializeScratchpad(agentId); }

  async ensureFolder(projectIdentifier: string, filesystemPath: string | null = null): Promise<Any> { return this._folders.ensureFolder(projectIdentifier, filesystemPath); }
  async attachFolderToAgent(agentId: string, folderId: string): Promise<Any> { return this._folders.attachFolderToAgent(agentId, folderId); }
  async listFolderFiles(folderId: string): Promise<Any> { return this._folders.listFolderFiles(folderId); }
  async closeAllFiles(agentId: string): Promise<Any> { return this._folders.closeAllFiles(agentId); }
  async ensureSource(sourceName: string, folderId: string | null = null): Promise<Any> { return this._folders.ensureSource(sourceName, folderId); }
  async discoverProjectFiles(projectPath: string, options: Any = { docsOnly: true }): Promise<Any> { return this._folders.discoverProjectFiles(projectPath, options); }
  async discoverProjectFilesLegacy(projectPath: string): Promise<Any> { return this._folders.discoverProjectFilesLegacy(projectPath); }
  async uploadProjectFiles(folderId: string, projectPath: string, files: Any, maxFiles = 50): Promise<Any> { return this._folders.uploadProjectFiles(folderId, projectPath, files, maxFiles); }
  computeFileHash(filePath: string): Any { return this._folders.computeFileHash(filePath); }
  async deleteFile(folderId: string, fileId: string): Promise<Any> { return this._folders.deleteFile(folderId, fileId); }
  async syncProjectFilesIncremental(folderId: string, projectPath: string, files: Any, db: Any, projectIdentifier: string): Promise<Any> { return this._folders.syncProjectFilesIncremental(folderId, projectPath, files, db, projectIdentifier); }
  async uploadReadme(sourceId: string, readmePath: string, projectIdentifier: string): Promise<Any> { return this._folders.uploadReadme(sourceId, readmePath, projectIdentifier); }
  async attachSourceToAgent(agentId: string, sourceId: string): Promise<Any> { return this._folders.attachSourceToAgent(agentId, sourceId); }
}

export function createLettaService(): LettaService {
  const baseURL = process.env.LETTA_BASE_URL!;
  const password = process.env.LETTA_PASSWORD!;
  if (!baseURL || !password) throw new Error('LETTA_BASE_URL and LETTA_PASSWORD must be set');
  return new LettaService(baseURL, password, { model: process.env.LETTA_MODEL, embedding: process.env.LETTA_EMBEDDING });
}

export { buildProjectMeta, buildBoardConfig, buildBoardMetrics, buildHotspots, buildBacklogSummary, buildRecentActivity, buildComponentsSummary, buildChangeLog, buildScratchpad, buildExpression } from './LettaMemoryBuilders.js';
export { LettaFileService } from './LettaFileService.js';
