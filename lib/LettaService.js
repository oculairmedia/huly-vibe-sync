/**
 * LettaService — thin facade over focused sub-services.
 *
 * Every public method delegates to the appropriate sub-service.
 * Consumers see the identical API they always have.
 */

import { LettaClient } from '@letta-ai/letta-client';
import { LettaConfig } from './letta/LettaConfig.js';
import { LettaAgentPersistenceService } from './letta/LettaAgentPersistenceService.js';
import { LettaMemoryService } from './letta/LettaMemoryService.js';
import { LettaAgentLifecycleService } from './letta/LettaAgentLifecycleService.js';
import { LettaToolService } from './letta/LettaToolService.js';
import { LettaFolderSourceService } from './letta/LettaFolderSourceService.js';

export class LettaService {
  constructor(baseURL, password, options = {}) {
    // Create client — single instance shared by all sub-services via config.client.
    const client = new LettaClient({
      baseUrl: baseURL,
      token: password,
    });

    // Build shared config, injecting the client we just created
    const config = new LettaConfig(baseURL, password, { ...options, client });

    // Expose client with a setter so tests that do `service.client = mockClient`
    // also update config.client, keeping sub-services in sync.
    this._config = config;
    Object.defineProperty(this, 'client', {
      get: () => this._config.client,
      set: (v) => { this._config.client = v; },
      enumerable: true,
      configurable: true,
    });

    // Simple config properties (read-only after construction)
    this.baseURL = config.baseURL;
    this.apiURL = config.apiURL;
    this.password = config.password;
    this.model = config.model;
    this.embedding = config.embedding;
    this.enableSleeptime = config.enableSleeptime;
    this.sleeptimeFrequency = config.sleeptimeFrequency;
    this.lettaDir = config.lettaDir;
    this.settingsPath = config.settingsPath;

    // Mutable config properties — tests set these on the facade, so proxy to config
    Object.defineProperty(this, 'controlAgentName', {
      get: () => config.controlAgentName,
      set: (v) => { config.controlAgentName = v; },
      enumerable: true, configurable: true,
    });
    Object.defineProperty(this, 'sharedHumanBlockId', {
      get: () => config.sharedHumanBlockId,
      set: (v) => { config.sharedHumanBlockId = v; },
      enumerable: true, configurable: true,
    });

    // Build sub-services (order matters — lifecycle depends on memory + persistence)
    this._persistence = new LettaAgentPersistenceService(config);
    this._memory = new LettaMemoryService(config);
    this._lifecycle = new LettaAgentLifecycleService(config, this._memory, this._persistence);
    this._tools = new LettaToolService(config, this._lifecycle);
    // Pass `this` as host so LettaFileService picks up test mocks on this.client
    this._folders = new LettaFolderSourceService(config, this);

    // Expose _agentState for backward compatibility (tests access it)
    this._agentState = this._persistence._agentState;

    // Legacy caches exposed for backward compatibility
    this._folderCache = this._folders._folderCache;
    this._sourceCache = this._folders._sourceCache;
    this._blockHashCache = this._memory._blockHashCache;

    // _controlAgentCache — proxy to lifecycle service
    Object.defineProperty(this, '_controlAgentCache', {
      get: () => this._lifecycle._controlAgentCache,
      set: (v) => { this._lifecycle._controlAgentCache = v; },
      enumerable: true, configurable: true,
    });

    // Expose fileService for direct access
    this.fileService = this._folders.fileService;
  }

  // ── Cache ───────────────────────────────────────────────────

  clearCache() {
    this._folders.clearCache();
    this._lifecycle.clearControlAgentCache();
    this._controlAgentCache = null;
    console.log(`[Letta] Cache cleared (block hash cache retained)`);
  }

  // ── Agent Lifecycle ─────────────────────────────────────────

  async ensureControlAgent() {
    return this._lifecycle.ensureControlAgent();
  }

  async getControlAgentConfig(agentId = null) {
    return this._lifecycle.getControlAgentConfig(agentId);
  }

  async ensureAgent(projectIdentifier, projectName) {
    return this._lifecycle.ensureAgent(projectIdentifier, projectName);
  }

  async getAgent(agentId) {
    return this._lifecycle.getAgent(agentId);
  }

  async listAgents(filters = {}) {
    return this._lifecycle.listAgents(filters);
  }

  _buildPersonaBlock(projectIdentifier, projectName) {
    return this._lifecycle._buildPersonaBlock(projectIdentifier, projectName);
  }

  // ── Agent Persistence ───────────────────────────────────────

  _loadAgentState() {
    return this._persistence._loadAgentState();
  }

  _saveAgentState() {
    return this._persistence._saveAgentState();
  }

  getPersistedAgentId(projectIdentifier) {
    return this._persistence.getPersistedAgentId(projectIdentifier);
  }

  saveAgentId(projectIdentifier, agentId) {
    return this._persistence.saveAgentId(projectIdentifier, agentId);
  }

  saveAgentIdToProjectFolder(projectPath, agentId, projectInfo = null) {
    return this._persistence.saveAgentIdToProjectFolder(projectPath, agentId, projectInfo);
  }

  updateAgentsMdWithProjectInfo(projectPath, agentId, projectInfo) {
    return this._persistence.updateAgentsMdWithProjectInfo(projectPath, agentId, projectInfo);
  }

  // ── Tools ───────────────────────────────────────────────────

  async attachPmTools(agentId) {
    return this._tools.attachPmTools(agentId);
  }

  async syncToolsFromControl(agentId, forceSync = false) {
    return this._tools.syncToolsFromControl(agentId, forceSync);
  }

  async attachMcpTools(agentId, hulyMcpUrl, vibeMcpUrl) {
    return this._tools.attachMcpTools(agentId, hulyMcpUrl, vibeMcpUrl);
  }

  async _ensureMcpTool(name, url) {
    return this._tools._ensureMcpTool(name, url);
  }

  async ensureSearchFolderPassagesTool() {
    return this._tools.ensureSearchFolderPassagesTool();
  }

  async attachSearchFolderPassagesTool(agentId) {
    return this._tools.attachSearchFolderPassagesTool(agentId);
  }

  async setAgentIdEnvVar(agentId) {
    return this._tools.setAgentIdEnvVar(agentId);
  }

  // ── Memory ──────────────────────────────────────────────────

  async _updatePersonaBlock(agentId, personaContent) {
    return this._memory._updatePersonaBlock(agentId, personaContent);
  }

  async _ensureTemplateBlocks(agentId) {
    return this._memory._ensureTemplateBlocks(agentId);
  }

  async _attachSharedHumanBlock(agentId) {
    return this._memory._attachSharedHumanBlock(agentId);
  }

  async upsertMemoryBlocks(agentId, blocks) {
    return this._memory.upsertMemoryBlocks(agentId, blocks);
  }

  _hashContent(content) {
    return this._memory._hashContent(content);
  }

  async initializeScratchpad(agentId) {
    return this._memory.initializeScratchpad(agentId);
  }

  // ── Folders / Sources / Files ───────────────────────────────

  async ensureFolder(projectIdentifier, filesystemPath = null) {
    return this._folders.ensureFolder(projectIdentifier, filesystemPath);
  }

  async attachFolderToAgent(agentId, folderId) {
    return this._folders.attachFolderToAgent(agentId, folderId);
  }

  async listFolderFiles(folderId) {
    return this._folders.listFolderFiles(folderId);
  }

  async closeAllFiles(agentId) {
    return this._folders.closeAllFiles(agentId);
  }

  async ensureSource(sourceName, folderId = null) {
    return this._folders.ensureSource(sourceName, folderId);
  }

  async discoverProjectFiles(projectPath, options = { docsOnly: true }) {
    return this._folders.discoverProjectFiles(projectPath, options);
  }

  async discoverProjectFilesLegacy(projectPath) {
    return this._folders.discoverProjectFilesLegacy(projectPath);
  }

  async uploadProjectFiles(folderId, projectPath, files, maxFiles = 50) {
    return this._folders.uploadProjectFiles(folderId, projectPath, files, maxFiles);
  }

  computeFileHash(filePath) {
    return this._folders.computeFileHash(filePath);
  }

  async deleteFile(folderId, fileId) {
    return this._folders.deleteFile(folderId, fileId);
  }

  async syncProjectFilesIncremental(folderId, projectPath, files, db, projectIdentifier) {
    return this._folders.syncProjectFilesIncremental(
      folderId,
      projectPath,
      files,
      db,
      projectIdentifier
    );
  }

  async uploadReadme(sourceId, readmePath, projectIdentifier) {
    return this._folders.uploadReadme(sourceId, readmePath, projectIdentifier);
  }

  async attachSourceToAgent(agentId, sourceId) {
    return this._folders.attachSourceToAgent(agentId, sourceId);
  }
}

/**
 * Create and initialize LettaService from environment variables
 *
 * @returns {LettaService}
 */
export function createLettaService() {
  const baseURL = process.env.LETTA_BASE_URL;
  const password = process.env.LETTA_PASSWORD;

  if (!baseURL || !password) {
    throw new Error('LETTA_BASE_URL and LETTA_PASSWORD must be set');
  }

  return new LettaService(baseURL, password, {
    model: process.env.LETTA_MODEL,
    embedding: process.env.LETTA_EMBEDDING,
  });
}

// Re-export memory builders from dedicated module
export {
  buildProjectMeta,
  buildBoardConfig,
  buildBoardMetrics,
  buildHotspots,
  buildBacklogSummary,
  buildRecentActivity,
  buildComponentsSummary,
  buildChangeLog,
  buildScratchpad,
  buildExpression,
} from './LettaMemoryBuilders.js';

// Re-export LettaFileService for direct access
export { LettaFileService } from './LettaFileService.js';
