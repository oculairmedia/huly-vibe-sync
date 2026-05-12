import { fetchWithPool } from '../http';
import { LettaFileService, type LettaServiceHost, type SyncDatabase } from '../LettaFileService.js';

interface LettaClient {
  folders: { list: (opts: Record<string, unknown>) => Promise<{ id: string; [key: string]: unknown }[]>; create: (data: Record<string, unknown>) => Promise<{ id: string; [key: string]: unknown }> };
  agents: { folders: { list: (agentId: string) => Promise<{ id: string }[]>; attach: (agentId: string, folderId: string) => Promise<void> }; sources: { list: (agentId: string) => Promise<{ id: string }[]>; attach: (agentId: string, sourceId: string) => Promise<void> } };
  sources: { list: (opts?: Record<string, unknown>) => Promise<{ name: string; id: string; [key: string]: unknown }[]>; create: (data: Record<string, unknown>) => Promise<{ id: string; name: string }> };
}

interface FolderConfig {
  client: LettaClient;
  apiURL: string;
  password: string;
  embedding?: string;
}

type FolderRecord = { id: string; [key: string]: unknown };
type SourceRecord = { id: string | null; name: string; [key: string]: unknown };

export class LettaFolderSourceService {
  config: FolderConfig;
  fileService: LettaFileService;
  _folderCache = new Map<string, FolderRecord>();
  _sourceCache = new Map<string, SourceRecord>();

  constructor(config: FolderConfig, host: LettaServiceHost) {
    this.config = config;
    this.fileService = new LettaFileService(host);
  }

  clearCache(): void { this._folderCache.clear(); this._sourceCache.clear(); }

  async ensureFolder(projectIdentifier: string, filesystemPath: string | null = null): Promise<FolderRecord> {
    const client = this.config.client;
    const folderName = `PM-${projectIdentifier}`;
    if (this._folderCache.has(folderName)) { const cached = this._folderCache.get(folderName)!; console.log(`[Letta] Folder exists (cached): ${cached.id}`); return cached; }
    console.log(`[Letta] Ensuring folder exists: ${folderName}`);
    try {
      const folders = await client.folders.list({ name: folderName, limit: 1 });
      if (folders && folders.length > 0) { const f = folders[0]!; console.log(`[Letta] Folder already exists: ${f.id}`); this._folderCache.set(folderName, f); return f; }
      console.log(`[Letta] Creating new folder: ${folderName}`);
      const fd: Record<string, unknown> = { name: folderName, description: filesystemPath ? `Filesystem folder for ${projectIdentifier} project at ${filesystemPath}` : `Documentation folder for ${projectIdentifier} project`, embedding: this.config.embedding };
      if (filesystemPath) fd.metadata = { filesystem_path: filesystemPath };
      const folder = await client.folders.create(fd); console.log(`[Letta] Folder created successfully: ${folder.id}`); this._folderCache.set(folderName, folder); return folder;
    } catch (error) { console.error('[Letta] Error ensuring folder:', (error as Error).message); throw error; }
  }

  async attachFolderToAgent(agentId: string, folderId: string): Promise<void> {
    const client = this.config.client;
    console.log(`[Letta] Attaching folder ${folderId} to agent ${agentId}`);
    try {
      const attachedFolders = await client.agents.folders.list(agentId);
      if (attachedFolders.some(f => f.id === folderId)) { console.log('[Letta] Folder already attached to agent'); return; }
      await client.agents.folders.attach(agentId, folderId); console.log(`[Letta] Folder ${folderId} attached to agent ${agentId}`);
    } catch (error) { console.error('[Letta] Error attaching folder to agent:', (error as Error).message); throw error; }
  }

  async listFolderFiles(folderId: string): Promise<Record<string, unknown>[]> { return this.fileService.listFolderFiles(folderId); }
  async closeAllFiles(agentId: string): Promise<void> { return this.fileService.closeAllFiles(agentId); }

  async ensureSource(sourceName: string, _folderId: string | null = null): Promise<SourceRecord> {
    const client = this.config.client; const { apiURL, password } = this.config;
    if (this._sourceCache.has(sourceName)) { const cached = this._sourceCache.get(sourceName)!; console.log(`[Letta] Source exists (cached): ${cached.id}`); return cached; }
    console.log(`[Letta] Ensuring source exists: ${sourceName}`);
    try {
      const sources = await client.sources.list();
      sources.forEach(s => { this._sourceCache.set(s.name, s); });
      const existingSource = sources.find(s => s.name === sourceName);
      if (existingSource) { console.log(`[Letta] Source already exists: ${existingSource.id}`); return existingSource; }
      console.log(`[Letta] Creating new source: ${sourceName}`);
      const source = await client.sources.create({ name: sourceName, description: `Source for ${sourceName}`, embedding: this.config.embedding }); console.log(`[Letta] Source created: ${source.id}`); this._sourceCache.set(sourceName, source); return source;
    } catch (error) {
      if ((error as Error).message?.includes('409')) {
        console.log(`[Letta] Source ${sourceName} already exists (409), fetching...`);
        try {
          const response = await fetchWithPool(`${apiURL}/sources?name=${encodeURIComponent(sourceName)}&limit=10`, { method: 'GET', headers: { Authorization: `Bearer ${password}`, 'Content-Type': 'application/json' } });
          if (response.ok) { const foundSources = await response.json() as { name: string; id: string }[]; const found = foundSources.find(s => s.name === sourceName); if (found) { console.log(`[Letta] Found existing source via REST: ${found.id}`); this._sourceCache.set(sourceName, found); return found; } }
          const allSources = await client.sources.list({ limit: 200 }); allSources.forEach(s => { this._sourceCache.set(s.name, s); });
          const foundSource = allSources.find(s => s.name === sourceName); if (foundSource) { console.log(`[Letta] Found existing source via SDK: ${foundSource.id}`); return foundSource; }
          return { id: null, name: sourceName, _placeholder: true };
        } catch (refetchError) { console.error('[Letta] Failed to refetch source after 409:', (refetchError as Error).message); return { id: null, name: sourceName, _placeholder: true }; }
      }
      console.error(`[Letta] Error ensuring source ${sourceName}:`, (error as Error).message); throw error;
    }
  }

  async discoverProjectFiles(projectPath: string, options: { docsOnly?: boolean; maxFiles?: number } = { docsOnly: true }): Promise<string[]> { return this.fileService.discoverProjectFiles(projectPath, options); }
  async discoverProjectFilesLegacy(projectPath: string): Promise<string[]> { return this.fileService.discoverProjectFilesLegacy(projectPath); }
  async uploadProjectFiles(folderId: string, projectPath: string, files: string[], maxFiles?: number): Promise<Record<string, unknown>[]> { return this.fileService.uploadProjectFiles(folderId, projectPath, files, maxFiles); }
  computeFileHash(filePath: string): string { return this.fileService.computeFileHash(filePath); }
  async deleteFile(folderId: string, fileId: string): Promise<void> { return this.fileService.deleteFile(folderId, fileId); }
  async syncProjectFilesIncremental(folderId: string, projectPath: string, files: string[], db: SyncDatabase, projectIdentifier: string): Promise<{ uploaded: number; deleted: number; skipped: number; errors: number }> { return this.fileService.syncProjectFilesIncremental(folderId, projectPath, files, db, projectIdentifier); }
  async uploadReadme(sourceId: string, readmePath: string, projectIdentifier: string): Promise<Record<string, unknown> | null> { return this.fileService.uploadReadme(sourceId, readmePath, projectIdentifier); }

  async attachSourceToAgent(agentId: string, sourceId: string): Promise<void> {
    const client = this.config.client; console.log(`[Letta] Attaching source ${sourceId} to agent ${agentId}`);
    try {
      const attachedSources = await client.agents.sources.list(agentId);
      if (attachedSources.some(s => s.id === sourceId)) { console.log('[Letta] Source already attached'); return; }
      await client.agents.sources.attach(agentId, sourceId); console.log(`[Letta] Source ${sourceId} attached to agent ${agentId}`);
    } catch (error) { console.error('[Letta] Error attaching source:', (error as Error).message); throw error; }
  }
}
